import { describe, it, expect } from 'vitest'
import {
  aggregateDevices, aggregateDemographics, aggregateGeo, postalCoveragePct, toBars, campaignStatusInfo, formatMetric,
  type DemographicDbRow, type GeoTargetInfo,
} from './googleAdsBreakdowns'

const m = { impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 }

describe('aggregateDevices', () => {
  it('Mobile, Ordinateur, Tablette toujours listés ; autres types seulement s’ils existent', () => {
    const a = aggregateDevices([{ device: 'MOBILE', ...m, impressions: 90 }, { device: 'MOBILE', ...m, impressions: 10 }])
    expect(a.map((d) => d.label)).toEqual(['Mobile', 'Ordinateur', 'Tablette'])
    expect(a[0].impressions).toBe(100)
    expect(a[2].impressions).toBe(0)
    const b = aggregateDevices([{ device: 'CONNECTED_TV', ...m, impressions: 5 }])
    expect(b.map((d) => d.label)).toEqual(['Mobile', 'Ordinateur', 'Tablette', 'TV connectée'])
  })
})

describe('aggregateDemographics — âge et sexe séparés, « Inconnu » conservé', () => {
  const rows: DemographicDbRow[] = [
    { dimension: 'age_range', value: 'AGE_RANGE_25_34', ...m, impressions: 30 },
    { dimension: 'age_range', value: 'AGE_RANGE_UNDETERMINED', ...m, impressions: 43 },
    { dimension: 'gender', value: 'MALE', ...m, impressions: 20 },
    { dimension: 'gender', value: 'UNDETERMINED', ...m, impressions: 40 },
  ]
  it('tranches d’âge ordonnées, remplies à 0, Inconnu en dernier', () => {
    const a = aggregateDemographics(rows, 'age_range')
    expect(a.map((x) => x.label)).toEqual(['18–24', '25–34', '35–44', '45–54', '55–64', '65+', 'Inconnu'])
    expect(a[1].impressions).toBe(30)
    expect(a[6]).toMatchObject({ impressions: 43, hint: 'non déterminé par Google' })
  })
  it('sexe : jamais mélangé avec l’âge', () => {
    const g = aggregateDemographics(rows, 'gender')
    expect(g.map((x) => x.label)).toEqual(['Femme', 'Homme', 'Inconnu'])
    expect(g.reduce((s, x) => s + x.impressions, 0)).toBe(60)
  })
  it('valeur inattendue de Google conservée, pas supprimée', () => {
    const g = aggregateDemographics([{ dimension: 'gender', value: 'NON_BINARY', ...m, impressions: 3 }], 'gender')
    expect(g[g.length - 1]).toMatchObject({ label: 'NON_BINARY', impressions: 3 })
  })
})

describe('toBars', () => {
  it('part du total et largeur relative au plus grand', () => {
    const bars = toBars([{ key: 'a', label: 'A', ...m, clicks: 30 }, { key: 'b', label: 'B', ...m, clicks: 10 }], 'clicks')
    expect(bars.total).toBe(40)
    expect(bars.items[0]).toMatchObject({ share: 75, width: 100 })
    expect(bars.items[1].share).toBe(25)
    expect(bars.items[1].width).toBeCloseTo(33.33, 1)
  })
  it('total nul : tout à 0, sans NaN', () => {
    const bars = toBars([{ key: 'a', label: 'A', ...m }], 'cost')
    expect(bars.items[0]).toMatchObject({ share: 0, width: 0 })
  })
  it('formatMetric : dépenses en €', () => {
    expect(formatMetric('cost', 2_500_000)).toMatch(/2,50\s?€/)
  })
})

describe('aggregateGeo', () => {
  const names = new Map<number, GeoTargetInfo>([[1, { geo_target_id: 1, name: 'Toulouse', canonical_name: 'Toulouse,Occitanie,France', target_type: 'City', region_name: 'Occitanie' }]])
  const g = (o: object) => ({ geo_level: 'city' as const, presence_type: 'LOCATION_OF_PRESENCE', geo_target_id: 1, ...m, ...o })
  it('regroupe par zone, sépare ville / code postal et type de présence', () => {
    const rows = [g({ impressions: 5 }), g({ impressions: 7 }), g({ geo_level: 'postal_code', geo_target_id: 2, impressions: 4 }), g({ presence_type: 'AREA_OF_INTEREST', impressions: 100 })]
    const cities = aggregateGeo(rows, 'city', 'LOCATION_OF_PRESENCE', names)
    expect(cities).toHaveLength(1)
    expect(cities[0]).toMatchObject({ label: 'Toulouse', region: 'Occitanie', impressions: 12 })
    expect(aggregateGeo(rows, 'postal_code', 'LOCATION_OF_PRESENCE', names)[0].label).toBe('Zone 2')
  })
  it('couverture des codes postaux', () => {
    expect(postalCoveragePct([{ ...m, impressions: 100 }], [{ ...m, impressions: 76 }])).toBe(76)
    expect(postalCoveragePct([], [])).toBeNull()
  })
})

describe('campaignStatusInfo — statut réel', () => {
  it('ENABLED / PAUSED / REMOVED / absent / inconnu', () => {
    expect(campaignStatusInfo('ENABLED')).toEqual({ label: 'Active', tone: 'green' })
    expect(campaignStatusInfo('PAUSED')).toEqual({ label: 'En pause', tone: 'amber' })
    expect(campaignStatusInfo('REMOVED').label).toBe('Supprimée')
    expect(campaignStatusInfo(null).label).toBe('Statut indisponible')
    expect(campaignStatusInfo('SOMETHING_NEW').label).toBe('SOMETHING_NEW')
  })
})
