// src/pages/GooglePerformancePage.tsx — Phase 4
// Statistiques Google Business Profile Performance API : appels, clics
// site, demandes d'itinéraire, impressions Maps/Search — période
// 7/30/90 jours ou personnalisée, comparaison avec la période précédente.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Phone, Globe, Navigation, Eye, RefreshCw, Loader2, TrendingUp, TrendingDown, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useGoogleOAuthStatus } from '@/lib/hooks/googleIntegrations'
import { useGbpPerformanceMetrics, useSyncGbpPerformance } from '@/lib/hooks/googleStats'

const PERIODS = [
  { key: '7', label: '7 jours', days: 7 },
  { key: '30', label: '30 jours', days: 30 },
  { key: '90', label: '90 jours', days: 90 },
] as const

function isoDaysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
  const pct = ((current - previous) / previous) * 100
  const up = pct >= 0
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: up ? 'var(--gnTx)' : 'var(--rdTx)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

export default function GooglePerformancePage() {
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

  const { data: current, isLoading, isError, error } = useGbpPerformanceMetrics(fromDate, toDate)
  const { data: previous } = useGbpPerformanceMetrics(prevFrom, prevTo)
  const syncMut = useSyncGbpPerformance()

  const gbp = status?.google_business
  const isConnected = gbp?.status === 'connected'
  const hasLocation = !!gbp?.google_location_id
  const neverSynced = isConnected && hasLocation && !gbp?.last_synced_at
  const hasSyncError = isConnected && hasLocation && !!gbp?.last_error
  const lastSyncedLabel = gbp?.last_synced_at
    ? new Date(gbp.last_synced_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const totals = useMemo(() => {
    const sum = (rows: typeof current, key: keyof NonNullable<typeof current>[number]) =>
      (rows ?? []).reduce((s, r) => s + (Number(r[key]) || 0), 0)
    return {
      calls: sum(current, 'calls'), callsPrev: sum(previous, 'calls'),
      websiteClicks: sum(current, 'website_clicks'), websiteClicksPrev: sum(previous, 'website_clicks'),
      directionRequests: sum(current, 'direction_requests'), directionRequestsPrev: sum(previous, 'direction_requests'),
      impressions: sum(current, 'business_impressions_maps') + sum(current, 'business_impressions_search'),
      impressionsPrev: sum(previous, 'business_impressions_maps') + sum(previous, 'business_impressions_search'),
    }
  }, [current, previous])

  const chartData = useMemo(() => (current ?? []).map((r) => ({
    date: new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    Appels: r.calls, 'Clics site': r.website_clicks, Itinéraires: r.direction_requests,
  })), [current])

  async function handleSync() {
    try {
      const res = await syncMut.mutateAsync()
      add(`Synchronisé — ${res.daysUpserted} jour(s)`)
    } catch (e: any) { add(e.message, 'error') }
  }

  if (statusLoading) return <div><Loader2 className="spin" /></div>

  if (!isConnected || !hasLocation) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Retour aux intégrations</button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{!isConnected ? 'Google Business Profile non connecté' : 'Aucun établissement sélectionné'}</div>
          <button className="btn-primary" onClick={() => nav('/parametres/integrations')} style={{ marginTop: 8 }}>Configurer</button>
        </div>
      </div>
    )
  }

  // Établissement sélectionné mais jamais synchronisé : jamais de
  // statistiques à zéro laissant croire qu'une synchronisation réelle a
  // eu lieu — état bloquant dédié tant qu'aucune synchronisation n'a réussi.
  if (neverSynced) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Retour aux intégrations</button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Aucune synchronisation n'a encore été effectuée</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            Cet établissement est sélectionné mais aucune statistique n'a encore été récupérée. Lancez une première synchronisation pour afficher le tableau de bord.
          </div>
          {hasSyncError && (
            <div style={{ fontSize: 12, color: 'var(--rdTx)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              Dernière tentative en erreur : {gbp?.last_error}
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
        <h1 className="page-title">Performances Google Business Profile</h1>
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
          <span>La dernière tentative de synchronisation a échoué : {gbp?.last_error}. Les données affichées ci-dessous datent de la dernière synchronisation réussie.</span>
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

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-icon blue"><Phone size={18} /></div>
          <div className="stat-value">{totals.calls}</div>
          <div className="stat-label">Appels <TrendBadge current={totals.calls} previous={totals.callsPrev} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Globe size={18} /></div>
          <div className="stat-value">{totals.websiteClicks}</div>
          <div className="stat-label">Clics vers le site <TrendBadge current={totals.websiteClicks} previous={totals.websiteClicksPrev} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><Navigation size={18} /></div>
          <div className="stat-value">{totals.directionRequests}</div>
          <div className="stat-label">Demandes d'itinéraire <TrendBadge current={totals.directionRequests} previous={totals.directionRequestsPrev} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><Eye size={18} /></div>
          <div className="stat-value">{totals.impressions}</div>
          <div className="stat-label">Vues (Maps + Recherche) <TrendBadge current={totals.impressions} previous={totals.impressionsPrev} /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Évolution</div>
        {isLoading ? <Loader2 className="spin" /> : chartData.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: 20 }}>Aucune donnée pour cette période — synchronisez pour récupérer les statistiques.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bd)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="Appels" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Clics site" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Itinéraires" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
