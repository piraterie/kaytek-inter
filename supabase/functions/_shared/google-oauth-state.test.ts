// supabase/functions/_shared/google-oauth-state.test.ts
// Tests unitaires purs (Deno.test) du state OAuth — AUCUN appel réseau,
// AUCUN contact Google, AUCUNE dépendance Supabase. Exécution :
//   deno test --allow-env supabase/functions/_shared/google-oauth-state.test.ts
import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { signState, verifyState, type StatePayload } from './google-oauth.ts'

const SECRET = 'test-only-secret-never-a-real-value-1234567890'
const OTHER_SECRET = 'a-different-secret-also-never-real-abcdef'

function makePayload(overrides: Partial<StatePayload> = {}): StatePayload {
  return {
    nonce: 'nonce-abc-123',
    org: '00000000-0000-0000-0000-0000000000a1',
    provider: 'google_ads',
    uid: '00000000-0000-0000-0000-00000000a001',
    exp: Date.now() + 10 * 60 * 1000,
    ...overrides,
  }
}

Deno.test('state valide — accepté, payload restitué à l\'identique', async () => {
  const payload = makePayload()
  const token = await signState(payload, SECRET)
  const result = await verifyState(token, SECRET)
  assert(result.ok, 'un state valide doit être accepté')
  if (result.ok) {
    assertEquals(result.payload.nonce, payload.nonce)
    assertEquals(result.payload.org, payload.org)
    assertEquals(result.payload.provider, payload.provider)
    assertEquals(result.payload.uid, payload.uid)
  }
})

Deno.test('state modifié (payload altéré après signature) — refusé', async () => {
  const token = await signState(makePayload(), SECRET)
  const [payloadB64, sigB64] = token.split('.')
  // Altère un seul caractère du payload encodé — la signature ne
  // correspond alors plus.
  const tampered = payloadB64.slice(0, -1) + (payloadB64.slice(-1) === 'A' ? 'B' : 'A')
  const result = await verifyState(`${tampered}.${sigB64}`, SECRET)
  assert(!result.ok, 'un state avec payload altéré doit être refusé')
  if (!result.ok) assertEquals(result.reason, 'signature_invalide')
})

Deno.test('state avec organisation substituée après signature — refusé (signature invalide)', async () => {
  // Tente de faire passer un state pour une AUTRE organisation en
  // reconstruisant un payload modifié à la main (sans re-signer) —
  // simule une tentative de substitution d'organisation par un client
  // malveillant qui aurait intercepté un state valide.
  const token = await signState(makePayload({ org: 'org-a' }), SECRET)
  const [, sigB64] = token.split('.')
  const forgedPayload = btoa(JSON.stringify(makePayload({ org: 'org-b' })))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const result = await verifyState(`${forgedPayload}.${sigB64}`, SECRET)
  assert(!result.ok, 'une substitution d\'organisation sans re-signature doit être refusée')
  if (!result.ok) assertEquals(result.reason, 'signature_invalide')
})

Deno.test('state signé avec une clé différente — refusé', async () => {
  const token = await signState(makePayload(), SECRET)
  const result = await verifyState(token, OTHER_SECRET)
  assert(!result.ok)
  if (!result.ok) assertEquals(result.reason, 'signature_invalide')
})

Deno.test('state expiré — refusé', async () => {
  const token = await signState(makePayload({ exp: Date.now() - 1000 }), SECRET)
  const result = await verifyState(token, SECRET)
  assert(!result.ok, 'un state expiré doit être refusé')
  if (!result.ok) assertEquals(result.reason, 'expire')
})

Deno.test('state avec provider invalide dans le payload — refusé', async () => {
  const token = await signState({ ...makePayload(), provider: 'not_a_real_provider' as any }, SECRET)
  const result = await verifyState(token, SECRET)
  assert(!result.ok)
  if (!result.ok) assertEquals(result.reason, 'payload_illisible')
})

Deno.test('state malformé (pas de point de séparation) — refusé', async () => {
  const result = await verifyState('ceci-nest-pas-un-state-valide', SECRET)
  assert(!result.ok)
  if (!result.ok) assertEquals(result.reason, 'format_invalide')
})

Deno.test('deux signatures du même payload sont déterministes (HMAC), mais deux nonces différents produisent des states différents', async () => {
  const tokenA = await signState(makePayload({ nonce: 'nonce-1' }), SECRET)
  const tokenB = await signState(makePayload({ nonce: 'nonce-2' }), SECRET)
  assertNotEquals(tokenA, tokenB, 'deux nonces différents doivent produire des states différents (imprévisibilité)')
})
