// supabase/functions/_shared/google-business-api.test.ts — Phase 3
//
// AUCUN appel réseau réel : globalThis.fetch remplacé par un routeur en
// mémoire pour chaque test. Client Supabase simulé, jamais de connexion
// réelle. Exécution : deno test --allow-env supabase/functions/_shared/google-business-api.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { listAccessibleGbpLocations } from './google-business-api.ts'

const ORG_ID = '00000000-0000-0000-0000-0000000000a1'
const ACCESS_TOKEN = 'FAKE_GBP_ACCESS_TOKEN_TEST_NEVER_REAL'
const originalFetch = globalThis.fetch

function restoreFetch() { globalThis.fetch = originalFetch }

function makeFakeSupabase(connected: boolean) {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  if (!connected) return { data: null, error: null }
                  if (table === 'gbp_connections') {
                    return {
                      data: {
                        id: 'conn-1', status: 'connected',
                        access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
                        token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                      }, error: null,
                    }
                  }
                  return { data: null, error: null }
                },
              }
            },
          }
        },
        update() { return { eq() { return Promise.resolve({ data: null, error: null }) } } },
      }
    },
    async rpc(name: string, args: any) {
      if (name === 'google_oauth_vault_read') {
        return { data: args.p_secret_id === 'secret-access-1' ? ACCESS_TOKEN : null, error: null }
      }
      throw new Error(`RPC non mocké dans ce test : ${name}`)
    },
  }
}

function makeFetchRouter(routes: { match: (url: string) => boolean; status: number; json: unknown }[]) {
  const calledUrls: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    calledUrls.push(u)
    const route = routes.find((r) => r.match(u))
    if (!route) throw new Error(`Appel fetch non mocké dans ce test : ${u}`)
    return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { calledUrls }
}

Deno.test('non connecté — aucun appel réseau, reason=not_connected', async () => {
  let called = false
  globalThis.fetch = (() => { called = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(false) as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) assertEquals(result.reason, 'not_connected')
    assertEquals(called, false)
  } finally {
    restoreFetch()
  }
})

Deno.test('aucun compte GBP accessible — ok=true, accounts=[]', async () => {
  makeFetchRouter([{ match: (u) => u.includes('/accounts') && !u.includes('/locations'), status: 200, json: { accounts: [] } }])
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) assertEquals(result.accounts.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('un compte, plusieurs établissements, adresse formatée et statut d\'ouverture normalisés', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('/accounts') && !u.includes('locations'), status: 200, json: { accounts: [{ name: 'accounts/123', accountName: 'Ma Société', type: 'PERSONAL' }] } },
    {
      match: (u) => u.includes('accounts/123/locations'),
      status: 200,
      json: {
        locations: [
          { name: 'locations/456', title: 'Agence Centre', storeCode: 'AG1', storefrontAddress: { addressLines: ['12 rue Test'], locality: 'Paris', postalCode: '75001', regionCode: 'FR' }, phoneNumbers: { primaryPhone: '0102030405' }, openInfo: { status: 'OPEN' } },
          { name: 'locations/789', title: 'Agence Nord', openInfo: { status: 'CLOSED_TEMPORARILY' } },
        ],
      },
    },
  ])
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) {
      assertEquals(result.accounts.length, 1)
      assertEquals(result.accounts[0].locations.length, 2)
      const loc1 = result.accounts[0].locations[0]
      assertEquals(loc1.title, 'Agence Centre')
      assertEquals(loc1.address, '12 rue Test, 75001, Paris, FR')
      assertEquals(loc1.openStatus, 'OPEN')
      assertEquals(result.accounts[0].locations[1].openStatus, 'CLOSED_TEMPORARILY')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('pagination des établissements (2 pages) — toutes les pages agrégées', async () => {
  let page = 0
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/accounts') && !u.includes('locations')) {
      return new Response(JSON.stringify({ accounts: [{ name: 'accounts/1', accountName: 'Compte', type: 'PERSONAL' }] }), { status: 200 })
    }
    if (u.includes('accounts/1/locations')) {
      page++
      if (page === 1) {
        return new Response(JSON.stringify({ locations: [{ name: 'locations/1', title: 'Page 1' }], nextPageToken: 'tok2' }), { status: 200 })
      }
      return new Response(JSON.stringify({ locations: [{ name: 'locations/2', title: 'Page 2' }] }), { status: 200 })
    }
    throw new Error(`URL non mockée : ${u}`)
  }) as typeof fetch
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) assertEquals(result.accounts[0].locations.length, 2, 'les 2 pages doivent être agrégées')
  } finally {
    restoreFetch()
  }
})

Deno.test('erreur Google (API non activée) — reason=api_not_enabled, aucun token dans le detail', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('/accounts') && !u.includes('locations'), status: 403, json: { error: { message: 'Business Profile API has not been used in project 123 before or it is disabled.' } } },
  ])
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.reason, 'api_not_enabled')
      assertEquals((result.detail ?? '').includes(ACCESS_TOKEN), false)
    }
  } finally {
    restoreFetch()
  }
})

// Reproduit l'incident production du 2026-08-06 : jeton émis sans le scope
// business.manage (403 + reason=ACCESS_TOKEN_SCOPE_INSUFFICIENT dans le
// corps structuré Google) — doit être distingué de insufficient_permission
// générique, le correctif étant côté utilisateur (révocation +
// reconnexion), pas un problème de droits sur l'établissement.
Deno.test('erreur Google (scope insuffisant sur le jeton) — reason=insufficient_scope, distincte de insufficient_permission', async () => {
  makeFetchRouter([
    {
      match: (u) => u.includes('/accounts') && !u.includes('locations'),
      status: 403,
      json: {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com' }],
        },
      },
    },
  ])
  try {
    const result = await listAccessibleGbpLocations(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.reason, 'insufficient_scope')
      assertEquals((result.detail ?? '').includes(ACCESS_TOKEN), false)
    }
  } finally {
    restoreFetch()
  }
})
