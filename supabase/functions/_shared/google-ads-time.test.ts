// supabase/functions/_shared/google-ads-time.test.ts
//
// Fuseau du compte : Europe/Paris, minuit–02h, passage heure d'été / d'hiver,
// autres fuseaux, créneaux de synchronisation. Aucune dépendance réseau.
// Exécution : deno test --allow-env supabase/functions/_shared/google-ads-time.test.ts
import { assertEquals, assert, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  isValidTimeZone, localParts, addDays, localDateRange, isHourlySyncHour, isBreakdownSyncHour,
} from './google-ads-time.ts'

const PARIS = 'Europe/Paris'
const at = (iso: string) => new Date(iso)

Deno.test('fuseau valide / invalide', () => {
  assert(isValidTimeZone('Europe/Paris'))
  assert(isValidTimeZone('America/Los_Angeles'))
  assert(!isValidTimeZone('Mars/Olympus'))
  assert(!isValidTimeZone(''))
  assert(!isValidTimeZone(null))
  assert(!isValidTimeZone(undefined))
  assert(!isValidTimeZone(42))
})

Deno.test('Europe/Paris en été (UTC+2) : 05:05 UTC = 07:05 locale', () => {
  assertEquals(localParts(at('2026-09-21T05:05:00Z'), PARIS), { date: '2026-09-21', hour: 7, minute: 5 })
})

Deno.test('Europe/Paris en hiver (UTC+1) : 06:05 UTC = 07:05 locale', () => {
  assertEquals(localParts(at('2026-12-15T06:05:00Z'), PARIS), { date: '2026-12-15', hour: 7, minute: 5 })
})

Deno.test('BUG CORRIGÉ — entre minuit et 02h à Paris (été), la date locale est déjà celle du lendemain', () => {
  // 22:30 UTC le 21/09 = 00:30 à Paris le 22/09 : « aujourd'hui » = 22/09, pas 21/09 (UTC).
  const now = at('2026-09-21T22:30:00Z')
  assertEquals(now.toISOString().slice(0, 10), '2026-09-21') // ce que l'ancien code (UTC) utilisait
  assertEquals(localParts(now, PARIS), { date: '2026-09-22', hour: 0, minute: 30 })
  assertEquals(localDateRange(now, PARIS, 2), { from: '2026-09-20', to: '2026-09-22' })
})

Deno.test('minuit pile et 01h59 à Paris : heure 0 et 1, jamais 24', () => {
  assertEquals(localParts(at('2026-09-21T22:00:00Z'), PARIS).hour, 0)
  assertEquals(localParts(at('2026-09-21T23:59:00Z'), PARIS), { date: '2026-09-22', hour: 1, minute: 59 })
  // 02:00 locale : la date n'est plus décalée par rapport à l'UTC
  assertEquals(localParts(at('2026-09-22T00:00:00Z'), PARIS), { date: '2026-09-22', hour: 2, minute: 0 })
})

Deno.test('passage à l\'heure d\'été (dimanche 2026-03-29, 02:00 → 03:00 à Paris) : l\'heure 2 n\'existe pas ce jour-là', () => {
  assertEquals(localParts(at('2026-03-29T00:59:00Z'), PARIS), { date: '2026-03-29', hour: 1, minute: 59 })
  assertEquals(localParts(at('2026-03-29T01:00:00Z'), PARIS), { date: '2026-03-29', hour: 3, minute: 0 })
  // Séquence locale autour du saut : 23:00Z=00h, 00:00Z=01h, 01:00Z=03h, 02:00Z=04h, 03:00Z=05h
  const seq = [0, 1, 2, 3, 4].map((k) => localParts(new Date(Date.UTC(2026, 2, 28, 23, 0) + k * 3600e3), PARIS).hour)
  assertEquals(seq, [0, 1, 3, 4, 5]) // l'heure 2 est sautée
})

Deno.test('passage à l\'heure d\'hiver (dimanche 2026-10-25, 03:00 → 02:00 à Paris) : l\'heure 2 apparaît deux fois', () => {
  const seq = [0, 1, 2, 3, 4].map((k) => localParts(new Date(Date.UTC(2026, 9, 24, 22, 0) + k * 3600e3), PARIS))
  assertEquals(seq.map((p) => p.hour), [0, 1, 2, 2, 3]) // 22:00Z=00h, 23:00Z=01h, 00:00Z=02h (été), 01:00Z=02h (hiver), 02:00Z=03h
  assertEquals(new Set(seq.map((p) => p.date)).size, 1)
  assertEquals(seq[0].date, '2026-10-25')
})

Deno.test('journée entière au passage d\'hiver : 25 heures locales, la date reste la même', () => {
  // Du 25/10 00:00 locale (22:00Z le 24) au 26/10 00:00 locale (23:00Z le 25) = 25 h
  let count = 0
  for (let t = Date.UTC(2026, 9, 24, 22, 0); t < Date.UTC(2026, 9, 25, 23, 0); t += 3600e3) {
    assertEquals(localParts(new Date(t), PARIS).date, '2026-10-25')
    count++
  }
  assertEquals(count, 25)
})

Deno.test('autres fuseaux : Los Angeles (retard sur l\'UTC) et Auckland (avance)', () => {
  assertEquals(localParts(at('2026-09-21T03:00:00Z'), 'America/Los_Angeles'), { date: '2026-09-20', hour: 20, minute: 0 })
  assertEquals(localParts(at('2026-09-21T12:00:00Z'), 'Pacific/Auckland'), { date: '2026-09-22', hour: 0, minute: 0 })
})

Deno.test('addDays : mois, année, bissextile', () => {
  assertEquals(addDays('2026-09-21', -2), '2026-09-19')
  assertEquals(addDays('2026-03-01', -1), '2026-02-28')
  assertEquals(addDays('2028-03-01', -1), '2028-02-29')
  assertEquals(addDays('2026-12-31', 1), '2027-01-01')
  assertEquals(addDays('2026-01-01', -90), '2025-10-03')
})

Deno.test('addDays refuse une date mal formée (jamais injectée dans une requête)', () => {
  assertThrows(() => addDays('2026-09-21; DROP', 1))
  assertThrows(() => addDays('21/09/2026', 1))
})

Deno.test('créneaux : horaire = 07h → 22h59 ; ventilations = 07h, 11h, 15h, 19h (heure locale)', () => {
  const hourly = Array.from({ length: 24 }, (_, h) => h).filter(isHourlySyncHour)
  assertEquals(hourly.length, 16)
  assertEquals(hourly[0], 7)
  assertEquals(hourly[hourly.length - 1], 22)
  assertEquals(Array.from({ length: 24 }, (_, h) => h).filter(isBreakdownSyncHour), [7, 11, 15, 19])
})

Deno.test('cron UTC horaire → créneaux locaux à Paris : 16 passages en été comme en hiver', () => {
  for (const day of ['2026-07-15', '2026-12-15']) {
    let n = 0
    for (let h = 0; h < 24; h++) {
      const p = localParts(new Date(`${day}T${String(h).padStart(2, '0')}:05:00Z`), PARIS)
      if (isHourlySyncHour(p.hour)) n++
    }
    assertEquals(n, 16, `passages horaires le ${day}`)
  }
})
