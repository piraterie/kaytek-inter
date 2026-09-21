// supabase/functions/_shared/google-ads-intraday.ts
//
// Synchronisations Google Ads : données horaires, ventilations (appareils, âge,
// sexe, ville, code postal), structure (zones ciblées, statut réel des
// campagnes, noms de zones) et leurs planificateurs (cron horaire, cron
// quotidien, bouton manuel).
//
// LECTURE SEULE côté Google (GAQL SELECT). Écriture uniquement dans les tables
// dédiées (service_role), par upsert idempotent — jamais dans les tables
// historiques (sauf le dernier horodatage dédié google_ads_connections.metrics_synced_at).
//
// Règles :
//  - dates et heures calculées dans le FUSEAU DU COMPTE (google-ads-time.ts) ;
//  - aucune organisation sans connexion Ads active + compte client sélectionné
//    n'entraîne le moindre appel Google ; les comptes « manager » sont ignorés
//    (FROM campaign n'y est pas valide) ;
//  - chaque organisation et chaque jeu de données est isolé : une erreur ne
//    bloque jamais les suivants ;
//  - aucun jeton ni corps d'erreur brut dans les résultats, états ou journaux.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import { vaultReadSecret, sanitizeErrorDetail } from './google-oauth.ts'
import { syncGoogleAdsMetrics, type AdsMetricsSyncResult } from './google-ads-metrics.ts'
import { adsSearchAll, type AdsContext } from './google-ads-client.ts'
import {
  hourlyQuery, devicesQuery, ageQuery, genderQuery, geoQuery, zonesQuery, campaignsQuery, geoTargetsQuery,
  parseHourly, parseDevices, parseAge, parseGender, parseGeo, parseZones, parseCampaigns, parseGeoTargets,
} from './google-ads-queries.ts'
import { isValidTimeZone, localParts, localDateRange, isHourlySyncHour, isBreakdownSyncHour } from './google-ads-time.ts'

// ── Paramètres ──────────────────────────────────────────────────────────────
export const HOURLY_WINDOW_DAYS_BACK = 2          // J-2 → aujourd'hui (J-2 = marge pour les données révisées)
export const SLIDING_WINDOW_DAYS = 7              // fenêtre glissante des ventilations
export const BACKFILL_DAYS = { devices: 30, demographics: 30, geo: 90 } as const
export const HOURLY_MIN_INTERVAL_MS = 30 * 60_000       // protège contre un double déclenchement du cron
export const BREAKDOWN_MIN_INTERVAL_MS = 2 * 3_600_000
export const MANUAL_FULL_MIN_INTERVAL_MS = 10 * 60_000  // 1 synchronisation manuelle complète / 10 min / organisation
const UPSERT_CHUNK = 500
const NAME_LOOKUP_CHUNK = 100

export type DatasetName = 'hourly' | 'devices' | 'demographics' | 'geo' | 'structure'
export interface DatasetResult { dataset: DatasetName; ok: boolean; rows?: number; error?: string; note?: string }

export interface ConnectionInfo {
  organisation_id: string
  google_customer_id: string
  google_login_customer_id: string | null
  time_zone: string | null
  is_manager_account: boolean | null
}

export interface DatasetEnv {
  svc: SupabaseClient
  organisationId: string
  customerId: string
  loginCustomerId: string | null
  tz: string
  accessToken: string
  now: Date
  fetchFn?: typeof fetch
}

export type TokenResult = { ok: true; accessToken: string } | { ok: false; reason: string }

export interface JobDeps {
  svc: SupabaseClient
  now?: () => Date
  fetchFn?: typeof fetch
  getToken?: (svc: SupabaseClient, organisationId: string) => Promise<TokenResult>
  dailySync?: (svc: SupabaseClient, organisationId: string, fetchFn?: typeof fetch, now?: Date) => Promise<AdsMetricsSyncResult>
}

const CUSTOMER_ID = /^\d{5,15}$/
const short = (s: string) => sanitizeErrorDetail(s, 160)

