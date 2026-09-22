// @vitest-environment jsdom
// src/pages/GoogleAdsPage.test.tsx
//
// Vérifie que le tableau de bord Google Ads ne peut jamais laisser croire
// qu'une synchronisation réelle a eu lieu quand ce n'est pas le cas : le
// texte exact exigé quand le developer token serveur est absent, aucun
// bouton de synchronisation tant que la configuration est incomplète, et un
// état bloquant dédié (pas de tableau à zéro) tant qu'aucune synchronisation
// n'a jamais réussi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GoogleAdsPage from './GoogleAdsPage'
import { useToastStore } from '@/lib/store'

const hooks = vi.hoisted(() => ({
  useGoogleOAuthStatus: vi.fn(),
  useLoadGoogleAdsAccounts: vi.fn(),
}))
const statsHooks = vi.hoisted(() => ({
  useGoogleAdsMetrics: vi.fn(),
  useSyncGoogleAdsMetrics: vi.fn(),
}))

const dataHooks = vi.hoisted(() => ({
  useGoogleAdsHourly: vi.fn(), useGoogleAdsDevices: vi.fn(), useGoogleAdsDemographics: vi.fn(), useGoogleAdsGeo: vi.fn(),
  useGoogleGeoNames: vi.fn(), useGoogleAdsZones: vi.fn(), useGoogleAdsCampaigns: vi.fn(), useGoogleAdsSyncState: vi.fn(),
}))
vi.mock('@/lib/hooks/googleAdsData', () => ({
  ...dataHooks,
  campaignStatusMap: (rows: { campaign_id: string; status: string }[] | undefined) => new Map((rows ?? []).map((r) => [r.campaign_id, r.status])),
}))
vi.mock('@/lib/hooks/googleIntegrations', () => ({
  useGoogleOAuthStatus: hooks.useGoogleOAuthStatus,
  useLoadGoogleAdsAccounts: hooks.useLoadGoogleAdsAccounts,
}))
vi.mock('@/lib/hooks/googleStats', () => ({
  useGoogleAdsMetrics: statsHooks.useGoogleAdsMetrics,
  useSyncGoogleAdsMetrics: statsHooks.useSyncGoogleAdsMetrics,
}))

function mutationStub(overrides: Partial<{ mutate: (...a: any[]) => void; mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean; data: any }> = {}) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, data: undefined, ...overrides }
}

function statusQuery(googleAds: any) {
  return { data: { google_ads: googleAds, google_business: { status: 'disconnected' } }, isLoading: false }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <GoogleAdsPage />
    </MemoryRouter>
  )
}

// Date figée à midi UTC : « aujourd'hui » vaut le même jour à Paris et en UTC (pas de bascule de minuit).
afterEach(() => { cleanup(); vi.useRealTimers() })

const q = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-21T12:00:00Z') })
  vi.clearAllMocks()
  for (const k of ['useGoogleAdsHourly', 'useGoogleAdsDevices', 'useGoogleAdsDemographics', 'useGoogleAdsGeo', 'useGoogleAdsZones', 'useGoogleAdsCampaigns', 'useGoogleAdsSyncState'] as const) dataHooks[k].mockReturnValue(q([]))
  // google-oauth-status ne renvoie que l'identifiant MASQUÉ : l'identifiant complet vient de l'état de synchronisation.
  dataHooks.useGoogleAdsSyncState.mockReturnValue(q([{ customer_id: '7536669574', dataset: 'manual_full', synced_at: '2026-09-21T12:00:00Z', attempted_at: null, backfilled_at: null, last_error: null }]))
  dataHooks.useGoogleGeoNames.mockReturnValue(q(new Map()))
  useToastStore.setState({ toasts: [] })
  hooks.useLoadGoogleAdsAccounts.mockReturnValue(mutationStub())
  statsHooks.useGoogleAdsMetrics.mockReturnValue({ data: [], isLoading: false, isError: false, error: null })
  statsHooks.useSyncGoogleAdsMetrics.mockReturnValue(mutationStub())
})

