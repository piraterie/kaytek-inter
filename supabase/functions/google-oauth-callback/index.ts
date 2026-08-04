// supabase/functions/google-oauth-callback/index.ts — Phase 2
//
// Reçoit la redirection du navigateur depuis accounts.google.com (GET,
// query params `code`/`state`/`error`). AUCUN header Authorization n'est
// disponible ici (le navigateur suit une redirection top-level, il ne
// peut pas y joindre le JWT Supabase) — toute la sécurité repose donc sur
// le `state` : signature HMAC + expiration + usage unique (table
// google_oauth_states) + revérification stricte org/provider/demandeur.
// C'est un fonctionnement standard du protocole OAuth (le callback n'est
// jamais un endpoint "authentifié" au sens JWT), pas une lacune.
//
// Échange le code contre les tokens CÔTÉ SERVEUR uniquement. Le
// refresh_token n'est JAMAIS renvoyé au frontend — seule une redirection
// (302) sans aucun secret dans l'URL est produite.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  corsHeaders, serviceClient, connectionsTable, logOAuthEvent,
  vaultCreateSecret, vaultUpdateSecret, sanitizeErrorDetail,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_OAUTH_STATE_SECRET,
  GOOGLE_OAUTH_FRONTEND_SUCCESS_URL, GOOGLE_OAUTH_FRONTEND_ERROR_URL,
  GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT,
  verifyState, type GoogleProvider,
} from '../_shared/google-oauth.ts'

// google_status explicite (en plus des deux URLs distinctes) : le
// frontend doit pouvoir distinguer succès/échec de façon fiable même si
// GOOGLE_OAUTH_FRONTEND_SUCCESS_URL et _ERROR_URL venaient à pointer vers
// la même page (aucune hypothèse sur la configuration exacte de l'admin).
function errorRedirect(provider: string | null, reason: string): Response {
  const url = new URL(GOOGLE_OAUTH_FRONTEND_ERROR_URL || 'about:blank')
  if (provider) url.searchParams.set('provider', provider)
  url.searchParams.set('google_status', 'error')
  url.searchParams.set('reason', reason)
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } })
}

function successRedirect(provider: string): Response {
  const url = new URL(GOOGLE_OAUTH_FRONTEND_SUCCESS_URL || 'about:blank')
  url.searchParams.set('provider', provider)
  url.searchParams.set('google_status', 'success')
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } })
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

