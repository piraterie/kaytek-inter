// src/lib/googleAdsMetrics.test.ts
// Logique d'affichage pure du tableau de bord Google Ads — aucun réseau, aucun DOM.
import { describe, it, expect } from 'vitest'
import {
  previousPeriod, computeDelta, ratioDelta, deltaLabel, deltaDirection, aggregate, byCampaign,
  filterSortCampaigns, describeSyncError, ctrPct, cpcMicros, costPerConvMicros, formatRelative, fmtEurMicros, fmtPct, MIN_BASE,
} from './googleAdsMetrics'
import type { AdsMetricRow } from '@/lib/hooks/googleStats'

const row = (o: Partial<AdsMetricRow>): AdsMetricRow => ({
  date: '2026-09-01', campaign_id: 'c1', campaign_name: 'Camp 1',
  impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0, phone_calls: 0, ...o,
})

describe('previousPeriod', () => {
  it('7 jours inclusifs → les 7 jours précédents, sans chevauchement', () => {
    expect(previousPeriod('2026-09-15', '2026-09-21')).toEqual({ from: '2026-09-08', to: '2026-09-14', days: 7 })
  })
  it('plage personnalisée qui ne finit pas aujourd’hui', () => {
    expect(previousPeriod('2026-08-10', '2026-08-19')).toEqual({ from: '2026-07-31', to: '2026-08-09', days: 10 })
  })
  it('un seul jour', () => {
    expect(previousPeriod('2026-09-21', '2026-09-21')).toEqual({ from: '2026-09-20', to: '2026-09-20', days: 1 })
  })
  it('plage inversée ou invalide → null', () => {
    expect(previousPeriod('2026-09-21', '2026-09-01')).toBeNull()
    expect(previousPeriod('nope', '2026-09-01')).toBeNull()
  })
})

describe('computeDelta — jamais de pourcentage absurde', () => {
  it('base normale → pourcentage', () => {
    const d = computeDelta(150, 100, MIN_BASE.impressions)
    expect(d).toEqual({ kind: 'pct', pct: 50 })
    expect(deltaLabel(d, String)).toBe('+50 %')
  })
  it('baisse', () => {
    expect(deltaLabel(computeDelta(50, 100, 10), String)).toBe('−50 %')
  })
  it('période précédente quasi nulle (2 clics → 90) : écart absolu, pas +4 400 %', () => {
    const d = computeDelta(90, 2, MIN_BASE.clicks)
    expect(d).toEqual({ kind: 'abs', diff: 88 })
    expect(deltaLabel(d, String)).toBe('+88')
  })
  it('précédent = 0 et actuel > 0 → « Nouveau », jamais Infinity', () => {
    const d = computeDelta(40, 0, 10)
    expect(d).toEqual({ kind: 'new' })
    expect(deltaLabel(d, String)).toBe('Nouveau')
  })
  it('0 → 0 : aucun badge', () => {
    expect(deltaLabel(computeDelta(0, 0, 10), String)).toBeNull()
  })
  it('valeur indéfinie (null) → aucune comparaison', () => {
    expect(computeDelta(null, 10, 1)).toEqual({ kind: 'none' })
    expect(computeDelta(10, null, 1)).toEqual({ kind: 'none' })
  })
  it('pourcentage plafonné à 999 %', () => {
    const d = computeDelta(100_000, 100, 10)
    expect(d).toEqual({ kind: 'pct', pct: 999 })
    expect(deltaLabel(d, String)).toBe('+>999 %')
  })
  it('variation < 0,5 % → « Stable »', () => {
    const d = computeDelta(1001, 1000, 10)
    expect(deltaLabel(d, String)).toBe('Stable')
    expect(deltaDirection(d)).toBe('flat')
  })
})

describe('ratioDelta — un ratio n’est comparé que si le volume est suffisant', () => {
  it('volume insuffisant sur la période précédente → aucune comparaison', () => {
    expect(ratioDelta(2.5, 40, 500, 20, 100)).toEqual({ kind: 'none' })
  })
  it('volume suffisant des deux côtés → pourcentage', () => {
    expect(ratioDelta(3, 2, 500, 400, 100)).toEqual({ kind: 'pct', pct: 50 })
  })
})

describe('ratios — dénominateur nul = indéfini, pas 0', () => {
  it('CTR / CPC / coût par conversion', () => {
    expect(ctrPct(10, 0)).toBeNull()
    expect(cpcMicros(5_000_000, 0)).toBeNull()
    expect(costPerConvMicros(5_000_000, 0)).toBeNull()
    expect(ctrPct(5, 100)).toBe(5)
    expect(cpcMicros(10_000_000, 4)).toBe(2_500_000)
    expect(costPerConvMicros(10_000_000, 2)).toBe(5_000_000)
  })
  it('formatage : null → tiret', () => {
    expect(fmtEurMicros(null)).toBe('—')
    expect(fmtPct(null)).toBe('—')
  })
})

