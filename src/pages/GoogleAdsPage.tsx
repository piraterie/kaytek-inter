// src/pages/GoogleAdsPage.tsx — Phase 5
// Tableau de bord Google Ads : impressions, clics, CTR, dépenses, CPC moyen,
// conversions, coût/conversion — période 7/30/90 jours ou personnalisée,
// comparaison avec la période précédente, tableau de campagnes triable/filtrable.
// Affichage uniquement : aucune requête API ni logique de synchronisation n'est
// modifiée ici (voir src/lib/googleAdsMetrics.ts pour les calculs purs).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  Eye, MousePointerClick, Euro, Target, RefreshCw, Loader2, AlertTriangle, ArrowLeft, TrendingUp, TrendingDown,
  ShieldAlert, Percent, Coins, Calculator, Clock, Search, ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useGoogleOAuthStatus, useLoadGoogleAdsAccounts, type AdsAccountsErrorReason } from '@/lib/hooks/googleIntegrations'
import { useGoogleAdsMetrics, useSyncGoogleAdsMetrics } from '@/lib/hooks/googleStats'
import {
  aggregate, byCampaign, computeDelta, ratioDelta, previousPeriod, isoDaysAgo, todayIso,
  ctrPct, cpcMicros, costPerConvMicros, filterSortCampaigns, describeSyncError, formatRelative,
  deltaLabel, deltaDirection, fmtInt, fmtConv, fmtPct, fmtEurMicros, MIN_BASE, MIN_VOLUME_FOR_RATIO, STATS_LOAD_ERROR,
  type Delta, type SortKey, type SortDir, type StatusFilter, type CampaignRow, type Totals,
} from '@/lib/googleAdsMetrics'

// Message exact exigé lorsque la configuration serveur (côté plateforme,
// pas côté organisation) est incomplète — un admin d'organisation ne peut
// rien faire de plus que contacter l'éditeur, jamais lui laisser croire
// qu'un bouton "Synchroniser" pourrait résoudre le problème.
const ADS_NOT_CONFIGURED_MESSAGE = "Google Ads n'est pas encore configuré par l'administrateur de la plateforme."

// Raisons qui indiquent une configuration serveur manquante/rejetée par
// Google (par opposition à un problème de connexion ou de permission côté
// organisation) — c'est uniquement pour celles-ci que le message exact
// ADS_NOT_CONFIGURED_MESSAGE doit s'afficher.
// Le Developer Token n'est plus requis (supprimé par Google le 2026-09-09) :
// il n'y a donc plus de raison "developer_token_missing".
const SERVER_CONFIG_REASONS: AdsAccountsErrorReason[] = ['developer_token_unapproved', 'api_not_enabled']

// Détail technique optionnel affiché sous le message exact, réservé aux
// administrateurs (page adminOnly) — n'apparaît jamais côté organisation
// dans un contexte non-admin.
const ADS_CONFIG_ERROR_DETAIL: Partial<Record<AdsAccountsErrorReason, string>> = {
  developer_token_unapproved: "L'accès à l'API Google Ads n'est pas approuvé par Google pour le projet Google Cloud de la plateforme.",
  api_not_enabled: "L'API Google Ads n'est pas activée dans le projet Google Cloud de la plateforme.",
}

const PERIODS = [
  { key: '7', label: '7 jours', days: 7 },
  { key: '30', label: '30 jours', days: 30 },
  { key: '90', label: '90 jours', days: 90 },
] as const

const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'costMicros', label: 'Dépenses', defaultDir: 'desc' },
  { key: 'impressions', label: 'Impressions', defaultDir: 'desc' },
  { key: 'clicks', label: 'Clics', defaultDir: 'desc' },
  { key: 'ctr', label: 'CTR', defaultDir: 'desc' },
  { key: 'conversions', label: 'Conversions', defaultDir: 'desc' },
  { key: 'costPerConv', label: 'Coût/conv.', defaultDir: 'asc' },
  { key: 'name', label: 'Nom', defaultDir: 'asc' },
  { key: 'status', label: 'Statut', defaultDir: 'desc' },
]
const defaultDirFor = (key: SortKey): SortDir => SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'desc'