// ── Accès jeton ─────────────────────────────────────────────────────────────
export async function loadAccessToken(svc: SupabaseClient, organisationId: string): Promise<TokenResult> {
  const refresh = await ensureFreshAccessToken(svc, 'google_ads', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
  if (refresh.status === 'error') return { ok: false, reason: 'token_error' }
  const { data } = await svc.from('google_ads_connections').select('access_token_secret_id').eq('organisation_id', organisationId).maybeSingle()
  if (!data?.access_token_secret_id) return { ok: false, reason: 'not_connected' }
  try {
    const token = await vaultReadSecret(svc, data.access_token_secret_id)
    return token ? { ok: true, accessToken: token } : { ok: false, reason: 'not_connected' }
  } catch {
    return { ok: false, reason: 'vault_error' }
  }
}

// ── État de synchronisation ─────────────────────────────────────────────────
type StateDataset = DatasetName | 'manual_full'
interface SyncState { synced_at: string | null; attempted_at: string | null; backfilled_at: string | null }

async function readState(svc: SupabaseClient, org: string, customer: string, dataset: StateDataset): Promise<SyncState | null> {
  const { data } = await svc.from('google_ads_sync_state').select('synced_at, attempted_at, backfilled_at')
    .eq('organisation_id', org).eq('customer_id', customer).eq('dataset', dataset).maybeSingle()
  return (data as SyncState | null) ?? null
}

async function writeState(svc: SupabaseClient, org: string, customer: string, dataset: StateDataset, patch: Partial<SyncState> & { last_error?: string | null }) {
  await svc.from('google_ads_sync_state').upsert(
    { organisation_id: org, customer_id: customer, dataset, ...patch },
    { onConflict: 'organisation_id,customer_id,dataset' },
  )
}

const ageMs = (iso: string | null | undefined, now: Date): number => (iso ? now.getTime() - new Date(iso).getTime() : Infinity)

// ── Écriture ────────────────────────────────────────────────────────────────
async function upsertChunks(svc: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<string | null> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await svc.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict })
    if (error) return short(error.message)
  }
  return null
}

const ctxOf = (env: DatasetEnv): AdsContext => ({ accessToken: env.accessToken, customerId: env.customerId, loginCustomerId: env.loginCustomerId, fetchFn: env.fetchFn })
const base = (env: DatasetEnv) => ({ organisation_id: env.organisationId, customer_id: env.customerId, synced_at: env.now.toISOString() })

/** Exécute un jeu de données en enregistrant l'état ; ne lève jamais. */
async function runDataset(
  env: DatasetEnv, dataset: DatasetName,
  fn: (isBackfill: boolean) => Promise<{ rows: number; note?: string; error?: string }>,
  opts: { backfillable?: boolean } = {},
): Promise<DatasetResult> {
  const nowIso = env.now.toISOString()
  try {
    const state = opts.backfillable ? await readState(env.svc, env.organisationId, env.customerId, dataset) : null
    const isBackfill = !!opts.backfillable && !state?.backfilled_at
    const r = await fn(isBackfill)
    if (r.error) {
      await writeState(env.svc, env.organisationId, env.customerId, dataset, { attempted_at: nowIso, last_error: r.error })
      return { dataset, ok: false, rows: r.rows, error: r.error }
    }
    await writeState(env.svc, env.organisationId, env.customerId, dataset, {
      attempted_at: nowIso, synced_at: nowIso, last_error: r.note ?? null,
      ...(isBackfill ? { backfilled_at: nowIso } : {}),
    })
    return { dataset, ok: true, rows: r.rows, note: r.note }
  } catch (e) {
    const error = short(e instanceof Error ? e.message : 'exception')
    console.warn(`[google-ads-intraday] ${dataset} — exception (${error})`)
    try { await writeState(env.svc, env.organisationId, env.customerId, dataset, { attempted_at: nowIso, last_error: error }) } catch { /* état non bloquant */ }
    return { dataset, ok: false, error }
  }
}

