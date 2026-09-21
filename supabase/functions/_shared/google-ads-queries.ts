// supabase/functions/_shared/google-ads-queries.ts
//
// Requêtes GAQL (lecture seule) et analyse des réponses pour les jeux de
// données horaires, appareils, démographie, géographie, zones ciblées et
// campagnes. Toutes validées en lecture seule sur Google Ads API v25 le
// 2026-09-21 (voir le compte rendu de validation). Fonctions PURES : aucun
// réseau, aucune base — testables isolément.
//
// Règles de conception :
//  - les valeurs énumérées de Google (AGE_RANGE_UNDETERMINED, UNDETERMINED,
//    MOBILE…) sont conservées TELLES QUE RETOURNÉES, jamais filtrées ni
//    recodées ;
//  - chaque analyseur AGRÈGE par clé d'unicité : un upsert PostgreSQL ne
//    tolère pas deux lignes de même clé dans un même lot ;
//  - une ligne incomplète est IGNORÉE, jamais complétée par une valeur
//    inventée (ex. un rayon sans latitude n'est pas enregistré) ;
//  - aucune date ni identifiant n'est interpolé sans validation stricte.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const GEO_CONSTANT = /^geoTargetConstants\/(\d+)$/

function assertDate(d: string): string {
  if (!ISO_DATE.test(d)) throw new Error(`date invalide : ${d}`)
  return d
}

const METRICS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value'

// ── Constructeurs de requêtes ───────────────────────────────────────────────
export const hourlyQuery = (from: string, to: string) =>
  `SELECT campaign.id, campaign.name, segments.date, segments.hour, ${METRICS} FROM campaign WHERE segments.date BETWEEN '${assertDate(from)}' AND '${assertDate(to)}'`

export const devicesQuery = (from: string, to: string) =>
  `SELECT segments.date, segments.device, ${METRICS} FROM customer WHERE segments.date BETWEEN '${assertDate(from)}' AND '${assertDate(to)}'`

export const ageQuery = (from: string, to: string) =>
  `SELECT ad_group_criterion.age_range.type, segments.date, ${METRICS} FROM age_range_view WHERE segments.date BETWEEN '${assertDate(from)}' AND '${assertDate(to)}'`

export const genderQuery = (from: string, to: string) =>
  `SELECT ad_group_criterion.gender.type, segments.date, ${METRICS} FROM gender_view WHERE segments.date BETWEEN '${assertDate(from)}' AND '${assertDate(to)}'`

// Pas de filtre campaign.status sur geographic_view : il exigerait campaign.status
// dans le SELECT (HTTP 400 sinon) et exclurait le trafic historique de campagnes
// supprimées, qui a pourtant bien eu lieu.
export const geoQuery = (level: 'city' | 'postal_code', from: string, to: string) => {
  const segment = level === 'city' ? 'segments.geo_target_city' : 'segments.geo_target_postal_code'
  return `SELECT geographic_view.location_type, segments.date, ${segment}, ${METRICS} FROM geographic_view WHERE segments.date BETWEEN '${assertDate(from)}' AND '${assertDate(to)}'`
}

export const zonesQuery = () =>
  `SELECT campaign.id, campaign.name, campaign.status, campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.proximity.geo_point.latitude_in_micro_degrees, campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units FROM campaign_criterion WHERE campaign_criterion.type IN ('LOCATION','PROXIMITY') AND campaign_criterion.negative = false AND campaign.status != 'REMOVED'`

export const campaignsQuery = () =>
  `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign`

export function geoTargetsQuery(resourceNames: string[]): string {
  for (const rn of resourceNames) if (!GEO_CONSTANT.test(rn)) throw new Error(`geo_target_constant invalide : ${rn}`)
  return `SELECT geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.target_type, geo_target_constant.country_code, geo_target_constant.parent_geo_target, geo_target_constant.status FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${resourceNames.map((r) => `'${r}'`).join(', ')})`
}

