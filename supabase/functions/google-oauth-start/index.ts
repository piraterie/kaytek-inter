// supabase/functions/google-oauth-start/index.ts — Phase 2
//
// Démarre le flux OAuth Google pour un provider donné (google_ads |
// google_business). Exige un JWT Supabase valide d'un administrateur
// actif ; l'organisation est TOUJOURS dérivée de auth.uid() via profiles
// — jamais d'un organisation_id envoyé par le frontend (aucun champ de ce
// nom n'est même lu depuis le body).
//
// Ne contacte jamais Google ici au-delà de construire une URL — aucune
// requête HTTP sortante dans cette fonction.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  corsHeaders, respond, requireActiveAdmin, serviceClient,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_OAUTH_STATE_SECRET,
  GOOGLE_AUTH_ENDPOINT, OPENID_SCOPES, PROVIDER_SCOPES,
  isValidProvider, signState, type StatePayload,
} from '../_shared/google-oauth.ts'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes — assez pour un consentement Google, pas plus.

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_REDIRECT_URI || !GOOGLE_OAUTH_STATE_SECRET) {
    console.error('[google-oauth-start] Configuration serveur incomplète (client id / redirect uri / state secret)')
    return respond({ error: 'Configuration OAuth serveur incomplète' }, 500)
  }

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }

  // Reçoit UNIQUEMENT le provider — aucun autre champ du body n'est lu
  // (en particulier jamais organisation_id, jamais redirect_uri).
  const { provider } = body
  if (!isValidProvider(provider)) {
    return respond({ error: "provider invalide — attendu 'google_ads' ou 'google_business'" }, 400)
  }

  // Nonce aléatoire (256 bits) — imprévisible, jamais dérivé d'une donnée
  // prévisible (timestamp, id séquentiel, etc.).
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('')

  const svc = serviceClient()
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)

  const { error: insertErr } = await svc.from('google_oauth_states').insert({
    nonce,
    organisation_id: auth.organisationId,
    provider,
    requested_by: auth.userId,
    expires_at: expiresAt.toISOString(),
  })
  if (insertErr) {
    console.error('[google-oauth-start] Échec création du state:', insertErr.message)
    return respond({ error: "Impossible d'initier la connexion" }, 500)
  }

  const payload: StatePayload = {
    nonce,
    org: auth.organisationId,
    provider,
    uid: auth.userId,
    exp: expiresAt.getTime(),
  }
  const state = await signState(payload, GOOGLE_OAUTH_STATE_SECRET)

  const scopes = [...OPENID_SCOPES, ...PROVIDER_SCOPES[provider]]
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    // access_type=offline + prompt=consent : demande explicite et
    // contrôlée d'un refresh_token à CHAQUE connexion (Google ne renvoie
    // un refresh_token qu'à la première autorisation sans prompt=consent
    // — on force son renvoi pour garantir qu'une reconnexion après
    // révocation/expiration obtienne bien un nouveau refresh_token).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })

  const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`

  // Jamais le client_secret n'apparaît dans cette réponse ni dans authUrl
  // (response_type=code n'en a pas besoin — seul l'échange côté serveur,
  // dans google-oauth-callback, l'utilise).
  return respond({ authUrl })
})
