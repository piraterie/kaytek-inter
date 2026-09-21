// src/lib/googleAdsMetrics.test.ts
// Logique d'affichage pure du tableau de bord Google Ads — aucun réseau, aucun DOM.
import { describe, it, expect } from 'vitest'
import {
  previousPeriod, computeDelta, ratioDelta, deltaLabel, deltaDirection, aggregate, byCampaign,
  filterSortCampaigns, describeSyncError, ctrPct, cpcMicros, costPerConvMicros, formatRelative, fmtEurMicros, fmtPct, MIN_BASE,
  formatPeriodLabel, formatDayLong, maskCustomerId, dailySeries, insightStats, campaignChanges, sharePct, buildKpis, fmtCompact,
  describeSyncResult, withIdleCampaigns, friendlyCampaignName, fmtConv,
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
  it('pourcentage > 300 % → écart absolu avec unité, jamais « +>999 % »', () => {
    const d = computeDelta(100_000, 100, 10)
    expect(d).toEqual({ kind: 'abs', diff: 99_900 })
    expect(deltaLabel(d, String, 'clics')).toBe('+99900 clics')
    expect(deltaLabel(d, String)).not.toMatch(/>|999 %/)
  })
  it('baisse ou hausse ≤ 300 % → pourcentage normal', () => {
    expect(computeDelta(400, 100, 10)).toEqual({ kind: 'pct', pct: 300 })
    expect(deltaLabel(computeDelta(401, 100, 10), String, 'clics')).toBe('+301 clics')
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
  it('regroupe par campagne, statut RÉEL (jamais déduit), repli du nom sur l’id', () => {
    const list = byCampaign(rows, new Map([['a', 'PAUSED']]))
    const a = list.find((c) => c.id === 'a')!
    // Campagne avec activité mais en pause : le statut vient de Google, pas de l'activité.
    expect(a).toMatchObject({ impressions: 1500, clicks: 75, costMicros: 35_000_000, status: 'PAUSED' })
    expect(a.ctr).toBe(5)
    expect(a.costPerConv).toBe(35_000_000 / 6)
    const b = list.find((c) => c.id === 'b')!
    expect(b.status).toBeNull()
    expect(b.ctr).toBeNull()
    expect(list.find((c) => c.id === 'c')!.name).toBe('c')
  })
})

describe('filterSortCampaigns', () => {
  const list = byCampaign([
    row({ campaign_id: 'a', campaign_name: 'Alpha', impressions: 1000, clicks: 50, cost_micros: 25_000_000, conversions: 5 }),
    row({ campaign_id: 'b', campaign_name: 'Bravo', impressions: 0 }),
    row({ campaign_id: 'c', campaign_name: 'Charlie', impressions: 200, clicks: 20, cost_micros: 40_000_000, conversions: 0 }),
  ], new Map([['a', 'ENABLED'], ['b', 'PAUSED'], ['c', 'ENABLED']]))
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
    expect(filterSortCampaigns([...list], { ...base, status: 'paused' }).map((c) => c.id)).toEqual(['b'])
    expect(filterSortCampaigns([...list], { ...base, status: 'enabled' }).map((c) => c.id).sort()).toEqual(['a', 'c'])
    expect(filterSortCampaigns([...list], { ...base, status: 'removed' })).toEqual([])
  })
  it('tri par statut : actives d’abord', () => {
    expect(filterSortCampaigns([...list], { ...base, sortKey: 'status', sortDir: 'desc' }).map((c) => c.id)[2]).toBe('b')
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

describe('formatPeriodLabel / formatDayLong', () => {
  it('même année : l’année n’apparaît qu’une fois', () => {
    expect(formatPeriodLabel('2026-08-24', '2026-09-21')).toMatch(/^24 août – 21 sept.? 2026$/)
  })
  it('années différentes : année aux deux bornes', () => {
    expect(formatPeriodLabel('2025-12-20', '2026-01-10')).toMatch(/2025 – .*2026$/)
  })
  it('dates invalides → chaîne vide / date brute', () => {
    expect(formatPeriodLabel('nope', '2026-01-10')).toBe('')
    expect(formatDayLong('nope')).toBe('nope')
  })
  it('jour long avec jour de la semaine', () => {
    expect(formatDayLong('2026-09-21')).toMatch(/lun.? 21 sept/)
  })
})

describe('maskCustomerId / sharePct / fmtCompact', () => {
  it('masque l’identifiant : jamais complet', () => {
    expect(maskCustomerId('7536669574')).toBe('····9574')
    expect(maskCustomerId('753-666-9574')).toBe('····9574')
    expect(maskCustomerId(null)).toBeNull()
    expect(maskCustomerId('12')).toBeNull()
  })
  it('part en % bornée 0–100, 0 si total nul', () => {
    expect(sharePct(25, 100)).toBe(25)
    expect(sharePct(5, 0)).toBe(0)
    expect(sharePct(500, 100)).toBe(100)
  })
  it('format compact', () => {
    expect(fmtCompact(1500)).toMatch(/1,5/)
  })
})

describe('dailySeries / insightStats', () => {
  const rows = [
    row({ date: '2026-09-02', campaign_id: 'a', impressions: 100, clicks: 10, cost_micros: 5_000_000, conversions: 1, conversions_value: 40 }),
    row({ date: '2026-09-01', campaign_id: 'a', impressions: 200, clicks: 30, cost_micros: 12_000_000, conversions: 2, conversions_value: 0 }),
    row({ date: '2026-09-01', campaign_id: 'b', impressions: 50, clicks: 5, cost_micros: 3_000_000, conversions: 0 }),
    row({ date: '2026-09-03', campaign_id: 'a', impressions: 0, clicks: 0, cost_micros: 0 }),
  ]
  it('agrège par jour, trie par date, coût en euros', () => {
    const s = dailySeries(rows)
    expect(s.map((p) => p.iso)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(s[0]).toMatchObject({ impressions: 250, clicks: 35, cost: 15, conversions: 2, label: '01/09' })
  })
  it('repères : moyenne/jour, meilleur jour, jour le plus coûteux, jours actifs, valeur de conversion', () => {
    const i = insightStats(rows)
    expect(i.days).toBe(3)
    expect(i.activeDays).toBe(2)
    expect(i.avgCostMicros).toBe(20_000_000 / 3)
    expect(i.bestClicksDay).toEqual({ iso: '2026-09-01', value: 35 })
    expect(i.priciestDay).toEqual({ iso: '2026-09-01', costMicros: 15_000_000 })
    expect(i.conversionsValue).toBe(40)
  })
  it('aucune donnée → valeurs neutres, jamais NaN', () => {
    const i = insightStats([])
    expect(i).toMatchObject({ days: 0, activeDays: 0, avgCostMicros: null, bestClicksDay: null, priciestDay: null, conversionsValue: 0 })
    expect(dailySeries(undefined)).toEqual([])
  })
})

describe('campaignChanges', () => {
  const cur = byCampaign([
    row({ campaign_id: 'a', campaign_name: 'Alpha', clicks: 120 }),
    row({ campaign_id: 'b', campaign_name: 'Bravo', clicks: 40 }),
    row({ campaign_id: 'c', campaign_name: 'Charlie', clicks: 0 }),
  ])
  const prev = byCampaign([
    row({ campaign_id: 'a', campaign_name: 'Alpha', clicks: 100 }),
    row({ campaign_id: 'b', campaign_name: 'Bravo', clicks: 80 }),
  ])
  it('classe par variation absolue de clics, ignore les campagnes 0 → 0', () => {
    const ch = campaignChanges(cur, prev)
    expect(ch.map((c) => c.id)).toEqual(['b', 'a'])
    expect(deltaLabel(ch[0].delta, String)).toBe('−50 %')
    expect(deltaLabel(ch[1].delta, String)).toBe('+20 %')
  })
  it('campagne sans historique → « Nouveau »', () => {
    const ch = campaignChanges(cur, [])
    expect(deltaLabel(ch.find((c) => c.id === 'a')!.delta, String)).toBe('Nouveau')
  })
  it('respecte la limite', () => {
    expect(campaignChanges(cur, prev, 1)).toHaveLength(1)
  })
})

describe('buildKpis', () => {
  const cur = { impressions: 1500, clicks: 75, costMicros: 35_000_000, conversions: 6 }
  const prev = { impressions: 1000, clicks: 50, costMicros: 20_000_000, conversions: 4 }
  it('7 indicateurs dans l’ordre, dépenses en premier (carte héro)', () => {
    const k = buildKpis(cur, prev, true, true)
    expect(k.map((x) => x.key)).toEqual(['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'costPerConv'])
    expect(k[0].tone).toBe('neutral')
    expect(deltaLabel(k[2].delta, String)).toBe('+50 %')
  })
  it('sans donnée : valeurs « — », aucune variation', () => {
    const k = buildKpis({ impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }, prev, false, false)
    expect(k.every((x) => x.value === '—' && x.delta.kind === 'none')).toBe(true)
  })
  it('sans comparaison possible : aucune variation malgré des valeurs', () => {
    expect(buildKpis(cur, prev, true, false).every((x) => x.delta.kind === 'none')).toBe(true)
  })
})

describe('describeSyncResult — jamais « 0 ligne(s) »', () => {
  it('synchronisation temporisée (< 10 min) : message informatif, pas une erreur', () => {
    const r = describeSyncResult({ rowsUpserted: 0, throttled: true, datasets: [] })
    expect(r).toEqual({ tone: 'info', message: 'Données déjà synchronisées récemment.' })
    expect(r.message).not.toMatch(/ligne/)
  })
  it('succès : aucun compteur de lignes', () => {
    const r = describeSyncResult({ rowsUpserted: 1234, throttled: false, datasets: [{ dataset: 'hourly', ok: true }] })
    expect(r.tone).toBe('success')
    expect(r.message).not.toMatch(/ligne|1234/)
  })
  it('un jeu de données en échec : avertissement, pas succès', () => {
    const r = describeSyncResult({ rowsUpserted: 10, throttled: false, datasets: [{ dataset: 'hourly', ok: true }, { dataset: 'geo', ok: false }] })
    expect(r.tone).toBe('warning')
    expect(r.message).toMatch(/partielle/)
  })
})

describe('withIdleCampaigns', () => {
  it('ajoute les campagnes actives ou en pause sans activité (0 réel), pas les supprimées', () => {
    const base = byCampaign([row({ campaign_id: 'a', impressions: 5 })], new Map([['a', 'ENABLED']]))
    const out = withIdleCampaigns(base, [
      { campaign_id: 'a', name: 'A', status: 'ENABLED' }, { campaign_id: 'p', name: 'Pausée', status: 'PAUSED' }, { campaign_id: 'r', name: 'Supprimée', status: 'REMOVED' },
    ])
    expect(out.map((c) => c.id)).toEqual(['a', 'p'])
    expect(out[1]).toMatchObject({ name: 'Pausée', status: 'PAUSED', impressions: 0, ctr: null })
  })
})

describe('friendlyCampaignName', () => {
  it('nom technique des campagnes Services Locaux remplacé, autres noms inchangés', () => {
    expect(friendlyCampaignName('LocalServicesCampaign:SystemGenerated:000631154a2ad5bb')).toBe('Services Locaux (généré par Google)')
    expect(friendlyCampaignName('Campagne Baziege')).toBe('Campagne Baziege')
    expect(friendlyCampaignName(null, '42')).toBe('42')
  })
})

describe('deltaLabel — écart arrondi à zéro', () => {
  it('jamais « −0 conv. » : aucun badge', () => {
    expect(deltaLabel({ kind: 'abs', diff: -0.04 }, fmtConv, 'conv.')).toBeNull()
    expect(deltaLabel({ kind: 'abs', diff: 3 }, fmtConv, 'conv.')).toBe('+3 conv.')
  })
})
