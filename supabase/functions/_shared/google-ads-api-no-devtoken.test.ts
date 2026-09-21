// supabase/functions/_shared/google-ads-api-no-devtoken.test.ts
//
// Scénario "developer token absent" — GOOGLE_ADS_DEVELOPER_TOKEN doit être
// LAISSÉ NON DÉFINI pour ce fichier (séparé de google-ads-api.test.ts) : la
// constante est lue une seule fois au chargement du module.
//
// Depuis le 2026-09-09 Google a supprimé les Developer Tokens : leur absence
// ne doit JAMAIS bloquer un appel, et l'en-tête developer-token ne doit pas
// être envoyé. AUCUN appel réseau réel (fetch entièrement mocké).
//
// Exécution : GOOGLE_OAUTH_CLIENT_ID=test-client-id deno test --allow-env supabase/functions/_shared/google-ads-api-no-devtoken.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { listAccessibleAdsAccounts } from './google-ads-api.ts'
import { GOOGLE_ADS_API_BASE } from './google-oauth.ts'

const ORG_ID = '00000000-0000-0000-0000-0000000000a1'
const ACCESS_TOKEN = 'FAKE_ACCESS_TOKEN_TEST_NEVER_REAL'

function fakeSupabase() {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'conn-1', status: 'connected',
                      access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
                      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    }, error: null,
                  }
                },
              }
            },
          }
        },
        update() { return { eq() { return Promise.resolve({ data: null, error: null }) } } },
      }
    },
    async rpc(name: string, args: any) {
      if (name === 'google_oauth_vault_read') return { data: args.p_secret_id === 'secret-access-1' ? ACCESS_TOKEN : null, error: null }
      throw new Error(`RPC non mocké : ${name}`)
    },
  }
}

Deno.test('GOOGLE_ADS_DEVELOPER_TOKEN absent — appels effectués sans en-tête developer-token, sur la version supportée', async () => {
  const originalFetch = globalThis.fetch
  const seen: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const body = String(url).includes('listAccessibleCustomers')
      ? { resourceNames: ['customers/1112223333'] }
      : { results: [{ customer: { id: '1112223333', descriptiveName: 'Compte Test', manager: false, status: 'ENABLED' } }] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const result = await listAccessibleAdsAccounts(fakeSupabase() as any, ORG_ID)
    assertEquals(result.ok, true)
    if (result.ok) assertEquals(result.accounts[0].customerId, '1112223333')
    assert(seen.length >= 2, 'listAccessibleCustomers + détail du compte attendus')
    for (const call of seen) {
      assert(call.url.startsWith(`${GOOGLE_ADS_API_BASE}/`), 'utilise la version de GOOGLE_ADS_API_BASE')
      assertEquals('developer-token' in call.headers, false)
      assertEquals(call.headers.Authorization, `Bearer ${ACCESS_TOKEN}`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('version Google Ads API utilisée = v25', () => {
  assertEquals(GOOGLE_ADS_API_BASE, 'https://googleads.googleapis.com/v25')
})