// ── Noms de zones (référentiel partagé google_geo_targets) ──────────────────
async function resolveGeoTargets(env: DatasetEnv, ids: number[]): Promise<{ names: Map<number, string>; error?: string }> {
  const unique = [...new Set(ids)]
  const names = new Map<number, string>()
  if (unique.length === 0) return { names }
  const known = new Set<number>()
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await env.svc.from('google_geo_targets').select('geo_target_id, canonical_name, name').in('geo_target_id', unique.slice(i, i + 200))
    if (error) return { names, error: 'lecture_referentiel_zones' }
    for (const r of (data ?? []) as { geo_target_id: number; canonical_name: string | null; name: string | null }[]) {
      known.add(Number(r.geo_target_id))
      names.set(Number(r.geo_target_id), r.canonical_name ?? r.name ?? '')
    }
  }
  const missing = unique.filter((id) => !known.has(id))
  for (let i = 0; i < missing.length; i += NAME_LOOKUP_CHUNK) {
    const res = await adsSearchAll(ctxOf(env), geoTargetsQuery(missing.slice(i, i + NAME_LOOKUP_CHUNK).map((id) => `geoTargetConstants/${id}`)))
    if (!res.ok) return { names, error: `noms_zones_${res.reason}` }
    const parsed = parseGeoTargets(res.rows)
    const err = await upsertChunks(env.svc, 'google_geo_targets', parsed.map((p) => ({ ...p, synced_at: env.now.toISOString() })), 'geo_target_id')
    if (err) return { names, error: 'ecriture_referentiel_zones' }
    for (const p of parsed) names.set(p.geo_target_id, p.canonical_name ?? p.name ?? '')
  }
  return { names }
}

// ── Jeux de données ─────────────────────────────────────────────────────────
/** Horaire : J-2 → aujourd'hui (fuseau du compte). Met à jour metrics_synced_at (dédié). */
export function syncHourly(env: DatasetEnv): Promise<DatasetResult> {
  return runDataset(env, 'hourly', async () => {
    const { from, to } = localDateRange(env.now, env.tz, HOURLY_WINDOW_DAYS_BACK)
    const res = await adsSearchAll(ctxOf(env), hourlyQuery(from, to))
    if (!res.ok) return { rows: 0, error: `google_${res.reason}` }
    const rows = parseHourly(res.rows).map((r) => ({ ...base(env), ...r }))
    const err = await upsertChunks(env.svc, 'google_ads_metrics_hourly', rows, 'organisation_id,customer_id,local_date,hour,campaign_id')
    if (err) return { rows: 0, error: 'ecriture_horaire' }
    // Horodatage DÉDIÉ des métriques : jamais écrit par OAuth / refresh de jeton / connexion.
    await env.svc.from('google_ads_connections').update({ metrics_synced_at: env.now.toISOString() }).eq('organisation_id', env.organisationId)
    return { rows: rows.length }
  })
}

export function syncDevices(env: DatasetEnv): Promise<DatasetResult> {
  return runDataset(env, 'devices', async (backfill) => {
    const { from, to } = localDateRange(env.now, env.tz, backfill ? BACKFILL_DAYS.devices : SLIDING_WINDOW_DAYS)
    const res = await adsSearchAll(ctxOf(env), devicesQuery(from, to))
    if (!res.ok) return { rows: 0, error: `google_${res.reason}` }
    const rows = parseDevices(res.rows).map((r) => ({ ...base(env), ...r }))
    const err = await upsertChunks(env.svc, 'google_ads_devices_daily', rows, 'organisation_id,customer_id,local_date,device')
    return err ? { rows: 0, error: 'ecriture_appareils' } : { rows: rows.length }
  }, { backfillable: true })
}

/** Âge et sexe : DEUX répartitions séparées (le croisement est impossible avec l'API). Valeurs « non déterminé » conservées. */
export function syncDemographics(env: DatasetEnv): Promise<DatasetResult> {
  return runDataset(env, 'demographics', async (backfill) => {
    const { from, to } = localDateRange(env.now, env.tz, backfill ? BACKFILL_DAYS.demographics : SLIDING_WINDOW_DAYS)
    let total = 0
    let firstError: string | undefined
    for (const [query, parse] of [[ageQuery(from, to), parseAge], [genderQuery(from, to), parseGender]] as const) {
      const res = await adsSearchAll(ctxOf(env), query)
      if (!res.ok) { firstError ??= `google_${res.reason}`; continue }
      const rows = parse(res.rows).map((r) => ({ ...base(env), ...r }))
      const err = await upsertChunks(env.svc, 'google_ads_demographics_daily', rows, 'organisation_id,customer_id,local_date,dimension,value')
      if (err) { firstError ??= 'ecriture_demographie'; continue }
      total += rows.length
    }
    return firstError ? { rows: total, error: firstError } : { rows: total }
  }, { backfillable: true })
}