// Mise en page responsive locale à la page (le design global — cartes, pastilles,
// couleurs — reste celui de globals.css). Mobile : KPI sur 2 colonnes, campagnes
// en cartes empilées au lieu d'un tableau à défilement horizontal.
// Les points de rupture suivent la LARGEUR UTILE (requêtes de conteneur), pas
// celle de l'écran : le menu latéral occupe 280 px dès 768 px, ce qui laisse
// ~470 px au contenu sur tablette — bien moins que ce qu'un @media laisse croire.
const PAGE_CSS = `
.gads-kpis-wrap,.gads-camp{container-type:inline-size}
.gads-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:16px}
.gads-kpis .stat-value{font-size:24px}
@container (min-width:560px){.gads-kpis{gap:12px}}
@container (min-width:880px){.gads-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
@container (max-width:879px){.gads-kpis>:last-child:nth-child(odd){grid-column:1/-1}}
@media(max-width:640px){.gads-kpis .stat-value{font-size:19px!important}}

@media(pointer:coarse){.gads .btn-sm{min-height:40px}}
.gads-sync{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:flex-start;font-size:12px;color:var(--t2);margin-bottom:12px}
.gads-sync-main{display:flex;gap:6px;align-items:flex-start;min-width:0}
.gads-sync-main svg{flex-shrink:0;margin-top:2px}

.gads-period{padding:14px;margin-bottom:12px;display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center}
.gads-presets{display:flex;gap:8px;flex-wrap:wrap}
.gads-range{display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1 1 300px;min-width:0}
.gads-range label{display:flex;align-items:center;gap:6px;flex:1 1 150px;min-width:0;font-size:12px;color:var(--t3)}
.gads-range input{flex:1 1 auto;width:auto;min-width:0}

.gads-table{display:block;overflow-x:auto}
.gads-table td,.gads-table th{font-variant-numeric:tabular-nums}
.gads-cards{display:none}
.gads-card{border:1px solid var(--bd);background:var(--s1);border-radius:12px;padding:12px}
.gads-sortsel{display:none}
.gads-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.gads-search{position:relative;flex:1 1 220px;max-width:380px;min-width:0}
.gads-search input{width:100%;padding-left:32px}
.gads-filters select{width:auto;flex:0 1 auto;min-width:150px}
.gads-th-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:3px;font-weight:600;white-space:nowrap;padding:8px 2px;min-height:20px}
.gads-th-btn:focus-visible{outline:2px solid var(--bl);outline-offset:2px;border-radius:4px}
@container (max-width:799px){
  .gads-table{display:none}
  .gads-cards{display:flex;flex-direction:column;gap:8px}
  .gads-sortsel{display:block}
}
@container (max-width:519px){
  .gads-search{flex-basis:100%;max-width:none}
  .gads-filters select{flex:1 1 calc(50% - 4px);min-width:0}
}
`

