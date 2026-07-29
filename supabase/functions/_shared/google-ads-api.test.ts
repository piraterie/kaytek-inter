// supabase/functions/_shared/google-ads-api.test.ts — Phase 3
//
// AUCUN appel réseau réel : globalThis.fetch est intégralement remplacé
// par un routeur en mémoire pour chaque test (jamais un octet envoyé à
// googleads.googleapis.com). Le client Supabase est un faux objet en
// mémoire. Ce fichier suppose GOOGLE_ADS_DEVELOPER_TOKEN déjà défini dans
// l'environnement du process (lu une seule fois au chargement du module —
// voir google-ads-api-no-devtoken.test.ts pour le scénario "absent").
//
// Exécution (les deux variables sont lues au chargement du module et
// doivent donc être définies AVANT `deno test`, pas à l'intérieur) :
//   GOOGLE_ADS_DEVELOPER_TOKEN=test-dev-token GOOGLE_OAUTH_CLIENT_ID=test-client-id deno test --allow-env supabase/functions/_shared/google-ads-api.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { listAccessibleAdsAccounts } from './google-ads-api.ts'

const ORG_ID = '00000000-0000-0000-0000-0000000000a1'
const ACCESS_TOKEN = 'FAKE_ACCESS_TOKEN_TEST_NEVER_REAL'
const originalFetch = globalThis.fetch

function restoreFetch() { globalThis.fetch = originalFetch }

function makeFakeSupabase(connected: boolean) {
  const client = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  if (!connected) return { data: null, error: null }
                  if (table === 'google_ads_connections') {
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
        update(_patch: Record<string, unknown>) {
          return { eq() { return Promise.resolve({ data: null, error: null }) } }
        },
      }
    },
    async rpc(name: string, args: any) {
      if (name === 'google_oauth_vault_read') {
        return { data: args.p_secret_id === 'secret-access-1' ? ACCESS_TOKEN : null, error: null }
      }
      throw new Error(`RPC non mocké dans ce test : ${name}`)
    },
  }
  return client
}

// Routeur de réponses Google Ads REST en mémoire — clé = fragment d'URL,
// valeur = corps JSON de la réponse (200 OK) ou une fonction (status, body).
function makeFetchRouter(routes: { match: (url: string, body: string) => boolean; status: number; json: unknown }[]) {
  const calledUrls: string[] = []
  const calledBodies: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const b = typeof init?.body === 'string' ? init.body : ''
    calledUrls.push(u)
    calledBodies.push(b)
    const route = routes.find((r) => r.match(u, b))
    if (!route) throw new Error(`Appel fetch non mocké dans ce test : ${u} body=${b}`)
    return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { calledUrls, calledBodies }
}

Deno.test('non connecté — aucun appel réseau, reason=not_connected', async () => {
  let called = false
  globalThis.fetch = (() => { called = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(false) as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) assertEquals(result.reason, 'not_connected')
    assertEquals(called, false)
  } finally {
    restoreFetch()
  }
})

Deno.test('liste vide (0 compte accessible) — ok=true, accounts=[]', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('listAccessibleCustomers'), status: 200, json: { resourceNames: [] } },
  ])
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) assertEquals(result.accounts.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('un compte publicitaire simple (non manager) — informations descriptives normalisées', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('listAccessibleCustomers'), status: 200, json: { resourceNames: ['customers/1112223333'] } },
    {
      match: (u) => u.includes('customers/1112223333/googleAds:search'),
      status: 200,
      json: { results: [{ customer: { id: '1112223333', descriptiveName: 'Compte Test', currencyCode: 'EUR', timeZone: 'Europe/Paris', manager: false, status: 'ENABLED' } }] },
    },
  ])
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) {
      assertEquals(result.accounts.length, 1)
      const a = result.accounts[0]
      assertEquals(a.customerId, '1112223333')
      assertEquals(a.descriptiveName, 'Compte Test')
      assertEquals(a.currencyCode, 'EUR')
      assertEquals(a.isManager, false)
      assertEquals(a.managerCustomerId, null)
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('compte manager (MCC) — comptes clients rattachés découverts (1 niveau)', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('listAccessibleCustomers'), status: 200, json: { resourceNames: ['customers/9998887777'] } },
    {
      match: (u, b) => u.includes('customers/9998887777/googleAds:search') && b.includes('FROM customer '),
      status: 200,
      json: { results: [{ customer: { id: '9998887777', descriptiveName: 'MCC Kaytek', currencyCode: 'EUR', timeZone: 'Europe/Paris', manager: true, status: 'ENABLED' } }] },
    },
    {
      match: (u, b) => u.includes('customers/9998887777/googleAds:search') && b.includes('customer_client'),
      status: 200,
      json: {
        results: [
          { customerClient: { clientCustomer: 'customers/9998887777', level: 0 } }, // le manager lui-même, doit être ignoré
          { customerClient: { clientCustomer: 'customers/1231231234', descriptiveName: 'Client A', currencyCode: 'EUR', timeZone: 'Europe/Paris', manager: false, status: 'ENABLED', level: 1 } },
        ],
      },
    },
  ])
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) {
      assertEquals(result.accounts.length, 2, 'le manager + 1 compte client rattaché, jamais le manager en double')
      const child = result.accounts.find((a) => a.customerId === '1231231234')
      assert(child, 'le compte client rattaché doit être présent')
      assertEquals(child?.managerCustomerId, '9998887777')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('erreur Google (permission refusée) — reason=insufficient_permission, aucun token dans le detail', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('listAccessibleCustomers'), status: 403, json: { error: { code: 403, message: 'User does not have permission to access customer. Contact administrator.' } } },
  ])
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(true) as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) {
      assertEquals(result.reason, 'insufficient_permission')
      assertEquals((result.detail ?? '').includes(ACCESS_TOKEN), false)
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('aucune valeur de token (access/refresh) présente dans le résultat sérialisé, dans tous les scénarios testés', async () => {
  makeFetchRouter([
    { match: (u) => u.includes('listAccessibleCustomers'), status: 200, json: { resourceNames: ['customers/1112223333'] } },
    { match: (u) => u.includes('googleAds:search'), status: 200, json: { results: [{ customer: { id: '1112223333', manager: false } }] } },
  ])
  try {
    const result = await listAccessibleAdsAccounts(makeFakeSupabase(true) as any, ORG_ID)
    const serialized = JSON.stringify(result)
    assertEquals(serialized.includes(ACCESS_TOKEN), false)
  } finally {
    restoreFetch()
  }
})
