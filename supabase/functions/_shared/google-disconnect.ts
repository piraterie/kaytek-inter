// supabase/functions/_shared/google-disconnect.ts
//
// Déconnexion d'un service Google (Ads ou Business Profile) d'UNE organisation,
// sans casser les autres connexions qui reposent sur la même autorisation Google.
//
// POURQUOI : Ads et Business Profile utilisent le même client OAuth. Chaque
// connexion a ses propres secrets Vault (et son propre refresh token), mais
// l'AUTORISATION Google (compte Google × client OAuth) est partagée : révoquer
// un jeton chez Google (oauth2.googleapis.com/revoke) invalide l'autorisation,
// donc les jetons de TOUS les services et de TOUTES les organisations qui
// utilisent ce compte Google. Constaté en production le 2026-09-21 : la
// déconnexion de Business Profile a rendu invalide le jeton Google Ads.
//
// RÈGLE :
//  1. la connexion demandée est TOUJOURS déconnectée localement ;
//  2. l'autorisation Google n'est révoquée que si cette connexion est la
//     DERNIÈRE connexion encore active (status = 'connected') utilisant le même
//     compte Google — recherche sur les deux tables et toutes les organisations ;
//  3. e-mail Google comparé sans tenir compte de la casse ;
//  4. e-mail absent (connexion ancienne) : prudence, pas de révocation ;
//  5. en cas de doute (recherche impossible, e-mail inconnu) : PAS de révocation.
//     Le pire cas d'un doute est une autorisation qui reste active côté Google
//     (retirable depuis les paramètres du compte Google) ; le pire cas d'une
//     révocation abusive est de casser un autre service ou une autre organisation.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  connectionsTable, logOAuthEvent, vaultReadSecret, vaultDeleteSecret, GOOGLE_REVOKE_ENDPOINT,
  type GoogleProvider,
} from './google-oauth.ts'

export type RevokeReason =
  | 'last_connection'      // aucune autre connexion active : on révoque
  | 'other_accounts_only'  // d'autres connexions actives, mais sur d'autres comptes Google : on révoque
  | 'grant_shared'         // une autre connexion active utilise le même compte Google : on garde
  | 'unknown_email'        // un e-mail manque (cette connexion ou une autre) : prudence, on garde
  | 'lookup_failed'        // recherche des autres connexions impossible : prudence, on garde
  | 'already_disconnected' // rien à faire

export interface RevokeDecision { revoke: boolean; reason: RevokeReason }
export interface OtherActiveConnection { email: string | null }

const normEmail = (e: string | null | undefined): string | null => {
  const v = (e ?? '').trim().toLowerCase()
  return v === '' ? null : v
}

/** Décision pure : faut-il révoquer l'autorisation Google en déconnectant cette connexion ? */
export function decideGrantRevocation(currentEmail: string | null | undefined, others: OtherActiveConnection[]): RevokeDecision {
  if (others.length === 0) return { revoke: true, reason: 'last_connection' }
  const cur = normEmail(currentEmail)
  if (cur === null) return { revoke: false, reason: 'unknown_email' }
  const otherEmails = others.map((o) => normEmail(o.email))
  if (otherEmails.some((e) => e === null)) return { revoke: false, reason: 'unknown_email' }
  if (otherEmails.some((e) => e === cur)) return { revoke: false, reason: 'grant_shared' }
  return { revoke: true, reason: 'other_accounts_only' }
}

const PROVIDERS: GoogleProvider[] = ['google_ads', 'google_business']

/**
 * Autres connexions ACTIVES (status = 'connected'), tous services et toutes
 * organisations confondus, en excluant la connexion en cours de déconnexion.
 * Nécessite le client service_role (lecture inter-organisations).
 */
export async function findOtherActiveConnections(
  svc: SupabaseClient, provider: GoogleProvider, organisationId: string,
): Promise<{ ok: true; others: OtherActiveConnection[] } | { ok: false }> {
  const others: OtherActiveConnection[] = []
  for (const p of PROVIDERS) {
    const { data, error } = await svc
      .from(connectionsTable(p))
      .select('organisation_id, google_account_email')
      .eq('status', 'connected')
    if (error) return { ok: false }
    for (const row of (data ?? []) as { organisation_id: string; google_account_email: string | null }[]) {
      if (p === provider && row.organisation_id === organisationId) continue // la connexion elle-même
      others.push({ email: row.google_account_email })
    }
  }
  return { ok: true, others }
}