function DeltaBadge({ delta, fmtAbs, tone }: { delta: Delta; fmtAbs: (n: number) => string; tone: 'goodUp' | 'goodDown' | 'neutral' }) {
  const label = deltaLabel(delta, fmtAbs)
  if (!label) return null
  const dir = deltaDirection(delta)
  const good = tone === 'neutral' || dir === 'flat' ? null : (tone === 'goodUp') === (dir === 'up')
  const color = good === null ? 'var(--t3)' : good ? 'var(--gnTx)' : 'var(--rdTx)'
  const title = delta.kind === 'abs'
    ? 'Période précédente trop faible pour un pourcentage fiable — écart en valeur absolue'
    : delta.kind === 'new' ? 'Aucune activité sur la période précédente' : 'Évolution par rapport à la période précédente'
  return (
    <span title={title} style={{ fontSize: 11, fontWeight: 600, color, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
      {dir === 'up' ? <TrendingUp size={11} /> : dir === 'down' ? <TrendingDown size={11} /> : null} {label}
    </span>
  )
}

interface Kpi {
  key: string
  label: string
  icon: ReactNode
  tone: 'blue' | 'green' | 'amber'
  value: string
  delta: Delta
  fmtAbs: (n: number) => string
  deltaTone: 'goodUp' | 'goodDown' | 'neutral'
}

function StatusPill({ active }: { active: boolean }) {
  return active
    ? <span className="pill pill-green">Active</span>
    : <span className="pill" style={{ background: 'transparent', border: '1px solid var(--bd)', color: 'var(--t2)' }}>Sans activité</span>
}

export default function GoogleAdsPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: status, isLoading: statusLoading } = useGoogleOAuthStatus()
  const [periodKey, setPeriodKey] = useState<typeof PERIODS[number]['key']>('30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [syncError, setSyncError] = useState<{ message: string; detail: string | null } | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('costMicros')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const period = PERIODS.find((p) => p.key === periodKey)!
  // Période de N jours = N jours calendaires inclusifs (aujourd'hui compris).
  const presetFrom = isoDaysAgo(period.days - 1)
  const presetTo = todayIso()
  const customValid = useCustom && !!customFrom && !!customTo && customFrom <= customTo
  const customInvalid = useCustom && !!customFrom && !!customTo && customFrom > customTo
  const fromDate = customValid ? customFrom : presetFrom
  const toDate = customValid ? customTo : presetTo
  // Période précédente de même durée, sans chevauchement — juste avant fromDate.
  const prev = previousPeriod(fromDate, toDate)

  const { data: rows, isLoading, isError, refetch } = useGoogleAdsMetrics(fromDate, toDate)
  const { data: prevRows } = useGoogleAdsMetrics(prev?.from ?? fromDate, prev?.to ?? toDate)
  const syncMut = useSyncGoogleAdsMetrics()

  const ads = status?.google_ads
  const isConnected = ads?.status === 'connected'
  const hasCustomer = !!ads?.google_customer_id

  // Sondage unique (pas de sync/écriture) pour détecter une configuration
  // serveur incomplète (ex. API Google Ads non activée dans le projet Cloud) — sans ceci,
  // un admin arrivant directement sur ce tableau de bord (connecté mais
  // sans compte sélectionnable) ne verrait qu'un état vide générique,
  // jamais la cause réelle. Réservé aux administrateurs (page adminOnly),
  // ne révèle aucun secret — uniquement une raison catégorisée.
  const probeAccounts = useLoadGoogleAdsAccounts()
  useEffect(() => {
    if (isConnected && !hasCustomer) probeAccounts.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, hasCustomer])
  const probeResult = probeAccounts.data
  let configErrorReason: AdsAccountsErrorReason | null = null
  if (probeResult && probeResult.ok === false) configErrorReason = probeResult.reason
  const isServerConfigMissing = configErrorReason ? SERVER_CONFIG_REASONS.includes(configErrorReason) : false
  const configErrorDetail = configErrorReason ? ADS_CONFIG_ERROR_DETAIL[configErrorReason] : null
  const neverSynced = isConnected && hasCustomer && !ads?.last_synced_at
  const hasSyncError = isConnected && hasCustomer && !!ads?.last_error
  const lastSyncedLabel = ads?.last_synced_at
    ? new Date(ads.last_synced_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null
  const lastSyncedRelative = formatRelative(ads?.last_synced_at)
  const syncIsStale = !!ads?.last_synced_at && Date.now() - new Date(ads.last_synced_at).getTime() > 24 * 3_600_000

  // ── Données affichées ──────────────────────────────────────────────────
  const hasData = (rows?.length ?? 0) > 0
  // Sans donnée sur la période précédente (ex. au-delà de l'historique
  // synchronisé), aucune comparaison : un « 0 » implicite ferait afficher
  // un faux « Nouveau » / une hausse infinie.
  const canCompare = hasData && (prevRows?.length ?? 0) > 0 && !!prev
  const totals = useMemo(() => aggregate(rows), [rows])
  const prevTotals = useMemo(() => aggregate(prevRows), [prevRows])

  const kpis: Kpi[] = useMemo(() => {
    const show = <T,>(v: T | null): T | null => (hasData ? v : null)
    const cur: Totals = totals
    const p: Totals = prevTotals
    const d = (c: number | null, pv: number | null, minBase: number): Delta => (canCompare ? computeDelta(c, pv, minBase) : { kind: 'none' })
    const r = (c: number | null, pv: number | null, cv: number, pvv: number, minV: number): Delta => (canCompare ? ratioDelta(c, pv, cv, pvv, minV) : { kind: 'none' })
    const ctr = ctrPct(cur.clicks, cur.impressions); const ctrP = ctrPct(p.clicks, p.impressions)
    const cpc = cpcMicros(cur.costMicros, cur.clicks); const cpcP = cpcMicros(p.costMicros, p.clicks)
    const cpv = costPerConvMicros(cur.costMicros, cur.conversions); const cpvP = costPerConvMicros(p.costMicros, p.conversions)
    return [
      { key: 'impressions', label: 'Impressions', icon: <Eye size={18} />, tone: 'blue', value: fmtInt(show(cur.impressions)),
        delta: d(cur.impressions, p.impressions, MIN_BASE.impressions), fmtAbs: fmtInt, deltaTone: 'goodUp' },
      { key: 'clicks', label: 'Clics', icon: <MousePointerClick size={18} />, tone: 'green', value: fmtInt(show(cur.clicks)),
        delta: d(cur.clicks, p.clicks, MIN_BASE.clicks), fmtAbs: fmtInt, deltaTone: 'goodUp' },
      { key: 'ctr', label: 'CTR', icon: <Percent size={18} />, tone: 'blue', value: fmtPct(show(ctr)),
        delta: r(ctr, ctrP, cur.impressions, p.impressions, MIN_VOLUME_FOR_RATIO.ctr), fmtAbs: fmtPct, deltaTone: 'goodUp' },
      // Une hausse des dépenses n'est ni bonne ni mauvaise en soi : neutre.
      { key: 'spend', label: 'Dépenses', icon: <Euro size={18} />, tone: 'amber', value: fmtEurMicros(show(cur.costMicros)),
        delta: d(cur.costMicros, p.costMicros, MIN_BASE.costMicros), fmtAbs: fmtEurMicros, deltaTone: 'neutral' },
      { key: 'cpc', label: 'CPC moyen', icon: <Coins size={18} />, tone: 'amber', value: fmtEurMicros(show(cpc)),
        delta: r(cpc, cpcP, cur.clicks, p.clicks, MIN_VOLUME_FOR_RATIO.cpc), fmtAbs: fmtEurMicros, deltaTone: 'goodDown' },
      { key: 'conversions', label: 'Conversions', icon: <Target size={18} />, tone: 'green', value: fmtConv(show(cur.conversions)),
        delta: d(cur.conversions, p.conversions, MIN_BASE.conversions), fmtAbs: fmtConv, deltaTone: 'goodUp' },
      { key: 'costPerConv', label: 'Coût / conversion', icon: <Calculator size={18} />, tone: 'blue', value: fmtEurMicros(show(cpv)),
        delta: r(cpv, cpvP, cur.conversions, p.conversions, MIN_VOLUME_FOR_RATIO.costPerConv), fmtAbs: fmtEurMicros, deltaTone: 'goodDown' },
    ]
  }, [totals, prevTotals, hasData, canCompare])

  const campaigns = useMemo(() => byCampaign(rows), [rows])
  const visibleCampaigns = useMemo(
    () => filterSortCampaigns(campaigns, { query, status: statusFilter, sortKey, sortDir }),
    [campaigns, query, statusFilter, sortKey, sortDir],
  )
  const visibleTotals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
    for (const c of visibleCampaigns) { t.impressions += c.impressions; t.clicks += c.clicks; t.costMicros += c.costMicros; t.conversions += c.conversions }
    return { ...t, ctr: ctrPct(t.clicks, t.impressions), costPerConv: costPerConvMicros(t.costMicros, t.conversions) }
  }, [visibleCampaigns])
  const filtersActive = query.trim() !== '' || statusFilter !== 'all'

  const latestDataDate = useMemo(() => {
    let max = ''
    for (const r of rows ?? []) if (r.date > max) max = r.date
    return max ? new Date(`${max}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
  }, [rows])

  const chartData = useMemo(() => {
    const byDate = new Map<string, { impressions: number; clicks: number }>()
    for (const r of rows ?? []) {
      const e = byDate.get(r.date) ?? { impressions: 0, clicks: 0 }
      e.impressions += r.impressions; e.clicks += r.clicks
      byDate.set(r.date, e)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), Clics: v.clicks, Impressions: v.impressions }))
  }, [rows])

  const fmtRange = (from: string, to: string) => {
    const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    return `${f(from)} → ${f(to)}`
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(defaultDirFor(key)) }
  }

  async function handleSync() {
    setSyncError(null)
    try {
      const res = await syncMut.mutateAsync()
      add(`Synchronisation terminée — ${res.rowsUpserted} ligne(s) mise(s) à jour`)
    } catch (e) {
      const described = describeSyncError(e)
      setSyncError(described)
      add(described.message, 'error')
    }
  }

  if (statusLoading) return <div><Loader2 className="spin" /></div>

  // Configuration serveur manquante/rejetée par Google : état bloquant
  // prioritaire sur tout le reste — un admin d'organisation ne peut rien
  // faire d'autre qu'attendre que la plateforme configure le secret.
  if (isConnected && !hasCustomer && isServerConfigMissing) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Retour aux intégrations</button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <ShieldAlert size={28} color="var(--rdTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{ADS_NOT_CONFIGURED_MESSAGE}</div>
          {configErrorDetail && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>{configErrorDetail}</div>
          )}
        </div>
      </div>
    )
  }

  if (!isConnected || !hasCustomer) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Retour aux intégrations</button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {!isConnected ? 'Google Ads non connecté' : 'Aucun compte Ads sélectionné'}
          </div>
          <button className="btn-primary" onClick={() => nav('/parametres/integrations')} style={{ marginTop: 8 }}>Configurer</button>
        </div>
      </div>
    )
  }

  // Compte sélectionné mais jamais synchronisé : jamais de tableau/graphique
  // rempli de zéros laissant croire qu'une synchronisation réelle a eu
  // lieu — état bloquant dédié tant qu'aucune synchronisation n'a réussi.
  if (neverSynced) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Retour aux intégrations</button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Aucune synchronisation n'a encore été effectuée</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            Ce compte Google Ads est sélectionné mais aucune donnée n'a encore été récupérée. Lancez une première synchronisation pour afficher le tableau de bord.
          </div>
          {hasSyncError && (
            <div style={{ fontSize: 12, color: 'var(--rdTx)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              Dernière tentative en erreur : {ads?.last_error}
            </div>
          )}
          {syncError && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--rdTx)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>{syncError.message}</div>
          )}
          <button className="btn-primary" disabled={syncMut.isPending} aria-busy={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {syncMut.isPending ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </button>
        </div>
      </div>
    )
  }

  const sortIcon = (key: SortKey) => key !== sortKey
    ? <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
    : sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => (key !== sortKey ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending')
  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th aria-sort={ariaSort(key)} style={{ padding: '6px 8px', textAlign: align, fontWeight: 600 }}>
      <button type="button" className="gads-th-btn" onClick={() => toggleSort(key)} style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {label} {sortIcon(key)}
      </button>
    </th>
  )
  const cell = { padding: '8px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }

  return (
    <div className="gads">
      <style>{PAGE_CSS}</style>

      <div className="page-header">
        <h1 className="page-title">Google Ads</h1>
        <div className="page-actions">
          <button className="btn-primary btn-sm" disabled={syncMut.isPending} aria-busy={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {syncMut.isPending ? 'Synchronisation…' : 'Synchroniser'}
          </button>
        </div>
      </div>

      <div className="gads-sync">
        <div className="gads-sync-main">
          <Clock size={13} />
          <span>
            Dernière synchronisation réussie : <strong style={{ color: 'var(--t1)' }}>{lastSyncedLabel ?? '—'}</strong>
            {lastSyncedRelative && <span style={{ whiteSpace: 'nowrap' }}> ({lastSyncedRelative})</span>}
          </span>
        </div>
        {syncIsStale && <span style={{ color: 'var(--amTx)', fontWeight: 600 }}>Pensez à synchroniser pour des chiffres à jour</span>}
        {latestDataDate && <span style={{ color: 'var(--t3)' }}>Données jusqu'au {latestDataDate}</span>}
      </div>

      {syncError && (
        <div role="alert" className="card" style={{ padding: 12, marginBottom: 16, color: 'var(--rdTx)', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 600 }}>La synchronisation a échoué</div>
            <div>{syncError.message}</div>
            <div style={{ color: 'var(--t2)', marginTop: 2 }}>Les données affichées ci-dessous datent de la dernière synchronisation réussie.</div>
            {syncError.detail && (
              <details style={{ marginTop: 4, color: 'var(--t3)', fontSize: 11.5 }}>
                <summary style={{ cursor: 'pointer' }}>Détail technique</summary>
                <div style={{ wordBreak: 'break-word', marginTop: 2 }}>{syncError.detail}</div>
              </details>
            )}
          </div>
        </div>
      )}

      {!syncError && hasSyncError && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: 'var(--rdTx)', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>La dernière tentative de synchronisation a échoué : {ads?.last_error}. Les données affichées ci-dessous datent de la dernière synchronisation réussie.</span>
        </div>
      )}

      <div className="card gads-period">
        <div className="gads-presets">
          {PERIODS.map((p) => (
            <button key={p.key} className={periodKey === p.key && !useCustom ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => { setPeriodKey(p.key); setUseCustom(false) }}>{p.label}</button>
          ))}
        </div>
        <div className="gads-range">
          <label>Du <input type="date" aria-label="Date de début" value={customFrom} max={customTo || undefined} onChange={(e) => { setCustomFrom(e.target.value); setUseCustom(true) }} /></label>
          <label>au <input type="date" aria-label="Date de fin" value={customTo} min={customFrom || undefined} onChange={(e) => { setCustomTo(e.target.value); setUseCustom(true) }} /></label>
        </div>
      </div>

      {customInvalid && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--amTx)', marginBottom: 12 }}>
          La date de début doit précéder la date de fin — la période prédéfinie « {period.label} » est affichée en attendant.
        </div>
      )}

      {isError && (
        <div role="alert" className="card" style={{ padding: 14, color: 'var(--rdTx)', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>{STATS_LOAD_ERROR}</span>
          {typeof refetch === 'function' && <button className="btn-secondary btn-sm" onClick={() => refetch()}>Réessayer</button>}
        </div>
      )}

      {!isLoading && !isError && !hasData && (
        <div className="card" style={{ padding: 14, marginBottom: 16, fontSize: 13, color: 'var(--t2)' }}>
          Aucune donnée synchronisée pour la période du {fmtRange(fromDate, toDate)}. Cliquez sur « Synchroniser » pour récupérer les métriques, ou choisissez une autre période.
        </div>
      )}

      {hasData && (
        <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 8 }}>
          {canCompare && prev
            ? `Comparaison avec la période précédente (${fmtRange(prev.from, prev.to)}).`
            : "Comparaison indisponible : aucune donnée sur la période précédente (la synchronisation récupère les 30 derniers jours)."}
        </div>
      )}

      <div className="gads-kpis-wrap">
        <div className="gads-kpis">
          {kpis.map((k) => (
            <div key={k.key} className="stat-card">
              <div className={`stat-icon ${k.tone}`}>{k.icon}</div>
              <div className="stat-value">{isLoading ? '…' : k.value}</div>
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {k.label} <DeltaBadge delta={k.delta} fmtAbs={k.fmtAbs} tone={k.deltaTone} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Évolution</div>
        {isLoading ? <Loader2 className="spin" /> : chartData.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune donnée pour cette période — synchronisez pour récupérer les métriques.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={16} />
              {/* Deux axes : les impressions (milliers) écraseraient les clics (dizaines) sur une échelle commune. */}
              {/* Couleur des graduations = couleur de la courbe qu'elles mesurent. */}
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#2563eb' }} stroke="#2563eb" allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#16a34a' }} stroke="#16a34a" allowDecimals={false} />
              <Tooltip formatter={(v: number) => fmtInt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="Impressions" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="Clics" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card gads-camp" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Campagnes</div>

        {campaigns.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune campagne sur cette période.</div>
        ) : (
          <>
            <div className="gads-filters">
              <div className="gads-search">
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)', pointerEvents: 'none' }} />
                <input type="search" aria-label="Rechercher une campagne" placeholder="Rechercher une campagne" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select aria-label="Filtrer par statut" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">Tous les statuts</option>
                <option value="active">Actives</option>
                <option value="inactive">Sans activité</option>
              </select>
              <select className="gads-sortsel" aria-label="Trier les campagnes" value={sortKey} onChange={(e) => { const k = e.target.value as SortKey; setSortKey(k); setSortDir(defaultDirFor(k)) }}>
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Trier : {o.label}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>
                {visibleCampaigns.length} sur {campaigns.length} campagne{campaigns.length > 1 ? 's' : ''}
              </span>
              {filtersActive && (
                <button className="btn-secondary btn-sm" onClick={() => { setQuery(''); setStatusFilter('all') }}>Réinitialiser</button>
              )}
            </div>

            {visibleCampaigns.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune campagne ne correspond à ces filtres.</div>
            ) : (
              <>
                <div className="gads-table">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: 'var(--t2)', borderBottom: '1px solid var(--bd)' }}>
                        {th('name', 'Campagne', 'left')}
                        {th('status', 'Statut', 'left')}
                        {th('impressions', 'Impressions')}
                        {th('clicks', 'Clics')}
                        {th('ctr', 'CTR')}
                        {th('costMicros', 'Dépenses')}
                        {th('conversions', 'Conversions')}
                        {th('costPerConv', 'Coût/conv.')}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCampaigns.map((c: CampaignRow) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--bd)' }}>
                          {/* Nom complet, à la ligne si besoin — jamais tronqué. */}
                          <td style={{ padding: '8px', minWidth: 160, maxWidth: 340, wordBreak: 'break-word' }}>{c.name}</td>
                          <td style={{ padding: '8px' }}><StatusPill active={c.active} /></td>
                          <td style={cell}>{fmtInt(c.impressions)}</td>
                          <td style={cell}>{fmtInt(c.clicks)}</td>
                          <td style={cell}>{fmtPct(c.ctr)}</td>
                          <td style={cell}>{fmtEurMicros(c.costMicros)}</td>
                          <td style={cell}>{fmtConv(c.conversions)}</td>
                          <td style={cell}>{fmtEurMicros(c.costPerConv)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700 }}>
                        <td style={{ padding: '8px' }} colSpan={2}>{filtersActive ? 'Total affiché' : 'Total'}</td>
                        <td style={cell}>{fmtInt(visibleTotals.impressions)}</td>
                        <td style={cell}>{fmtInt(visibleTotals.clicks)}</td>
                        <td style={cell}>{fmtPct(visibleTotals.ctr)}</td>
                        <td style={cell}>{fmtEurMicros(visibleTotals.costMicros)}</td>
                        <td style={cell}>{fmtConv(visibleTotals.conversions)}</td>
                        <td style={cell}>{fmtEurMicros(visibleTotals.costPerConv)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="gads-cards">
                  {visibleCampaigns.map((c: CampaignRow) => (
                    <div key={c.id} className="gads-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, wordBreak: 'break-word' }}>{c.name}</div>
                        <StatusPill active={c.active} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px 10px', fontSize: 12 }}>
                        {([
                          ['Impressions', fmtInt(c.impressions)], ['Clics', fmtInt(c.clicks)], ['CTR', fmtPct(c.ctr)],
                          ['Dépenses', fmtEurMicros(c.costMicros)], ['Conversions', fmtConv(c.conversions)], ['Coût/conv.', fmtEurMicros(c.costPerConv)],
                        ] as const).map(([label, value]) => (
                          <div key={label}>
                            <div style={{ color: 'var(--t3)', fontSize: 11 }}>{label}</div>
                            <div style={{ fontWeight: 600 }}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 10 }}>
              Statut déduit de l'activité sur la période (impressions ou dépenses), et non du statut de la campagne dans Google Ads.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
