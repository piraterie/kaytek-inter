// src/pages/IntegrationsGooglePage.tsx — Phase 2 (OAuth réel) + Phase 3
// (découverte et sélection des comptes)
// Page admin-only : connexion/déconnexion Google Ads et Google Business
// Profile, puis sélection du compte Ads / établissement GBP à associer à
// l'organisation. N'appelle que les Edge Functions (google-oauth-*,
// google-ads-list-accounts, google-business-list-locations,
// google-select-connection) — jamais d'accès direct aux tables, jamais de
// token reçu ou manipulé ici. Le rôle admin est déjà garanti par
// <Guard adminOnly> (route) et l'entrée NAV correspondante.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Megaphone, Star, Loader2, Link2, Unlink, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import {
  useGoogleOAuthStatus, useConnectGoogle, useDisconnectGoogle,
  useLoadGoogleAdsAccounts, useLoadGoogleBusinessLocations,
  useSelectGoogleAdsAccount, useSelectGoogleBusinessLocation,
  type GoogleConnectionInfo, type GoogleProvider, type AdsAccountInfo, type GbpLocationInfo,
  type AdsAccountsErrorReason, type GbpLocationsErrorReason,
  type AdsAccountsResponse, type GbpLocationsResponse,
} from '@/lib/hooks/googleIntegrations'

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connecté',
  disconnected: 'Non connecté',
  expired: 'Reconnexion nécessaire',
  revoked: 'Accès révoqué',
}

const ADS_ERROR_LABEL: Record<AdsAccountsErrorReason, string> = {
  not_connected: 'Connectez d\'abord un compte Google.',
  needs_reconnect: 'La connexion a expiré — reconnectez-vous à Google.',
  developer_token_missing: 'L\'accès à l\'API Google Ads n\'est pas encore configuré côté Kaytek. Contactez le support.',
  developer_token_unapproved: 'L\'accès à l\'API Google Ads n\'est pas encore approuvé par Google pour ce compte.',
  api_not_enabled: 'L\'API Google Ads n\'est pas activée pour ce compte Google.',
  insufficient_permission: 'Ce compte Google n\'a pas les droits suffisants sur les comptes Google Ads demandés.',
  google_error: 'Google n\'a pas pu répondre à cette demande. Réessayez dans un instant.',
}

const GBP_ERROR_LABEL: Record<GbpLocationsErrorReason, string> = {
  not_connected: 'Connectez d\'abord un compte Google.',
  needs_reconnect: 'La connexion a expiré — reconnectez-vous à Google.',
  api_not_enabled: 'L\'API Google Business Profile n\'est pas activée pour ce compte Google.',
  insufficient_permission: 'Ce compte Google n\'a pas les droits suffisants sur les établissements demandés.',
  google_error: 'Google n\'a pas pu répondre à cette demande. Réessayez dans un instant.',
}

