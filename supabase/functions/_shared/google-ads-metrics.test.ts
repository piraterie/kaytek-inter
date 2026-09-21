// supabase/functions/_shared/google-ads-metrics.test.ts
//
// Synchronisation QUOTIDIENNE existante, corrigée : fenêtre de dates dans le FUSEAU
// du compte (bug de minuit à 02h à Paris), horodatage dédié metrics_synced_at.
// Base et API Google simulées : aucun réseau.
// Exécution : GOOGLE_OAUTH_CLIENT_ID=x deno test --allow-env supabase/functions/_shared/google-ads-metrics.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { syncGoogleAdsMetrics } from './google-ads-metrics.ts'
import { makeFakeDb, makeFakeGoogle, adsConnection, metricsOf, type Row } from './google-ads-test-support.ts'

const ORG = '10000000-0000-0000-0000-000000000001'
const TOKEN = 'ya29.DAILY_TOKEN_THAT_MUST_NEVER_LEAK'

function setup(conn: Row = adsConnection(ORG), respond?: () => { status?: number; body: unknown }) {
  const db = makeFakeDb({ google_ads_connections: [conn] })
  db.secrets[`sec-${ORG}`] = TOKEN
  const google = makeFakeGoogle([{ match: /FROM campaign/, respond: respond ?? (() => ({ body: { results: [
    { campaign: { id: '11', name: 'Camp' }, segments: { date: '2026-09-21' }, metrics: metricsOf(26, 2, 46_470_000) },
  ] } })) }])
  const run = (nowIso: string) => syncGoogleAdsMetrics(db.svc as never, ORG, 30, { fetchFn: google.fetchFn, now: new Date(nowIso) })
  return { db, google, run }
}

Deno.test('fenêtre de 30 jours dans le fuseau du compte (Europe/Paris) — 07h locale', async () => {
  const t = setup()
  const r = await t.run('2026-09-21T05:00:00Z')
  assert(r.ok)
  assert(t.google.queries()[0].includes("BETWEEN '2026-08-22' AND '2026-09-21'"), t.google.queries()[0])
})

Deno.test('BUG CORRIGÉ — entre minuit et 02h à Paris, « aujourd\'hui » est déjà la date du lendemain UTC', async () => {
  const t = setup()
  await t.run('2026-09-21T22:30:00Z') // 00:30 à Paris le 22/09
  const q = t.google.queries()[0]
  assert(q.includes("AND '2026-09-22'"), `la date de fin doit être 2026-09-22 (Paris), pas 2026-09-21 (UTC) : ${q}`)
  assert(q.includes("BETWEEN '2026-08-23'"), q)
})

Deno.test('passage à l\'heure d\'hiver : la date de fin reste la date locale', async () => {
  const t = setup()
  await t.run('2026-10-24T22:30:00Z') // 00:30 à Paris le 25/10 (été, UTC+2)
  assert(t.google.queries()[0].includes("AND '2026-10-25'"), t.google.queries()[0])
  const t2 = setup()
  await t2.run('2026-10-25T23:30:00Z') // 00:30 à Paris le 26/10 (hiver, UTC+1)
  assert(t2.google.queries()[0].includes("AND '2026-10-26'"), t2.google.queries()[0])
})

Deno.test('fuseau absent ou invalide : repli sur UTC (ancien comportement), sans erreur', async () => {
  for (const tz of [null, 'Mars/Olympus']) {
    const t = setup(adsConnection(ORG, { time_zone: tz }))
    const r = await t.run('2026-09-21T22:30:00Z')
    assert(r.ok)
    assert(t.google.queries()[0].includes("AND '2026-09-21'"), t.google.queries()[0])
  }
})

Deno.test('succès : lignes quotidiennes écrites (idempotent) + horodatage DÉDIÉ metrics_synced_at', async () => {
  const t = setup()
  await t.run('2026-09-21T05:00:00Z')
  await t.run('2026-09-21T06:00:00Z')
  assertEquals(t.db.tables.google_ads_metrics_daily.length, 1)
  assertEquals(t.db.tables.google_ads_metrics_daily[0].cost_micros, 46_470_000)
  assertEquals(t.db.tables.google_ads_connections[0].metrics_synced_at, '2026-09-21T06:00:00.000Z')
  assertEquals(t.db.tables.google_ads_connections[0].last_synced_at, '2026-09-21T06:00:00.000Z')
})

Deno.test('échec Google : metrics_synced_at N\'EST PAS modifié', async () => {
  const t = setup(adsConnection(ORG), () => ({ status: 500, body: { error: { message: 'boom' } } }))
  const r = await t.run('2026-09-21T05:00:00Z')
  assert(!r.ok)
  assertEquals(t.db.tables.google_ads_connections[0].metrics_synced_at, null)
})

Deno.test('le corps envoyé à Google ne contient que la requête (aucun pageSize : champ supprimé depuis la v19)', async () => {
  const t = setup()
  await t.run('2026-09-21T05:00:00Z')
  assertEquals(Object.keys(JSON.parse(JSON.stringify({ query: t.google.queries()[0] }))), ['query'])
  assert(!JSON.stringify(t.google.calls).includes('pageSize'))
})

Deno.test('aucun jeton dans le résultat d\'erreur', async () => {
  const t = setup(adsConnection(ORG), () => ({ status: 401, body: { error: { message: `bad ${TOKEN}` } } }))
  const r = await t.run('2026-09-21T05:00:00Z')
  assert(!r.ok)
  assert(!JSON.stringify(r).includes(TOKEN))
})
