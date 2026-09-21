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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
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
const TODAY = new Date().toISOString().slice(0, 10)
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
  status: 'connected', google_customer_id: '7536669574', last_synced_at: new Date().toISOString(), last_error: null,
}))

describe('GoogleAdsPage — KPI et comparaison', () => {
  it('affiche CTR, CPC moyen et coût par conversion calculés', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
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
    expect(screen.getByText(/comparaison indisponible/i)).toBeInTheDocument()
    expect(screen.queryByText('Nouveau')).not.toBeInTheDocument()
  })

  it('période précédente quasi vide : écart absolu, jamais un pourcentage absurde', () => {
    syncedStatus()
    mockMetrics(CURRENT, [mRow({ impressions: 40, clicks: 2, cost_micros: 1_000_000, conversions: 0 })])
    renderPage()
    expect(screen.getByText('+73')).toBeInTheDocument() // clics : 75 − 2
    expect(screen.queryByText(/3\s?650\s?%/)).not.toBeInTheDocument()
  })

  it('valeurs indéfinies affichées « — », pas 0 (aucune conversion → coût/conversion indéfini)', () => {
    syncedStatus(); mockMetrics([mRow({ impressions: 100, clicks: 5, cost_micros: 3_000_000, conversions: 0 })], [])
    renderPage()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('GoogleAdsPage — tableau des campagnes', () => {
  it('colonnes demandées, statut déduit, et total', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    for (const col of ['Campagne', 'Statut', 'Impressions', 'Clics', 'CTR', 'Dépenses', 'Conversions', 'Coût/conv.']) {
      expect(screen.getAllByText(col).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('Sans activité').length).toBeGreaterThan(0) // Zulu
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText(/statut déduit de l'activité/i)).toBeInTheDocument()
  })

  it('filtre par nom', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.change(screen.getByLabelText('Rechercher une campagne'), { target: { value: 'char' } })
    expect(screen.getAllByText('Charlie').length).toBeGreaterThan(0)
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Total affiché')).toBeInTheDocument()
  })

  it('filtre « Sans activité » et message si aucun résultat', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'inactive' } })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getAllByText('Zulu').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Rechercher une campagne'), { target: { value: 'introuvable' } })
    expect(screen.getByText(/aucune campagne ne correspond/i)).toBeInTheDocument()
  })

  it('tri par clic sur un en-tête (ordre inversé au second clic)', () => {
    syncedStatus(); mockMetrics(CURRENT, [])
    renderPage()
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
