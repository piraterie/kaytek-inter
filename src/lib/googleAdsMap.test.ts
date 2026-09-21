import { describe, it, expect } from 'vitest'
import {
  radiusKm, viewportOfCircles, makeProjection, niceScaleKm, groupRadiusZones, formatKm, formatLatLon, noCoordinatesProvider, bubbleRadius,
  KM_PER_MILE, type RadiusZone,
} from './googleAdsMap'

const toulouse = { latitude: 43.6, longitude: 1.44 }

describe('rayons', () => {
  it('miles → km', () => {
    expect(radiusKm(10, 'MILES')).toBeCloseTo(10 * KM_PER_MILE)
    expect(radiusKm(25, 'KILOMETERS')).toBe(25)
  })
  it('projection à échelle uniforme : un rayon de 25 km fait 25 × pxPerKm dans toutes les directions', () => {
    const vp = viewportOfCircles([{ ...toulouse, km: 25 }])
    const p = makeProjection(vp, 600, 400)
    const c = p.project({ lat: toulouse.latitude, lon: toulouse.longitude })
    expect(c.x).toBeCloseTo(300)
    expect(c.y).toBeCloseTo(200)
    const north = p.project({ lat: toulouse.latitude + 25 / 111.32, lon: toulouse.longitude })
    expect(c.y - north.y).toBeCloseTo(25 * p.pxPerKm, 3)
    const dLon = 25 / (111.32 * Math.cos((p.viewport.minLat + p.viewport.maxLat) / 2 * Math.PI / 180))
    const east = p.project({ lat: toulouse.latitude, lon: toulouse.longitude + dLon })
    expect(east.x - c.x).toBeCloseTo(25 * p.pxPerKm, 3)
  })
  it('étendue minimale pour un très petit rayon', () => {
    const vp = viewportOfCircles([{ ...toulouse, km: 0 }], 0.12, 40)
    expect((vp.maxLat - vp.minLat) * 111.32).toBeGreaterThanOrEqual(39.9)
  })
  it('échelle « ronde »', () => {
    expect([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]).toContain(niceScaleKm(3.2))
  })
})

describe('groupRadiusZones — cercles identiques regroupés', () => {
  const z = (id: string, o: Partial<RadiusZone> = {}): RadiusZone => ({ id, ...toulouse, radius: 25, unit: 'KILOMETERS', campaignName: id, status: 'ENABLED', ...o })
  it('deux campagnes, même rayon → un cercle, deux campagnes', () => {
    const g = groupRadiusZones([z('A'), z('B')])
    expect(g).toHaveLength(1)
    expect(g[0].campaigns.map((c) => c.name)).toEqual(['A', 'B'])
  })
  it('même centre, rayon différent → 2 cercles, du plus grand au plus petit', () => {
    const g = groupRadiusZones([z('A', { radius: 10 }), z('B', { radius: 40 })])
    expect(g.map((x) => x.km)).toEqual([40, 10])
  })
  it('groupe « actif » seulement si une campagne est ENABLED', () => {
    expect(groupRadiusZones([z('A', { status: 'PAUSED' })])[0].active).toBe(false)
    expect(groupRadiusZones([z('A', { status: 'PAUSED' }), z('B')])[0].active).toBe(true)
  })
})

describe('aucune coordonnée inventée', () => {
  it('le fournisseur par défaut ne renvoie jamais de position', () => {
    expect(noCoordinatesProvider.lookup({ geoTargetId: 1, name: 'Toulouse', region: 'Occitanie', level: 'city' })).toBeNull()
  })
  it('bulles : rayon proportionnel à √valeur, 0 si valeur nulle', () => {
    expect(bubbleRadius(0, 10)).toBe(0)
    expect(bubbleRadius(10, 10)).toBe(22)
    expect(bubbleRadius(2.5, 10)).toBeCloseTo(4 + 18 * Math.sqrt(0.25))
  })
  it('formats', () => {
    expect(formatKm(25)).toBe('25 km')
    expect(formatKm(2.5)).toBe('2,5 km')
    expect(formatLatLon(43.579, 1.44)).toMatch(/43,579° N, 1,440° E/)
  })
})
