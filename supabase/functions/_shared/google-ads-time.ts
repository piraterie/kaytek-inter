// supabase/functions/_shared/google-ads-time.ts
//
// Dates et heures dans le FUSEAU DU COMPTE Google Ads (google_ads_connections.time_zone,
// ex. « Europe/Paris »), jamais en UTC. Google renvoie segments.date et
// segments.hour dans ce fuseau : « aujourd'hui », « hier » et l'heure courante
// doivent être calculés dans le même repère, sinon, entre minuit et 02h à Paris
// (été), on interrogerait la veille au lieu d'aujourd'hui.
//
// Fonctions pures, basées sur Intl (données IANA du runtime) : le passage heure
// d'été / heure d'hiver est géré par le runtime, pas par des décalages codés.

export interface LocalParts {
  date: string   // YYYY-MM-DD, date locale du compte
  hour: number   // 0-23, heure locale du compte
  minute: number // 0-59
}

/** Vrai si `tz` est un identifiant de fuseau IANA reconnu par le runtime. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Date et heure locales du compte à l'instant `now`. */
export function localParts(now: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // Certains runtimes renvoient « 24 » à minuit : on ramène dans 0-23.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Arithmétique calendaire pure sur une date YYYY-MM-DD (aucun fuseau impliqué). */
export function addDays(date: string, days: number): string {
  if (!ISO_DATE.test(date)) throw new Error(`date invalide : ${date}`)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Fenêtre [aujourd'hui − daysBack, aujourd'hui] dans le fuseau du compte. */
export function localDateRange(now: Date, tz: string, daysBack: number): { from: string; to: string } {
  const to = localParts(now, tz).date
  return { from: addDays(to, -daysBack), to }
}

// ── Créneaux de synchronisation (heure LOCALE du compte) ───────────────────
/** Synchronisation horaire : de 07h00 à 22h59 locales (16 passages par jour). */
export const HOURLY_SYNC_FIRST_HOUR = 7
export const HOURLY_SYNC_LAST_HOUR = 22
/** Ventilations (appareils, âge, sexe, ville, code postal) : 4 passages par jour. */
export const BREAKDOWN_SYNC_HOURS: readonly number[] = [7, 11, 15, 19]

export const isHourlySyncHour = (hour: number): boolean =>
  hour >= HOURLY_SYNC_FIRST_HOUR && hour <= HOURLY_SYNC_LAST_HOUR

export const isBreakdownSyncHour = (hour: number): boolean => BREAKDOWN_SYNC_HOURS.includes(hour)