describe('GoogleAdsPage — configuration serveur manquante (API non activée dans le projet Cloud)', () => {
  it("affiche le texte exact exigé et jamais de bouton de synchronisation", () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({ status: 'connected', google_customer_id: null }))
    hooks.useLoadGoogleAdsAccounts.mockReturnValue(mutationStub({ data: { ok: false, reason: 'api_not_enabled' } }))
    renderPage()
    expect(screen.getByText("Google Ads n'est pas encore configuré par l'administrateur de la plateforme.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /synchroniser/i })).not.toBeInTheDocument()
  })
})

describe('GoogleAdsPage — non connecté', () => {
  it('affiche un état non connecté distinct, sans bouton de synchronisation', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({ status: 'disconnected' }))
    renderPage()
    expect(screen.getByText('Google Ads non connecté')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /synchroniser/i })).not.toBeInTheDocument()
  })
})

describe('GoogleAdsPage — compte sélectionné mais jamais synchronisé', () => {
  it("bloque l'affichage du tableau de bord et ne montre aucune donnée à zéro", () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_customer_id: '123-456-7890', last_synced_at: null, last_error: null,
    }))
    renderPage()
    expect(screen.getByText("Aucune synchronisation n'a encore été effectuée")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /synchroniser maintenant/i })).toBeInTheDocument()
    expect(screen.queryByText('Campagnes')).not.toBeInTheDocument()
    expect(screen.queryByText('Impressions')).not.toBeInTheDocument()
  })
})

describe('GoogleAdsPage — synchronisé avec succès', () => {
  it('affiche le tableau de bord et la date de dernière synchronisation', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_customer_id: '123-456-7890', last_synced_at: '2026-08-01T10:00:00.000Z', last_error: null,
    }))
    renderPage()
    expect(screen.getByText(/dernière synchronisation réussie/i)).toBeInTheDocument()
    expect(screen.getByText('Campagnes')).toBeInTheDocument()
    expect(screen.queryByText(/tentative de synchronisation a échoué/i)).not.toBeInTheDocument()
  })
})

describe('GoogleAdsPage — dernière synchronisation en erreur après un succès antérieur', () => {
  it('affiche un bandeau d\'erreur non bloquant, sans cacher les dernières données synchronisées', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_customer_id: '123-456-7890',
      last_synced_at: '2026-08-01T10:00:00.000Z', last_error: 'GAQL_QUOTA_EXCEEDED',
    }))
    renderPage()
    expect(screen.getByText(/tentative de synchronisation a échoué/i)).toBeInTheDocument()
    expect(screen.getByText(/GAQL_QUOTA_EXCEEDED/)).toBeInTheDocument()
    expect(screen.getByText('Campagnes')).toBeInTheDocument()
  })
})

// ── Tableau de bord enrichi : KPI, comparaison, campagnes, synchronisation ──
const TODAY = '2026-09-21'
const mRow = (o: Record<string, unknown>) => ({
  date: '2026-09-01', campaign_id: 'a', campaign_name: 'Alpha',
  impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0, phone_calls: 0, ...o,
})
const CURRENT = [
  mRow({ impressions: 1000, clicks: 50, cost_micros: 25_000_000, conversions: 5 }),
  mRow({ campaign_id: 'c', campaign_name: 'Charlie', impressions: 500, clicks: 25, cost_micros: 10_000_000, conversions: 1 }),
  mRow({ campaign_id: 'z', campaign_name: 'Zulu' }),
]
// La page appelle useGoogleAdsMetrics deux fois : période courante (to = aujourd'hui) puis précédente.
function mockMetrics(current: unknown[], previous: unknown[]) {
  statsHooks.useGoogleAdsMetrics.mockImplementation((_from: string, to: string) => ({
    data: to === TODAY ? current : previous, isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }))
}
const syncedStatus = () => hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
  status: 'connected', google_customer_id: '••• ••• 9574', last_synced_at: new Date().toISOString(), last_error: null, time_zone: 'Europe/Paris',
}))

