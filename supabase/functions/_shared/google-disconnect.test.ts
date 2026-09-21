// supabase/functions/_shared/google-disconnect.test.ts
//
// Règle testée : déconnecter localement dans tous les cas ; ne révoquer
// l'autorisation Google que si la connexion est la DERNIÈRE encore active sur le
// même compte Google (Ads + Business Profile, toutes organisations, e-mail
// insensible à la casse, e-mail absent = prudence).
//
// AUCUN appel réseau : fetch et le coffre Vault sont remplacés par des faux en
// mémoire ; le client Supabase est une base en mémoire.
//
// Exécution : deno test --allow-env supabase/functions/_shared/google-disconnect.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { decideGrantRevocation, disconnectGoogleService, findOtherActiveConnections } from './google-disconnect.ts'

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const REFRESH_A_ADS = 'REFRESH_TOKEN_A_ADS_NEVER_REAL'
const SECRETS: Record<string, string> = {
  'sec-a-ads-acc': 'ACCESS_A_ADS', 'sec-a-ads-ref': REFRESH_A_ADS,
  'sec-a-gbp-acc': 'ACCESS_A_GBP', 'sec-a-gbp-ref': 'REFRESH_A_GBP',
  'sec-b-gbp-acc': 'ACCESS_B_GBP', 'sec-b-gbp-ref': 'REFRESH_B_GBP',
  'sec-b-ads-acc': 'ACCESS_B_ADS', 'sec-b-ads-ref': 'REFRESH_B_ADS',
}

type Row = Record<string, any>
function conn(org: string, id: string, email: string | null, status = 'connected'): Row {
  return {
    organisation_id: org, id: `row-${id}`, status, google_account_email: email,
    access_token_secret_id: status === 'disconnected' ? null : `sec-${id}-acc`,
    refresh_token_secret_id: status === 'disconnected' ? null : `sec-${id}-ref`,
    token_expires_at: '2099-01-01T00:00:00Z', last_error: null,
  }
}

// Base en mémoire minimale : select().eq()/neq() (attendable, ou maybeSingle) et update().eq().
function makeDb(tables: { google_ads_connections: Row[]; gbp_connections: Row[] }, opts: { failLookupOn?: string } = {}) {
  const events: Row[] = []
  const svc: any = {
    from(name: string) {
      if (name === 'google_oauth_events') return { insert: (r: Row) => { events.push(r); return Promise.resolve({ error: null }) } }
      const rows: Row[] = (tables as any)[name]
      return {
        select(_cols: string) {
          const filters: ((r: Row) => boolean)[] = []
          const b: any = {
            eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b },
            neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b },
            maybeSingle: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
            then(res: any, rej: any) {
              const error = opts.failLookupOn === name ? { message: 'boom' } : null
              return Promise.resolve({ data: error ? null : rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error }).then(res, rej)
            },
          }
          return b
        },
        update(patch: Row) {
          return { eq(c: string, v: unknown) { rows.filter((r) => r[c] === v).forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }) } }
        },
      }
    },
  }
  return { svc, events }
}

function makeDeps(db: ReturnType<typeof makeDb>, fetchImpl?: typeof fetch) {
  const revokeCalls: string[] = []
  const deleted: string[] = []
  const fetchFn = (fetchImpl ?? (async (_url: string | URL | Request, init?: RequestInit) => {
    revokeCalls.push(String((init?.body as URLSearchParams).get('token')))
    return new Response('{}', { status: 200 })
  })) as typeof fetch
  return {
    revokeCalls, deleted,
    deps: {
      svc: db.svc, fetchFn,
      readSecret: async (_s: unknown, id: string) => SECRETS[id] ?? null,
      deleteSecret: async (_s: unknown, id: string) => { deleted.push(id) },
    },
  }
}

const findRow = (rows: Row[], org: string) => rows.find((r) => r.organisation_id === org)!
// Lecture d'une table de la base en mémoire (copies des lignes).
const rowsOf = async (db: ReturnType<typeof makeDb>, table: string): Promise<Row[]> => (await db.svc.from(table).select('x')).data

