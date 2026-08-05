// supabase/functions/_shared/google-oauth-auth.test.ts
// Tests unitaires de requireActiveAdmin() — la porte d'authentification
// commune à 6 des 7 Edge Functions Google (toutes sauf google-oauth-callback,
// qui ne reçoit jamais de header Authorization par construction — voir son
// propre commentaire). AUCUN appel réseau réel : globalThis.fetch est
// intégralement remplacé par un routeur en mémoire simulant l'API Auth
// (GET /auth/v1/user) et PostgREST (GET /rest/v1/profiles) de Supabase.
//
// Exécution :
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-key deno test --allow-env supabase/functions/_shared/google-oauth-auth.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { requireActiveAdmin } from './google-oauth.ts'

const originalFetch = globalThis.fetch
function restoreFetch() { globalThis.fetch = originalFetch }

interface FakeProfile {
  role: string
  organisation_id: string | null
  actif: boolean
}

// Simule /auth/v1/user (valide si le Bearer correspond à VALID_JWT) et
// /rest/v1/profiles (retourne fakeProfile, ou aucune ligne si null).
function mockAuthAndProfiles(opts: { validJwt: string; fakeProfile: FakeProfile | null }) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const headers = new Headers(init?.headers)
    const authHeader = headers.get('Authorization') ?? ''

    if (u.includes('/auth/v1/user')) {
      const token = authHeader.replace(/^Bearer\s+/i, '')
      if (token !== opts.validJwt) {
        return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'invalid JWT' }), { status: 401 })
      }
      return new Response(JSON.stringify({ id: 'user-1', email: 'admin@test.local' }), { status: 200 })
    }

    if (u.includes('/rest/v1/profiles')) {
      const rows = opts.fakeProfile ? [opts.fakeProfile] : []
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    throw new Error(`Appel fetch non mocké dans ce test : ${u}`)
  }) as typeof fetch
}

const VALID_JWT = 'FAKE_VALID_JWT_NEVER_REAL'

function makeRequest(authHeader?: string) {
  return new Request('https://example.local/google-oauth-status', {
    headers: authHeader !== undefined ? { Authorization: authHeader } : {},
  })
}

Deno.test('JWT absent — 401 sans le moindre appel réseau', async () => {
  let called = false
  globalThis.fetch = (() => { called = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const result = await requireActiveAdmin(makeRequest())
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.status, 401)
      assertEquals(result.error, 'Authentification requise')
    }
    assertEquals(called, false)
  } finally {
    restoreFetch()
  }
})

Deno.test('Header Authorization sans préfixe Bearer — 401 sans appel réseau', async () => {
  let called = false
  globalThis.fetch = (() => { called = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const result = await requireActiveAdmin(makeRequest('FAKE_VALID_JWT_NEVER_REAL'))
    assertEquals(result.ok, false)
    if (!result.ok) assertEquals(result.status, 401)
    assertEquals(called, false)
  } finally {
    restoreFetch()
  }
})

Deno.test('JWT invalide/expiré (rejeté par Supabase Auth) — 401 Session invalide', async () => {
  mockAuthAndProfiles({ validJwt: VALID_JWT, fakeProfile: null })
  try {
    const result = await requireActiveAdmin(makeRequest('Bearer WRONG_TOKEN'))
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.status, 401)
      assertEquals(result.error, 'Session invalide')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('JWT valide mais profil introuvable/inactif — 403 Compte inactif', async () => {
  mockAuthAndProfiles({ validJwt: VALID_JWT, fakeProfile: { role: 'admin', organisation_id: 'org-1', actif: false } })
  try {
    const result = await requireActiveAdmin(makeRequest(`Bearer ${VALID_JWT}`))
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.status, 403)
      assertEquals(result.error, 'Compte inactif')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('JWT valide, utilisateur actif mais non-admin — 403 réservé aux administrateurs', async () => {
  mockAuthAndProfiles({ validJwt: VALID_JWT, fakeProfile: { role: 'assistant', organisation_id: 'org-1', actif: true } })
  try {
    const result = await requireActiveAdmin(makeRequest(`Bearer ${VALID_JWT}`))
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.status, 403)
      assertEquals(result.error, 'Réservé aux administrateurs actifs')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('JWT valide, admin actif SANS organisation — 403 organisation introuvable', async () => {
  mockAuthAndProfiles({ validJwt: VALID_JWT, fakeProfile: { role: 'admin', organisation_id: null, actif: true } })
  try {
    const result = await requireActiveAdmin(makeRequest(`Bearer ${VALID_JWT}`))
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.status, 403)
      assertEquals(result.error, 'Organisation introuvable pour ce compte')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('JWT valide, admin actif avec organisation — ok=true', async () => {
  mockAuthAndProfiles({ validJwt: VALID_JWT, fakeProfile: { role: 'admin', organisation_id: 'org-1', actif: true } })
  try {
    const result = await requireActiveAdmin(makeRequest(`Bearer ${VALID_JWT}`))
    assertEquals(result.ok, true)
    if (result.ok) {
      assertEquals(result.userId, 'user-1')
      assertEquals(result.organisationId, 'org-1')
    }
  } finally {
    restoreFetch()
  }
})