describe('GoogleAdsPage — KPI et comparaison', () => {
  it('affiche CTR, CPC moyen et coût par conversion calculés', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours')) // vue période (pas « Aujourd'hui », sélectionné par défaut)
    expect(screen.getAllByText('CTR').length).toBeGreaterThan(0) // carte KPI + en-tête du tableau
    expect(screen.getByText('CPC moyen')).toBeInTheDocument()
    expect(screen.getByText('Coût / conversion')).toBeInTheDocument()
    expect(screen.getAllByText('5,0 %').length).toBeGreaterThan(0)       // 75 clics / 1 500 impressions
    expect(screen.getAllByText('0,47 €').length).toBeGreaterThan(0)      // 35 € / 75 clics
    expect(screen.getAllByText('5,83 €').length).toBeGreaterThan(0)      // 35 € / 6 conversions
  })

  it('sans donnée sur la période précédente : aucune comparaison, jamais de « Nouveau »', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(screen.getByText(/comparaison indisponible/i)).toBeInTheDocument()
    expect(screen.queryByText('Nouveau')).not.toBeInTheDocument()
  })

  it('période précédente quasi vide : écart absolu, jamais un pourcentage absurde', () => {
    syncedStatus()
    mockMetrics(CURRENT, [mRow({ impressions: 40, clicks: 2, cost_micros: 1_000_000, conversions: 0 })])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(screen.getAllByText('+73 clics').length).toBeGreaterThan(0) // clics : 75 − 2 (carte KPI + en-tête du graphique)
    expect(screen.queryByText(/3\s?650\s?%/)).not.toBeInTheDocument()
  })

  it('valeurs indéfinies affichées « — », pas 0 (aucune conversion → coût/conversion indéfini)', () => {
    syncedStatus(); mockMetrics([mRow({ impressions: 100, clicks: 5, cost_micros: 3_000_000, conversions: 0 })], [])
    renderPage()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('GoogleAdsPage — tableau des campagnes', () => {
  it('colonnes demandées, statut RÉEL Google (pas déduit de l’activité), et total', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsCampaigns.mockReturnValue(q([
      { campaign_id: 'a', name: 'Alpha', status: 'ENABLED' }, { campaign_id: 'c', name: 'Charlie', status: 'PAUSED' }, { campaign_id: 'z', name: 'Zulu', status: 'PAUSED' },
    ]))
    renderPage()
    for (const col of ['Campagne', 'Statut', 'Impressions', 'Clics', 'CTR', 'Dépenses', 'Conversions', 'Coût/conv.']) {
      expect(screen.getAllByText(col).length).toBeGreaterThan(0)
    }
    // Charlie a de l'activité mais est EN PAUSE : le statut vient de Google, jamais de l'activité.
    expect(screen.getAllByText('En pause').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.queryByText('Sans activité')).not.toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText(/statut est celui de la campagne dans Google Ads/i)).toBeInTheDocument()
  })

  it('filtre par nom', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    fireEvent.change(screen.getByLabelText('Rechercher une campagne'), { target: { value: 'char' } })
    expect(screen.getAllByText('Charlie').length).toBeGreaterThan(0)
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Total affiché')).toBeInTheDocument()
  })

  it('statut absent de google_ads_campaigns : « Statut indisponible », jamais « Active » supposé', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(screen.getAllByText('Statut indisponible').length).toBeGreaterThan(0)
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('filtre « En pause » et message si aucun résultat', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsCampaigns.mockReturnValue(q([
      { campaign_id: 'a', name: 'Alpha', status: 'ENABLED' }, { campaign_id: 'c', name: 'Charlie', status: 'ENABLED' }, { campaign_id: 'z', name: 'Zulu', status: 'PAUSED' },
    ]))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^En pause/ }))
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getAllByText('Zulu').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Rechercher une campagne'), { target: { value: 'introuvable' } })
    expect(screen.getByText(/aucune campagne ne correspond/i)).toBeInTheDocument()
  })

  it('tri par clic sur un en-tête (ordre inversé au second clic)', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    const order = () => screen.getAllByRole('row').map((r) => r.textContent ?? '').filter((t) => /Alpha|Charlie|Zulu/.test(t)).map((t) => (/Alpha/.test(t) ? 'A' : /Charlie/.test(t) ? 'C' : 'Z'))
    expect(order()).toEqual(['A', 'C', 'Z']) // dépenses décroissantes par défaut
    const btn = screen.getAllByRole('button', { name: /^Campagne/ })[0]
    fireEvent.click(btn) // nom croissant
    expect(order()).toEqual(['A', 'C', 'Z'])
    fireEvent.click(btn) // nom décroissant
    expect(order()).toEqual(['Z', 'C', 'A'])
  })
})

