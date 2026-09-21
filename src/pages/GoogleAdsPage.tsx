// src/pages/GoogleAdsPage.tsx — Phase 5
// Tableau de bord Google Ads, organisé en blocs façon appli Google Ads (vue
// d'ensemble, performances, campagnes, tendances, compte) avec l'identité Kaytek.
// Affichage uniquement : aucune requête API ni logique de synchronisation n'est
// modifiée ici. Les blocs vivent dans src/pages/googleAds/, les calculs purs dans
// src/lib/googleAdsMetrics.ts.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Loader2, AlertTriangle, ArrowLeft, ShieldAlert, Info } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useGoogleOAuthStatus, useLoadGoogleAdsAccounts, type AdsAccountsErrorReason } from '@/lib/hooks/googleIntegrations'
import { useGoogleAdsMetrics, useSyncGoogleAdsMetrics } from '@/lib/hooks/googleStats'
import {
  aggregate, buildKpis, byCampaign, campaignChanges, dailySeries, insightStats, previousPeriod, isoDaysAgo, todayIso,
  describeSyncError, formatRelative, formatPeriodLabel, formatDayLong, maskCustomerId, STATS_LOAD_ERROR,
} from '@/lib/googleAdsMetrics'
import { PAGE_CSS } from './googleAds/styles'
import { Overview } from './googleAds/Overview'
import { PerformanceChart } from './googleAds/PerformanceChart'
import { CampaignsSection } from './googleAds/CampaignsSection'
import { InsightsSection } from './googleAds/InsightsSection'
import { AccountSection } from './googleAds/AccountSection'

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

