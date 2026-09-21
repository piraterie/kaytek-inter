// src/lib/googleAdsMetrics.ts
// Logique d'affichage PURE du tableau de bord Google Ads (agrégation, ratios,
// comparaison de périodes, tri/filtre des campagnes, messages d'erreur).
// Aucun appel réseau, aucune dépendance React : testable isolément. Ne change
// jamais ce qui est demandé à l'API Google Ads — uniquement ce qui est affiché.
import type { AdsMetricRow } from '@/lib/hooks/googleStats'

// ── Dates ────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000

export function isoDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10)
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function parseIso(d: string): number {
  return Date.parse(`${d}T00:00:00Z`)
}

/** Période de même durée, immédiatement avant `from` (jamais de chevauchement). */
export function previousPeriod(from: string, to: string): { from: string; to: string; days: number } | null {
  const f = parseIso(from)
  const t = parseIso(to)
  if (Number.isNaN(f) || Number.isNaN(t) || t < f) return null
  const days = Math.round((t - f) / DAY_MS) + 1
  const prevTo = f - DAY_MS
  const prevFrom = prevTo - (days - 1) * DAY_MS
  return { from: new Date(prevFrom).toISOString().slice(0, 10), to: new Date(prevTo).toISOString().slice(0, 10), days }
}

// ── Agrégats et ratios ───────────────────────────────────────────────────
export interface Totals { impressions: number; clicks: number; costMicros: number; conversions: number }