describe('aggregate / byCampaign', () => {
  const rows = [
    row({ campaign_id: 'a', campaign_name: 'Alpha', impressions: 1000, clicks: 50, cost_micros: 25_000_000, conversions: 5 }),
    row({ date: '2026-09-02', campaign_id: 'a', campaign_name: 'Alpha', impressions: 500, clicks: 25, cost_micros: 10_000_000, conversions: 1 }),
    row({ campaign_id: 'b', campaign_name: 'Bravo', impressions: 0, clicks: 0, cost_micros: 0 }),
    row({ campaign_id: 'c', campaign_name: null, impressions: 10, clicks: 1, cost_micros: 1_000_000 }),
  ]
  it('agrège les totaux', () => {
    expect(aggregate(rows)).toEqual({ impressions: 1510, clicks: 76, costMicros: 36_000_000, conversions: 6 })
  })
  it('regroupe par campagne, dérive CTR / statut, repli du nom sur l’id', () => {
    const list = byCampaign(rows)
    const a = list.find((c) => c.id === 'a')!
    expect(a).toMatchObject({ impressions: 1500, clicks: 75, costMicros: 35_000_000, active: true })
    expect(a.ctr).toBe(5)
    expect(a.costPerConv).toBe(35_000_000 / 6)
    const b = list.find((c) => c.id === 'b')!
    expect(b.active).toBe(false)
    expect(b.ctr).toBeNull()
    expect(list.find((c) => c.id === 'c')!.name).toBe('c')
  })
})

describe('filterSortCampaigns', () => {
  const list = byCampaign([
    row({ campaign_id: 'a', campaign_name: 'Alpha', impressions: 1000, clicks: 50, cost_micros: 25_000_000, conversions: 5 }),
    row({ campaign_id: 'b', campaign_name: 'Bravo', impressions: 0 }),
    row({ campaign_id: 'c', campaign_name: 'Charlie', impressions: 200, clicks: 20, cost_micros: 40_000_000, conversions: 0 }),
  ])
  const base = { query: '', status: 'all' as const, sortKey: 'costMicros' as const, sortDir: 'desc' as const }

  it('tri par dépenses décroissantes', () => {
    expect(filterSortCampaigns([...list], base).map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })
  it('tri par coût/conv. croissant : les valeurs indéfinies restent en dernier', () => {
    expect(filterSortCampaigns([...list], { ...base, sortKey: 'costPerConv', sortDir: 'asc' }).map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(filterSortCampaigns([...list], { ...base, sortKey: 'costPerConv', sortDir: 'desc' }).map((c) => c.id)[0]).toBe('a')
  })
  it('tri par nom', () => {
    expect(filterSortCampaigns([...list], { ...base, sortKey: 'name', sortDir: 'desc' }).map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })
  it('filtre texte insensible à la casse', () => {
    expect(filterSortCampaigns([...list], { ...base, query: 'CHAR' }).map((c) => c.id)).toEqual(['c'])
  })
  it('filtre par statut', () => {
    expect(filterSortCampaigns([...list], { ...base, status: 'inactive' }).map((c) => c.id)).toEqual(['b'])
    expect(filterSortCampaigns([...list], { ...base, status: 'active' }).map((c) => c.id).sort()).toEqual(['a', 'c'])
  })
})

describe('describeSyncError — messages lisibles', () => {
  it('google_error → message en français, détail conservé, jamais le code brut', () => {
    const r = describeSyncError({ reason: 'google_error', detail: 'HTTP 400 …', message: 'google_error' })
    expect(r.message).not.toContain('google_error')
    expect(r.message).toMatch(/Google Ads/)
    expect(r.detail).toBe('HTTP 400 …')
  })
  it('needs_reconnect / insufficient_permission / no_customer_selected', () => {
    expect(describeSyncError({ reason: 'needs_reconnect' }).message).toMatch(/expiré/)
    expect(describeSyncError({ reason: 'insufficient_permission' }).message).toMatch(/droits/)
    expect(describeSyncError({ reason: 'no_customer_selected' }).message).toMatch(/Aucun compte/)
  })
  it('message déjà en français (session) conservé tel quel', () => {
    expect(describeSyncError(new Error('Session expirée — reconnectez-vous.')).message).toBe('Session expirée — reconnectez-vous.')
  })
  it('erreur inconnue / anglaise → message générique, texte brut seulement en détail', () => {
    const r = describeSyncError(new Error('Failed to send a request to the Edge Function'))
    expect(r.message).toBe('La synchronisation a échoué. Réessayez dans un instant.')
    expect(r.detail).toBe('Failed to send a request to the Edge Function')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  it('paliers', () => {
    expect(formatRelative('2026-09-21T11:59:40Z', now)).toBe("à l'instant")
    expect(formatRelative('2026-09-21T11:30:00Z', now)).toBe('il y a 30 min')
    expect(formatRelative('2026-09-21T09:00:00Z', now)).toBe('il y a 3 h')
    expect(formatRelative('2026-09-18T12:00:00Z', now)).toBe('il y a 3 j')
    expect(formatRelative(null, now)).toBeNull()
  })
})
