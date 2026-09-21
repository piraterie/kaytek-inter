// supabase/functions/_shared/google-ads-intraday.test.ts
//
// Synchronisations horaire / ventilations / structure / quotidien / manuelle :
// créneaux en heure LOCALE du compte, éligibilité, idempotence, absence de
// doublons, limitation manuelle à 10 min, isolation entre organisations,
// AUCUN jeton dans les journaux, résultats ou états.
// Base et API Google simulées (voir google-ads-test-support.ts) : aucun réseau.
// Exécution : GOOGLE_OAUTH_CLIENT_ID=x deno test --allow-env supabase/functions/_shared/google-ads-intraday.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  runIntradayJob, runDailyJob, runManualFull, syncHourly, listEligibleConnections, type JobDeps, type DatasetEnv,
} from './google-ads-intraday.ts'
import { makeFakeDb, makeFakeGoogle, adsConnection, metricsOf, type Row } from './google-ads-test-support.ts'

const ORG1 = '10000000-0000-0000-0000-000000000001'
const ORG2 = '20000000-0000-0000-0000-000000000002'
const CUST1 = '7536669574'
const CUST2 = '1112223333'
const TOKEN = 'ya29.TOKEN_THAT_MUST_NEVER_LEAK'

// Heures UTC ↔ Paris (été, UTC+2) : 05:05Z = 07:05 ; 20:05Z = 22:05 ; 21:05Z = 23:05 ; 04:05Z = 06:05
const at = (iso: string) => () => new Date(iso)

const hourlyRow = (campaign: string, date: string, hour: number, imp = 10, clicks = 1, cost = 1_000_000) =>
  ({ campaign: { id: campaign, name: `Camp ${campaign}` }, segments: { date, hour }, metrics: metricsOf(imp, clicks, cost) })