// ───────────────────────────── décision pure ─────────────────────────────
Deno.test('décision — aucune autre connexion active : révoquer (dernière connexion)', () => {
  assertEquals(decideGrantRevocation('a@x.fr', []), { revoke: true, reason: 'last_connection' })
  assertEquals(decideGrantRevocation(null, []), { revoke: true, reason: 'last_connection' })
})
Deno.test('décision — même compte Google, casse et espaces ignorés : NE PAS révoquer', () => {
  assertEquals(decideGrantRevocation('Ludovic@Gmail.com', [{ email: '  ludovic@gmail.COM ' }]), { revoke: false, reason: 'grant_shared' })
})
Deno.test('décision — autres connexions sur d\'AUTRES comptes Google seulement : révoquer', () => {
  assertEquals(decideGrantRevocation('a@x.fr', [{ email: 'b@y.fr' }, { email: 'c@z.fr' }]), { revoke: true, reason: 'other_accounts_only' })
})
Deno.test('décision — e-mail absent sur une autre connexion : prudence, ne pas révoquer', () => {
  assertEquals(decideGrantRevocation('a@x.fr', [{ email: null }]), { revoke: false, reason: 'unknown_email' })
  assertEquals(decideGrantRevocation('a@x.fr', [{ email: '   ' }]), { revoke: false, reason: 'unknown_email' })
  assertEquals(decideGrantRevocation('a@x.fr', [{ email: 'b@y.fr' }, { email: null }]), { revoke: false, reason: 'unknown_email' })
})
Deno.test('décision — e-mail absent sur CETTE connexion alors qu\'une autre est active : prudence', () => {
  assertEquals(decideGrantRevocation(null, [{ email: 'b@y.fr' }]), { revoke: false, reason: 'unknown_email' })
  assertEquals(decideGrantRevocation('', [{ email: 'b@y.fr' }]), { revoke: false, reason: 'unknown_email' })
})

// ─────────────────────────── scénarios complets ───────────────────────────
Deno.test('CAS PRODUCTION — déconnecter GBP alors qu\'Ads est connecté (même org, même compte) : AUCUNE révocation, Ads intact', async () => {
  const db = makeDb({
    google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')],
    gbp_connections: [conn(ORG_A, 'a-gbp', 'ludo@gmail.com')],
  })
  const { deps, revokeCalls, deleted } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_business', ORG_A)

  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: false, reason: 'grant_shared' })
  assertEquals(revokeCalls.length, 0, 'aucun appel à oauth2.googleapis.com/revoke')
  // GBP déconnecté localement
  const gbp = findRow(await rowsOf(db, 'gbp_connections'), ORG_A)
  assertEquals(gbp.status, 'disconnected')
  assertEquals(gbp.access_token_secret_id, null)
  assertEquals(gbp.refresh_token_secret_id, null)
  assertEquals(deleted.sort(), ['sec-a-gbp-acc', 'sec-a-gbp-ref'])
  // Ads strictement intact : statut, secrets, e-mail
  const ads = (await rowsOf(db, 'google_ads_connections'))[0]
  assertEquals(ads.status, 'connected')
  assertEquals(ads.refresh_token_secret_id, 'sec-a-ads-ref')
  assertEquals(ads.access_token_secret_id, 'sec-a-ads-acc')
  assertEquals(ads.google_account_email, 'ludo@gmail.com')
  assert(!deleted.includes('sec-a-ads-acc') && !deleted.includes('sec-a-ads-ref'), 'les secrets Ads ne sont jamais supprimés')
  // audit
  assertEquals(db.events.length, 1)
  assertEquals(db.events[0].event_type, 'disconnected')
  assert(String(db.events[0].detail).includes('conservee') && String(db.events[0].detail).includes('grant_shared'))
})

Deno.test('déconnecter Ads alors que GBP est connecté (sens inverse) : aucune révocation', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [conn(ORG_A, 'a-gbp', 'ludo@gmail.com')] })
  const { deps, revokeCalls } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r.ok && r.grantRevoked, false)
  assertEquals(revokeCalls.length, 0)
  const gbp = (await rowsOf(db, 'gbp_connections'))[0]
  assertEquals(gbp.status, 'connected')
})

Deno.test('AUTRE ORGANISATION, même compte Google (casse différente) : aucune révocation, l\'autre organisation reste connectée', async () => {
  const db = makeDb({
    google_ads_connections: [conn(ORG_A, 'a-ads', 'Ludo@Gmail.com')],
    gbp_connections: [conn(ORG_B, 'b-gbp', 'ludo@gmail.com')],
  })
  const { deps, revokeCalls, deleted } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: false, reason: 'grant_shared' })
  assertEquals(revokeCalls.length, 0)
  assertEquals(deleted.sort(), ['sec-a-ads-acc', 'sec-a-ads-ref'])
  const other = (await rowsOf(db, 'gbp_connections'))[0]
  assertEquals(other.status, 'connected')
  assertEquals(other.refresh_token_secret_id, 'sec-b-gbp-ref')
})

Deno.test('DERNIÈRE connexion active sur ce compte : UNE seule révocation, avec le refresh token', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [conn(ORG_A, 'a-gbp', 'ludo@gmail.com', 'disconnected')] })
  const { deps, revokeCalls, deleted } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: true, reason: 'last_connection' })
  assertEquals(revokeCalls, [REFRESH_A_ADS])
  assertEquals(deleted.sort(), ['sec-a-ads-acc', 'sec-a-ads-ref'])
  const ads = (await rowsOf(db, 'google_ads_connections'))[0]
  assertEquals(ads.status, 'disconnected')
  assertEquals(ads.google_account_email, null)
})

