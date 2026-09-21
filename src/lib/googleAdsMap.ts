// src/lib/googleAdsMap.ts
//
// Géométrie de la carte « Zones » (SVG embarqué, aucune tuile externe, aucune dépendance
// cartographique). Fonctions PURES : projection, échelle, graticule, cercles de rayon.
//
// ARCHITECTURE REMPLAÇABLE : la carte ne connaît que ces types — un fond différent (autre SVG,
// futur Leaflet/MapLibre) ou une source de coordonnées peut être branché sans toucher à la
// logique métier.
//
// RÈGLE ABSOLUE : aucune coordonnée n'est inventée. Les rayons ciblés utilisent la latitude,
// la longitude et la distance FOURNIES par Google. Google ne fournit aucune coordonnée pour une
// ville ou un code postal : le fournisseur par défaut n'en renvoie AUCUNE, donc aucune position
// de ville n'est affichée tant qu'un jeu de coordonnées n'a pas été validé et branché.

export interface LatLon { lat: number; lon: number }

/** Zone ciblée avec rayon réel (latitude, longitude, distance et unité fournies par Google). */
export interface RadiusZone {
  id: string
  latitude: number
  longitude: number
  radius: number
  unit: 'KILOMETERS' | 'MILES'
  campaignName: string | null
  status: string | null
}

/** Point de présence positionné (uniquement si un fournisseur de coordonnées validé existe). */
export interface PresencePoint { id: string; label: string; value: number; position: LatLon }

/**
 * Fournisseur de coordonnées pour des zones nommées (villes, codes postaux).
 * PAR DÉFAUT : aucune coordonnée (Google n'en fournit pas). Un jeu de centroïdes ne doit être
 * branché qu'après validation de sa source et de sa licence.
 */
export interface GeoCoordinatesProvider {
  readonly name: string
  lookup(target: { geoTargetId: number; name: string; region: string | null; level: 'city' | 'postal_code' }): LatLon | null
}
export const noCoordinatesProvider: GeoCoordinatesProvider = { name: 'aucun (Google ne fournit pas de coordonnées de zone)', lookup: () => null }

const KM_PER_DEG_LAT = 111.32
export const KM_PER_MILE = 1.609344

export const radiusKm = (radius: number, unit: 'KILOMETERS' | 'MILES'): number => (unit === 'MILES' ? radius * KM_PER_MILE : radius)

export interface Viewport { minLat: number; maxLat: number; minLon: number; maxLon: number }

/** Rectangle englobant de cercles (rayon en km), avec une marge relative et une étendue minimale. */
export function viewportOfCircles(zones: { latitude: number; longitude: number; km: number }[], pad = 0.12, minSpanKm = 40): Viewport {
  if (zones.length === 0) throw new Error('aucune zone')
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const z of zones) {
    const dLat = z.km / KM_PER_DEG_LAT
    const dLon = z.km / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos((z.latitude * Math.PI) / 180)))
    minLat = Math.min(minLat, z.latitude - dLat); maxLat = Math.max(maxLat, z.latitude + dLat)
    minLon = Math.min(minLon, z.longitude - dLon); maxLon = Math.max(maxLon, z.longitude + dLon)
  }
  const midLat = (minLat + maxLat) / 2
  const minSpanLat = minSpanKm / KM_PER_DEG_LAT
  const minSpanLon = minSpanKm / (KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180))
  const latPad = Math.max((maxLat - minLat) * pad, 0), lonPad = Math.max((maxLon - minLon) * pad, 0)
  let v = { minLat: minLat - latPad, maxLat: maxLat + latPad, minLon: minLon - lonPad, maxLon: maxLon + lonPad }
  const grow = (lo: number, hi: number, span: number) => (hi - lo < span ? [(lo + hi) / 2 - span / 2, (lo + hi) / 2 + span / 2] : [lo, hi])
  ;[v.minLat, v.maxLat] = grow(v.minLat, v.maxLat, minSpanLat)
  ;[v.minLon, v.maxLon] = grow(v.minLon, v.maxLon, minSpanLon)
  return v
}