/** Routes Google : une réponse par type de requête (spécifiques d'abord). */
function routes(over: Partial<Record<'hourly' | 'devices' | 'age' | 'gender' | 'city' | 'postal' | 'zones' | 'campaigns' | 'names', (call: { query: string; url: string }) => { status?: number; body: unknown }>> = {}) {
  const ok = (results: unknown[]) => () => ({ body: { results } })
  return [
    { match: /FROM geo_target_constant/, respond: over.names ?? (() => ({ body: { results: [] } })) },
    { match: /segments\.hour/, respond: over.hourly ?? ok([hourlyRow('c1', '2026-09-21', 8)]) },
    { match: /FROM customer/, respond: over.devices ?? ok([{ segments: { date: '2026-09-21', device: 'MOBILE' }, metrics: metricsOf(100, 5, 2_000_000) }, { segments: { date: '2026-09-21', device: 'DESKTOP' }, metrics: metricsOf(10, 1, 100_000) }]) },
    { match: /FROM age_range_view/, respond: over.age ?? ok([
      { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_UNDETERMINED' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(50, 2, 500_000) },
      { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(30, 3, 900_000) },
    ]) },
    { match: /FROM gender_view/, respond: over.gender ?? ok([
      { adGroupCriterion: { gender: { type: 'UNDETERMINED' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(60, 2, 600_000) },
      { adGroupCriterion: { gender: { type: 'FEMALE' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(20, 3, 800_000) },
    ]) },
    { match: /geo_target_city/, respond: over.city ?? ok([{ geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-21', geoTargetCity: 'geoTargetConstants/1006219' }, metrics: metricsOf(70, 5, 2_000_000) }]) },
    { match: /geo_target_postal_code/, respond: over.postal ?? ok([{ geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-21', geoTargetPostalCode: 'geoTargetConstants/9055221' }, metrics: metricsOf(40, 3, 1_000_000) }]) },
    { match: /FROM campaign_criterion/, respond: over.zones ?? ok([]) },
    { match: /FROM campaign$/, respond: over.campaigns ?? ok([{ campaign: { id: 'c1', name: 'Camp c1', status: 'ENABLED', advertisingChannelType: 'SEARCH' } }, { campaign: { id: 'c0', name: 'Ancienne', status: 'REMOVED' } }]) },
  ]
}

function setup(connections: Row[] = [adsConnection(ORG1)], over: Parameters<typeof routes>[0] = {}, dbOpts: Parameters<typeof makeFakeDb>[1] = {}) {
  const db = makeFakeDb({ google_ads_connections: connections }, dbOpts)
  const google = makeFakeGoogle(routes(over))
  let dailyCalls = 0
  const deps = (now: string, extra: Partial<JobDeps> = {}): JobDeps => ({
    svc: db.svc as unknown as JobDeps['svc'], now: at(now), fetchFn: google.fetchFn,
    getToken: async () => ({ ok: true, accessToken: TOKEN }),
    dailySync: async () => { dailyCalls++; return { ok: true, rowsUpserted: 31 } },
    ...extra,
  })
  return { db, google, deps, get dailyCalls() { return dailyCalls } }
}

const state = (db: ReturnType<typeof makeFakeDb>, org: string, dataset: string) => db.tables.google_ads_sync_state.find((s) => s.organisation_id === org && s.dataset === dataset)

/** Capture console.warn / error / log pendant un test (détection de fuites de secret). */
async function withConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const saved = { warn: console.warn, error: console.error, log: console.log }
  const buf: string[] = []
  const grab = (...a: unknown[]) => { buf.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  console.warn = grab; console.error = grab; console.log = grab
  try { return { result: await fn(), logs: buf.join('\n') } } finally { Object.assign(console, saved) }
}

// ───────────────────────────── HORAIRE ─────────────────────────────
Deno.test('horaire — créneau 07h05 heure de Paris : synchronise, écrit dans la table horaire, horodatage dédié', async () => {
  const t = setup()
  const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  assertEquals([s.eligible, s.ran, s.failed], [1, 1, 0])
  assertEquals(t.google.calls.length, 1)
  const rows = t.db.tables.google_ads_metrics_hourly
  assertEquals(rows.length, 1)
  assertEquals(rows[0], { organisation_id: ORG1, customer_id: CUST1, campaign_id: 'c1', campaign_name: 'Camp c1', local_date: '2026-09-21', hour: 8, impressions: 10, clicks: 1, cost_micros: 1_000_000, conversions: 0, conversions_value: 0, synced_at: '2026-09-21T05:05:00.000Z' })
  // Horodatage DÉDIÉ des métriques
  assertEquals(t.db.tables.google_ads_connections[0].metrics_synced_at, '2026-09-21T05:05:00.000Z')
  assertEquals(state(t.db, ORG1, 'hourly')?.synced_at, '2026-09-21T05:05:00.000Z')
  assertEquals(state(t.db, ORG1, 'hourly')?.last_error, null)
})

Deno.test('horaire — la requête couvre J-2 → aujourd\'hui, dates du FUSEAU du compte', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  assert(t.google.queries()[0].includes("BETWEEN '2026-09-19' AND '2026-09-21'"), t.google.queries()[0])
  assert(t.google.queries()[0].includes('segments.hour'))
  assertEquals(t.google.calls[0].url.includes(`/customers/${CUST1}/`), true)
})

Deno.test('horaire — heure LOCALE : 07h→22h59 synchronisent, 06h et 23h non (AUCUN appel Google hors créneau)', async () => {
  for (const [utc, expectRun] of [['2026-09-21T04:05:00Z', false], ['2026-09-21T05:05:00Z', true], ['2026-09-21T20:05:00Z', true], ['2026-09-21T21:05:00Z', false], ['2026-09-21T22:05:00Z', false], ['2026-09-21T00:05:00Z', false]] as const) {
    const t = setup()
    const s = await runIntradayJob(t.deps(utc), 'hourly')
    assertEquals(s.ran, expectRun ? 1 : 0, utc)
    assertEquals(t.google.calls.length, expectRun ? 1 : 0, `appels Google à ${utc}`)
    if (!expectRun) assertEquals(s.skipped.outside_hours, 1)
  }
})

Deno.test('horaire — 16 passages par jour et par organisation à Paris, en été comme en hiver', async () => {
  for (const day of ['2026-07-15', '2026-12-15']) {
    const t = setup()
    let ran = 0
    for (let h = 0; h < 24; h++) {
      const s = await runIntradayJob(t.deps(`${day}T${String(h).padStart(2, '0')}:05:00Z`), 'hourly')
      ran += s.ran
    }
    assertEquals(ran, 16, day)
    assertEquals(t.google.calls.length, 16, `${day} : 16 appels Google`)
  }
})

Deno.test('horaire — fuseau du compte différent (New York) : créneaux décalés en conséquence', async () => {
  const t = setup([adsConnection(ORG1, { time_zone: 'America/New_York' })])
  assertEquals((await runIntradayJob(t.deps('2026-09-21T11:05:00Z'), 'hourly')).ran, 1) // 07:05 à New York (UTC-4)
  const t2 = setup([adsConnection(ORG1, { time_zone: 'America/New_York' })])
  assertEquals((await runIntradayJob(t2.deps('2026-09-21T05:05:00Z'), 'hourly')).ran, 0) // 01:05 à New York
})

Deno.test('horaire — IDEMPOTENCE : deux passages avec les mêmes données = aucune ligne en double', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  await runIntradayJob(t.deps('2026-09-21T06:05:00Z'), 'hourly')
  await runIntradayJob(t.deps('2026-09-21T07:05:00Z'), 'hourly')
  assertEquals(t.db.tables.google_ads_metrics_hourly.length, 1)
  assertEquals(t.db.tables.google_ads_metrics_hourly[0].synced_at, '2026-09-21T07:05:00.000Z')
})

Deno.test('horaire — les valeurs mises à jour par Google écrasent l\'ancienne ligne (même clé)', async () => {
  const t = setup([adsConnection(ORG1)], { hourly: () => ({ body: { results: [hourlyRow('c1', '2026-09-21', 8, 10, 1)] } }) })
  await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  const t2 = { ...t }
  t2.google.calls.length = 0
  const g2 = makeFakeGoogle(routes({ hourly: () => ({ body: { results: [hourlyRow('c1', '2026-09-21', 8, 25, 3, 4_000_000)] } }) }))
  await runIntradayJob({ ...t.deps('2026-09-21T06:05:00Z'), fetchFn: g2.fetchFn }, 'hourly')
  assertEquals(t.db.tables.google_ads_metrics_hourly.length, 1)
  assertEquals([t.db.tables.google_ads_metrics_hourly[0].impressions, t.db.tables.google_ads_metrics_hourly[0].clicks], [25, 3])
})

Deno.test('horaire — anti double-déclenchement : synchronisé il y a moins de 30 min → aucun appel Google', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  const before = t.google.calls.length
  const s = await runIntradayJob(t.deps('2026-09-21T05:25:00Z'), 'hourly')
  assertEquals(s.skipped.recent, 1)
  assertEquals(t.google.calls.length, before)
})

Deno.test('horaire — ÉLIGIBILITÉ : connexion inactive / sans compte / manager / identifiant invalide / fuseau absent → AUCUN appel', async () => {
  const cases: [string, Row][] = [
    ['déconnectée', adsConnection(ORG1, { status: 'disconnected' })],
    ['expirée', adsConnection(ORG1, { status: 'expired' })],
    ['sans compte sélectionné', adsConnection(ORG1, { google_customer_id: null })],
    ['compte manager', adsConnection(ORG1, { is_manager_account: true })],
    ['identifiant de compte invalide', adsConnection(ORG1, { google_customer_id: '75; DROP TABLE' })],
    ['fuseau absent', adsConnection(ORG1, { time_zone: null })],
    ['fuseau invalide', adsConnection(ORG1, { time_zone: 'Mars/Olympus' })],
  ]
  for (const [label, conn] of cases) {
    const t = setup([conn])
    const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
    assertEquals(s.ran, 0, label)
    assertEquals(t.google.calls.length, 0, `${label} : aucun appel Google`)
    assertEquals(t.db.tables.google_ads_metrics_hourly.length, 0, label)
  }
})

Deno.test('horaire — aucune organisation connectée : aucun appel', async () => {
  const t = setup([])
  const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  assertEquals([s.eligible, s.ran], [0, 0])
  assertEquals(t.google.calls.length, 0)
})

Deno.test('horaire — ISOLATION : l\'échec d\'une organisation n\'empêche pas les autres, chacune avec SES données', async () => {
  const t = setup([adsConnection(ORG1), adsConnection(ORG2, { google_customer_id: CUST2 })], {
    hourly: (c) => c.url.includes(CUST1) ? { status: 500, body: { error: { message: 'boom' } } } : { body: { results: [hourlyRow('c9', '2026-09-21', 9, 77)] } },
  })
  const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  assertEquals([s.ran, s.failed], [2, 1])
  const rows = t.db.tables.google_ads_metrics_hourly
  assertEquals(rows.length, 1)
  assertEquals([rows[0].organisation_id, rows[0].customer_id, rows[0].impressions], [ORG2, CUST2, 77])
  assertEquals(state(t.db, ORG1, 'hourly')?.last_error, 'google_google_error')
  assertEquals(state(t.db, ORG1, 'hourly')?.synced_at, undefined)
  // metrics_synced_at inchangé pour l'organisation en échec, mis à jour pour l'autre
  assertEquals(t.db.tables.google_ads_connections.find((c) => c.organisation_id === ORG1)!.metrics_synced_at, null)
  assertEquals(t.db.tables.google_ads_connections.find((c) => c.organisation_id === ORG2)!.metrics_synced_at, '2026-09-21T05:05:00.000Z')
})

Deno.test('horaire — jeton indisponible (reconnexion requise) : aucun appel Google pour cette organisation, les autres continuent', async () => {
  const t = setup([adsConnection(ORG1), adsConnection(ORG2, { google_customer_id: CUST2 })])
  const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z', {
    getToken: async (_s, org) => (org === ORG1 ? { ok: false, reason: 'needs_reconnect' } : { ok: true, accessToken: TOKEN }),
  }), 'hourly')
  assertEquals([s.ran, s.failed, s.skipped.token_needs_reconnect], [1, 1, 1])
  assertEquals(t.google.calls.length, 1)
  assert(t.google.calls[0].url.includes(CUST2))
})

Deno.test('horaire — exception inattendue sur une organisation : isolée, les suivantes traitées', async () => {
  const t = setup([adsConnection(ORG1), adsConnection(ORG2, { google_customer_id: CUST2 })])
  const { result: s } = await withConsole(() => runIntradayJob(t.deps('2026-09-21T05:05:00Z', {
    getToken: async (_s, org) => { if (org === ORG1) throw new Error('boum'); return { ok: true, accessToken: TOKEN } },
  }), 'hourly'))
  assertEquals([s.ran, s.failed], [1, 1])
})

Deno.test('horaire — échec d\'écriture en base : signalé, horodatage NON mis à jour', async () => {
  const t = setup([adsConnection(ORG1)], {}, { failWrites: ['google_ads_metrics_hourly'] })
  const s = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
  assertEquals(s.failed, 1)
  assertEquals(t.db.tables.google_ads_connections[0].metrics_synced_at, null)
  assertEquals(state(t.db, ORG1, 'hourly')?.last_error, 'ecriture_horaire')
})

// ─────────────────────────── VENTILATIONS ───────────────────────────
Deno.test('ventilations — créneaux locaux 07h, 11h, 15h, 19h uniquement : 4 passages par jour, 5 requêtes chacun', async () => {
  const t = setup()
  let ran = 0
  for (let h = 0; h < 24; h++) {
    // 7h de Paris en été = 05h UTC ; on avance d'une heure locale à chaque tour, avec > 2 h d'écart entre passages
    const s = await runIntradayJob(t.deps(`2026-09-21T${String(h).padStart(2, '0')}:15:00Z`), 'breakdowns')
    ran += s.ran
  }
  assertEquals(ran, 4)
  // appareils + âge + sexe + ville + code postal = 5 requêtes par passage (+ noms de zones la 1re fois)
  const queries = t.google.queries()
  assertEquals(queries.filter((q) => q.includes('FROM customer')).length, 4)
  assertEquals(queries.filter((q) => q.includes('FROM age_range_view')).length, 4)
  assertEquals(queries.filter((q) => q.includes('FROM gender_view')).length, 4)
  assertEquals(queries.filter((q) => q.includes('geo_target_city')).length, 4)
  assertEquals(queries.filter((q) => q.includes('geo_target_postal_code')).length, 4)
})

Deno.test('ventilations — hors créneau (08h locale) : aucun appel', async () => {
  const t = setup()
  const s = await runIntradayJob(t.deps('2026-09-21T06:15:00Z'), 'breakdowns') // 08:15 à Paris
  assertEquals(s.ran, 0)
  assertEquals(t.google.calls.length, 0)
})

Deno.test('ventilations — rattrapage initial (30 j / 30 j / 90 j) PUIS fenêtre glissante de 7 jours', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  const first = t.google.queries()
  assert(first.find((q) => q.includes('FROM customer'))!.includes("BETWEEN '2026-08-22' AND '2026-09-21'"), 'appareils : 30 jours')
  assert(first.find((q) => q.includes('FROM age_range_view'))!.includes("BETWEEN '2026-08-22' AND '2026-09-21'"), 'âge : 30 jours')
  assert(first.find((q) => q.includes('geo_target_city'))!.includes("BETWEEN '2026-06-23' AND '2026-09-21'"), 'ville : 90 jours')
  assert(first.find((q) => q.includes('geo_target_postal_code'))!.includes("BETWEEN '2026-06-23' AND '2026-09-21'"), 'code postal : 90 jours')
  for (const d of ['devices', 'demographics', 'geo']) assert(state(t.db, ORG1, d)?.backfilled_at, `${d} : rattrapage marqué terminé`)

  t.google.calls.length = 0
  await runIntradayJob(t.deps('2026-09-21T09:15:00Z'), 'breakdowns') // 11:15 Paris, > 2 h plus tard
  const next = t.google.queries()
  assert(next.find((q) => q.includes('FROM customer'))!.includes("BETWEEN '2026-09-14' AND '2026-09-21'"), 'appareils : 7 jours')
  assert(next.find((q) => q.includes('geo_target_city'))!.includes("BETWEEN '2026-09-14' AND '2026-09-21'"), 'ville : 7 jours')
})

Deno.test('ventilations — un rattrapage ÉCHOUÉ n\'est pas marqué terminé : il est retenté au passage suivant', async () => {
  let failGeo = true
  const t = setup([adsConnection(ORG1)], { city: () => (failGeo ? { status: 500, body: { error: { message: 'x' } } } : { body: { results: [] } }) })
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  assertEquals(state(t.db, ORG1, 'geo')?.backfilled_at, undefined)
  assertEquals(state(t.db, ORG1, 'geo')?.last_error, 'google_google_error')
  failGeo = false
  t.google.calls.length = 0
  await runIntradayJob(t.deps('2026-09-21T09:15:00Z'), 'breakdowns')
  assert(t.google.queries().find((q) => q.includes('geo_target_city'))!.includes("BETWEEN '2026-06-23'"), 'rattrapage de 90 jours retenté')
  assert(state(t.db, ORG1, 'geo')?.backfilled_at)
})

Deno.test('ventilations — DÉMOGRAPHIE : deux répartitions séparées, valeurs « non déterminé » CONSERVÉES, aucun croisement', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  const demo = t.db.tables.google_ads_demographics_daily
  const byDim = (d: string) => demo.filter((r) => r.dimension === d).map((r) => r.value).sort()
  assertEquals(byDim('age_range'), ['AGE_RANGE_25_34', 'AGE_RANGE_UNDETERMINED'])
  assertEquals(byDim('gender'), ['FEMALE', 'UNDETERMINED'])
  assert(demo.every((r) => r.customer_id === CUST1 && r.organisation_id === ORG1))
  // jamais une colonne âge ET sexe sur la même ligne
  assert(demo.every((r) => !('age_range' in r) && !('gender' in r)))
  assertEquals(demo.find((r) => r.value === 'AGE_RANGE_UNDETERMINED')!.impressions, 50)
})

Deno.test('ventilations — appareils : valeurs Google conservées', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  assertEquals(t.db.tables.google_ads_devices_daily.map((r) => r.device).sort(), ['DESKTOP', 'MOBILE'])
})

Deno.test('ventilations — géographie : ville et code postal SÉPARÉS (niveau distinct), présence conservée, noms résolus une seule fois', async () => {
  const names = (c: { query: string }) => ({
    body: { results: [
      ...(c.query.includes('/1006219') ? [{ geoTargetConstant: { id: '1006219', name: 'Toulouse', canonicalName: 'Toulouse,Occitanie,France', targetType: 'City', countryCode: 'FR', parentGeoTarget: 'geoTargetConstants/20940', status: 'ENABLED' } }] : []),
      ...(c.query.includes('/9055221') ? [{ geoTargetConstant: { id: '9055221', name: '31000', canonicalName: '31000,Occitanie,France', targetType: 'Postal Code', countryCode: 'FR', parentGeoTarget: 'geoTargetConstants/20940', status: 'ENABLED' } }] : []),
    ] },
  })
  const t = setup([adsConnection(ORG1)], { names })
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  const geo = t.db.tables.google_ads_geo_daily
  assertEquals(geo.map((r) => [r.geo_level, r.geo_target_id, r.presence_type]).sort(), [['city', 1006219, 'LOCATION_OF_PRESENCE'], ['postal_code', 9055221, 'LOCATION_OF_PRESENCE']])
  assertEquals(t.db.tables.google_geo_targets.map((r) => [r.geo_target_id, r.canonical_name, r.region_name]).sort(), [[1006219, 'Toulouse,Occitanie,France', 'Occitanie'], [9055221, '31000,Occitanie,France', 'Occitanie']])
  const nameQueries = () => t.google.queries().filter((q) => q.includes('FROM geo_target_constant')).length
  assertEquals(nameQueries(), 1)
  // 2e passage : noms déjà connus → aucune nouvelle requête de noms
  await runIntradayJob(t.deps('2026-09-21T09:15:00Z'), 'breakdowns')
  assertEquals(nameQueries(), 1)
  assertEquals(geo.length, 2)
})

Deno.test('ventilations — IDEMPOTENCE : 3 passages = aucune ligne en double', async () => {
  const t = setup()
  for (const h of ['05', '09', '13']) await runIntradayJob(t.deps(`2026-09-21T${h}:15:00Z`), 'breakdowns')
  assertEquals(t.db.tables.google_ads_devices_daily.length, 2)
  assertEquals(t.db.tables.google_ads_demographics_daily.length, 4)
  assertEquals(t.db.tables.google_ads_geo_daily.length, 2)
})

Deno.test('ventilations — plusieurs lignes Google de même clé (groupes d\'annonces) : additionnées, jamais de doublon dans le lot', async () => {
  const t = setup([adsConnection(ORG1)], {
    age: () => ({ body: { results: [
      { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(10, 1, 100) },
      { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' } }, segments: { date: '2026-09-21' }, metrics: metricsOf(5, 2, 50) },
    ] } }),
  })
  const { result: s } = await withConsole(() => runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns'))
  assertEquals(s.failed, 0) // la base simulée échouerait sur « cannot affect row a second time »
  assertEquals(t.db.tables.google_ads_demographics_daily.find((r) => r.value === 'AGE_RANGE_25_34')!.impressions, 15)
})

Deno.test('ventilations — un jeu de données en échec n\'empêche pas les autres', async () => {
  const t = setup([adsConnection(ORG1)], { age: () => ({ status: 500, body: { error: { message: 'x' } } }) })
  const s = await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  assertEquals(s.datasets.devices, { ok: 1, failed: 0 })
  assertEquals(s.datasets.geo, { ok: 1, failed: 0 })
  assertEquals(s.datasets.demographics, { ok: 0, failed: 1 })
  assertEquals(t.db.tables.google_ads_devices_daily.length, 2)
  // le sexe (2e requête de la démographie) est quand même enregistré
  assertEquals(t.db.tables.google_ads_demographics_daily.filter((r) => r.dimension === 'gender').length, 2)
  assertEquals(state(t.db, ORG1, 'demographics')?.backfilled_at, undefined)
})

Deno.test('ventilations — anti double-déclenchement (2 h)', async () => {
  const t = setup()
  await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
  const n = t.google.calls.length
  const s = await runIntradayJob(t.deps('2026-09-21T05:45:00Z'), 'breakdowns')
  assertEquals(s.skipped.recent, 1)
  assertEquals(t.google.calls.length, n)
})

// ───────────────────────── STRUCTURE + QUOTIDIEN ─────────────────────────
Deno.test('structure — statut RÉEL des campagnes stocké tel que Google le renvoie (jamais déduit)', async () => {
  const t = setup([adsConnection(ORG1)], { campaigns: () => ({ body: { results: [
    { campaign: { id: '1', name: 'A', status: 'ENABLED', advertisingChannelType: 'SEARCH' } },
    { campaign: { id: '2', name: 'B', status: 'PAUSED' } },
    { campaign: { id: '3', name: 'C', status: 'REMOVED' } },
  ] } }) })
  await runDailyJob(t.deps('2026-09-21T05:00:00Z'))
  assertEquals(t.db.tables.google_ads_campaigns.map((c) => [c.campaign_id, c.status]).sort(), [['1', 'ENABLED'], ['2', 'PAUSED'], ['3', 'REMOVED']])
  assert(t.db.tables.google_ads_campaigns.every((c) => c.customer_id === CUST1 && c.organisation_id === ORG1))
})

Deno.test('structure — zones : rayon avec coordonnées, zone nommée sans coordonnées + libellé ; rayon incomplet IGNORÉ', async () => {
  const t = setup([adsConnection(ORG1)], {
    zones: () => ({ body: { results: [
      { campaign: { id: '1', name: 'Baziege', status: 'ENABLED' }, campaignCriterion: { criterionId: '501', type: 'PROXIMITY', negative: false, proximity: { geoPoint: { latitudeInMicroDegrees: 43579286, longitudeInMicroDegrees: 1439845 }, radius: 20, radiusUnits: 'KILOMETERS' } } },
      { campaign: { id: '1', name: 'Baziege', status: 'ENABLED' }, campaignCriterion: { criterionId: '502', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/1006219' } } },
      { campaign: { id: '1', name: 'Baziege', status: 'ENABLED' }, campaignCriterion: { criterionId: '503', type: 'PROXIMITY', negative: false, proximity: { radius: 30, radiusUnits: 'KILOMETERS' } } }, // sans coordonnées
    ] } }),
    names: () => ({ body: { results: [{ geoTargetConstant: { id: '1006219', name: 'Toulouse', canonicalName: 'Toulouse,Occitanie,France', targetType: 'City', countryCode: 'FR' } }] } }),
  })
  await runDailyJob(t.deps('2026-09-21T05:00:00Z'))
  const zones = t.db.tables.google_ads_targeted_zones
  assertEquals(zones.length, 2)
  const prox = zones.find((z) => z.zone_type === 'PROXIMITY')!
  assertEquals([prox.latitude, prox.longitude, prox.radius, prox.radius_unit, prox.criterion_id], [43.579286, 1.439845, 20, 'KILOMETERS', 501])
  const loc = zones.find((z) => z.zone_type === 'LOCATION')!
  assertEquals([loc.latitude, loc.longitude, loc.radius, loc.geo_target_id, loc.label], [null, null, null, 1006219, 'Toulouse,Occitanie,France'])
  assertEquals(state(t.db, ORG1, 'structure')?.last_error, 'zones_ignorees_1')
})

Deno.test('structure — instantané du ciblage : une zone qui n\'est plus renvoyée par Google est retirée', async () => {
  let current = [
    { campaign: { id: '1', name: 'A', status: 'ENABLED' }, campaignCriterion: { criterionId: '1', type: 'PROXIMITY', negative: false, proximity: { geoPoint: { latitudeInMicroDegrees: 43000000, longitudeInMicroDegrees: 1000000 }, radius: 10, radiusUnits: 'KILOMETERS' } } },
    { campaign: { id: '1', name: 'A', status: 'ENABLED' }, campaignCriterion: { criterionId: '2', type: 'PROXIMITY', negative: false, proximity: { geoPoint: { latitudeInMicroDegrees: 44000000, longitudeInMicroDegrees: 2000000 }, radius: 5, radiusUnits: 'MILES' } } },
  ]
  const t = setup([adsConnection(ORG1)], { zones: () => ({ body: { results: current } }) })
  await runDailyJob(t.deps('2026-09-21T05:00:00Z'))
  assertEquals(t.db.tables.google_ads_targeted_zones.length, 2)
  current = [current[0]]
  await runDailyJob(t.deps('2026-09-22T05:00:00Z'))
  assertEquals(t.db.tables.google_ads_targeted_zones.map((z) => z.criterion_id), [1])
})

Deno.test('structure — la suppression d\'une zone ne touche JAMAIS une autre organisation ni un autre compte', async () => {
  const t = setup([adsConnection(ORG1)], { zones: () => ({ body: { results: [] } }) })
  t.db.tables.google_ads_targeted_zones.push(
    { organisation_id: ORG2, customer_id: CUST2, campaign_id: 'x', criterion_id: 1, zone_type: 'LOCATION', synced_at: '2000-01-01T00:00:00Z' },
    { organisation_id: ORG1, customer_id: 'AUTRE_COMPTE', campaign_id: 'x', criterion_id: 2, zone_type: 'LOCATION', synced_at: '2000-01-01T00:00:00Z' },
    { organisation_id: ORG1, customer_id: CUST1, campaign_id: 'x', criterion_id: 3, zone_type: 'LOCATION', synced_at: '2000-01-01T00:00:00Z' },
  )
  await runDailyJob(t.deps('2026-09-21T05:00:00Z'))
  assertEquals(t.db.tables.google_ads_targeted_zones.map((z) => z.criterion_id).sort(), [1, 2])
})

Deno.test('quotidien — métriques quotidiennes + structure pour les organisations éligibles ; échecs isolés', async () => {
  const t = setup([adsConnection(ORG1), adsConnection(ORG2, { google_customer_id: CUST2 }), adsConnection('30000000-0000-0000-0000-000000000003', { status: 'disconnected' })])
  const r = await runDailyJob(t.deps('2026-09-21T05:00:00Z', {
    dailySync: async (_s, org) => (org === ORG1 ? { ok: false, reason: 'google_error' } : { ok: true, rowsUpserted: 31 }),
  }))
  assertEquals([r.eligible, r.synced, r.failed], [2, 1, 1])
  // la structure est tentée même quand les métriques quotidiennes échouent
  assertEquals(state(t.db, ORG1, 'structure')?.synced_at !== undefined, true)
})

// ───────────────────────── SYNCHRONISATION MANUELLE ─────────────────────────
Deno.test('manuel — synchronisation COMPLÈTE : quotidien + horaire + appareils + démographie + géographie + structure', async () => {
  const t = setup()
  const r = await runManualFull(t.deps('2026-09-21T14:30:00Z'), ORG1)
  assert(r.ok && !r.throttled)
  if (r.ok && !r.throttled) {
    assertEquals(r.daily.rowsUpserted, 31)
    assertEquals(r.datasets.map((d) => d.dataset), ['hourly', 'devices', 'demographics', 'geo', 'structure'])
    assert(r.datasets.every((d) => d.ok), JSON.stringify(r.datasets))
  }
  assertEquals(t.dailyCalls, 1)
  assertEquals(t.db.tables.google_ads_metrics_hourly.length, 1)
})

Deno.test('manuel — ignore les créneaux horaires (fonctionne à 3h du matin)', async () => {
  const t = setup()
  const r = await runManualFull(t.deps('2026-09-21T01:00:00Z'), ORG1) // 03:00 à Paris
  assert(r.ok && !r.throttled)
  assertEquals(t.db.tables.google_ads_metrics_hourly.length, 1)
})

Deno.test('manuel — LIMITATION : une synchronisation complète par tranche de 10 min et par organisation', async () => {
  const t = setup()
  await runManualFull(t.deps('2026-09-21T14:30:00Z'), ORG1)
  const calls = t.google.calls.length
  const daily = t.dailyCalls

  const r = await runManualFull(t.deps('2026-09-21T14:35:00Z'), ORG1)
  assert(r.ok && r.throttled)
  if (r.ok && r.throttled) assertEquals(r.nextAllowedAt, '2026-09-21T14:40:00.000Z')
  assertEquals(t.google.calls.length, calls, 'aucun appel Google pendant la limitation')
  assertEquals(t.dailyCalls, daily)

  const r2 = await runManualFull(t.deps('2026-09-21T14:41:00Z'), ORG1)
  assert(r2.ok && !r2.throttled)
  assert(t.google.calls.length > calls)
})

Deno.test('manuel — la limitation est PAR organisation', async () => {
  const t = setup([adsConnection(ORG1), adsConnection(ORG2, { google_customer_id: CUST2 })])
  await runManualFull(t.deps('2026-09-21T14:30:00Z'), ORG1)
  const r = await runManualFull(t.deps('2026-09-21T14:31:00Z'), ORG2)
  assert(r.ok && !r.throttled)
})

Deno.test('manuel — un échec des métriques quotidiennes ne verrouille PAS la nouvelle tentative', async () => {
  const t = setup()
  const failing = t.deps('2026-09-21T14:30:00Z', { dailySync: async () => ({ ok: false, reason: 'google_error', detail: 'x' }) })
  const r = await runManualFull(failing, ORG1)
  assert(!r.ok)
  if (!r.ok) assertEquals(r.reason, 'google_error')
  assertEquals(t.google.calls.length, 0)
  const retry = await runManualFull(t.deps('2026-09-21T14:31:00Z'), ORG1)
  assert(retry.ok && !retry.throttled)
})

Deno.test('manuel — non connecté / sans compte / compte manager : refus explicite, AUCUN appel Google', async () => {
  const cases: [string, Row | null, string][] = [
    ['déconnecté', adsConnection(ORG1, { status: 'disconnected' }), 'not_connected'],
    ['inexistant', null, 'not_connected'],
    ['sans compte', adsConnection(ORG1, { google_customer_id: null }), 'no_customer_selected'],
    ['manager', adsConnection(ORG1, { is_manager_account: true }), 'no_customer_selected'],
  ]
  for (const [label, conn, reason] of cases) {
    const t = setup(conn ? [conn] : [])
    const r = await runManualFull(t.deps('2026-09-21T14:30:00Z'), ORG1)
    assert(!r.ok, label)
    if (!r.ok) assertEquals(r.reason, reason, label)
    assertEquals(t.google.calls.length, 0, label)
    assertEquals(t.dailyCalls, 0, label)
  }
})

Deno.test('manuel — fuseau absent : les métriques quotidiennes sont synchronisées, les données horaires signalées, aucun appel horaire', async () => {
  const t = setup([adsConnection(ORG1, { time_zone: null })])
  const r = await runManualFull(t.deps('2026-09-21T14:30:00Z'), ORG1)
  assert(r.ok && !r.throttled)
  if (r.ok && !r.throttled) assertEquals(r.datasets, [{ dataset: 'hourly', ok: false, error: 'timezone_missing' }])
  assertEquals(t.dailyCalls, 1)
  assertEquals(t.google.calls.length, 0)
})

Deno.test('manuel — jeton indisponible : métriques quotidiennes faites, le reste signalé', async () => {
  const t = setup()
  const r = await runManualFull(t.deps('2026-09-21T14:30:00Z', { getToken: async () => ({ ok: false, reason: 'needs_reconnect' }) }), ORG1)
  assert(r.ok && !r.throttled)
  if (r.ok && !r.throttled) assertEquals(r.datasets[0].error, 'token_needs_reconnect')
})

// ───────────────────────── SÉCURITÉ ─────────────────────────
Deno.test('AUCUN JETON ni corps d\'erreur brut dans les journaux, résultats et états — même si Google renvoie le jeton', async () => {
  const leaky = (c: { url: string }) => ({ status: 401, body: { error: { message: `invalid credentials ${TOKEN} for ${c.url}` } } })
  const t = setup([adsConnection(ORG1)], { hourly: leaky, devices: leaky, age: leaky, gender: leaky, city: leaky, postal: leaky, zones: leaky, campaigns: leaky })
  const { result, logs } = await withConsole(async () => {
    const a = await runIntradayJob(t.deps('2026-09-21T05:05:00Z'), 'hourly')
    const b = await runIntradayJob(t.deps('2026-09-21T05:15:00Z'), 'breakdowns')
    const c = await runDailyJob(t.deps('2026-09-21T05:00:00Z'))
    const d = await runManualFull(t.deps('2026-09-21T15:00:00Z'), ORG1)
    return [a, b, c, d]
  })
  const everything = JSON.stringify([result, t.db.tables.google_ads_sync_state, t.db.events]) + logs
  assert(!everything.includes(TOKEN), 'jeton présent dans les résultats, états ou journaux')
  assert(!everything.includes('ya29.'), 'fragment de jeton présent')
  assert(!everything.includes('invalid credentials'), 'corps d\'erreur brut présent')
  for (const s of t.db.tables.google_ads_sync_state) assert(String(s.last_error ?? '').length <= 200)
})

Deno.test('listEligibleConnections : uniquement les connexions actives avec compte client valide', async () => {
  const t = setup([
    adsConnection(ORG1), adsConnection(ORG2, { status: 'expired' }),
    adsConnection('30000000-0000-0000-0000-000000000003', { is_manager_account: true }),
    adsConnection('40000000-0000-0000-0000-000000000004', { google_customer_id: null }),
    adsConnection('50000000-0000-0000-0000-000000000005', { google_customer_id: 'abc' }),
  ])
  const list = await listEligibleConnections(t.db.svc as unknown as JobDeps['svc'])
  assertEquals(list.map((c) => c.organisation_id), [ORG1])
})

Deno.test('syncHourly direct : date/heure et compte portés par chaque ligne (jamais mélangés entre comptes)', async () => {
  const t = setup()
  const env = (customerId: string): DatasetEnv => ({ svc: t.db.svc as unknown as DatasetEnv['svc'], organisationId: ORG1, customerId, loginCustomerId: null, tz: 'Europe/Paris', accessToken: TOKEN, now: new Date('2026-09-21T05:05:00Z'), fetchFn: t.google.fetchFn })
  await syncHourly(env(CUST1))
  await syncHourly(env('9998887777'))
  assertEquals(t.db.tables.google_ads_metrics_hourly.map((r) => r.customer_id).sort(), ['7536669574', '9998887777'])
})