export default function GoogleAdsPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: status, isLoading: statusLoading } = useGoogleOAuthStatus()
  const [periodKey, setPeriodKey] = useState<typeof PERIODS[number]['key']>('30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [syncError, setSyncError] = useState<{ message: string; detail: string | null } | null>(null)

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
  const kpis = useMemo(() => buildKpis(totals, prevTotals, hasData, canCompare), [totals, prevTotals, hasData, canCompare])
  const series = useMemo(() => dailySeries(rows), [rows])
  const campaigns = useMemo(() => byCampaign(rows), [rows])
  const prevCampaigns = useMemo(() => byCampaign(prevRows), [prevRows])
  const changes = useMemo(() => (canCompare && campaigns.length > 1 ? campaignChanges(campaigns, prevCampaigns) : []), [canCompare, campaigns, prevCampaigns])
  const insights = useMemo(() => insightStats(rows), [rows])
  const latestDataDate = useMemo(() => {
    let max = ''
    for (const r of rows ?? []) if (r.date > max) max = r.date
    return max ? formatDayLong(max) : null
  }, [rows])

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

  function selectPreset(key: typeof PERIODS[number]['key']) { setPeriodKey(key); setUseCustom(false) }
  function selectCustom() {
    setUseCustom(true)
    // Pré-remplit avec la période affichée pour que le passage en mode personnalisé ne change rien à l'écran.
    if (!customFrom && !customTo) { setCustomFrom(presetFrom); setCustomTo(presetTo) }
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

  const accountLine = [ads?.customer_descriptive_name || 'Compte', maskCustomerId(ads?.google_customer_id), ads?.currency_code].filter(Boolean).join(' · ')
  const dotClass = !ads?.last_synced_at ? 'none' : syncIsStale ? 'stale' : ''

  return (
    <div className="gads">
      <style>{PAGE_CSS}</style>

      {/* ── En-tête ── */}
      <div className="page-header gads-head" style={{ marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Google Ads</h1>
          <div className="gads-account">{accountLine}</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary btn-sm" disabled={syncMut.isPending} aria-busy={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {syncMut.isPending ? 'Synchronisation…' : 'Synchroniser'}
          </button>
        </div>
      </div>

      <div className="gads-status">
        <div className="gads-status-main">
          <span className={`gads-dot ${dotClass}`} aria-hidden="true" />
          <span>
            Dernière synchronisation réussie : <strong style={{ color: 'var(--t1)' }}>{lastSyncedLabel ?? '—'}</strong>
            {lastSyncedRelative && <span style={{ whiteSpace: 'nowrap' }}> ({lastSyncedRelative})</span>}
          </span>
        </div>
        {syncIsStale && <span style={{ color: 'var(--amTx)', fontWeight: 600 }}>Pensez à synchroniser pour des chiffres à jour</span>}
        {latestDataDate && <span style={{ color: 'var(--t3)' }}>Données jusqu'au {latestDataDate}</span>}
      </div>

      {syncError && (
        <div role="alert" className="gads-alert">
          <AlertTriangle size={16} />
          <div>
            <div className="gads-alert-title">La synchronisation a échoué</div>
            <div>{syncError.message}</div>
            <div className="gads-alert-sub">Les données affichées ci-dessous datent de la dernière synchronisation réussie.</div>
            {syncError.detail && (
              <details>
                <summary>Détail technique</summary>
                <div style={{ wordBreak: 'break-word', marginTop: 2 }}>{syncError.detail}</div>
              </details>
            )}
          </div>
        </div>
      )}

      {!syncError && hasSyncError && (
        <div className="gads-alert">
          <AlertTriangle size={16} />
          <span>La dernière tentative de synchronisation a échoué : {ads?.last_error}. Les données affichées ci-dessous datent de la dernière synchronisation réussie.</span>
        </div>
      )}

      {/* ── Période ── */}
      <div className="card gads-period">
        <div className="gads-seg" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={!useCustom && periodKey === p.key} onClick={() => selectPreset(p.key)}>{p.label}</button>
          ))}
          <button type="button" aria-pressed={useCustom} onClick={selectCustom}>Personnalisé</button>
        </div>
        {useCustom && (
          <div className="gads-range">
            <label>Du <input type="date" aria-label="Date de début" value={customFrom} max={customTo || undefined} onChange={(e) => { setCustomFrom(e.target.value); setUseCustom(true) }} /></label>
            <label>Au <input type="date" aria-label="Date de fin" value={customTo} min={customFrom || undefined} onChange={(e) => { setCustomTo(e.target.value); setUseCustom(true) }} /></label>
          </div>
        )}
        <div className="gads-period-label">
          <span className="gads-period-main">{formatPeriodLabel(fromDate, toDate)}</span>
          {hasData && (
            <span className="gads-period-cmp">
              {canCompare && prev
                ? `Comparaison avec la période précédente (${formatPeriodLabel(prev.from, prev.to)})`
                : 'Comparaison indisponible : aucune donnée sur la période précédente (la synchronisation récupère les 30 derniers jours).'}
            </span>
          )}
        </div>
      </div>

      {customInvalid && (
        <div role="alert" className="gads-alert warn">
          <AlertTriangle size={16} />
          <span>La date de début doit précéder la date de fin — la période prédéfinie « {period.label} » est affichée en attendant.</span>
        </div>
      )}

      {isError && (
        <div role="alert" className="gads-alert" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle size={16} />
          <span>{STATS_LOAD_ERROR}</span>
          {typeof refetch === 'function' && <button className="btn-secondary btn-sm" onClick={() => refetch()}>Réessayer</button>}
        </div>
      )}

      {!isLoading && !isError && !hasData && (
        <div className="gads-alert info">
          <Info size={16} />
          <span>Aucune donnée synchronisée pour la période du {formatPeriodLabel(fromDate, toDate)}. Cliquez sur « Synchroniser » pour récupérer les métriques, ou choisissez une autre période.</span>
        </div>
      )}

      {/* ── Blocs ── */}
      <Overview kpis={kpis} loading={isLoading} spark={series} />
      <PerformanceChart series={series} kpis={kpis} loading={isLoading} />
      <CampaignsSection campaigns={campaigns} />
      {hasData && <InsightsSection stats={insights} changes={changes} />}
      {ads && <AccountSection info={ads} onManage={() => nav('/parametres/integrations')} />}
    </div>
  )
}