describe('GoogleAdsPage — synchronisation', () => {
  it('bouton désactivé avec libellé de chargement pendant la synchronisation', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    statsHooks.useSyncGoogleAdsMetrics.mockReturnValue(mutationStub({ isPending: true }))
    renderPage()
    const btn = screen.getByRole('button', { name: /synchronisation…/i })
    expect(btn).toBeDisabled()
  })

  it('affiche la date de dernière synchronisation', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    expect(screen.getByText(/dernière synchronisation réussie/i)).toBeInTheDocument()
    expect(screen.getByText(/à l'instant/)).toBeInTheDocument()
  })

  it('erreur google_error : message lisible, pas le code brut, détail technique repliable', async () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    const err = Object.assign(new Error('google_error'), { reason: 'google_error', detail: 'HTTP 400 INVALID_ARGUMENT' })
    statsHooks.useSyncGoogleAdsMetrics.mockReturnValue(mutationStub({ mutateAsync: vi.fn().mockRejectedValue(err) }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^synchroniser$/i }))
    expect(await screen.findByText(/n'a pas pu traiter la demande de synchronisation/i)).toBeInTheDocument()
    expect(screen.queryByText('google_error')).not.toBeInTheDocument()
    expect(screen.getByText('Détail technique')).toBeInTheDocument()
    expect(screen.getByText('HTTP 400 INVALID_ARGUMENT')).toBeInTheDocument()
  })
})

// ── Refonte : structure en blocs façon Google Ads ───────────────────────────
const ADS_FULL = {
  status: 'connected', google_customer_id: '••• ••• 9574', last_synced_at: new Date().toISOString(), last_error: null,
  currency_code: 'EUR', time_zone: 'Europe/Paris', is_manager_account: false, google_account_email: 'admin@test.local', connected_at: '2026-09-21T10:00:00Z',
}
const fullStatus = () => hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery(ADS_FULL))
const h2s = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