// Exportée séparément de `serve()` uniquement pour permettre les tests
// unitaires (google-oauth-callback.test.ts) d'invoquer le handler
// directement sans ouvrir de serveur HTTP réel — aucun changement de
// comportement en production, `serve()` ci-dessous reste le seul point
// d'entrée réellement déployé.
export async function handleGoogleOauthCallback(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')
  const googleError = url.searchParams.get('error')

  if (googleError) {
    // L'utilisateur a refusé le consentement, ou Google a rejeté la
    // requête — jamais journalisé comme une anomalie serveur.
    console.log('[google-oauth-callback] Consentement refusé/erreur Google:', googleError)
    return errorRedirect(null, 'consent_refuse')
  }

  if (!code || !stateToken) return errorRedirect(null, 'parametres_manquants')

  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI || !GOOGLE_OAUTH_STATE_SECRET) {
    console.error('[google-oauth-callback] Configuration serveur incomplète')
    return errorRedirect(null, 'configuration_serveur')
  }

  // ── 1. Vérification stricte du state (signature + expiration) ────────
  const verified = await verifyState(stateToken, GOOGLE_OAUTH_STATE_SECRET)
  if (!verified.ok) {
    console.warn('[google-oauth-callback] state rejeté:', verified.reason)
    return errorRedirect(null, `state_${verified.reason}`)
  }
  const { nonce, org: organisationId, provider, uid: requestedBy } = verified.payload

  const svc = serviceClient()

  // ── 2. Vérification en base : existe, non consommé, non expiré, et
  // correspondance stricte org/provider/demandeur avec le payload signé
  // (double contrôle — le state pourrait en théorie être valide/signé
  // mais ne plus correspondre à la ligne si celle-ci a été altérée hors
  // de ce flux, ce qui n'arrive jamais en pratique mais coûte peu à
  // vérifier). ────────────────────────────────────────────────────────
  const { data: stateRow, error: stateErr } = await svc
    .from('google_oauth_states')
    .select('id, organisation_id, provider, requested_by, expires_at, consumed_at')
    .eq('nonce', nonce)
    .maybeSingle()

  if (stateErr || !stateRow) {
    await logOAuthEvent(svc, organisationId, provider, 'state_rejected', 'nonce introuvable')
    return errorRedirect(provider, 'state_introuvable')
  }
  if (stateRow.consumed_at) {
    await logOAuthEvent(svc, organisationId, provider, 'state_rejected', 'nonce déjà utilisé (rejeu)')
    return errorRedirect(provider, 'state_deja_utilise')
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await logOAuthEvent(svc, organisationId, provider, 'state_rejected', 'nonce expiré (vérif DB)')
    return errorRedirect(provider, 'state_expire')
  }
  if (stateRow.organisation_id !== organisationId || stateRow.provider !== provider || stateRow.requested_by !== requestedBy) {
    await logOAuthEvent(svc, organisationId, provider, 'state_rejected', 'incohérence org/provider/demandeur')
    return errorRedirect(provider, 'state_incoherent')
  }

  // ── 3. Consommation IMMÉDIATE (avant l'échange du code) — réduit au
  // minimum la fenêtre de rejeu possible. Un UPDATE conditionné sur
  // consumed_at IS NULL agit aussi comme verrou anti-concurrence : si
  // deux requêtes arrivaient en parallèle avec le même state, une seule
  // verrait count > 0. ───────────────────────────────────────────────
  const { data: consumedRows, error: consumeErr } = await svc
    .from('google_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', stateRow.id)
    .is('consumed_at', null)
    .select('id')

  if (consumeErr || !consumedRows || consumedRows.length === 0) {
    await logOAuthEvent(svc, organisationId, provider, 'state_rejected', 'échec consommation (rejeu concurrent probable)')
    return errorRedirect(provider, 'state_deja_utilise')
  }

  // ── 4. Échange du code contre les tokens — côté serveur uniquement ───
  let tokenRes: Response
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
  } catch (e) {
    console.error('[google-oauth-callback] Échange de code — erreur réseau:', e instanceof Error ? e.message : String(e))
    await logOAuthEvent(svc, organisationId, provider, 'token_exchange_failed', 'erreur réseau')
    return errorRedirect(provider, 'echange_token_echoue')
  }

  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse
  if (!tokenRes.ok || !tokenJson.access_token) {
    // Ne jamais journaliser le corps complet (pourrait contenir un
    // fragment de token en cas de réponse d'erreur atypique) — seulement
    // le code d'erreur structuré renvoyé par Google.
    console.error('[google-oauth-callback] Échange de code refusé par Google:', tokenJson.error ?? tokenRes.status)
    await logOAuthEvent(svc, organisationId, provider, 'token_exchange_failed', tokenJson.error ?? `http_${tokenRes.status}`)
    return errorRedirect(provider, 'echange_token_echoue')
  }

  // ── 5. Identité du compte connecté (email, affichage uniquement) ─────
  let accountEmail: string | null = null
  try {
    const userinfoRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    if (userinfoRes.ok) {
      const userinfo = (await userinfoRes.json()) as { email?: string }
      accountEmail = userinfo.email ?? null
    }
  } catch (e) {
    // Non bloquant — l'email est une commodité d'affichage, pas une
    // condition de sécurité.
    console.warn('[google-oauth-callback] userinfo indisponible (non bloquant):', e instanceof Error ? e.message : String(e))
  }

  // ── 6. Stockage des tokens via Vault — jamais en clair dans la table
  // de connexion (voir migration 20260728000004/000006). ───────────────
  const table = connectionsTable(provider)
  const { data: existing } = await svc
    .from(table)
    .select('id, refresh_token_secret_id, access_token_secret_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()

  let accessTokenSecretId: string
  let refreshTokenSecretId: string | null = existing?.refresh_token_secret_id ?? null

  try {
    if (existing?.access_token_secret_id) {
      await vaultUpdateSecret(svc, existing.access_token_secret_id, tokenJson.access_token)
      accessTokenSecretId = existing.access_token_secret_id
    } else {
      accessTokenSecretId = await vaultCreateSecret(
        svc, tokenJson.access_token, `google_${provider}_access_${organisationId}_${crypto.randomUUID()}`,
        `access_token ${provider} — organisation ${organisationId}`,
      )
    }

    // Google ne renvoie un refresh_token qu'à la première autorisation
    // (ou avec prompt=consent, systématiquement demandé par
    // google-oauth-start) — s'il est absent ici, on conserve l'ancien
    // sans y toucher plutôt que de l'effacer.
    if (tokenJson.refresh_token) {
      if (refreshTokenSecretId) {
        await vaultUpdateSecret(svc, refreshTokenSecretId, tokenJson.refresh_token)
      } else {
        refreshTokenSecretId = await vaultCreateSecret(
          svc, tokenJson.refresh_token, `google_${provider}_refresh_${organisationId}_${crypto.randomUUID()}`,
          `refresh_token ${provider} — organisation ${organisationId}`,
        )
      }
    }
  } catch (e) {
    // Diagnostic uniquement : le message technique (ex. erreur Postgres/
    // Vault) est nettoyé de tout fragment ressemblant à un token Google
    // avant d'être persisté — jamais de token/secret réel dans ce champ.
    const rawMessage = e instanceof Error ? e.message : 'unknown_vault_error'
    const safeDetail = sanitizeErrorDetail(rawMessage)

    console.error('[google-oauth-callback] Échec stockage Vault:', safeDetail)
    await logOAuthEvent(svc, organisationId, provider, 'vault_storage_failed', safeDetail)
    return errorRedirect(provider, 'stockage_echoue')
  }

  // ── 7. Mise à jour des métadonnées (jamais de token dans cette ligne) ─
  const tokenExpiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString()
  const { error: upsertErr } = await svc.from(table).upsert(
    {
      organisation_id: organisationId,
      access_token_secret_id: accessTokenSecretId,
      refresh_token_secret_id: refreshTokenSecretId,
      token_expires_at: tokenExpiresAt,
      scopes: tokenJson.scope ?? null,
      status: 'connected',
      connected_by: requestedBy,
      connected_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      last_error: null,
      google_account_email: accountEmail,
    },
    { onConflict: 'organisation_id' },
  )

  if (upsertErr) {
    console.error('[google-oauth-callback] Échec mise à jour connexion:', upsertErr.message)
    await logOAuthEvent(svc, organisationId, provider, 'connection_update_failed')
    return errorRedirect(provider, 'enregistrement_echoue')
  }

  await logOAuthEvent(svc, organisationId, provider, 'connected')

  return successRedirect(provider)
}

// import.meta.main : ne démarre le serveur HTTP que lorsque ce fichier est
// exécuté directement (déploiement réel) — pas lorsqu'il est importé par
// index.test.ts pour appeler handleGoogleOauthCallback() directement (un
// `serve()` déclenché à l'import ouvrirait un vrai listener réseau pendant
// les tests, sans rapport avec ce qui est testé).
if (import.meta.main) serve(handleGoogleOauthCallback)