/** Présence réelle : deux requêtes SÉPARÉES (ville : ~99,8 % ; code postal : ~76 %), jamais fusionnées. */
export function syncGeo(env: DatasetEnv): Promise<DatasetResult> {
  return runDataset(env, 'geo', async (backfill) => {
    const { from, to } = localDateRange(env.now, env.tz, backfill ? BACKFILL_DAYS.geo : SLIDING_WINDOW_DAYS)
    let total = 0
    let firstError: string | undefined
    const ids: number[] = []
    for (const level of ['city', 'postal_code'] as const) {
      const res = await adsSearchAll(ctxOf(env), geoQuery(level, from, to))
      if (!res.ok) { firstError ??= `google_${res.reason}`; continue }
      const parsed = parseGeo(level, res.rows)
      const err = await upsertChunks(env.svc, 'google_ads_geo_daily', parsed.map((r) => ({ ...base(env), ...r })), 'organisation_id,customer_id,local_date,geo_level,presence_type,geo_target_id')
      if (err) { firstError ??= 'ecriture_geo'; continue }
      total += parsed.length
      ids.push(...parsed.map((p) => p.geo_target_id))
    }
    if (firstError) return { rows: total, error: firstError }
    // Les noms manquants ne font pas échouer la synchronisation : les données sont là, les noms suivront.
    const names = await resolveGeoTargets(env, ids)
    return { rows: total, note: names.error }
  }, { backfillable: true })
}

/** Zones ciblées (rayons avec coordonnées + zones nommées) et statut RÉEL des campagnes. */
export function syncStructure(env: DatasetEnv): Promise<DatasetResult> {
  return runDataset(env, 'structure', async () => {
    let total = 0
    // Campagnes (statut réel)
    const c = await adsSearchAll(ctxOf(env), campaignsQuery())
    if (!c.ok) return { rows: 0, error: `google_${c.reason}` }
    const campaigns = parseCampaigns(c.rows).map((r) => ({ ...base(env), campaign_id: r.campaign_id, name: r.name, status: r.status, advertising_channel_type: r.advertising_channel_type }))
    const campErr = await upsertChunks(env.svc, 'google_ads_campaigns', campaigns, 'organisation_id,customer_id,campaign_id')
    if (campErr) return { rows: 0, error: 'ecriture_campagnes' }
    total += campaigns.length

    // Zones ciblées
    const z = await adsSearchAll(ctxOf(env), zonesQuery())
    if (!z.ok) return { rows: total, error: `google_${z.reason}` }
    const { zones, skipped } = parseZones(z.rows)
    const names = await resolveGeoTargets(env, zones.map((x) => x.geo_target_id).filter((x): x is number => x != null))
    const zoneRows = zones.map((x) => ({ ...base(env), ...x, label: x.geo_target_id != null ? (names.names.get(x.geo_target_id) || null) : null }))
    const zoneErr = await upsertChunks(env.svc, 'google_ads_targeted_zones', zoneRows, 'organisation_id,customer_id,campaign_id,criterion_id')
    if (zoneErr) return { rows: total, error: 'ecriture_zones' }
    // Instantané du CIBLAGE ACTUEL : une zone qui n'est plus renvoyée par Google n'est plus ciblée.
    await env.svc.from('google_ads_targeted_zones').delete()
      .eq('organisation_id', env.organisationId).eq('customer_id', env.customerId).lt('synced_at', env.now.toISOString())
    total += zoneRows.length
    const notes = [names.error, skipped > 0 ? `zones_ignorees_${skipped}` : null].filter(Boolean).join(',')
    return { rows: total, note: notes || undefined }
  })
}

