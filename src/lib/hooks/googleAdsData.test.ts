// Pagination des lectures Google Ads : PostgREST plafonne chaque réponse à 1000 lignes (max_rows).
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/store', () => ({ useAuthStore: { getState: () => ({ user: { organisation_id: 'org' } }) } }))

import { fetchAllPages, campaignStatusMap } from './googleAdsData'

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i }))

describe('fetchAllPages', () => {
  it('lit toutes les pages jusqu’à une page incomplète (2 500 lignes → 3 requêtes range)', async () => {
    const all = rows(2500)
    const calls: [number, number][] = []
    const out = await fetchAllPages<{ id: number }>(async (a, b) => { calls.push([a, b]); return { data: all.slice(a, b + 1), error: null } })
    expect(out).toHaveLength(2500)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(new Set(out.map((r) => r.id)).size).toBe(2500)
  })
  it('exactement 1 000 lignes → une seconde requête (vide) pour confirmer la fin', async () => {
    const all = rows(1000)
    const calls: [number, number][] = []
    const out = await fetchAllPages<{ id: number }>(async (a, b) => { calls.push([a, b]); return { data: all.slice(a, b + 1), error: null } })
    expect(out).toHaveLength(1000)
    expect(calls).toHaveLength(2)
  })
  it('aucune ligne → une seule requête, tableau vide', async () => {
    const out = await fetchAllPages<{ id: number }>(async () => ({ data: [], error: null }))
    expect(out).toEqual([])
  })
  it('une erreur de page est propagée (pas de données partielles silencieuses)', async () => {
    let n = 0
    await expect(fetchAllPages<{ id: number }>(async () => (n++ === 0 ? { data: rows(1000), error: null } : { data: null, error: { message: 'boom' } })))
      .rejects.toThrow('boom')
  })
})

describe('campaignStatusMap', () => {
  it('campaign_id → statut Google', () => {
    const m = campaignStatusMap([{ campaign_id: '1', name: 'A', status: 'PAUSED', advertising_channel_type: null }])
    expect(m.get('1')).toBe('PAUSED')
    expect(campaignStatusMap(undefined).size).toBe(0)
  })
})
