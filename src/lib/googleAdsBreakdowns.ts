// src/lib/googleAdsBreakdowns.ts
//
// Appareils, démographie, géographie, statut des campagnes : agrégation et présentation
// des lignes lues en base. Fonctions PURES.
//
// Règles :
//  - les valeurs de Google sont conservées telles que retournées : « Inconnu / non
//    déterminé » (âge et sexe) n'est JAMAIS supprimé — il pèse ~43 % des impressions ;
//  - âge et sexe sont deux répartitions SÉPARÉES (l'API Google Ads ne permet pas de les
//    croiser) : aucune fonction ici ne les combine ;
//  - une catégorie attendue mais absente d'une période vaut 0 (calcul, pas une donnée inventée) ;
//  - aucune coordonnée n'est jamais déduite d'un nom de ville ou d'un code postal.
import { fmtInt, fmtConv, fmtEurMicros } from '@/lib/googleAdsMetrics'

// ── Métriques sélectionnables ───────────────────────────────────────────────
export type MetricKey = 'impressions' | 'clicks' | 'cost' | 'conversions'
export const METRIC_OPTIONS: { key: MetricKey; label: string }[] = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'clicks', label: 'Clics' },
  { key: 'cost', label: 'Dépenses' },
  { key: 'conversions', label: 'Conversions' },
]

export interface MetricRow { impressions: number; clicks: number; cost_micros: number; conversions: number }

export const metricOf = (r: MetricRow, key: MetricKey): number =>
  key === 'impressions' ? r.impressions : key === 'clicks' ? r.clicks : key === 'cost' ? r.cost_micros : r.conversions

export function formatMetric(key: MetricKey, value: number): string {
  return key === 'cost' ? fmtEurMicros(value) : key === 'conversions' ? fmtConv(value) : fmtInt(value)
}

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const zero = (): MetricRow => ({ impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 })
const add = (a: MetricRow, r: { impressions?: unknown; clicks?: unknown; cost_micros?: unknown; conversions?: unknown }): MetricRow => ({
  impressions: a.impressions + num(r.impressions), clicks: a.clicks + num(r.clicks),
  cost_micros: a.cost_micros + num(r.cost_micros), conversions: a.conversions + num(r.conversions),
})

// ── Barres horizontales ─────────────────────────────────────────────────────
export interface BarItem extends MetricRow {
  key: string
  label: string
  /** Libellé secondaire éventuel (ex. « non déterminé par Google ») */
  hint?: string
  value: number
  /** Part du total, en % (0-100) */
  share: number
  /** Largeur de barre relative à la plus grande valeur, en % (0-100) */
  width: number
}

export interface BarSet { items: BarItem[]; total: number }

export function toBars(base: (MetricRow & { key: string; label: string; hint?: string })[], metric: MetricKey): BarSet {
  const total = base.reduce((s, r) => s + metricOf(r, metric), 0)
  const max = base.reduce((m, r) => Math.max(m, metricOf(r, metric)), 0)
  return {
    total,
    items: base.map((r) => {
      const value = metricOf(r, metric)
      return { ...r, value, share: total > 0 ? (value / total) * 100 : 0, width: max > 0 ? (value / max) * 100 : 0 }
    }),
  }
}

// ── Appareils ───────────────────────────────────────────────────────────────
const DEVICE_LABEL: Record<string, string> = {
  MOBILE: 'Mobile', DESKTOP: 'Ordinateur', TABLET: 'Tablette', CONNECTED_TV: 'TV connectée', OTHER: 'Autre',
  UNKNOWN: 'Inconnu', UNSPECIFIED: 'Inconnu',
}
const DEVICE_MAIN = ['MOBILE', 'DESKTOP', 'TABLET']

export interface DeviceDbRow { device: string; impressions: number; clicks: number; cost_micros: number; conversions: number }

/** Mobile, Ordinateur et Tablette toujours affichés ; les autres types seulement s'ils sont présents. */
export function aggregateDevices(rows: DeviceDbRow[]) {
  const by = new Map<string, MetricRow>()
  for (const r of rows) by.set(r.device, add(by.get(r.device) ?? zero(), r))
  const extras = [...by.keys()].filter((k) => !DEVICE_MAIN.includes(k)).sort((a, b) => by.get(b)!.impressions - by.get(a)!.impressions)
  return [...DEVICE_MAIN, ...extras].map((k) => ({ key: k, label: DEVICE_LABEL[k] ?? k, ...(by.get(k) ?? zero()) }))
}