export interface Projection {
  width: number
  height: number
  /** pixels par km (échelle uniforme) */
  pxPerKm: number
  project(p: LatLon): { x: number; y: number }
  viewport: Viewport
}

/**
 * Projection équirectangulaire à échelle uniforme (longitude corrigée par cos φ moyen),
 * ajustée dans width × height en conservant les proportions, viewport centré.
 */
export function makeProjection(v: Viewport, width: number, height: number): Projection {
  const midLat = (v.minLat + v.maxLat) / 2
  const cosMid = Math.cos((midLat * Math.PI) / 180)
  const spanKmX = (v.maxLon - v.minLon) * KM_PER_DEG_LAT * cosMid
  const spanKmY = (v.maxLat - v.minLat) * KM_PER_DEG_LAT
  const pxPerKm = Math.min(width / spanKmX, height / spanKmY)
  const cx = (v.minLon + v.maxLon) / 2
  const cy = (v.minLat + v.maxLat) / 2
  return {
    width, height, pxPerKm, viewport: v,
    project: (p) => ({
      x: width / 2 + (p.lon - cx) * KM_PER_DEG_LAT * cosMid * pxPerKm,
      y: height / 2 - (p.lat - cy) * KM_PER_DEG_LAT * pxPerKm,
    }),
  }
}

/** Graduation « ronde » de l'échelle (5, 10, 20, 50, 100… km) proche de `targetPx`. */
export function niceScaleKm(pxPerKm: number, targetPx = 80): number {
  const raw = targetPx / pxPerKm
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]
  return steps.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), steps[0])
}

/** Pas de graticule (degrés) donnant ~4 à 6 lignes sur la plus grande étendue. */
export function graticuleStep(spanDeg: number): number {
  const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]
  const raw = spanDeg / 5
  return steps.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), steps[0])
}

export function graticuleValues(min: number, max: number, step: number): number[] {
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/** Rayon d'une bulle proportionnelle à l'aire (√valeur), borné. */
export function bubbleRadius(value: number, max: number, rMin = 4, rMax = 22): number {
  if (!(max > 0) || !(value > 0)) return 0
  return rMin + (rMax - rMin) * Math.sqrt(value / max)
}

/** « 43,579° N, 1,440° E » */
export function formatLatLon(lat: number, lon: number): string {
  const f = (v: number) => Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return `${f(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${f(lon)}° ${lon >= 0 ? 'E' : 'O'}`
}

// ── Regroupement des rayons identiques ──────────────────────────────────────
export interface RadiusGroup {
  key: string
  latitude: number
  longitude: number
  radius: number
  unit: 'KILOMETERS' | 'MILES'
  km: number
  campaigns: { name: string; status: string | null }[]
  /** true si au moins une campagne du groupe est active (ENABLED) */
  active: boolean
}

/**
 * Plusieurs campagnes peuvent cibler exactement le même rayon : un seul cercle est dessiné,
 * avec la liste des campagnes. Ordre : du plus grand au plus petit (les petits restent visibles).
 */
export function groupRadiusZones(zones: RadiusZone[]): RadiusGroup[] {
  const by = new Map<string, RadiusGroup>()
  for (const z of zones) {
    const km = radiusKm(z.radius, z.unit)
    const key = `${z.latitude.toFixed(5)}|${z.longitude.toFixed(5)}|${km.toFixed(3)}`
    const g = by.get(key) ?? { key, latitude: z.latitude, longitude: z.longitude, radius: z.radius, unit: z.unit, km, campaigns: [], active: false }
    g.campaigns.push({ name: z.campaignName || 'Campagne', status: z.status })
    if (z.status === 'ENABLED') g.active = true
    by.set(key, g)
  }
  return [...by.values()].sort((a, b) => b.km - a.km || a.key.localeCompare(b.key))
}

/** Distance d'un cercle en km, formatée : « 25 km », « 12,5 km ». */
export const formatKm = (km: number): string => `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`
