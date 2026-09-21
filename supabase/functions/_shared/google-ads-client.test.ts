// supabase/functions/_shared/google-ads-client.test.ts
//
// Client de lecture Google Ads : pagination, classification des erreurs,
// AUCUN jeton dans les erreurs. Aucun réseau réel (fetch simulé).
// Exécution : GOOGLE_OAUTH_CLIENT_ID=x deno test --allow-env supabase/functions/_shared/google-ads-client.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { adsSearchAll, MAX_PAGES } from './google-ads-client.ts'
import { GOOGLE_ADS_API_BASE } from './google-oauth.ts'

const TOKEN = 'ya29.SECRET_ACCESS_TOKEN_FOR_TESTS_ONLY'
const ctx = (fetchFn: typeof fetch, loginCustomerId: string | null = null) => ({ accessToken: TOKEN, customerId: '7536669574', loginCustomerId, fetchFn })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.test('une page : URL v25 du compte, jeton en Bearer, jamais de pageSize', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const r = await adsSearchAll(ctx((async (url: string | URL | Request, init?: RequestInit) => { seen = { url: String(url), init: init! }; return json({ results: [{ a: 1 }] }) }) as typeof fetch), 'SELECT 1')
  assert(r.ok)
  if (r.ok) assertEquals([r.rows.length, r.pages], [1, 1])
  assertEquals(seen!.url, `${GOOGLE_ADS_API_BASE}/customers/7536669574/googleAds:search`)
  assert(GOOGLE_ADS_API_BASE.endsWith('/v25'))
  const headers = seen!.init.headers as Record<string, string>
  assertEquals(headers.Authorization, `Bearer ${TOKEN}`)
  assertEquals(seen!.init.method, 'POST')
  assertEquals(JSON.parse(String(seen!.init.body)), { query: 'SELECT 1' })
})

Deno.test('login-customer-id envoyé seulement s\'il existe ; developer-token seulement si le secret est défini', async () => {
  const seen: Record<string, string>[] = []
  const f = (async (_u: string | URL | Request, init?: RequestInit) => { seen.push(init!.headers as Record<string, string>); return json({ results: [] }) }) as typeof fetch
  await adsSearchAll(ctx(f, null), 'Q')
  await adsSearchAll(ctx(f, '1234567890'), 'Q')
  assertEquals('login-customer-id' in seen[0], false)
  assertEquals(seen[1]['login-customer-id'], '1234567890')
  assertEquals('developer-token' in seen[0], !!Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN'))
})

Deno.test('PAGINATION : les pages sont enchaînées avec nextPageToken et les lignes concaténées dans l\'ordre', async () => {
  const tokens: (string | undefined)[] = []
  const f = (async (_u: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body))
    tokens.push(body.pageToken)
    if (!body.pageToken) return json({ results: [{ n: 1 }, { n: 2 }], nextPageToken: 'P2' })
    if (body.pageToken === 'P2') return json({ results: [{ n: 3 }], nextPageToken: 'P3' })
    return json({ results: [{ n: 4 }] })
  }) as typeof fetch
  const r = await adsSearchAll(ctx(f), 'Q')
  assert(r.ok)
  if (r.ok) { assertEquals(r.rows.map((x) => x.n), [1, 2, 3, 4]); assertEquals(r.pages, 3) }
  assertEquals(tokens, [undefined, 'P2', 'P3'])
})

Deno.test('pagination : garde-fou contre une pagination sans fin', async () => {
  const f = (async () => json({ results: [{ n: 1 }], nextPageToken: 'ENCORE' })) as typeof fetch
  const r = await adsSearchAll(ctx(f), 'Q', { maxPages: 3 })
  assert(!r.ok)
  if (!r.ok) assertEquals(r.reason, 'too_many_pages')
  assert(MAX_PAGES >= 10)
})

Deno.test('classification des erreurs Google', async () => {
  const cases: [number, unknown, string][] = [
    [401, { error: { message: 'Request had invalid authentication credentials.' } }, 'unauthorized'],
    [403, { error: { message: 'Google Ads API has not been used in project 1 before or it is disabled.' } }, 'api_not_enabled'],
    [403, { error: { message: 'User does not have permission' } }, 'insufficient_permission'],
    [429, { error: { message: 'Too many requests' } }, 'rate_limited'],
    [400, { error: { message: 'invalid argument' } }, 'google_error'],
    [500, { error: { message: 'internal' } }, 'google_error'],
  ]
  for (const [status, body, reason] of cases) {
    const r = await adsSearchAll(ctx((async () => json(body, status)) as typeof fetch), 'Q')
    assert(!r.ok, `HTTP ${status} doit échouer`)
    if (!r.ok) { assertEquals(r.reason, reason, `HTTP ${status}`); assertEquals(r.status, status) }
  }
})

Deno.test('erreur réseau et réponse illisible : échecs propres, jamais d\'exception', async () => {
  const net = await adsSearchAll(ctx((async () => { throw new Error('connexion refusée') }) as unknown as typeof fetch), 'Q')
  assert(!net.ok)
  if (!net.ok) assertEquals([net.reason, net.status], ['network', 0])
  const bad = await adsSearchAll(ctx((async () => new Response('<html>oups</html>', { status: 200 })) as typeof fetch), 'Q')
  assert(!bad.ok)
  if (!bad.ok) assertEquals(bad.detail, 'reponse_google_illisible')
})

Deno.test('AUCUN JETON dans les erreurs, même si Google le renvoie dans le corps ou si l\'erreur réseau le contient', async () => {
  const echo = await adsSearchAll(ctx((async () => new Response(`{"error":{"message":"bad token ${TOKEN} and ya29.OTHER_TOKEN_VALUE"}}`, { status: 401 })) as typeof fetch), 'Q')
  assert(!echo.ok)
  if (!echo.ok) {
    assert(!echo.detail.includes(TOKEN), 'jeton exact présent dans le détail')
    assert(!echo.detail.includes('ya29.OTHER_TOKEN_VALUE'), 'jeton de forme ya29. présent dans le détail')
  }
  const net = await adsSearchAll(ctx((async () => { throw new Error(`échec pour Bearer ${TOKEN}`) }) as unknown as typeof fetch), 'Q')
  assert(!net.ok)
  if (!net.ok) assert(!net.detail.includes(TOKEN))
  assert(!JSON.stringify([echo, net]).includes(TOKEN))
})

Deno.test('le détail d\'erreur est tronqué', async () => {
  const r = await adsSearchAll(ctx((async () => new Response('x'.repeat(5000), { status: 500 })) as typeof fetch), 'Q')
  assert(!r.ok)
  if (!r.ok) assert(r.detail.length <= 300)
})
