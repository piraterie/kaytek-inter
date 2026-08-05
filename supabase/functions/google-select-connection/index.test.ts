// supabase/functions/google-select-connection/index.test.ts
// Test de régression pour le bug corrigé dans cette session : la
// validation `locationResourceName?.startsWith('accounts/')` rejetait
// TOUTE sélection d'établissement Google Business Profile, puisque les
// resource names de localisation renvoyés par Google (et par
// listAccessibleGbpLocations, voir _shared/google-business-api.ts) sont
// TOUJOURS au format `locations/{id}`, jamais `accounts/{id}` — la
// fonctionnalité de sélection GBP était donc totalement cassée en
// production (400 systématique) sans qu'aucun test ne le détecte, car
// aucun test HTTP de bout en bout de ce handler n'existait avant ce fichier.
//
// AUCUN appel réseau réel : globalThis.fetch simule Supabase Auth,
// PostgREST (profiles/gbp_connections/rpc) et les APIs Google Business
// Profile — jamais un octet envoyé à un service réel.
//
// Exécution :
//   SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-key deno test --allow-env supabase/functions/google-select-connection/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handleGoogleSelectConnection } from './index.ts'

const originalFetch = globalThis.fetch
function restoreFetch() { globalThis.fetch = originalFetch }

const VALID_JWT = 'FAKE_VALID_JWT_NEVER_REAL'
const ORG_ID = 'org-1'
const ACCESS_TOKEN = 'FAKE_GBP_ACCESS_TOKEN_TEST_NEVER_REAL'

function makeRequest(body: unknown, authHeader = `Bearer ${VALID_JWT}`): Request {
  return new Request('https://example.local/google-select-connection', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Routeur fetch unique couvrant tout le chemin HTTP réel du handler :
// Auth Supabase → profil admin → connexion gbp_connections (x2, refresh
// puis relecture) → vault (RPC) → APIs Google Business Profile → écriture
// finale de la sélection.
function mockFullGbpSelectionPath() {
  const patchedBodies: string[] = []

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const pathname = new URL(u).pathname
    const method = init?.method ?? 'GET'

    if (pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'user-1', email: 'admin@test.local' }), { status: 200 })
    }

    if (pathname === '/rest/v1/profiles') {
      return new Response(JSON.stringify([{ role: 'admin', organisation_id: ORG_ID, actif: true }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    if (pathname === '/rest/v1/gbp_connections' && method === 'GET') {
      // Servie deux fois avec des `select=` différents (ensureFreshAccessToken
      // puis listAccessibleGbpLocations) — même ligne mock suffisante pour
      // les deux, un access_token_secret_id/expiry valides évitent tout
      // renouvellement (chemin le plus simple, non testé ici).
      return new Response(JSON.stringify([{
        id: 'conn-1', status: 'connected',
        access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
        token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (pathname === '/rest/v1/rpc/google_oauth_vault_read') {
      return new Response(JSON.stringify(ACCESS_TOKEN), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (u.includes('mybusinessaccountmanagement.googleapis.com')) {
      return new Response(JSON.stringify({ accounts: [{ name: 'accounts/123', accountName: 'Mon établissement' }] }), { status: 200 })
    }

    if (u.includes('mybusinessbusinessinformation.googleapis.com')) {
      return new Response(JSON.stringify({
        locations: [{ name: 'locations/456', title: 'Boutique Centre-Ville', storefrontAddress: { addressLines: ['1 rue Test'] } }],
      }), { status: 200 })
    }

    if (pathname === '/rest/v1/gbp_connections' && method === 'PATCH') {
      const bodyText = typeof init?.body === 'string' ? init.body : ''
      patchedBodies.push(bodyText)
      return new Response(JSON.stringify([{}]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    throw new Error(`Appel fetch non mocké dans ce test : ${method} ${u}`)
  }) as typeof fetch

  return { patchedBodies }
}

Deno.test('sélection GBP avec un locationResourceName réel (locations/…) — acceptée, plus jamais rejetée par erreur de format', async () => {
  const { patchedBodies } = mockFullGbpSelectionPath()
  try {
    const res = await handleGoogleSelectConnection(makeRequest({
      provider: 'google_business',
      accountResourceName: 'accounts/123',
      locationResourceName: 'locations/456',
    }))
    const json = await res.json()

    assertEquals(res.status, 200)
    assertEquals(json.ok, true)
    assertEquals(json.selected.locationResourceName, 'locations/456')
    assertEquals(patchedBodies.length, 1)
    assertEquals(JSON.parse(patchedBodies[0]).google_location_id, 'locations/456')
  } finally {
    restoreFetch()
  }
})

Deno.test('sélection GBP avec un accountResourceName malformé — toujours rejetée (400), la validation reste effective', async () => {
  mockFullGbpSelectionPath()
  try {
    const res = await handleGoogleSelectConnection(makeRequest({
      provider: 'google_business',
      accountResourceName: 'not-a-valid-resource-name',
      locationResourceName: 'locations/456',
    }))
    assertEquals(res.status, 400)
  } finally {
    restoreFetch()
  }
})
