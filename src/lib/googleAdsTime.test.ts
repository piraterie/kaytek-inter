import { describe, it, expect } from 'vitest'
import { resolveTimeZone, isValidTimeZone, localParts, localDate, addDays, formatHourMinute, presetRange } from './googleAdsTime'

describe('fuseau du compte', () => {
  it('fuseau invalide ou absent → UTC (jamais celui du navigateur)', () => {
    expect(resolveTimeZone(undefined)).toBe('UTC')
    expect(resolveTimeZone('Mars/Olympus')).toBe('UTC')
    expect(resolveTimeZone('Europe/Paris')).toBe('Europe/Paris')
    expect(isValidTimeZone('')).toBe(false)
  })
  it('entre minuit et 02h à Paris (été), « aujourd’hui » n’est pas la date UTC', () => {
    const now = new Date('2026-07-14T22:30:00Z') // 00:30 le 15 à Paris
    expect(localDate(now, 'UTC')).toBe('2026-07-14')
    expect(localDate(now, 'Europe/Paris')).toBe('2026-07-15')
    expect(localParts(now, 'Europe/Paris')).toEqual({ date: '2026-07-15', hour: 0, minute: 30 })
  })
  it('heure d’hiver (UTC+1) et minuit affiché 00 (jamais 24)', () => {
    expect(localParts(new Date('2026-01-10T23:05:00Z'), 'Europe/Paris')).toEqual({ date: '2026-01-11', hour: 0, minute: 5 })
  })
})

describe('addDays / presetRange', () => {
  it('arithmétique calendaire, mois et années', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(() => addDays('nope', 1)).toThrow()
  })
  it('« today » : un seul jour ; 7 j = 7 jours calendaires inclusifs', () => {
    const now = new Date('2026-09-21T12:00:00Z')
    expect(presetRange('today', now, 'Europe/Paris')).toEqual({ from: '2026-09-21', to: '2026-09-21' })
    expect(presetRange('7', now, 'Europe/Paris')).toEqual({ from: '2026-09-15', to: '2026-09-21' })
    expect(presetRange('30', now, 'UTC')).toEqual({ from: '2026-08-23', to: '2026-09-21' })
  })
  it('bascule de jour selon le fuseau', () => {
    const now = new Date('2026-07-14T22:30:00Z')
    expect(presetRange('today', now, 'Europe/Paris').to).toBe('2026-07-15')
  })
})

describe('formatHourMinute', () => {
  it('HH:mm dans le fuseau du compte ; absent ou invalide → null', () => {
    expect(formatHourMinute('2026-09-21T13:07:00Z', 'Europe/Paris')).toBe('15:07')
    expect(formatHourMinute(null, 'UTC')).toBeNull()
    expect(formatHourMinute('pas une date', 'UTC')).toBeNull()
  })
})