describe('GoogleAdsPage — structure en blocs', () => {
  it('affiche les blocs dans l’ordre mobile demandé', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(h2s()).toEqual(["Vue d'ensemble", 'Performances', 'Campagnes', 'Données démographiques', 'Appareils', 'Zones', 'Tendances', 'Compte connecté'])
  })

  it('sans donnée synchronisée : pas de bloc Tendances, un message clair, les autres blocs restent', () => {
    fullStatus(); mockMetrics([], [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(h2s()).toEqual(["Vue d'ensemble", 'Performances', 'Campagnes', 'Données démographiques', 'Appareils', 'Zones', 'Compte connecté'])
    expect(screen.getByText(/aucune donnée synchronisée pour la période/i)).toBeInTheDocument()
  })

  it('aucun bloc inventé : pas de termes de recherche ni de facturation', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    expect(screen.queryByText(/termes de recherche|facturation/i)).not.toBeInTheDocument()
  })

  it('compte connecté : identifiant masqué, jamais l’identifiant complet', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    expect(screen.getAllByText('····9574').length).toBeGreaterThan(0)
    expect(screen.queryByText(/7536669574/)).not.toBeInTheDocument()
    expect(screen.getByText('admin@test.local')).toBeInTheDocument()
    expect(screen.getByText('Compte client')).toBeInTheDocument()
  })

  it('période : « Aujourd’hui » sélectionné par défaut, « Personnalisé » révèle les dates préremplies', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    const seg = within(screen.getByRole('group', { name: 'Période' }))
    expect(seg.getByRole('button', { name: "Aujourd'hui" })).toHaveAttribute('aria-pressed', 'true')
    expect(seg.getByRole('button', { name: '30 jours' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Date de début')).not.toBeInTheDocument()
    fireEvent.click(seg.getByRole('button', { name: 'Personnalisé' }))
    expect(seg.getByRole('button', { name: 'Personnalisé' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Date de début') as HTMLInputElement).value).not.toBe('')
    fireEvent.click(seg.getByRole('button', { name: '7 jours' }))
    expect(screen.queryByLabelText('Date de début')).not.toBeInTheDocument()
    // Les périodes 7 j / 30 j / 90 j continuent de fonctionner comme avant après un aller-retour.
    fireEvent.click(seg.getByRole('button', { name: '30 jours' }))
    expect(seg.getByRole('button', { name: '30 jours' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(seg.getByRole('button', { name: "Aujourd'hui" }))
    expect(seg.getByRole('button', { name: "Aujourd'hui" })).toHaveAttribute('aria-pressed', 'true')
  })

  it('graphique : bascule d’indicateur (clics & impressions → dépenses)', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    const seg = within(screen.getByRole('group', { name: 'Indicateur du graphique' }))
    expect(seg.getByRole('button', { name: 'Trafic' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(seg.getByRole('button', { name: 'Dépenses' }))
    expect(seg.getByRole('button', { name: 'Dépenses' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('dépensés')).toBeInTheDocument()
  })

  it('variation des clics par campagne : affichée avec plusieurs campagnes et une période précédente', () => {
    fullStatus()
    mockMetrics(CURRENT, [
      mRow({ campaign_id: 'a', impressions: 300, clicks: 20, cost_micros: 5_000_000 }),
      mRow({ campaign_id: 'c', campaign_name: 'Charlie', impressions: 300, clicks: 20, cost_micros: 5_000_000 }),
    ])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(screen.getByText('Variation des clics par campagne')).toBeInTheDocument()
  })

  it('cartes campagnes : part des dépenses affichée', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(screen.getAllByText(/\d+ % des dépenses/).length).toBeGreaterThan(0)
  })
})

// ── Nouvelles sections : Aujourd'hui, Appareils, Démographie, Zones ─────────
const M0 = { impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 }
const hRow = (o: Record<string, unknown>) => ({
  campaign_id: 'a', campaign_name: 'Alpha', local_date: TODAY, hour: 9, ...M0, conversions_value: 0, ...o,
})
const periodBtn = (name: string) => within(screen.getByRole('group', { name: 'Période' })).getByRole('button', { name })

describe('GoogleAdsPage — période « Aujourd’hui »', () => {
  function todaySetup(hourly?: unknown[]) {
    fullStatus(); mockMetrics([], [])
    // Synchro à 14:20 (Paris) = 12:20 UTC
    dataHooks.useGoogleAdsSyncState.mockReturnValue(q([{ customer_id: '7536669574', dataset: 'hourly', synced_at: '2026-09-21T12:20:00Z', attempted_at: null, backfilled_at: null, last_error: null }]))
    dataHooks.useGoogleAdsHourly.mockReturnValue(q(hourly ?? [
      hRow({ hour: 9, impressions: 100, clicks: 10, cost_micros: 20_000_000 }),
      hRow({ local_date: '2026-09-20', hour: 9, impressions: 50, clicks: 5, cost_micros: 10_000_000 }),
    ]))
    renderPage()
    fireEvent.click(periodBtn("Aujourd'hui"))
  }

  it('la période « Aujourd’hui » existe avant 7 / 30 / 90 jours et Personnalisé', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    const names = within(screen.getByRole('group', { name: 'Période' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(["Aujourd'hui", '7 jours', '30 jours', '90 jours', 'Personnalisé'])
  })

  it('affiche « Données synchronisées à HH:mm » dans le fuseau du compte, jamais « temps réel »', () => {
    todaySetup()
    expect(screen.getByText(/Données synchronisées à 14:20/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/temps réel|\blive\b/i)
    expect(screen.getByText(/Fuseau horaire du compte : Europe\/Paris/)).toBeInTheDocument()
  })

  it('KPI du jour lus depuis la table horaire ; comparaison avec hier sur les mêmes heures', () => {
    todaySetup()
    expect(screen.getAllByText('100').length).toBeGreaterThan(0) // impressions aujourd'hui
    expect(screen.getByText(/Comparaison avec hier sur les mêmes heures \(00h–14h/)).toBeInTheDocument()
    expect(screen.getByText(/Les heures après 14h ne sont pas encore synchronisées/)).toBeInTheDocument()
  })

  it('note de retard des conversions quand l’indicateur Conversions est choisi', () => {
    todaySetup()
    fireEvent.click(within(screen.getByRole('group', { name: 'Indicateur horaire' })).getByRole('button', { name: 'Conversions' }))
    expect(screen.getByText(/conversions avec plusieurs heures de retard/)).toBeInTheDocument()
  })

  it('aucune donnée hier : pas de comparaison, jamais de « Nouveau »', () => {
    todaySetup([hRow({ impressions: 100, clicks: 10, cost_micros: 20_000_000 })])
    expect(screen.queryByText('Nouveau')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Comparaison avec hier indisponible/).length).toBeGreaterThan(0)
  })

  it('les campagnes du jour viennent des lignes horaires avec leur statut réel', () => {
    dataHooks.useGoogleAdsCampaigns.mockReturnValue(q([{ campaign_id: 'a', name: 'Alpha', status: 'PAUSED' }]))
    todaySetup()
    expect(screen.getAllByText('En pause').length).toBeGreaterThan(0)
  })
})

describe('GoogleAdsPage — Appareils', () => {
  it('Mobile / Ordinateur / Tablette avec pastilles de métrique', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsDevices.mockReturnValue(q([
      { device: 'MOBILE', ...M0, clicks: 30, impressions: 300 }, { device: 'DESKTOP', ...M0, clicks: 10, impressions: 200 },
    ]))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Appareils' }).closest('section')!)
    for (const l of ['Mobile', 'Ordinateur', 'Tablette']) expect(sec.getByText(l)).toBeInTheDocument()
    const pills = within(sec.getByRole('group', { name: 'Indicateur des appareils' }))
    for (const l of ['Impressions', 'Clics', 'Dépenses', 'Conversions']) expect(pills.getByRole('button', { name: l })).toBeInTheDocument()
    expect(sec.getByText('75 %')).toBeInTheDocument() // mobile : 30 / 40 clics
    fireEvent.click(pills.getByRole('button', { name: 'Impressions' }))
    expect(sec.getByText('60 %')).toBeInTheDocument() // 300 / 500
  })
  it('conversions à 0 : pas de fausse donnée, une note claire', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsDevices.mockReturnValue(q([{ device: 'MOBILE', ...M0, clicks: 30 }]))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Appareils' }).closest('section')!)
    fireEvent.click(sec.getByRole('button', { name: 'Conversions' }))
    expect(sec.getByText(/Aucune conversion enregistrée/)).toBeInTheDocument()
  })
})

describe('GoogleAdsPage — Données démographiques', () => {
  const demo = [
    { dimension: 'age_range', value: 'AGE_RANGE_25_34', ...M0, impressions: 30 },
    { dimension: 'age_range', value: 'AGE_RANGE_UNDETERMINED', ...M0, impressions: 70 },
    { dimension: 'gender', value: 'MALE', ...M0, impressions: 20 },
    { dimension: 'gender', value: 'UNDETERMINED', ...M0, impressions: 80 },
  ]
  it('Âge par défaut, « Inconnu » conservé ; « Âge et sexe » = deux répartitions séparées, non croisées', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsDemographics.mockReturnValue(q(demo))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Données démographiques' }).closest('section')!)
    expect(sec.getByRole('button', { name: 'Âge' })).toHaveAttribute('aria-pressed', 'true')
    expect(sec.getByText('25–34')).toBeInTheDocument()
    expect(sec.getByText('70 %')).toBeInTheDocument()
    expect(sec.getAllByText(/non déterminé par Google/).length).toBeGreaterThan(0)
    fireEvent.click(sec.getByRole('button', { name: 'Âge et sexe' }))
    // Deux blocs distincts (cartes séparées), chacun avec sa propre liste, et un avertissement explicite en tête.
    expect(sec.getByText('Par âge')).toBeInTheDocument()
    expect(sec.getByText('Par sexe')).toBeInTheDocument()
    expect(sec.getByRole('list', { name: 'Répartition par âge' })).toBeInTheDocument()
    expect(sec.getByRole('list', { name: 'Répartition par sexe' })).toBeInTheDocument()
    expect(sec.getByText(/ne permet pas de croiser l'âge et le sexe/)).toBeInTheDocument()
    expect(sec.getByText('Femme')).toBeInTheDocument()
  })
})

describe('GoogleAdsPage — Zones', () => {
  const zones = [
    { campaign_id: 'a', campaign_name: 'Alpha', campaign_status: 'ENABLED', criterion_id: 1, zone_type: 'PROXIMITY', latitude: 43.6, longitude: 1.44, radius: 25, radius_unit: 'KILOMETERS', geo_target_id: null, label: null },
    { campaign_id: 'c', campaign_name: 'Charlie', campaign_status: 'ENABLED', criterion_id: 2, zone_type: 'LOCATION', latitude: null, longitude: null, radius: null, radius_unit: null, geo_target_id: 9, label: 'Blagnac' },
  ]
  const geo = [
    { geo_level: 'city', presence_type: 'LOCATION_OF_PRESENCE', geo_target_id: 1, ...M0, impressions: 90, clicks: 9, cost_micros: 4_000_000 },
    { geo_level: 'postal_code', presence_type: 'LOCATION_OF_PRESENCE', geo_target_id: 2, ...M0, impressions: 60 },
  ]
  const names = new Map([
    [1, { geo_target_id: 1, name: 'Toulouse', canonical_name: 'Toulouse,Occitanie,France', target_type: 'City', region_name: 'Occitanie' }],
    [2, { geo_target_id: 2, name: '31000', canonical_name: '31000,Occitanie,France', target_type: 'Postal Code', region_name: 'Occitanie' }],
  ])

  it('présence : villes en principal, codes postaux en détail, sans carte inventée', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsGeo.mockReturnValue(q(geo)); dataHooks.useGoogleGeoNames.mockReturnValue(q(names))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Zones' }).closest('section')!)
    expect(sec.getByText('Toulouse')).toBeInTheDocument()
    expect(sec.getByText('31000')).toBeInTheDocument() // dans le repli « Codes postaux (détail) »
    expect(sec.getByText(/Codes postaux \(détail\)/)).toBeInTheDocument()
    expect(sec.getByText(/d'où venaient les personnes qui ont vu vos annonces/)).toBeInTheDocument()
    expect(sec.getByText(/ne fournit pas de coordonnées pour les villes ni les codes postaux/)).toBeInTheDocument()
    expect(sec.queryByRole('img', { name: /Carte des zones/ })).not.toBeInTheDocument()
  })

  it('zones ciblées : carte SVG des rayons réels + zones nommées listées, non dessinées', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsZones.mockReturnValue(q(zones))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Zones' }).closest('section')!)
    fireEvent.click(sec.getByRole('button', { name: 'Zones ciblées' }))
    expect(sec.getByRole('img', { name: /Carte des zones ciblées : 1 rayon/ })).toBeInTheDocument()
    expect(sec.getByText('Rayon de 25 km')).toBeInTheDocument()
    expect(sec.getByText(/43,600° N, 1,440° E/)).toBeInTheDocument()
    expect(sec.getByText('Blagnac')).toBeInTheDocument()
    expect(sec.getByText(/les zones que vos campagnes cherchent à atteindre/)).toBeInTheDocument()
    expect(sec.getByText(/Google ne fournit pas de coordonnées pour les zones nommées/)).toBeInTheDocument()
  })

  it('zones nommées seules : aucune carte', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    dataHooks.useGoogleAdsZones.mockReturnValue(q([zones[1]]))
    renderPage()
    const sec = within(screen.getByRole('heading', { name: 'Zones' }).closest('section')!)
    fireEvent.click(sec.getByRole('button', { name: 'Zones ciblées' }))
    expect(sec.queryByRole('img', { name: /Carte/ })).not.toBeInTheDocument()
    expect(sec.getByText('Blagnac')).toBeInTheDocument()
  })
})

describe('GoogleAdsPage — synchronisation temporisée', () => {
  it('« Données déjà synchronisées récemment » (info), jamais « 0 ligne(s) »', async () => {
    fullStatus(); mockMetrics(CURRENT, [])
    statsHooks.useSyncGoogleAdsMetrics.mockReturnValue(mutationStub({ mutateAsync: vi.fn().mockResolvedValue({ ok: true, rowsUpserted: 0, throttled: true, nextAllowedAt: null, datasets: [] }) }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^synchroniser$/i }))
    await vi.waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1))
    const t = useToastStore.getState().toasts[0]
    expect(t.message).toBe('Données déjà synchronisées récemment.')
    expect(t.type).toBe('info')
    expect(t.message).not.toMatch(/ligne/)
  })
})

describe('GoogleAdsPage — compte connecté repliable', () => {
  it('résumé sur une ligne « Compte ····9574 · EUR · Europe/Paris » et bouton Gérer la connexion', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    expect(screen.getByText('Compte ····9574 · EUR · Europe/Paris')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gérer la connexion' })).toBeInTheDocument()
  })
})

describe('GoogleAdsPage — variations jamais absurdes', () => {
  it('jamais « +>999 % » ni de pourcentage géant', () => {
    fullStatus()
    mockMetrics(CURRENT, [mRow({ impressions: 5000, clicks: 20, cost_micros: 100_000_000 })])
    renderPage()
    expect(document.body.textContent).not.toMatch(/>\s?999|\+\s?\d{1,3}\s?\d{3}\s?%/)
  })
})

describe('GoogleAdsPage — liaison des lectures au compte (régression : identifiant masqué)', () => {
  it('les lectures utilisent l’identifiant COMPLET du compte, jamais le masque « ••• ••• 9574 »', () => {
    fullStatus(); mockMetrics(CURRENT, [])
    renderPage()
    for (const k of ['useGoogleAdsDevices', 'useGoogleAdsDemographics', 'useGoogleAdsGeo', 'useGoogleAdsHourly'] as const) {
      const ids = dataHooks[k].mock.calls.map((c) => c[0].customerId)
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids)).toEqual(new Set(['7536669574']))
    }
    for (const k of ['useGoogleAdsZones', 'useGoogleAdsCampaigns'] as const) {
      expect(new Set(dataHooks[k].mock.calls.map((c) => c[0]))).toEqual(new Set(['7536669574']))
    }
  })

  it('compte introuvable dans l’état de synchronisation : lectures désactivées, jamais de zéros présentés comme réels', () => {
    fullStatus(); mockMetrics([], [])
    dataHooks.useGoogleAdsSyncState.mockReturnValue(q([]))
    dataHooks.useGoogleAdsHourly.mockReturnValue(q(undefined))
    renderPage()
    fireEvent.click(periodBtn("Aujourd'hui"))
    expect(dataHooks.useGoogleAdsDevices.mock.calls.every((c) => c[0].customerId === null)).toBe(true)
    expect(screen.getByText(/aucune donnée synchronisée aujourd'hui/i)).toBeInTheDocument()
  })
})

describe('GoogleAdsPage — menu « Trier » (mobile)', () => {
  const CAMPS = [
    mRow({ campaign_id: 'a', campaign_name: 'Alpha', impressions: 100, clicks: 10, cost_micros: 5_000_000 }),
    mRow({ campaign_id: 'b', campaign_name: 'Bravo', impressions: 300, clicks: 30, cost_micros: 9_000_000 }),
    mRow({ campaign_id: 'c', campaign_name: 'Charlie', impressions: 200, clicks: 20, cost_micros: 1_000_000 }),
  ]
  const names = () => Array.from(document.querySelectorAll('.gads-cards .gads-card-name')).map((e) => e.textContent)

  it('changer le critère change réellement l’ordre ; le bouton inverse le sens', () => {
    fullStatus(); mockMetrics(CAMPS, [])
    renderPage()
    fireEvent.click(periodBtn('30 jours'))
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie']) // dépenses décroissantes
    fireEvent.change(screen.getByLabelText('Trier les campagnes'), { target: { value: 'impressions' } })
    expect(names()).toEqual(['Bravo', 'Charlie', 'Alpha'])
    fireEvent.change(screen.getByLabelText('Trier les campagnes'), { target: { value: 'name' } })
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    fireEvent.click(screen.getByLabelText(/Ordre croissant/))
    expect(names()).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(screen.getByLabelText(/Ordre décroissant/)).toBeInTheDocument()
  })
})
