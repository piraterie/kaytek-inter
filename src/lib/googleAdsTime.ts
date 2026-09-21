// src/lib/googleAdsTime.ts
//
// Dates et heures dans le FUSEAU DU COMPTE Google Ads (google_ads_connections.time_zone,
// ex. « Europe/Paris »), jamais dans le fuseau du navigateur ni en UTC : les données
// horaires et journalières de Google sont datées dans ce fuseau. Entre minuit et 02h à
// Paris (été), « aujourd'hui » n'est pas la date UTC.
// Fonctions pures basées sur Intl (miroir de supabase/functions/_shared/google-ads-time.ts).

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Fuseau du compte, ou UTC si absent/invalide (jamais une supposition sur le lieu de l'utilisateur). */
export const resolveTimeZone = (tz: unknown): string => (isValidTimeZone(tz) ? tz : 'UTC')

export interface LocalParts { date: string; hour: number; minute: number }

export function localParts(now: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Arithmétique calendaire pure sur une date YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  if (!ISO_DATE.test(date)) throw new Error(`date invalide : ${date}`)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Date locale du compte à l'instant `now`. */
export const localDate = (now: Date, tz: string): string => localParts(now, tz).date

/** « HH:mm » (24 h) d'un instant ISO, dans le fuseau du compte ; null si l'instant est absent ou invalide. */
export function formatHourMinute(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = localParts(d, tz)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export type PeriodKey = 'today' | '7' | '30' | '90'

/** Plage d'une période prédéfinie, en dates locales du compte (N jours calendaires inclusifs, aujourd'hui compris). */
export function presetRange(key: PeriodKey, now: Date, tz: string): { from: string; to: string } {
  const to = localDate(now, tz)
  const days = key === 'today' ? 1 : Number(key)
  return { from: addDays(to, -(days - 1)), to }
}
