// supabase/functions/_shared/google-business-performance.ts — Phase 4
//
// Synchronisation des statistiques Google Business Profile Performance API
// (appels, clics site, demandes d'itinéraire, impressions Maps/Search).
// Endpoint confirmé actif (recherche du 2026-08-04) : GET
// businessprofileperformance.googleapis.com/v1/{location}:fetchMultiDailyMetricsTimeSeries.
//
// RÈGLE ABSOLUE : si l'API ne renvoie pas de valeur pour un jour/métrique
// donné, on stocke 0 (absence de mesure, comportement documenté de l'API
// pour les jours sans activité) — jamais une valeur inventée ou
// extrapolée. Un jour totalement absent de la réponse n'est PAS écrit en
// base (pas de ligne fantôme à 0 pour un jour non couvert par la période
// demandée).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import { vaultReadSecret, sanitizeErrorDetail } from './google-oauth.ts'

const PERFORMANCE_API_BASE = 'https://businessprofileperformance.googleapis.com/v1'

const DAILY_METRICS = [
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const

type DailyMetric = typeof DAILY_METRICS[number]

export type GbpPerfSyncErrorReason =
  | 'not_connected' | 'needs_reconnect' | 'no_location_selected'
  | 'api_not_enabled' | 'insufficient_permission' | 'google_error'

export type GbpPerfSyncResult =
  | { ok: true; daysUpserted: number }
  | { ok: false; reason: GbpPerfSyncErrorReason; detail?: string }

function classifyError(status: number, bodyText: string): { reason: GbpPerfSyncErrorReason; detail: string } {
  const detail = sanitizeErrorDetail(bodyText)
  const low = bodyText.toLowerCase()
  if (low.includes('has not been used') || (status === 403 && low.includes('disabled'))) return { reason: 'api_not_enabled', detail }
  if (low.includes('permission_denied') || status === 403 || status === 401) return { reason: 'insufficient_permission', detail }
  return { reason: 'google_error', detail }
}

function ymd(d: Date) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

// Synchronise les métriques quotidiennes des `daysBack` derniers jours
// (par défaut 30 — assez pour couvrir une resynchronisation manuelle
// après une interruption sans excéder les quotas de l'API).
export async function syncGbpPerformanceMetrics(svc: SupabaseClient, organisationId: string, daysBack = 30): Promise<GbpPerfSyncResult> {
  const refresh = await ensureFreshAccessToken(svc, 'google_business', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const { data: connection } = await svc
    .from('gbp_connections')
    .select('access_token_secret_id, google_location_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()
  if (!connection?.access_token_secret_id) return { ok: false, reason: 'not_connected' }
  if (!connection.google_location_id) return { ok: false, reason: 'no_location_selected' }

  let accessToken: string | null
  try {
    accessToken = await vaultReadSecret(svc, connection.access_token_secret_id)
  } catch (e) {
    return { ok: false, reason: 'google_error', detail: sanitizeErrorDetail(e instanceof Error ? e.message : 'lecture_vault_echouee') }
  }
  if (!accessToken) return { ok: false, reason: 'not_connected' }

  const end = new Date()
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000)
  const { year: sy, month: sm, day: sd } = ymd(start)
  const { year: ey, month: em, day: ed } = ymd(end)

  const url = new URL(`${PERFORMANCE_API_BASE}/${connection.google_location_id}:fetchMultiDailyMetricsTimeSeries`)
  for (const m of DAILY_METRICS) url.searchParams.append('dailyMetrics', m)
  url.searchParams.set('dailyRange.start_date.year', String(sy))
  url.searchParams.set('dailyRange.start_date.month', String(sm))
  url.searchParams.set('dailyRange.start_date.day', String(sd))
  url.searchParams.set('dailyRange.end_date.year', String(ey))
  url.searchParams.set('dailyRange.end_date.month', String(em))
  url.searchParams.set('dailyRange.end_date.day', String(ed))

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  const bodyText = await res.text()
  if (!res.ok) {
    const { reason, detail } = classifyError(res.status, bodyText)
    return { ok: false, reason, detail }
  }
  let json: any
  try {
    json = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    return { ok: false, reason: 'google_error', detail: 'reponse_google_illisible' }
  }

  // Agrégation par jour : { 'YYYY-MM-DD': { calls, website_clicks, ... } }
  const byDate = new Map<string, Record<string, number>>()
  const series: { dailyMetric: DailyMetric; timeSeries?: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } }[] =
    json.multiDailyMetricTimeSeries?.[0]?.dailyMetricTimeSeries ?? []

  const COLUMN_BY_METRIC: Record<DailyMetric, string> = {
    CALL_CLICKS: 'calls',
    WEBSITE_CLICKS: 'website_clicks',
    BUSINESS_DIRECTION_REQUESTS: 'direction_requests',
    BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'business_impressions_maps',
    BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'business_impressions_maps',
    BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'business_impressions_search',
    BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'business_impressions_search',
  }

  for (const entry of series) {
    const column = COLUMN_BY_METRIC[entry.dailyMetric]
    if (!column) continue // métrique non demandée par ce module — ignorée sans erreur
    for (const dv of entry.timeSeries?.datedValues ?? []) {
      const dateStr = `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`
      const value = dv.value ? parseInt(dv.value, 10) : 0
      const bucket = byDate.get(dateStr) ?? {}
      bucket[column] = (bucket[column] ?? 0) + value // desktop+mobile maps/search cumulés dans la même colonne
      byDate.set(dateStr, bucket)
    }
  }

  let daysUpserted = 0
  for (const [date, metrics] of byDate) {
    const { error } = await svc.from('gbp_performance_metrics_daily').upsert({
      organisation_id: organisationId,
      date,
      calls: metrics.calls ?? 0,
      website_clicks: metrics.website_clicks ?? 0,
      direction_requests: metrics.direction_requests ?? 0,
      business_impressions_maps: metrics.business_impressions_maps ?? 0,
      business_impressions_search: metrics.business_impressions_search ?? 0,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'organisation_id,date' })
    if (!error) daysUpserted++
  }

  await svc.from('gbp_connections').update({ last_synced_at: new Date().toISOString() }).eq('organisation_id', organisationId)

  return { ok: true, daysUpserted }
}