function formatCustomerId(id: string | null | undefined): string {
  if (!id) return ''
  const digits = id.replace(/[^0-9]/g, '')
  if (digits.length !== 10) return id
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'connected' ? 'var(--gnTx, #16a34a)' : status === 'expired' || status === 'revoked' ? 'var(--rdTx, #dc2626)' : 'var(--t2, #6b7280)'
  return (
    <span style={{ fontSize: 13, fontWeight: 600, color, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function AssociatedBadge({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gnTx, #16a34a)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <CheckCircle2 size={13} /> {label}
    </span>
  )
}

function ListItemButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left', border: '1px solid var(--bd, #e5e7eb)', borderRadius: 8, padding: '10px 12px',
        background: 'var(--bg2, #fff)', cursor: disabled ? 'default' : 'pointer', display: 'flex',
        flexDirection: 'column', gap: 2, width: '100%',
      }}
    >
      {children}
    </button>
  )
}

// ── Sélection Google Ads ──────────────────────────────────────────────
function AdsSelector({ info }: { info: GoogleConnectionInfo | undefined }) {
  const { add } = useToastStore()
  const loadMut = useLoadGoogleAdsAccounts()
  const selectMut = useSelectGoogleAdsAccount()
  const [accounts, setAccounts] = useState<AdsAccountInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const hasSelection = !!info?.google_customer_id

  function handleLoad() {
    setLoadError(null)
    loadMut.mutate(undefined, {
      onSuccess: (res: AdsAccountsResponse) => {
        if (res.ok) { setAccounts(res.accounts); return }
        // 'reason' in res : le tsconfig du projet a strictNullChecks
        // désactivé, ce qui dégrade le narrowing de type par simple
        // retour anticipé (res resterait typé comme l'union complète) —
        // la garde par opérateur `in` reste fiable indépendamment de ce
        // réglage.
        if ('reason' in res) setLoadError(ADS_ERROR_LABEL[res.reason] ?? 'Erreur inconnue')
        setAccounts(null)
      },
      onError: (err: any) => { setLoadError(err?.message || 'Erreur de chargement'); setAccounts(null) },
    })
  }

  function handleSelect(a: AdsAccountInfo) {
    if (a.isManager) {
      add('Ce compte est un compte manager (MCC) — sélectionnez plutôt un compte publicitaire client.', 'error')
      return
    }
    selectMut.mutate(a.customerId, {
      onSuccess: () => { setAccounts(null); add('Compte Google Ads associé'); },
      onError: (err: any) => add(err?.message || 'Association impossible', 'error'),
    })
  }

  if (hasSelection && accounts === null) {
    return (
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600 }}>{info?.customer_descriptive_name || 'Compte Google Ads'}</div>
          <AssociatedBadge label="Compte associé" />
        </div>
        <div style={{ color: 'var(--t2, #6b7280)' }}>ID client : {formatCustomerId(info?.google_customer_id)}</div>
        {info?.currency_code && <div style={{ color: 'var(--t2, #6b7280)' }}>Devise : {info.currency_code}</div>}
        {info?.time_zone && <div style={{ color: 'var(--t2, #6b7280)' }}>Fuseau horaire : {info.time_zone}</div>}
        <button className="btn-secondary" style={{ marginTop: 6, alignSelf: 'flex-start' }} disabled={loadMut.isPending} onClick={handleLoad}>
          {loadMut.isPending ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Changer de compte
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!hasSelection && <div style={{ fontSize: 13, color: 'var(--t2, #6b7280)' }}>Sélectionnez un compte Google Ads.</div>}
      {accounts === null && (
        <button className="btn-secondary" disabled={loadMut.isPending} onClick={handleLoad}>
          {loadMut.isPending ? <Loader2 size={14} className="spin" /> : null} Charger mes comptes
        </button>
      )}
      {loadError && <div style={{ fontSize: 12, color: 'var(--rdTx, #dc2626)' }}>{loadError}</div>}
      {accounts && accounts.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--t2, #6b7280)' }}>Aucun compte Google Ads accessible avec ce compte Google.</div>
      )}
      {accounts && accounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {accounts.map((a) => (
            <ListItemButton key={a.customerId} disabled={selectMut.isPending} onClick={() => handleSelect(a)}>
              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                {a.descriptiveName || 'Compte sans nom'}
                {a.isManager && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t2, #6b7280)', border: '1px solid var(--bd, #e5e7eb)', borderRadius: 4, padding: '1px 5px' }}>
                    MCC
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t2, #6b7280)' }}>
                {formatCustomerId(a.customerId)}
                {a.currencyCode ? ` · ${a.currencyCode}` : ''}
                {a.infoIncomplete ? ' · informations incomplètes' : ''}
              </div>
            </ListItemButton>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sélection Google Business Profile ────────────────────────────────
function GbpSelector({ info }: { info: GoogleConnectionInfo | undefined }) {
  const { add } = useToastStore()
  const loadMut = useLoadGoogleBusinessLocations()
  const selectMut = useSelectGoogleBusinessLocation()
  const [flatLocations, setFlatLocations] = useState<GbpLocationInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const hasSelection = !!info?.google_location_id

  function handleLoad() {
    setLoadError(null)
    loadMut.mutate(undefined, {
      onSuccess: (res: GbpLocationsResponse) => {
        if (res.ok) { setFlatLocations(res.accounts.flatMap((a) => a.locations)); return }
        if ('reason' in res) setLoadError(GBP_ERROR_LABEL[res.reason] ?? 'Erreur inconnue')
        setFlatLocations(null)
      },
      onError: (err: any) => { setLoadError(err?.message || 'Erreur de chargement'); setFlatLocations(null) },
    })
  }

  function handleSelect(loc: GbpLocationInfo) {
    selectMut.mutate(
      { accountResourceName: loc.accountResourceName, locationResourceName: loc.locationResourceName },
      {
        onSuccess: () => { setFlatLocations(null); add('Établissement associé'); },
        onError: (err: any) => add(err?.message || 'Association impossible', 'error'),
      },
    )
  }

  if (hasSelection && flatLocations === null) {
    return (
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600 }}>{info?.location_title || info?.account_name || 'Établissement'}</div>
          <AssociatedBadge label="Établissement associé" />
        </div>
        {info?.location_address && <div style={{ color: 'var(--t2, #6b7280)' }}>{info.location_address}</div>}
        {info?.location_open_status && <div style={{ color: 'var(--t2, #6b7280)' }}>Statut : {info.location_open_status}</div>}
        <button className="btn-secondary" style={{ marginTop: 6, alignSelf: 'flex-start' }} disabled={loadMut.isPending} onClick={handleLoad}>
          {loadMut.isPending ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Changer d'établissement
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!hasSelection && <div style={{ fontSize: 13, color: 'var(--t2, #6b7280)' }}>Sélectionnez un établissement.</div>}
      {flatLocations === null && (
        <button className="btn-secondary" disabled={loadMut.isPending} onClick={handleLoad}>
          {loadMut.isPending ? <Loader2 size={14} className="spin" /> : null} Charger mes établissements
        </button>
      )}
      {loadError && <div style={{ fontSize: 12, color: 'var(--rdTx, #dc2626)' }}>{loadError}</div>}
      {flatLocations && flatLocations.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--t2, #6b7280)' }}>Aucun établissement accessible avec ce compte Google.</div>
      )}
      {flatLocations && flatLocations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {flatLocations.map((loc) => (
            <ListItemButton key={loc.locationResourceName} disabled={selectMut.isPending} onClick={() => handleSelect(loc)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{loc.title || 'Établissement sans nom'}</div>
              {loc.address && <div style={{ fontSize: 12, color: 'var(--t2, #6b7280)' }}>{loc.address}</div>}
              {loc.openStatus && <div style={{ fontSize: 11, color: 'var(--t2, #6b7280)' }}>Statut : {loc.openStatus}</div>}
            </ListItemButton>
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectionCard({
  title, icon: Icon, provider, info, onConnect, onDisconnect, connecting, disconnecting,
}: {
  title: string
  icon: typeof Megaphone
  provider: GoogleProvider
  info: GoogleConnectionInfo | undefined
  onConnect: (p: GoogleProvider) => void
  onDisconnect: (p: GoogleProvider) => void
  connecting: boolean
  disconnecting: boolean
}) {
  const status = info?.status ?? 'disconnected'
  const isConnected = status === 'connected' || status === 'expired'

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon size={20} />
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        </div>
        <StatusBadge status={status} />
      </div>

      {isConnected && info?.google_account_email && (
        <div style={{ fontSize: 12, color: 'var(--t2, #6b7280)' }}>Compte Google : {info.google_account_email}</div>
      )}

      {status === 'expired' && (
        <div style={{ fontSize: 13, color: 'var(--rdTx, #dc2626)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} /> La connexion a expiré — reconnectez-vous.
        </div>
      )}

      {info?.last_error && (
        <div style={{ fontSize: 12, color: 'var(--rdTx, #dc2626)' }}>Dernière erreur : {info.last_error}</div>
      )}

      {isConnected && status !== 'expired' && (
        provider === 'google_ads' ? <AdsSelector info={info} /> : <GbpSelector info={info} />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {!isConnected ? (
          <button className="btn-primary" disabled={connecting} onClick={() => onConnect(provider)}>
            {connecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
            Connecter {title}
          </button>
        ) : (
          <button className="btn-secondary" disabled={disconnecting} onClick={() => onDisconnect(provider)}>
            {disconnecting ? <Loader2 size={14} className="spin" /> : <Unlink size={14} />}
            Déconnecter
          </button>
        )}
      </div>
    </div>
  )
}

export default function IntegrationsGooglePage() {
  const { add } = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, refetch } = useGoogleOAuthStatus()
  const connectMut = useConnectGoogle()
  const disconnectMut = useDisconnectGoogle()
  const handledCallback = useRef(false)

  // Résultat du callback OAuth (redirection serveur google-oauth-callback
  // → google_status/provider/reason en query params, jamais de secret).
  useEffect(() => {
    if (handledCallback.current) return
    const googleStatus = searchParams.get('google_status')
    if (!googleStatus) return
    handledCallback.current = true

    const provider = searchParams.get('provider')
    const providerLabel = provider === 'google_ads' ? 'Google Ads' : provider === 'google_business' ? 'Google Business Profile' : 'Google'

    if (googleStatus === 'success') {
      add(`${providerLabel} connecté avec succès`, 'success')
      refetch()
    } else {
      const reason = searchParams.get('reason') || 'erreur_inconnue'
      add(`Connexion ${providerLabel} échouée (${reason})`, 'error')
    }

    // Nettoyage de l'URL — jamais laisser ces paramètres dans l'historique/barre d'adresse.
    searchParams.delete('google_status')
    searchParams.delete('provider')
    searchParams.delete('reason')
    setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function handleConnect(provider: GoogleProvider) {
    connectMut.mutate(provider, {
      onSuccess: (authUrl) => {
        // Redirection pleine page — jamais de popup, jamais de token
        // manipulé côté client.
        window.location.href = authUrl
      },
      onError: (err: any) => add(err?.message || 'Impossible de démarrer la connexion', 'error'),
    })
  }

  function handleDisconnect(provider: GoogleProvider) {
    disconnectMut.mutate(provider, {
      onSuccess: () => add('Déconnecté'),
      onError: (err: any) => add(err?.message || 'Déconnexion impossible', 'error'),
    })
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <div className="params-section-label">Intégrations Google</div>
      <p style={{ fontSize: 13, color: 'var(--t2, #6b7280)', marginBottom: 16 }}>
        Connectez les comptes Google de votre organisation. Réservé aux administrateurs.
      </p>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t2, #6b7280)' }}>
          <Loader2 size={16} className="spin" /> Chargement du statut…
        </div>
      ) : (
        <div className="grid-2" style={{ gap: 16 }}>
          <ConnectionCard
            title="Google Ads"
            icon={Megaphone}
            provider="google_ads"
            info={data?.google_ads}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            connecting={connectMut.isPending && connectMut.variables === 'google_ads'}
            disconnecting={disconnectMut.isPending && disconnectMut.variables === 'google_ads'}
          />
          <ConnectionCard
            title="Google Business Profile"
            icon={Star}
            provider="google_business"
            info={data?.google_business}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            connecting={connectMut.isPending && connectMut.variables === 'google_business'}
            disconnecting={disconnectMut.isPending && disconnectMut.variables === 'google_business'}
          />
        </div>
      )}
    </div>
  )
}
