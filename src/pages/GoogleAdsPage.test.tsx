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
import { render, screen, cleanup } from '@testing-library/react'
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

describe('GoogleAdsPage — configuration serveur manquante (developer token absent)', () => {
  it("affiche le texte exact exigé et jamais de bouton de synchronisation", () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({ status: 'connected', google_customer_id: null }))
    hooks.useLoadGoogleAdsAccounts.mockReturnValue(mutationStub({ data: { ok: false, reason: 'developer_token_missing' } }))
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
