import { describe, it, expect } from 'vitest'
import { hourlySeries, buildTodayView, syncedHourToday, todayInsights, sumHours, type HourlyDbRow } from './googleAdsToday'

const r = (o: Partial<HourlyDbRow>): HourlyDbRow => ({
  campaign_id: 'a', campaign_name: 'Alpha', local_date: '2026-09-21', hour: 9,
  impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0, ...o,
})
const TODAY = '2026-09-21', YEST = '2026-09-20', TZ = 'Europe/Paris'
// 14:20 à Paris (12:20 UTC, été)
const SYNCED = '2026-09-21T12:20:00Z'

describe('hourlySeries', () => {
  it('24 points 00h→23h, heures sans activité à 0', () => {
    const s = hourlySeries([r({ hour: 9, impressions: 10, clicks: 2, cost_micros: 3_000_000 })], TODAY, null)
    expect(s).toHaveLength(24)
    expect(s[0]).toMatchObject({ label: '00h', impressions: 0, clicks: 0, cost: 0, pending: false })
    expect(s[9]).toMatchObject({ label: '09h', impressions: 10, clicks: 2, cost: 3 })
    expect(s[23].label).toBe('23h')
  })
  it('les heures après la synchronisation sont « pending » (null), jamais un faux 0', () => {
    const s = hourlySeries([], TODAY, 14)
    expect(s[14]).toMatchObject({ impressions: 0, pending: false })
    expect(s[15]).toMatchObject({ impressions: null, clicks: null, cost: null, pending: true })
  })
  it('somme les campagnes d’une même heure ; ignore les autres jours et les heures invalides', () => {
    const s = hourlySeries([
      r({ impressions: 5 }), r({ campaign_id: 'b', impressions: 7 }),
      r({ local_date: YEST, impressions: 99 }), r({ hour: 25, impressions: 99 }),
    ], TODAY, null)
    expect(s[9].impressions).toBe(12)
    expect(sumHours(s, 0, 24).impressions).toBe(12)
  })
})

describe('syncedHourToday', () => {
  it('heure LOCALE de la synchro si elle date d’aujourd’hui (date locale), sinon null', () => {
    expect(syncedHourToday(SYNCED, TZ, TODAY)).toEqual({ hour: 14, minute: 20 })
    expect(syncedHourToday('2026-09-20T12:20:00Z', TZ, TODAY)).toBeNull()
    expect(syncedHourToday(null, TZ, TODAY)).toBeNull()
  })
})

describe('buildTodayView — comparaison sur les mêmes heures COMPLÈTES', () => {
  const rows = [
    r({ local_date: TODAY, hour: 9, clicks: 4, impressions: 40, cost_micros: 8_000_000 }),
    r({ local_date: TODAY, hour: 14, clicks: 3, impressions: 30, cost_micros: 6_000_000 }), // heure partielle (14h20)
    r({ local_date: YEST, hour: 9, clicks: 2, impressions: 20, cost_micros: 4_000_000 }),
    r({ local_date: YEST, hour: 14, clicks: 5, impressions: 50, cost_micros: 9_000_000 }), // hier, heure 14 entière
    r({ local_date: YEST, hour: 18, clicks: 50, impressions: 500, cost_micros: 90_000_000 }), // fin de journée d’hier
  ]
  const v = buildTodayView(rows, TODAY, YEST, SYNCED, TZ)
  it('totaux d’aujourd’hui = tout ce qui est synchronisé (heure partielle incluse)', () => {
    expect(v.syncedHour).toBe(14)
    expect(v.totals.clicks).toBe(7)
  })
  it('comparaison = heures 00h→13h des deux jours : ni la journée d’hier entière, ni l’heure partielle', () => {
    expect(v.compareHours).toBe(14)
    expect(v.compareToday.clicks).toBe(4)
    expect(v.compareYesterday.clicks).toBe(2) // ni le 5 de 14h ni le 50 de 18h
    expect(v.canCompare).toBe(true)
  })
  it('sans données hier → pas de comparaison (jamais un faux « Nouveau »)', () => {
    const w = buildTodayView(rows.filter((x) => x.local_date === TODAY), TODAY, YEST, SYNCED, TZ)
    expect(w.hasYesterday).toBe(false)
    expect(w.canCompare).toBe(false)
  })
  it('pas de synchronisation aujourd’hui → aucune comparaison', () => {
    const w = buildTodayView(rows, TODAY, YEST, '2026-09-20T12:00:00Z', TZ)
    expect(w.syncedHour).toBeNull()
    expect(w.canCompare).toBe(false)
  })
})

describe('todayInsights', () => {
  it('meilleure heure, heure la plus coûteuse, heures avec diffusion (heures connues seulement)', () => {
    const pts = hourlySeries([
      r({ hour: 9, impressions: 40, clicks: 4, cost_micros: 8_000_000 }),
      r({ hour: 11, impressions: 10, clicks: 1, cost_micros: 12_000_000 }),
    ], TODAY, 12)
    const i = todayInsights(pts)
    expect(i.elapsedHours).toBe(13)
    expect(i.activeHours).toBe(2)
    expect(i.bestClicksHour).toEqual({ hour: 9, value: 4 })
    expect(i.priciestHour).toEqual({ hour: 11, costMicros: 12_000_000 })
    expect(i.avgCostMicrosPerHour).toBeCloseTo(20_000_000 / 13)
  })
})