export function aggregate(rows: AdsMetricRow[] | undefined): Totals {
  const r: Totals = { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
  for (const row of rows ?? []) {
    r.impressions += row.impressions
    r.clicks += row.clicks
    r.costMicros += row.cost_micros
    r.conversions += row.conversions
  }
  return r
}

// Un ratio sans dénominateur est INDÉFINI (null), jamais 0 : « 0,00 € par
// conversion » sans aucune conversion laisserait croire à un coût nul.
export const ctrPct = (clicks: number, impressions: number): number | null => (impressions > 0 ? (clicks / impressions) * 100 : null)
export const cpcMicros = (costMicros: number, clicks: number): number | null => (clicks > 0 ? costMicros / clicks : null)
export const costPerConvMicros = (costMicros: number, conversions: number): number | null => (conversions > 0 ? costMicros / conversions : null)

// ── Comparaison avec la période précédente ───────────────────────────────
export type Delta =
  | { kind: 'none' }                 // comparaison impossible ou sans intérêt
  | { kind: 'new' }                  // 0 avant, > 0 maintenant
  | { kind: 'abs'; diff: number }    // base trop faible : écart absolu, jamais un %
  | { kind: 'pct'; pct: number }

export const MAX_PCT = 999

/**
 * `minBase` = plus petite valeur précédente pour laquelle un pourcentage est
 * jugé significatif. En dessous, on affiche l'écart absolu (« +3 ») — évite
 * les « +4 800 % » quand la période précédente était quasi vide.
 */
export function computeDelta(current: number | null, previous: number | null, minBase: number): Delta {
  if (current === null || previous === null) return { kind: 'none' }
  if (previous === 0) return current > 0 ? { kind: 'new' } : { kind: 'none' }
  if (previous < minBase) return current === previous ? { kind: 'none' } : { kind: 'abs', diff: current - previous }
  const pct = ((current - previous) / previous) * 100
  return { kind: 'pct', pct: Math.max(-MAX_PCT, Math.min(MAX_PCT, pct)) }
}

// Seuils de volume : un ratio (CTR, CPC, coût/conv.) n'est comparé que si les
// deux périodes reposent sur assez d'événements pour être représentatives.
export const MIN_BASE = { impressions: 100, clicks: 10, costMicros: 5_000_000, conversions: 3 } as const
export const MIN_VOLUME_FOR_RATIO = { ctr: 100 /* impressions */, cpc: 10 /* clics */, costPerConv: 3 /* conversions */ } as const

export function ratioDelta(cur: number | null, prev: number | null, curVolume: number, prevVolume: number, minVolume: number): Delta {
  if (curVolume < minVolume || prevVolume < minVolume) return { kind: 'none' }
  return computeDelta(cur, prev, 0)
}

// ── Formatage ────────────────────────────────────────────────────────────
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('fr-FR', o)
const NF_INT = nf({ maximumFractionDigits: 0 })
const NF_CONV = nf({ maximumFractionDigits: 1 })
const NF_PCT = nf({ minimumFractionDigits: 1, maximumFractionDigits: 2 })
const NF_EUR = nf({ style: 'currency', currency: 'EUR' })
const DASH = '—'

export const fmtInt = (n: number | null) => (n === null ? DASH : NF_INT.format(n))
export const fmtConv = (n: number | null) => (n === null ? DASH : NF_CONV.format(n))
export const fmtPct = (n: number | null) => (n === null ? DASH : `${NF_PCT.format(n)} %`)
export const fmtEurMicros = (micros: number | null) => (micros === null ? DASH : NF_EUR.format(micros / 1_000_000))

/** Libellé court d'un écart ; `fmtAbs` formate l'écart absolu dans l'unité de la mesure. */
export function deltaLabel(d: Delta, fmtAbs: (n: number) => string): string | null {
  switch (d.kind) {
    case 'none': return null
    case 'new': return 'Nouveau'
    case 'abs': return `${d.diff > 0 ? '+' : '−'}${fmtAbs(Math.abs(d.diff))}`
    case 'pct': {
      const rounded = Math.round(d.pct)
      if (rounded === 0) return 'Stable'
      const capped = Math.abs(d.pct) >= MAX_PCT ? '>' : ''
      return `${rounded > 0 ? '+' : '−'}${capped}${NF_INT.format(Math.abs(rounded))} %`
    }
  }
}

/** Sens de l'écart pour la couleur : 'up' | 'down' | 'flat'. */
export function deltaDirection(d: Delta): 'up' | 'down' | 'flat' {
  if (d.kind === 'new') return 'up'
  if (d.kind === 'abs') return d.diff > 0 ? 'up' : 'down'
  if (d.kind === 'pct') return Math.round(d.pct) === 0 ? 'flat' : d.pct > 0 ? 'up' : 'down'
  return 'flat'
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const min = Math.floor((now.getTime() - t) / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.floor(h / 24)} j`
}

// ── Campagnes : agrégation, tri, filtre ──────────────────────────────────
export interface CampaignRow {
  id: string
  name: string
  impressions: number
  clicks: number
  costMicros: number
  conversions: number
  ctr: number | null
  costPerConv: number | null
  // Déduit de l'activité sur la période — la synchronisation ne récupère pas
  // le statut réel (campaign.status) de la campagne dans Google Ads.
  active: boolean
}

export function byCampaign(rows: AdsMetricRow[] | undefined): CampaignRow[] {
  const map = new Map<string, CampaignRow>()
  for (const r of rows ?? []) {
    const e = map.get(r.campaign_id) ?? {
      id: r.campaign_id, name: r.campaign_name || r.campaign_id,
      impressions: 0, clicks: 0, costMicros: 0, conversions: 0, ctr: null, costPerConv: null, active: false,
    }
    e.impressions += r.impressions; e.clicks += r.clicks; e.costMicros += r.cost_micros; e.conversions += r.conversions
    if (r.campaign_name) e.name = r.campaign_name
    map.set(r.campaign_id, e)
  }
  return Array.from(map.values()).map((c) => ({
    ...c,
    ctr: ctrPct(c.clicks, c.impressions),
    costPerConv: costPerConvMicros(c.costMicros, c.conversions),
    active: c.impressions > 0 || c.costMicros > 0,
  }))
}

export type SortKey = 'name' | 'status' | 'impressions' | 'clicks' | 'ctr' | 'costMicros' | 'conversions' | 'costPerConv'
export type SortDir = 'asc' | 'desc'
export type StatusFilter = 'all' | 'active' | 'inactive'

const SORT_VALUE: Record<Exclude<SortKey, 'name'>, (c: CampaignRow) => number | null> = {
  status: (c) => (c.active ? 1 : 0),
  impressions: (c) => c.impressions,
  clicks: (c) => c.clicks,
  ctr: (c) => c.ctr,
  costMicros: (c) => c.costMicros,
  conversions: (c) => c.conversions,
  costPerConv: (c) => c.costPerConv,
}

export function filterSortCampaigns(
  list: CampaignRow[],
  opts: { query: string; status: StatusFilter; sortKey: SortKey; sortDir: SortDir },
): CampaignRow[] {
  const q = opts.query.trim().toLowerCase()
  const filtered = list.filter((c) =>
    (!q || c.name.toLowerCase().includes(q)) &&
    (opts.status === 'all' || (opts.status === 'active' ? c.active : !c.active)))
  const dir = opts.sortDir === 'asc' ? 1 : -1
  return filtered.sort((a, b) => {
    if (opts.sortKey === 'name') return dir * a.name.localeCompare(b.name, 'fr')
    const va = SORT_VALUE[opts.sortKey](a)
    const vb = SORT_VALUE[opts.sortKey](b)
    if (va === null && vb === null) return a.name.localeCompare(b.name, 'fr')
    if (va === null) return 1 // valeurs indéfinies (—) toujours en dernier, quel que soit le sens
    if (vb === null) return -1
    return va === vb ? a.name.localeCompare(b.name, 'fr') : dir * (va - vb)
  })
}

// ── Messages d'erreur lisibles ───────────────────────────────────────────
const SYNC_REASON_MESSAGE: Record<string, string> = {
  not_connected: "Google Ads n'est pas connecté. Reconnectez le compte depuis Paramètres → Intégrations.",
  needs_reconnect: 'La connexion à Google a expiré. Reconnectez-vous depuis Paramètres → Intégrations.',
  no_customer_selected: "Aucun compte Google Ads n'est sélectionné. Choisissez-en un depuis Paramètres → Intégrations.",
  api_not_enabled: "L'API Google Ads n'est pas activée pour la plateforme. Contactez le support.",
  insufficient_permission: "Ce compte Google n'a pas les droits suffisants sur le compte Google Ads sélectionné.",
  google_error: "Google Ads n'a pas pu traiter la demande de synchronisation. Réessayez dans quelques instants ; si le problème persiste, contactez le support.",
}
const GENERIC_SYNC_ERROR = 'La synchronisation a échoué. Réessayez dans un instant.'

/** Message utilisateur + détail technique optionnel (admin) d'une erreur de synchronisation. */
export function describeSyncError(err: unknown): { message: string; detail: string | null } {
  const e = err as { reason?: unknown; detail?: unknown; message?: unknown } | null
  const reason = typeof e?.reason === 'string' ? e.reason : null
  const detail = typeof e?.detail === 'string' && e.detail ? e.detail : null
  if (reason && SYNC_REASON_MESSAGE[reason]) return { message: SYNC_REASON_MESSAGE[reason], detail }
  const raw = typeof e?.message === 'string' ? e.message : ''
  // Messages déjà rédigés en français par invokeGoogleFunction (session, HTTP).
  if (/^(Session expirée|Erreur serveur)/.test(raw)) return { message: raw, detail }
  return { message: GENERIC_SYNC_ERROR, detail: detail ?? (raw || null) }
}

/** Message lisible pour un échec de LECTURE des statistiques (jamais le texte brut de l'erreur). */
export const STATS_LOAD_ERROR = 'Impossible de charger les statistiques pour le moment. Réessayez dans un instant.'

// ── Refonte UI : libellés de période, séries journalières, tendances, KPI ──
// Dérivations d'AFFICHAGE uniquement, à partir des données déjà chargées.

const dayFmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o })
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** « 24 août – 21 sept. 2026 » (l'année n'est répétée que si elle change). */
export function formatPeriodLabel(from: string, to: string): string {
  const f = isoToDate(from); const t = isoToDate(to)
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return ''
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear()
  const short = dayFmt({ day: 'numeric', month: 'short' })
  const full = dayFmt({ day: 'numeric', month: 'short', year: 'numeric' })
  return `${sameYear ? short.format(f) : full.format(f)} – ${full.format(t)}`
}

/** « lun. 21 sept. » */
export function formatDayLong(iso: string): string {
  const d = isoToDate(iso)
  return Number.isNaN(d.getTime()) ? iso : dayFmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

export const fmtCompact = (n: number) => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** ····9574 — jamais l'identifiant complet à l'écran. */
export const maskCustomerId = (id: string | null | undefined): string | null => {
  const digits = (id ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `····${digits.slice(-4)}` : null
}

export interface DailyPoint { iso: string; label: string; impressions: number; clicks: number; cost: number; conversions: number }

/** Totaux par jour (toutes campagnes), triés par date. `cost` en euros. */
export function dailySeries(rows: AdsMetricRow[] | undefined): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>()
  for (const r of rows ?? []) {
    const e = byDate.get(r.date) ?? { iso: r.date, label: '', impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    e.impressions += r.impressions; e.clicks += r.clicks; e.cost += r.cost_micros / 1_000_000; e.conversions += r.conversions
    byDate.set(r.date, e)
  }
  const short = dayFmt({ day: '2-digit', month: '2-digit' })
  return Array.from(byDate.values())
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .map((p) => ({ ...p, label: short.format(isoToDate(p.iso)) }))
}

export interface InsightStats {
  days: number                     // jours pour lesquels on a des données
  activeDays: number               // jours avec au moins une impression
  avgCostMicros: number | null     // dépense moyenne par jour de données
  bestClicksDay: { iso: string; value: number } | null
  priciestDay: { iso: string; costMicros: number } | null
  conversionsValue: number         // valeur des conversions sur la période
}

export function insightStats(rows: AdsMetricRow[] | undefined): InsightStats {
  const daily = new Map<string, { clicks: number; cost: number; imp: number }>()
  let conversionsValue = 0
  for (const r of rows ?? []) {
    const e = daily.get(r.date) ?? { clicks: 0, cost: 0, imp: 0 }
    e.clicks += r.clicks; e.cost += r.cost_micros; e.imp += r.impressions
    daily.set(r.date, e)
    conversionsValue += Number(r.conversions_value) || 0
  }
  let best: InsightStats['bestClicksDay'] = null
  let priciest: InsightStats['priciestDay'] = null
  let totalCost = 0; let active = 0
  for (const [iso, d] of daily) {
    totalCost += d.cost
    if (d.imp > 0) active++
    if (d.clicks > 0 && (!best || d.clicks > best.value)) best = { iso, value: d.clicks }
    if (d.cost > 0 && (!priciest || d.cost > priciest.costMicros)) priciest = { iso, costMicros: d.cost }
  }
  return { days: daily.size, activeDays: active, avgCostMicros: daily.size ? totalCost / daily.size : null, bestClicksDay: best, priciestDay: priciest, conversionsValue }
}

export interface CampaignChange { id: string; name: string; clicks: number; prevClicks: number; delta: Delta }

/** Campagnes dont les clics ont le plus varié (en valeur absolue) vs la période précédente. */
export function campaignChanges(current: CampaignRow[], previous: CampaignRow[], limit = 4): CampaignChange[] {
  const prev = new Map(previous.map((c) => [c.id, c]))
  return current
    .map((c) => {
      const p = prev.get(c.id)?.clicks ?? 0
      return { id: c.id, name: c.name, clicks: c.clicks, prevClicks: p, delta: computeDelta(c.clicks, p, MIN_BASE.clicks) }
    })
    .filter((c) => c.delta.kind !== 'none')
    .sort((a, b) => Math.abs(b.clicks - b.prevClicks) - Math.abs(a.clicks - a.prevClicks) || a.name.localeCompare(b.name, 'fr'))
    .slice(0, limit)
}

/** Part de `part` dans `total`, en % (0 si total nul). */
export const sharePct = (part: number, total: number): number => (total > 0 ? Math.max(0, Math.min(100, (part / total) * 100)) : 0)

// ── KPI (données pures : l'icône est choisie par le composant via `key`) ──
export type KpiKey = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions' | 'costPerConv'
export interface KpiData {
  key: KpiKey
  label: string
  value: string
  delta: Delta
  fmtAbs: (n: number) => string
  /** Une hausse est-elle bonne, mauvaise, ou neutre (dépenses) ? */
  tone: 'goodUp' | 'goodDown' | 'neutral'
}

export function buildKpis(cur: Totals, prev: Totals, hasData: boolean, canCompare: boolean): KpiData[] {
  const show = (v: number | null): number | null => (hasData ? v : null)
  const d = (c: number | null, p: number | null, minBase: number): Delta => (canCompare ? computeDelta(c, p, minBase) : { kind: 'none' })
  const r = (c: number | null, p: number | null, cv: number, pv: number, minV: number): Delta => (canCompare ? ratioDelta(c, p, cv, pv, minV) : { kind: 'none' })
  const ctr = ctrPct(cur.clicks, cur.impressions); const ctrP = ctrPct(prev.clicks, prev.impressions)
  const cpc = cpcMicros(cur.costMicros, cur.clicks); const cpcP = cpcMicros(prev.costMicros, prev.clicks)
  const cpv = costPerConvMicros(cur.costMicros, cur.conversions); const cpvP = costPerConvMicros(prev.costMicros, prev.conversions)
  return [
    { key: 'spend', label: 'Dépenses', value: fmtEurMicros(show(cur.costMicros)), delta: d(cur.costMicros, prev.costMicros, MIN_BASE.costMicros), fmtAbs: fmtEurMicros, tone: 'neutral' },
    { key: 'impressions', label: 'Impressions', value: fmtInt(show(cur.impressions)), delta: d(cur.impressions, prev.impressions, MIN_BASE.impressions), fmtAbs: fmtInt, tone: 'goodUp' },
    { key: 'clicks', label: 'Clics', value: fmtInt(show(cur.clicks)), delta: d(cur.clicks, prev.clicks, MIN_BASE.clicks), fmtAbs: fmtInt, tone: 'goodUp' },
    { key: 'ctr', label: 'CTR', value: fmtPct(show(ctr)), delta: r(ctr, ctrP, cur.impressions, prev.impressions, MIN_VOLUME_FOR_RATIO.ctr), fmtAbs: fmtPct, tone: 'goodUp' },
    { key: 'cpc', label: 'CPC moyen', value: fmtEurMicros(show(cpc)), delta: r(cpc, cpcP, cur.clicks, prev.clicks, MIN_VOLUME_FOR_RATIO.cpc), fmtAbs: fmtEurMicros, tone: 'goodDown' },
    { key: 'conversions', label: 'Conversions', value: fmtConv(show(cur.conversions)), delta: d(cur.conversions, prev.conversions, MIN_BASE.conversions), fmtAbs: fmtConv, tone: 'goodUp' },
    { key: 'costPerConv', label: 'Coût / conversion', value: fmtEurMicros(show(cpv)), delta: r(cpv, cpvP, cur.conversions, prev.conversions, MIN_VOLUME_FOR_RATIO.costPerConv), fmtAbs: fmtEurMicros, tone: 'goodDown' },
  ]
}
