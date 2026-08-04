// src/pages/GoogleAdsPage.tsx — Phase 5
// Tableau de bord Google Ads : impressions, clics, dépenses, conversions,
// CPC, coût/conversion, taux de conversion, campagnes actives — période
// 7/30/90 jours ou personnalisée, comparaison avec la période précédente.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Eye, MousePointerClick, Euro, Target, RefreshCw, Loader2, AlertTriangle, ArrowLeft, TrendingUp, TrendingDown, ShieldAlert } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useGoogleOAuthStatus, useLoadGoogleAdsAccounts, type AdsAccountsErrorReason } from '@/lib/hooks/googleIntegrations'
import { useGoogleAdsMetrics, useSyncGoogleAdsMetrics, type AdsMetricRow } from '@/lib/hooks/googleStats'

// Message exact exigé lorsque la configuration serveur (côté plateforme,
// pas côté organisation) est incomplète — un admin d'organisation ne peut
// rien faire de plus que contacter l'éditeur, jamais lui laisser croire
// qu'un bouton "Synchroniser" pourrait résoudre le problème.
const ADS_NOT_CONFIGURED_MESSAGE = "Google Ads n'est pas encore configuré par l'administrateur de la plateforme."

// Raisons qui indiquent une configuration serveur manquante/rejetée par
// Google (par opposition à un problème de connexion ou de permission côté
// organisation) — c'est uniquement pour celles-ci que le message exact
// ADS_NOT_CONFIGURED_MESSAGE doit s'afficher.
const SERVER_CONFIG_REASONS: AdsAccountsErrorReason[] = ['developer_token_missing', 'developer_token_unapproved', 'api_not_enabled']

// Détail technique optionnel affiché sous le message exact, réservé aux
// administrateurs (page adminOnly) — n'apparaît jamais côté organisation
// dans un contexte non-admin.
const ADS_CONFIG_ERROR_DETAIL: Partial<Record<AdsAccountsErrorReason, string>> = {
  developer_token_missing: "Le secret GOOGLE_ADS_DEVELOPER_TOKEN doit être configuré côté Supabase.",
  developer_token_unapproved: "L'accès à l'API Google Ads n'est pas encore approuvé par Google pour ce compte développeur.",
  api_not_enabled: "L'API Google Ads n'est pas activée pour ce compte Google.",
}

const PERIODS = [
  { key: '7', label: '7 jours', days: 7 },
  { key: '30', label: '30 jours', days: 30 },
  { key: '90', label: '90 jours', days: 90 },
] as const

function isoDaysAgo(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10) }
function todayIso() { return new Date().toISOString().slice(0, 10) }
const eur = (micros: number) => (micros / 1_000_000).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