// ── Éligibilité ─────────────────────────────────────────────────────────────
/** Connexions Ads ACTIVES avec un compte client sélectionné (comptes manager exclus). */
export async function listEligibleConnections(svc: SupabaseClient): Promise<ConnectionInfo[]> {
  const { data, error } = await svc.from('google_ads_connections')
    .select('organisation_id, google_customer_id, google_login_customer_id, time_zone, is_manager_account')
    .eq('status', 'connected').not('google_customer_id', 'is', null)
  if (error) { console.warn('[google-ads-intraday] lecture des connexions impossible'); return [] }
  return ((data ?? []) as ConnectionInfo[]).filter((c) => c.is_manager_account !== true && CUSTOMER_ID.test(String(c.google_customer_id ?? '')))
}

const envOf = (deps: JobDeps, conn: ConnectionInfo, tz: string, accessToken: string, now: Date): DatasetEnv => ({
  svc: deps.svc, organisationId: conn.organisation_id, customerId: conn.google_customer_id, loginCustomerId: conn.google_login_customer_id,
  tz, accessToken, now, fetchFn: deps.fetchFn,
})

export interface JobSummary {
  eligible: number
  ran: number
  skipped: Record<string, number>
  failed: number
  datasets: Record<string, { ok: number; failed: number }>
}

const bump = (rec: Record<string, number>, k: string) => { rec[k] = (rec[k] ?? 0) + 1 }

// ── Cron horaire / ventilations ─────────────────────────────────────────────
export async function runIntradayJob(deps: JobDeps, job: 'hourly' | 'breakdowns'): Promise<JobSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const getToken = deps.getToken ?? loadAccessToken
  const summary: JobSummary = { eligible: 0, ran: 0, skipped: {}, failed: 0, datasets: {} }
  const conns = await listEligibleConnections(deps.svc)
  summary.eligible = conns.length

  for (const conn of conns) {
    try {
      if (!isValidTimeZone(conn.time_zone)) { bump(summary.skipped, 'timezone_missing'); continue }
      const local = localParts(now, conn.time_zone)
      if (job === 'hourly' ? !isHourlySyncHour(local.hour) : !isBreakdownSyncHour(local.hour)) { bump(summary.skipped, 'outside_hours'); continue }

      // Anti double-déclenchement : ne rappelle pas Google si les données viennent d'être synchronisées.
      if (job === 'hourly') {
        const st = await readState(deps.svc, conn.organisation_id, conn.google_customer_id, 'hourly')
        if (ageMs(st?.synced_at, now) < HOURLY_MIN_INTERVAL_MS) { bump(summary.skipped, 'recent'); continue }
      } else {
        const states = await Promise.all((['devices', 'demographics', 'geo'] as const).map((d) => readState(deps.svc, conn.organisation_id, conn.google_customer_id, d)))
        if (states.every((s) => ageMs(s?.synced_at, now) < BREAKDOWN_MIN_INTERVAL_MS)) { bump(summary.skipped, 'recent'); continue }
      }

      const token = await getToken(deps.svc, conn.organisation_id)
      if (!token.ok) { summary.failed++; bump(summary.skipped, `token_${token.reason}`); continue }

      const env = envOf(deps, conn, conn.time_zone, token.accessToken, now)
      const results = job === 'hourly' ? [await syncHourly(env)] : [await syncDevices(env), await syncDemographics(env), await syncGeo(env)]
      summary.ran++
      for (const r of results) {
        const d = (summary.datasets[r.dataset] ??= { ok: 0, failed: 0 })
        if (r.ok) d.ok++; else { d.failed++; summary.failed++ }
      }
    } catch (e) {
      summary.failed++
      console.warn('[google-ads-intraday] organisation ignorée après exception:', short(e instanceof Error ? e.message : 'exception'))
    }
  }
  return summary
}