// ── Métriques ───────────────────────────────────────────────────────────────
export interface Metrics {
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversions_value: number
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// deno-lint-ignore no-explicit-any
export function readMetrics(m: any): Metrics {
  return {
    impressions: num(m?.impressions), clicks: num(m?.clicks), cost_micros: num(m?.costMicros),
    conversions: num(m?.conversions), conversions_value: num(m?.conversionsValue),
  }
}

const addMetrics = (a: Metrics, b: Metrics): Metrics => ({
  impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, cost_micros: a.cost_micros + b.cost_micros,
  conversions: a.conversions + b.conversions, conversions_value: a.conversions_value + b.conversions_value,
})

/** Regroupe par clé et additionne les métriques (garantit l'unicité avant upsert). */
function aggregate<K extends object>(items: (K & Metrics)[], keyOf: (k: K & Metrics) => string): (K & Metrics)[] {
  const map = new Map<string, K & Metrics>()
  for (const it of items) {
    const key = keyOf(it)
    const prev = map.get(key)
    map.set(key, prev ? { ...prev, ...addMetrics(prev, it) } : it)
  }
  return [...map.values()]
}

// ── Analyseurs ──────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Row = any

export interface HourlyRow extends Metrics { campaign_id: string; campaign_name: string | null; local_date: string; hour: number }
export function parseHourly(rows: Row[]): HourlyRow[] {
  const out: HourlyRow[] = []
  for (const r of rows) {
    const hour = r.segments?.hour
    const date = r.segments?.date
    const id = r.campaign?.id
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !ISO_DATE.test(date ?? '') || !id) continue
    out.push({ campaign_id: String(id), campaign_name: r.campaign?.name ?? null, local_date: date, hour, ...readMetrics(r.metrics) })
  }
  return aggregate(out, (x) => `${x.local_date}|${x.hour}|${x.campaign_id}`)
}

export interface DeviceRow extends Metrics { local_date: string; device: string }
export function parseDevices(rows: Row[]): DeviceRow[] {
  const out: DeviceRow[] = []
  for (const r of rows) {
    const date = r.segments?.date
    const device = r.segments?.device
    if (!ISO_DATE.test(date ?? '') || !device) continue
    out.push({ local_date: date, device: String(device), ...readMetrics(r.metrics) })
  }
  return aggregate(out, (x) => `${x.local_date}|${x.device}`)
}

export interface DemographicRow extends Metrics { local_date: string; dimension: 'age_range' | 'gender'; value: string }
/** age_range_view renvoie une ligne par critère de groupe d'annonces : on additionne par (date, tranche d'âge). */
export function parseAge(rows: Row[]): DemographicRow[] {
  const out: DemographicRow[] = []
  for (const r of rows) {
    const date = r.segments?.date
    const value = r.adGroupCriterion?.ageRange?.type
    if (!ISO_DATE.test(date ?? '') || !value) continue
    out.push({ local_date: date, dimension: 'age_range', value: String(value), ...readMetrics(r.metrics) })
  }
  return aggregate(out, (x) => `${x.local_date}|${x.value}`)
}
export function parseGender(rows: Row[]): DemographicRow[] {
  const out: DemographicRow[] = []
  for (const r of rows) {
    const date = r.segments?.date
    const value = r.adGroupCriterion?.gender?.type
    if (!ISO_DATE.test(date ?? '') || !value) continue
    out.push({ local_date: date, dimension: 'gender', value: String(value), ...readMetrics(r.metrics) })
  }
  return aggregate(out, (x) => `${x.local_date}|${x.value}`)
}

export interface GeoRow extends Metrics { local_date: string; geo_level: 'city' | 'postal_code'; presence_type: string; geo_target_id: number }
export function parseGeo(level: 'city' | 'postal_code', rows: Row[]): GeoRow[] {
  const out: GeoRow[] = []
  for (const r of rows) {
    const date = r.segments?.date
    const constant = level === 'city' ? r.segments?.geoTargetCity : r.segments?.geoTargetPostalCode
    const m = typeof constant === 'string' ? GEO_CONSTANT.exec(constant) : null
    const presence = r.geographicView?.locationType
    if (!ISO_DATE.test(date ?? '') || !m || !presence) continue
    out.push({ local_date: date, geo_level: level, presence_type: String(presence), geo_target_id: Number(m[1]), ...readMetrics(r.metrics) })
  }
  return aggregate(out, (x) => `${x.local_date}|${x.presence_type}|${x.geo_target_id}`)
}

export interface ZoneRow {
  campaign_id: string; campaign_name: string | null; campaign_status: string | null
  criterion_id: number; zone_type: 'PROXIMITY' | 'LOCATION'
  latitude: number | null; longitude: number | null; radius: number | null; radius_unit: 'KILOMETERS' | 'MILES' | null
  geo_target_id: number | null; label: string | null
}