function TrendBadge({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return null
  const pct = ((current - previous) / previous) * 100
  const good = inverse ? pct <= 0 : pct >= 0
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: good ? 'var(--gnTx)' : 'var(--rdTx)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {pct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function aggregate(rows: AdsMetricRow[] | undefined) {
  const r = { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
  for (const row of rows ?? []) {
    r.impressions += row.impressions; r.clicks += row.clicks
    r.costMicros += row.cost_micros; r.conversions += row.conversions
  }
  return r
}

export default function GoogleAdsPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: status, isLoading: statusLoading } = useGoogleOAuthStatus()
  const [periodKey, setPeriodKey] = useState<typeof PERIODS[number]['key']>('30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const period = PERIODS.find((p) => p.key === periodKey)!
  const fromDate = useCustom && customFrom ? customFrom : isoDaysAgo(period.days)
  const toDate = useCustom && customTo ? customTo : todayIso()
  const prevDays = Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) || period.days
  const prevFrom = isoDaysAgo(prevDays * 2)
  const prevTo = isoDaysAgo(prevDays)

  const { data: rows, isLoading, isError, error } = useGoogleAdsMetrics(fromDate, toDate)
  const { data: prevRows } = useGoogleAdsMetrics(prevFrom, prevTo)
  const syncMut = useSyncGoogleAdsMetrics()

  const ads = status?.google_ads
  const isConnected = ads?.status === 'connected'
  const hasCustomer = !!ads?.google_customer_id

  // Sondage unique (pas de sync/écriture) pour détecter une configuration
  // serveur incomplète (ex. GOOGLE_ADS_DEVELOPER_TOKEN absent) — sans ceci,
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

  const totals = aggregate(rows)
  const prevTotals = aggregate(prevRows)
  const cpc = totals.clicks ? totals.costMicros / totals.clicks : 0
  const cpcPrev = prevTotals.clicks ? prevTotals.costMicros / prevTotals.clicks : 0
  const costPerConv = totals.conversions ? totals.costMicros / totals.conversions : 0
  const costPerConvPrev = prevTotals.conversions ? prevTotals.costMicros / prevTotals.conversions : 0
  const convRate = totals.clicks ? (totals.conversions / totals.clicks) * 100 : 0
  const convRatePrev = prevTotals.clicks ? (prevTotals.conversions / prevTotals.clicks) * 100 : 0

  const byCampaign = useMemo(() => {
    const map = new Map<string, { name: string; impressions: number; clicks: number; costMicros: number; conversions: number }>()
    for (const r of rows ?? []) {
      const entry = map.get(r.campaign_id) ?? { name: r.campaign_name || r.campaign_id, impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
      entry.impressions += r.impressions; entry.clicks += r.clicks; entry.costMicros += r.cost_micros; entry.conversions += r.conversions
      map.set(r.campaign_id, entry)
    }
    return Array.from(map.values()).sort((a, b) => b.costMicros - a.costMicros)
  }, [rows])

  const chartData = useMemo(() => {
    const byDate = new Map<string, { impressions: number; clicks: number; costMicros: number }>()
    for (const r of rows ?? []) {
      const e = byDate.get(r.date) ?? { impressions: 0, clicks: 0, costMicros: 0 }
      e.impressions += r.impressions; e.clicks += r.clicks; e.costMicros += r.cost_micros
      byDate.set(r.date, e)
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), Clics: v.clicks, Impressions: v.impressions }))
  }, [rows])

  async function handleSync() {
    try {
      const res = await syncMut.mutateAsync()
      add(`Synchronisé — ${res.rowsUpserted} ligne(s)`)
    } catch (e: any) { add(e.message, 'error') }
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
          <button className="btn-primary" disabled={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Synchroniser maintenant
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Google Ads</h1>
        <div className="page-actions">
          <button className="btn-secondary btn-sm" disabled={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Synchroniser
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 12 }}>
        Dernière synchronisation réussie : {lastSyncedLabel ?? '—'}
      </div>

      {hasSyncError && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: 'var(--rdTx)', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>La dernière tentative de synchronisation a échoué : {ads?.last_error}. Les données affichées ci-dessous datent de la dernière synchronisation réussie.</span>
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.map((p) => (
          <button key={p.key} className={periodKey === p.key && !useCustom ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => { setPeriodKey(p.key); setUseCustom(false) }}>{p.label}</button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>ou</span>
        <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setUseCustom(true) }} />
        <span style={{ fontSize: 12 }}>→</span>
        <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setUseCustom(true) }} />
      </div>

      {isError && <div className="card" style={{ padding: 16, color: 'var(--rdTx)', marginBottom: 16 }}>{(error as Error)?.message}</div>}

      <div className="grid-4" style={{ marginBottom: 12 }}>
        <div className="stat-card">
          <div className="stat-icon blue"><Eye size={18} /></div>
          <div className="stat-value">{totals.impressions.toLocaleString('fr-FR')}</div>
          <div className="stat-label">Impressions <TrendBadge current={totals.impressions} previous={prevTotals.impressions} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><MousePointerClick size={18} /></div>
          <div className="stat-value">{totals.clicks.toLocaleString('fr-FR')}</div>
          <div className="stat-label">Clics <TrendBadge current={totals.clicks} previous={prevTotals.clicks} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><Euro size={18} /></div>
          <div className="stat-value">{eur(totals.costMicros)}</div>
          <div className="stat-label">Dépenses <TrendBadge current={totals.costMicros} previous={prevTotals.costMicros} inverse /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><Target size={18} /></div>
          <div className="stat-value">{totals.conversions.toFixed(1)}</div>
          <div className="stat-label">Conversions <TrendBadge current={totals.conversions} previous={prevTotals.conversions} /></div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-value">{eur(cpc)}</div>
          <div className="stat-label">Coût par clic <TrendBadge current={cpc} previous={cpcPrev} inverse /></div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{eur(costPerConv)}</div>
          <div className="stat-label">Coût par conversion <TrendBadge current={costPerConv} previous={costPerConvPrev} inverse /></div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{convRate.toFixed(1)}%</div>
          <div className="stat-label">Taux de conversion <TrendBadge current={convRate} previous={convRatePrev} /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Évolution</div>
        {isLoading ? <Loader2 className="spin" /> : chartData.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune donnée pour cette période — synchronisez pour récupérer les métriques.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="Impressions" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Clics" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Campagnes</div>
        {byCampaign.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune campagne sur cette période.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--t2)', borderBottom: '1px solid var(--bd)' }}>
                  <th style={{ padding: '6px 8px' }}>Campagne</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Impressions</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Clics</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Dépenses</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Conversions</th>
                </tr>
              </thead>
              <tbody>
                {byCampaign.map((c) => (
                  <tr key={c.name} style={{ borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '8px' }}>{c.name}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{c.impressions.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{c.clicks.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{eur(c.costMicros)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{c.conversions.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