// ── Cron quotidien : métriques quotidiennes + structure ─────────────────────
export async function runDailyJob(deps: JobDeps): Promise<{ eligible: number; synced: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))()
  const getToken = deps.getToken ?? loadAccessToken
  const dailySync = deps.dailySync ?? ((svc, org, fetchFn, n) => syncGoogleAdsMetrics(svc, org, 30, { fetchFn, now: n }))
  const conns = await listEligibleConnections(deps.svc)
  let synced = 0
  let failed = 0
  for (const conn of conns) {
    try {
      const daily = await dailySync(deps.svc, conn.organisation_id, deps.fetchFn, now)
      // La structure (statut des campagnes, zones ciblées) est indépendante des métriques : tentée dans tous les cas.
      let structureOk = true
      const token = await getToken(deps.svc, conn.organisation_id)
      if (token.ok) {
        structureOk = (await syncStructure(envOf(deps, conn, isValidTimeZone(conn.time_zone) ? conn.time_zone : 'UTC', token.accessToken, now))).ok
      } else structureOk = false
      if (daily.ok && structureOk) synced++; else failed++
    } catch (e) {
      failed++
      console.warn('[google-ads-intraday] organisation ignorée (quotidien) après exception:', short(e instanceof Error ? e.message : 'exception'))
    }
  }
  return { eligible: conns.length, synced, failed }
}

// ── Bouton « Synchroniser » (complet, limité à 1 fois / 10 min / organisation) ─
export type ManualFullResult =
  | { ok: false; reason: string; daily?: AdsMetricsSyncResult }
  | { ok: true; throttled: true; nextAllowedAt: string }
  | { ok: true; throttled: false; daily: Extract<AdsMetricsSyncResult, { ok: true }>; datasets: DatasetResult[] }

export async function runManualFull(deps: JobDeps, organisationId: string): Promise<ManualFullResult> {
  const now = (deps.now ?? (() => new Date()))()
  const getToken = deps.getToken ?? loadAccessToken
  const dailySync = deps.dailySync ?? ((svc, org, fetchFn, n) => syncGoogleAdsMetrics(svc, org, 30, { fetchFn, now: n }))

  const { data: conn } = await deps.svc.from('google_ads_connections')
    .select('organisation_id, google_customer_id, google_login_customer_id, time_zone, is_manager_account, status')
    .eq('organisation_id', organisationId).maybeSingle()
  if (!conn || conn.status !== 'connected') return { ok: false, reason: 'not_connected' }
  if (!conn.google_customer_id) return { ok: false, reason: 'no_customer_selected' }
  if (conn.is_manager_account === true || !CUSTOMER_ID.test(String(conn.google_customer_id))) return { ok: false, reason: 'no_customer_selected' }
  const info = conn as ConnectionInfo

  // Limitation : une synchronisation manuelle COMPLÈTE par tranche de 10 minutes et par organisation.
  const prev = await readState(deps.svc, organisationId, info.google_customer_id, 'manual_full')
  const sinceMs = ageMs(prev?.attempted_at, now)
  if (sinceMs < MANUAL_FULL_MIN_INTERVAL_MS) {
    return { ok: true, throttled: true, nextAllowedAt: new Date(new Date(prev!.attempted_at!).getTime() + MANUAL_FULL_MIN_INTERVAL_MS).toISOString() }
  }
  await writeState(deps.svc, organisationId, info.google_customer_id, 'manual_full', { attempted_at: now.toISOString() })

  // 1. Métriques quotidiennes (contrat historique du bouton : un échec ici est renvoyé tel quel).
  const daily = await dailySync(deps.svc, organisationId, deps.fetchFn, now)
  if (!daily.ok) {
    // Un échec ne doit pas verrouiller une nouvelle tentative pendant 10 minutes.
    await writeState(deps.svc, organisationId, info.google_customer_id, 'manual_full', { attempted_at: prev?.attempted_at ?? null })
    return { ok: false, reason: daily.reason, daily }
  }

  // 2. Le reste : chaque jeu de données est indépendant.
  const datasets: DatasetResult[] = []
  const token = await getToken(deps.svc, organisationId)
  if (!token.ok) {
    datasets.push({ dataset: 'hourly', ok: false, error: `token_${token.reason}` })
  } else if (!isValidTimeZone(info.time_zone)) {
    datasets.push({ dataset: 'hourly', ok: false, error: 'timezone_missing' })
  } else {
    const env = envOf(deps, info, info.time_zone, token.accessToken, now)
    datasets.push(await syncHourly(env), await syncDevices(env), await syncDemographics(env), await syncGeo(env), await syncStructure(env))
  }
  await writeState(deps.svc, organisationId, info.google_customer_id, 'manual_full', { synced_at: now.toISOString(), last_error: null })
  return { ok: true, throttled: false, daily, datasets }
}