Deno.test('connexions « expired » / « disconnected » des autres services : ne comptent pas comme actives', async () => {
  const db = makeDb({
    google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com'), conn(ORG_B, 'b-ads', 'ludo@gmail.com', 'expired')],
    gbp_connections: [conn(ORG_B, 'b-gbp', 'ludo@gmail.com', 'disconnected')],
  })
  const { deps, revokeCalls } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r.ok && r.reason, 'last_connection')
  assertEquals(revokeCalls.length, 1)
})

Deno.test('autre connexion active sur un AUTRE compte Google : révocation autorisée', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [conn(ORG_B, 'b-gbp', 'autre@gmail.com')] })
  const { deps, revokeCalls } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: true, reason: 'other_accounts_only' })
  assertEquals(revokeCalls.length, 1)
  const other = (await rowsOf(db, 'gbp_connections'))[0]
  assertEquals(other.status, 'connected')
})

Deno.test('ancienne connexion SANS e-mail encore active : prudence, aucune révocation', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [conn(ORG_B, 'b-gbp', null)] })
  const { deps, revokeCalls } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: false, reason: 'unknown_email' })
  assertEquals(revokeCalls.length, 0)
})

Deno.test('CETTE connexion sans e-mail alors qu\'une autre est active : prudence', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', null)], gbp_connections: [conn(ORG_B, 'b-gbp', 'ludo@gmail.com')] })
  const { deps, revokeCalls } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r.ok && r.reason, 'unknown_email')
  assertEquals(revokeCalls.length, 0)
})

Deno.test('recherche des autres connexions impossible (erreur base) : pas de révocation, déconnexion locale réussie', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [] }, { failLookupOn: 'gbp_connections' })
  const { deps, revokeCalls, deleted } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: false, reason: 'lookup_failed' })
  assertEquals(revokeCalls.length, 0)
  assertEquals(deleted.length, 2)
})

Deno.test('révocation Google en échec (réseau ou HTTP 400) : jamais bloquant, déconnexion locale réussie', async () => {
  for (const failing of [
    (async () => { throw new Error('réseau') }) as unknown as typeof fetch,
    (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch,
  ]) {
    const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [] })
    const { deps } = makeDeps(db, failing)
    const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
    assertEquals(r.ok && r.status, 'disconnected')
    assertEquals(r.ok && r.grantRevoked, false)
    assertEquals((await rowsOf(db, 'google_ads_connections'))[0].status, 'disconnected')
  }
})

Deno.test('idempotent : déjà déconnecté ou jamais connecté → aucun effet, aucune révocation', async () => {
  for (const rows of [[conn(ORG_A, 'a-ads', null, 'disconnected')], []]) {
    const db = makeDb({ google_ads_connections: rows, gbp_connections: [conn(ORG_A, 'a-gbp', 'ludo@gmail.com')] })
    const { deps, revokeCalls, deleted } = makeDeps(db)
    const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
    assertEquals(r, { ok: true, status: 'disconnected', grantRevoked: false, reason: 'already_disconnected' })
    assertEquals(revokeCalls.length, 0)
    assertEquals(deleted.length, 0)
    assertEquals(db.events.length, 0)
  }
})

Deno.test('findOtherActiveConnections : exclut uniquement la connexion elle-même (même table ET même organisation)', async () => {
  const db = makeDb({
    google_ads_connections: [conn(ORG_A, 'a-ads', 'a@x.fr'), conn(ORG_B, 'b-ads', 'b@x.fr')],
    gbp_connections: [conn(ORG_A, 'a-gbp', 'c@x.fr'), conn(ORG_B, 'b-gbp', 'd@x.fr', 'expired')],
  })
  const r = await findOtherActiveConnections(db.svc, 'google_ads', ORG_A)
  assert(r.ok)
  assertEquals(r.others.map((o) => o.email).sort(), ['b@x.fr', 'c@x.fr'])
})

Deno.test('aucun jeton ni e-mail dans le résultat ni dans l\'audit', async () => {
  const db = makeDb({ google_ads_connections: [conn(ORG_A, 'a-ads', 'ludo@gmail.com')], gbp_connections: [] })
  const { deps } = makeDeps(db)
  const r = await disconnectGoogleService(deps, 'google_ads', ORG_A)
  const dump = JSON.stringify([r, db.events])
  for (const secret of [...Object.values(SECRETS), 'ludo@gmail.com']) assert(!dump.includes(secret), `fuite : ${secret}`)
})
