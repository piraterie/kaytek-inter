// supabase/functions/google-oauth-callback/index.test.ts
// Tests unitaires des branches de rejet précoce de google-oauth-callback —
// celles qui répondent AVANT tout appel réseau/DB (consentement refusé,
// paramètres manquants, state invalide). Aucun appel réseau réel : ces
// branches ne touchent ni Supabase ni Google, donc aucun mock de fetch
// n'est nécessaire ici (contrairement à _shared/*.test.ts).
//
// Exécution :
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-key GOOGLE_OAUTH_CLIENT_ID=test-client-id GOOGLE_OAUTH_CLIENT_SECRET=test-client-secret GOOGLE_OAUTH_REDIRECT_URI=https://example.local/callback GOOGLE_OAUTH_STATE_SECRET=test-state-secret deno test --allow-env supabase/functions/google-oauth-callback/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handleGoogleOauthCallback } from './index.ts'
import { signState, type StatePayload } from '../_shared/google-oauth.ts'

function makeCallbackRequest(params: Record<string, string>): Request {
  const url = new URL('https://example.local/google-oauth-callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

function redirectReason(res: Response): { status: number; reason: string | null } {
  const location = res.headers.get('Location')
  const reason = location ? new URL(location).searchParams.get('reason') : null
  return { status: res.status, reason }
}

Deno.test('Google renvoie error=access_denied — redirection erreur, reason=consent_refuse', async () => {
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ error: 'access_denied' }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'consent_refuse')
})

Deno.test('code manquant (state présent) — redirection erreur, reason=parametres_manquants', async () => {
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ state: 'whatever' }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'parametres_manquants')
})

Deno.test('state manquant (code présent) — redirection erreur, reason=parametres_manquants', async () => {
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ code: 'fake-code' }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'parametres_manquants')
})

Deno.test('state signé avec un secret différent (falsifié) — redirection erreur, reason=state_signature_invalide', async () => {
  const payload: StatePayload = {
    nonce: crypto.randomUUID(),
    org: 'org-1',
    provider: 'google_ads',
    uid: 'user-1',
    exp: Date.now() + 10 * 60 * 1000,
  }
  const forgedState = await signState(payload, 'un-secret-different-du-serveur')
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ code: 'fake-code', state: forgedState }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'state_signature_invalide')
})

Deno.test('state au format invalide (pas de point de séparation) — redirection erreur, reason=state_format_invalide', async () => {
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ code: 'fake-code', state: 'ceci-nest-pas-un-state-valide' }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'state_format_invalide')
})

Deno.test('state signé correctement mais expiré — redirection erreur, reason=state_expire', async () => {
  const payload: StatePayload = {
    nonce: crypto.randomUUID(),
    org: 'org-1',
    provider: 'google_business',
    uid: 'user-1',
    exp: Date.now() - 1000, // déjà expiré
  }
  const stateSecret = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET') ?? ''
  const expiredState = await signState(payload, stateSecret)
  const res = await handleGoogleOauthCallback(makeCallbackRequest({ code: 'fake-code', state: expiredState }))
  const { status, reason } = redirectReason(res)
  assertEquals(status, 302)
  assertEquals(reason, 'state_expire')
})
