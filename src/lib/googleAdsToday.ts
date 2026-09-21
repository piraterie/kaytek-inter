// src/lib/googleAdsToday.ts
//
// Vue « Aujourd'hui » : données horaires (google_ads_metrics_hourly), courbe 00h → 23h
// remplie à 0 pour les heures sans activité, comparaison LIKE-FOR-LIKE avec hier.
// Fonctions PURES : aucune requête, aucune donnée inventée.
//
// Règles :
//  - jamais « temps réel » : la fraîcheur affichée est l'heure de dernière synchronisation ;
//  - les heures APRÈS l'heure de synchronisation ne sont pas encore connues : elles restent
//    vides (null), jamais un faux 0 ;
//  - une heure sans ligne AVANT/PENDANT la synchronisation = aucune activité → 0 ;
//  - la comparaison porte sur les heures COMPLÈTES 00h → (heure de synchro) des deux jours :
//    jamais une journée partielle contre une journée entière, ni une heure partielle contre
//    une heure entière.
import type { AdsMetricRow } from '@/lib/hooks/googleStats'
import { localParts } from '@/lib/googleAdsTime'

export interface HourlyDbRow {
  campaign_id: string
  campaign_name: string | null
  local_date: string
  hour: number
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversions_value: number
}

export interface HourPoint {
  hour: number
  label: string           // « 00h » … « 23h »
  impressions: number | null
  clicks: number | null
  cost: number | null     // euros
  conversions: number | null
  /** true si l'heure n'est pas encore connue (postérieure à la synchronisation) */
  pending: boolean
}

export interface HourTotals { impressions: number; clicks: number; costMicros: number; conversions: number }

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}h`

/** Heure LOCALE de la dernière synchronisation si elle a eu lieu AUJOURD'HUI (date locale), sinon null. */
export function syncedHourToday(syncedAtIso: string | null | undefined, tz: string, todayLocal: string): { hour: number; minute: number } | null {
  if (!syncedAtIso) return null
  const d = new Date(syncedAtIso)
  if (Number.isNaN(d.getTime())) return null
  const p = localParts(d, tz)
  return p.date === todayLocal ? { hour: p.hour, minute: p.minute } : null
}

/**
 * Série de 24 points pour un jour. `knownUntilHour` = dernière heure connue (incluse) ;
 * au-delà, les points sont « pending » (valeurs null). Sans borne (null), toutes les heures sont
 * considérées connues (cas d'un jour passé complet).
 */
export function hourlySeries(rows: HourlyDbRow[], date: string, knownUntilHour: number | null): HourPoint[] {
  const acc = Array.from({ length: 24 }, () => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 }))
  for (const r of rows) {
    if (r.local_date !== date || !Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue
    const a = acc[r.hour]
    a.impressions += Number(r.impressions) || 0
    a.clicks += Number(r.clicks) || 0
    a.cost += (Number(r.cost_micros) || 0) / 1_000_000
    a.conversions += Number(r.conversions) || 0
  }
  return acc.map((a, hour) => {
    const pending = knownUntilHour !== null && hour > knownUntilHour
    return { hour, label: hourLabel(hour), pending, ...(pending ? { impressions: null, clicks: null, cost: null, conversions: null } : a) }
  })
}

/** Somme des heures [fromHour, toHourExclusive) d'une série. */
export function sumHours(points: HourPoint[], fromHour: number, toHourExclusive: number): HourTotals {
  const t: HourTotals = { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
  for (const p of points) {
    if (p.hour < fromHour || p.hour >= toHourExclusive || p.pending) continue
    t.impressions += p.impressions ?? 0
    t.clicks += p.clicks ?? 0
    t.costMicros += Math.round((p.cost ?? 0) * 1_000_000)
    t.conversions += p.conversions ?? 0
  }
  return t
}

export interface TodayView {
  todayDate: string
  yesterdayDate: string
  /** Dernière heure connue aujourd'hui (heure locale de la synchronisation), null si aucune synchro aujourd'hui. */
  syncedHour: number | null
  today: HourPoint[]
  yesterday: HourPoint[]
  /** Totaux d'aujourd'hui tels que synchronisés (toutes les heures connues, heure partielle incluse). */
  totals: HourTotals
  /** Base de comparaison : heures COMPLÈTES 00h → (heure de synchro) des deux jours. */
  compareHours: number
  compareToday: HourTotals
  compareYesterday: HourTotals
  hasToday: boolean
  hasYesterday: boolean
  canCompare: boolean
}

export function buildTodayView(rows: HourlyDbRow[], todayDate: string, yesterdayDate: string, syncedAtIso: string | null | undefined, tz: string): TodayView {
  const synced = syncedHourToday(syncedAtIso, tz, todayDate)
  const syncedHour = synced ? synced.hour : null
  // Sans synchronisation aujourd'hui, seules les heures ayant des lignes sont connues.
  const maxRowHour = rows.filter((r) => r.local_date === todayDate).reduce((m, r) => Math.max(m, r.hour), -1)
  const knownUntil = syncedHour !== null ? syncedHour : maxRowHour
  const today = hourlySeries(rows, todayDate, knownUntil)
  const yesterday = hourlySeries(rows, yesterdayDate, null)
  const compareHours = syncedHour !== null ? syncedHour : 0
  const hasToday = rows.some((r) => r.local_date === todayDate)
  const hasYesterday = rows.some((r) => r.local_date === yesterdayDate)
  return {
    todayDate, yesterdayDate, syncedHour, today, yesterday,
    totals: sumHours(today, 0, 24),
    compareHours,
    compareToday: sumHours(today, 0, compareHours),
    compareYesterday: sumHours(yesterday, 0, compareHours),
    hasToday, hasYesterday,
    // Comparaison seulement s'il existe au moins une heure complète ET des données hier.
    canCompare: syncedHour !== null && compareHours > 0 && hasYesterday,
  }
}

/** Lignes horaires → lignes « métriques » génériques (agrégation par campagne réutilisable). */
export function hourlyToMetricRows(rows: HourlyDbRow[], date: string): AdsMetricRow[] {
  return rows.filter((r) => r.local_date === date).map((r) => ({
    date: r.local_date, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
    impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, cost_micros: Number(r.cost_micros) || 0,
    conversions: Number(r.conversions) || 0, conversions_value: Number(r.conversions_value) || 0, phone_calls: 0,
  }))
}

export interface TodayInsights {
  elapsedHours: number
  activeHours: number
  bestClicksHour: { hour: number; value: number } | null
  priciestHour: { hour: number; costMicros: number } | null
  avgCostMicrosPerHour: number | null
}

export function todayInsights(points: HourPoint[]): TodayInsights {
  const known = points.filter((p) => !p.pending)
  let best: TodayInsights['bestClicksHour'] = null
  let priciest: TodayInsights['priciestHour'] = null
  let total = 0
  let active = 0
  for (const p of known) {
    const cost = Math.round((p.cost ?? 0) * 1_000_000)
    total += cost
    if ((p.impressions ?? 0) > 0) active++
    if ((p.clicks ?? 0) > 0 && (!best || (p.clicks ?? 0) > best.value)) best = { hour: p.hour, value: p.clicks ?? 0 }
    if (cost > 0 && (!priciest || cost > priciest.costMicros)) priciest = { hour: p.hour, costMicros: cost }
  }
  return { elapsedHours: known.length, activeHours: active, bestClicksHour: best, priciestHour: priciest, avgCostMicrosPerHour: known.length ? total / known.length : null }
}
