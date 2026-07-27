// supabase/functions/google-oauth-disconnect/index.ts — Phase 2
//
// Déconnecte le compte Google (Ads ou Business Profile) de l'organisation
// de l'administrateur appelant. Organisation TOUJOURS dérivée de
// auth.uid() — un organisation_id envoyé par le client n'est jamais lu.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  corsHeaders, respond, requireActiveAdmin, serviceClient, connectionsTable, logOAuthEvent,
  vaultReadSecret, vaultDeleteSecret, GOOGLE_REVOKE_ENDPOINT, isValidProvider,
} from '../_shared/google-oauth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }
  const { provider } = body
  if (!isValidProvider(provider)) {
    return respond({ error: "provider invalide — attendu 'google_ads' ou 'google_business'" }, 400)
  }

  const svc = serviceClient()
  const table = connectionsTable(provider)

  // WHERE organisation_id = auth.organisationId (dérivée du JWT) — ne
  // peut donc jamais toucher la connexion d'une autre organisation, quel
  // que soit ce que le client aurait pu tenter d'envoyer.
  const { data: connection, error: fetchErr } = await svc
    .from(table)
    .select('id, status, access_token_secret_id, refresh_token_secret_id')
    .eq('organisation_id', auth.organisationId)
    .maybeSingle()

  if (fetchErr) {
    console.error('[google-oauth-disconnect] Erreur lecture connexion:', fetchErr.message)
    return respond({ error: 'Erreur serveur' }, 500)
  }

  if (!connection || connection.status === 'disconnected') {
    // Idempotent : déjà déconnecté (ou jamais connecté) → succès sans effet.
    return respond({ ok: true, status: 'disconnected' })
  }

  // ── Révocation côté Google — best-effort, jamais bloquant : même si
  // Google refuse ou est injoignable, la déconnexion locale doit réussir
  // (sinon un admin ne pourrait jamais se déconnecter en cas de panne
  // Google, ce qui serait pire du point de vue sécurité). ───────────────
  const tokenToRevoke = connection.refresh_token_secret_id ?? connection.access_token_secret_id
  if (tokenToRevoke) {
    try {
      const tokenValue = await vaultReadSecret(svc, tokenToRevoke)
      if (tokenValue) {
        const revokeRes = await fetch(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokenValue }),
        })
        if (!revokeRes.ok) {
          console.warn('[google-oauth-disconnect] Révocation Google non confirmée (non bloquant), status:', revokeRes.status)
        }
      }
    } catch (e) {
      console.warn('[google-oauth-disconnect] Révocation Google échouée (non bloquant):', e instanceof Error ? e.message : String(e))
    }
  }

  // ── Suppression des secrets Vault (jamais laissés orphelins) ─────────
  for (const secretId of [connection.access_token_secret_id, connection.refresh_token_secret_id]) {
    if (!secretId) continue
    try {
      await vaultDeleteSecret(svc, secretId)
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
    .eq('organisation_id', auth.organisationId)

  if (updateErr) {
    console.error('[google-oauth-disconnect] Échec mise à jour connexion:', updateErr.message)
    return respond({ error: 'Erreur serveur' }, 500)
  }

  await logOAuthEvent(svc, auth.organisationId, provider, 'disconnected')

  return respond({ ok: true, status: 'disconnected' })
})