export interface DisconnectDeps {
  svc: SupabaseClient
  fetchFn?: typeof fetch
  readSecret?: (svc: SupabaseClient, id: string) => Promise<string | null>
  deleteSecret?: (svc: SupabaseClient, id: string) => Promise<void>
  logEvent?: typeof logOAuthEvent
}

export type DisconnectResult =
  | { ok: true; status: 'disconnected'; grantRevoked: boolean; reason: RevokeReason }
  | { ok: false; error: string }

export async function disconnectGoogleService(
  deps: DisconnectDeps, provider: GoogleProvider, organisationId: string,
): Promise<DisconnectResult> {
  const { svc } = deps
  const doFetch = deps.fetchFn ?? fetch
  const readSecret = deps.readSecret ?? vaultReadSecret
  const deleteSecret = deps.deleteSecret ?? vaultDeleteSecret
  const logEvent = deps.logEvent ?? logOAuthEvent
  const table = connectionsTable(provider)

  // WHERE organisation_id = organisationId (dérivée du JWT par l'appelant) — ne
  // peut jamais toucher la connexion d'une autre organisation.
  const { data: connection, error: fetchErr } = await svc
    .from(table)
    .select('id, status, access_token_secret_id, refresh_token_secret_id, google_account_email')
    .eq('organisation_id', organisationId)
    .maybeSingle()

  if (fetchErr) {
    console.error('[google-oauth-disconnect] Erreur lecture connexion:', fetchErr.message)
    return { ok: false, error: 'Erreur serveur' }
  }
  if (!connection || connection.status === 'disconnected') {
    // Idempotent : déjà déconnecté (ou jamais connecté) → succès sans effet.
    return { ok: true, status: 'disconnected', grantRevoked: false, reason: 'already_disconnected' }
  }

  // ── Décision de révocation — AVANT toute modification locale (l'e-mail est
  // effacé par la mise à jour finale). ──────────────────────────────────────
  const lookup = await findOtherActiveConnections(svc, provider, organisationId)
  const decision: RevokeDecision = lookup.ok
    ? decideGrantRevocation(connection.google_account_email, lookup.others)
    : { revoke: false, reason: 'lookup_failed' }

  // ── Révocation côté Google — uniquement si dernière connexion active sur ce
  // compte. Au mieux, jamais bloquante : même si Google refuse ou est
  // injoignable, la déconnexion locale doit réussir. ────────────────────────
  let grantRevoked = false
  if (decision.revoke) {
    const tokenToRevoke = connection.refresh_token_secret_id ?? connection.access_token_secret_id
    if (tokenToRevoke) {
      try {
        const tokenValue = await readSecret(svc, tokenToRevoke)
        if (tokenValue) {
          const revokeRes = await doFetch(GOOGLE_REVOKE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokenValue }),
          })
          grantRevoked = revokeRes.ok
          if (!revokeRes.ok) {
            console.warn('[google-oauth-disconnect] Révocation Google non confirmée (non bloquant), status:', revokeRes.status)
          }
        }
      } catch (e) {
        console.warn('[google-oauth-disconnect] Révocation Google échouée (non bloquant):', e instanceof Error ? e.message : String(e))
      }
    }
  }

  // ── Suppression des secrets Vault de CETTE connexion (jamais orphelins) ───
  for (const secretId of [connection.access_token_secret_id, connection.refresh_token_secret_id]) {
    if (!secretId) continue
    try {
      await deleteSecret(svc, secretId)
    } catch (e) {
      console.error('[google-oauth-disconnect] Échec suppression secret Vault (continue):', e instanceof Error ? e.message : String(e))
    }
  }

  const { error: updateErr } = await svc
    .from(table)
    .update({
      status: 'disconnected',
      access_token_secret_id: null,
      refresh_token_secret_id: null,
      token_expires_at: null,
      google_account_email: null,
      last_error: null,
    })
    .eq('organisation_id', organisationId)

  if (updateErr) {
    console.error('[google-oauth-disconnect] Échec mise à jour connexion:', updateErr.message)
    return { ok: false, error: 'Erreur serveur' }
  }

  // Audit : jamais d'e-mail ni de jeton — seulement la décision et sa raison.
  await logEvent(svc, organisationId, provider, 'disconnected',
    `autorisation_google=${grantRevoked ? 'revoquee' : 'conservee'} (${decision.reason})`)

  return { ok: true, status: 'disconnected', grantRevoked, reason: decision.reason }
}