// ── Démographie ─────────────────────────────────────────────────────────────
const AGE_ORDER = ['AGE_RANGE_18_24', 'AGE_RANGE_25_34', 'AGE_RANGE_35_44', 'AGE_RANGE_45_54', 'AGE_RANGE_55_64', 'AGE_RANGE_65_UP', 'AGE_RANGE_UNDETERMINED']
const AGE_LABEL: Record<string, string> = {
  AGE_RANGE_18_24: '18–24', AGE_RANGE_25_34: '25–34', AGE_RANGE_35_44: '35–44', AGE_RANGE_45_54: '45–54',
  AGE_RANGE_55_64: '55–64', AGE_RANGE_65_UP: '65+', AGE_RANGE_UNDETERMINED: 'Inconnu',
}
const GENDER_ORDER = ['FEMALE', 'MALE', 'UNDETERMINED']
const GENDER_LABEL: Record<string, string> = { FEMALE: 'Femme', MALE: 'Homme', UNDETERMINED: 'Inconnu' }
const UNDETERMINED_HINT = 'non déterminé par Google'

export interface DemographicDbRow { dimension: 'age_range' | 'gender'; value: string; impressions: number; clicks: number; cost_micros: number; conversions: number }

export function aggregateDemographics(rows: DemographicDbRow[], dimension: 'age_range' | 'gender') {
  const order = dimension === 'age_range' ? AGE_ORDER : GENDER_ORDER
  const labels = dimension === 'age_range' ? AGE_LABEL : GENDER_LABEL
  const by = new Map<string, MetricRow>()
  for (const r of rows) if (r.dimension === dimension) by.set(r.value, add(by.get(r.value) ?? zero(), r))
  // Valeurs inattendues renvoyées par Google (ex. UNKNOWN) : conservées, après les catégories connues.
  const extras = [...by.keys()].filter((k) => !order.includes(k))
  return [...order, ...extras].map((k) => {
    const undetermined = k === 'AGE_RANGE_UNDETERMINED' || k === 'UNDETERMINED'
    return { key: k, label: labels[k] ?? (k === 'UNKNOWN' ? 'Inconnu' : k), hint: undetermined || k === 'UNKNOWN' ? UNDETERMINED_HINT : undefined, ...(by.get(k) ?? zero()) }
  })
}

// ── Géographie (présence réelle) ────────────────────────────────────────────
export interface GeoDbRow { geo_level: 'city' | 'postal_code'; presence_type: string; geo_target_id: number; impressions: number; clicks: number; cost_micros: number; conversions: number }
export interface GeoTargetInfo { geo_target_id: number; name: string | null; canonical_name: string | null; target_type: string | null; region_name: string | null }

export interface GeoItem extends MetricRow { geoTargetId: number; label: string; region: string | null }

export function aggregateGeo(rows: GeoDbRow[], level: 'city' | 'postal_code', presenceType: string, names: Map<number, GeoTargetInfo>): GeoItem[] {
  const by = new Map<number, MetricRow>()
  for (const r of rows) {
    if (r.geo_level !== level || r.presence_type !== presenceType) continue
    by.set(r.geo_target_id, add(by.get(r.geo_target_id) ?? zero(), r))
  }
  return [...by.entries()].map(([id, m]) => {
    const info = names.get(id)
    return { geoTargetId: id, label: info?.name || info?.canonical_name?.split(',')[0] || `Zone ${id}`, region: info?.region_name ?? null, ...m }
  })
}

/** Part des impressions « ville » couverte par les codes postaux (Google n'attribue pas tous les codes postaux). */
export function postalCoveragePct(city: MetricRow[], postal: MetricRow[]): number | null {
  const c = city.reduce((s, r) => s + r.impressions, 0)
  const p = postal.reduce((s, r) => s + r.impressions, 0)
  return c > 0 ? Math.min(100, (p / c) * 100) : null
}

// ── Statut RÉEL des campagnes (google_ads_campaigns) ────────────────────────
export type StatusTone = 'green' | 'amber' | 'grey'
const STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  ENABLED: { label: 'Active', tone: 'green' },
  PAUSED: { label: 'En pause', tone: 'amber' },
  REMOVED: { label: 'Supprimée', tone: 'grey' },
  UNKNOWN: { label: 'Inconnu', tone: 'grey' },
  UNSPECIFIED: { label: 'Inconnu', tone: 'grey' },
}

/** Libellé du statut réel Google ; `null` = campagne absente de google_ads_campaigns (jamais déduit de l'activité). */
export function campaignStatusInfo(status: string | null | undefined): { label: string; tone: StatusTone } {
  if (!status) return { label: 'Statut indisponible', tone: 'grey' }
  return STATUS_LABEL[status] ?? { label: status, tone: 'grey' }
}

/** Ordre d'affichage/tri : actives, en pause, autres statuts, puis inconnues. */
export function statusRank(status: string | null | undefined): number {
  if (status === 'ENABLED') return 0
  if (status === 'PAUSED') return 1
  if (!status) return 3
  return 2
}