/**
 * Zones CIBLÉES (positives) uniquement. Un rayon n'est retenu que s'il a
 * RÉELLEMENT latitude, longitude, distance et unité ; une zone nommée n'a
 * jamais de coordonnées. Les lignes incomplètes sont ignorées et comptées.
 */
export function parseZones(rows: Row[]): { zones: ZoneRow[]; skipped: number } {
  const out = new Map<string, ZoneRow>()
  let skipped = 0
  for (const r of rows) {
    const c = r.campaignCriterion
    const campaignId = r.campaign?.id
    const criterionId = Number(c?.criterionId)
    if (!c || !campaignId || !Number.isFinite(criterionId) || c.negative === true) { skipped++; continue }
    const base = { campaign_id: String(campaignId), campaign_name: r.campaign?.name ?? null, campaign_status: r.campaign?.status ?? null, criterion_id: criterionId }
    if (c.type === 'PROXIMITY') {
      const lat = Number(c.proximity?.geoPoint?.latitudeInMicroDegrees) / 1e6
      const lon = Number(c.proximity?.geoPoint?.longitudeInMicroDegrees) / 1e6
      const radius = Number(c.proximity?.radius)
      const unit = c.proximity?.radiusUnits
      const hasCoords = c.proximity?.geoPoint?.latitudeInMicroDegrees != null && c.proximity?.geoPoint?.longitudeInMicroDegrees != null
      if (!hasCoords || !Number.isFinite(lat) || !Number.isFinite(lon) || !(radius > 0) || (unit !== 'KILOMETERS' && unit !== 'MILES')
          || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue }
      out.set(`${base.campaign_id}|${criterionId}`, { ...base, zone_type: 'PROXIMITY', latitude: lat, longitude: lon, radius, radius_unit: unit, geo_target_id: null, label: null })
    } else if (c.type === 'LOCATION') {
      const m = typeof c.location?.geoTargetConstant === 'string' ? GEO_CONSTANT.exec(c.location.geoTargetConstant) : null
      if (!m) { skipped++; continue }
      out.set(`${base.campaign_id}|${criterionId}`, { ...base, zone_type: 'LOCATION', latitude: null, longitude: null, radius: null, radius_unit: null, geo_target_id: Number(m[1]), label: null })
    } else { skipped++ }
  }
  return { zones: [...out.values()], skipped }
}

export interface CampaignRow { campaign_id: string; name: string | null; status: string; advertising_channel_type: string | null }
/** Le statut est celui retourné par Google (ENABLED, PAUSED, REMOVED…) — jamais déduit. */
export function parseCampaigns(rows: Row[]): CampaignRow[] {
  const out = new Map<string, CampaignRow>()
  for (const r of rows) {
    const id = r.campaign?.id
    const status = r.campaign?.status
    if (!id || !status) continue
    out.set(String(id), { campaign_id: String(id), name: r.campaign?.name ?? null, status: String(status), advertising_channel_type: r.campaign?.advertisingChannelType ?? null })
  }
  return [...out.values()]
}

export interface GeoTargetRow {
  geo_target_id: number; name: string | null; canonical_name: string | null; target_type: string | null
  country_code: string | null; region_name: string | null; parent_geo_target_id: number | null; status: string | null
}

/** Région déduite du nom canonique (« Toulouse,Occitanie,France » → « Occitanie ») — uniquement s'il y a au moins 3 composantes. */
export function regionFromCanonicalName(canonical: string | null | undefined): string | null {
  if (!canonical) return null
  const parts = canonical.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length >= 3 ? parts[parts.length - 2] : null
}

export function parseGeoTargets(rows: Row[]): GeoTargetRow[] {
  const out = new Map<number, GeoTargetRow>()
  for (const r of rows) {
    const g = r.geoTargetConstant
    const id = Number(g?.id)
    if (!g || !Number.isFinite(id)) continue
    const parent = typeof g.parentGeoTarget === 'string' ? GEO_CONSTANT.exec(g.parentGeoTarget) : null
    out.set(id, {
      geo_target_id: id, name: g.name ?? null, canonical_name: g.canonicalName ?? null, target_type: g.targetType ?? null,
      country_code: g.countryCode ?? null, region_name: regionFromCanonicalName(g.canonicalName),
      parent_geo_target_id: parent ? Number(parent[1]) : null, status: g.status ?? null,
    })
  }
  return [...out.values()]
}
