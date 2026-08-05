// @vitest-environment jsdom
// src/pages/GooglePerformancePage.test.tsx
//
// Vérifie que la page de statistiques Google Business Profile distingue
// clairement "jamais synchronisé" (aucune statistique à zéro affichée) de
// "synchronisé mais aucune donnée sur la période" (tableau de bord réel,
// simplement vide) et affiche la date de dernière synchronisation réussie.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GooglePerformancePage from './GooglePerformancePage'

const hooks = vi.hoisted(() => ({ useGoogleOAuthStatus: vi.fn() }))
const statsHooks = vi.hoisted(() => ({
  useGbpPerformanceMetrics: vi.fn(),
  useSyncGbpPerformance: vi.fn(),
}))

vi.mock('@/lib/hooks/googleIntegrations', () => ({ useGoogleOAuthStatus: hooks.useGoogleOAuthStatus }))
vi.mock('@/lib/hooks/googleStats', () => ({
  useGbpPerformanceMetrics: statsHooks.useGbpPerformanceMetrics,
  useSyncGbpPerformance: statsHooks.useSyncGbpPerformance,
}))

function mutationStub(overrides: Partial<{ mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean }> = {}) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, ...overrides }
}

function statusQuery(googleBusiness: any) {
  return { data: { google_ads: { status: 'disconnected' }, google_business: googleBusiness }, isLoading: false }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <GooglePerformancePage />
    </MemoryRouter>
  )
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  statsHooks.useGbpPerformanceMetrics.mockReturnValue({ data: [], isLoading: false, isError: false, error: null })
  statsHooks.useSyncGbpPerformance.mockReturnValue(mutationStub())
})

describe('GooglePerformancePage — établissement sélectionné mais jamais synchronisé', () => {
  it('bloque le tableau de bord et ne montre aucune statistique à zéro', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_location_id: 'loc-1', last_synced_at: null, last_error: null,
    }))
    renderPage()
    expect(screen.getByText("Aucune synchronisation n'a encore été effectuée")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /synchroniser maintenant/i })).toBeInTheDocument()
    expect(screen.queryByText('Appels')).not.toBeInTheDocument()
  })
})

describe('GooglePerformancePage — synchronisé avec des données à zéro sur la période', () => {
  it('affiche le vrai tableau de bord (pas de blocage) avec la date de dernière synchro', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_location_id: 'loc-1', last_synced_at: '2026-08-01T09:00:00.000Z', last_error: null,
    }))
    renderPage()
    expect(screen.getByText(/dernière synchronisation réussie/i)).toBeInTheDocument()
    expect(screen.getByText('Appels')).toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })
})

describe('GooglePerformancePage — erreur API lors de la dernière synchronisation', () => {
  it('affiche un bandeau d\'erreur distinct de l\'état "jamais synchronisé"', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      status: 'connected', google_location_id: 'loc-1',
      last_synced_at: '2026-08-01T09:00:00.000Z', last_error: 'GOOGLE_API_UNAVAILABLE',
    }))
    renderPage()
    expect(screen.getByText(/tentative de synchronisation a échoué/i)).toBeInTheDocument()
    expect(screen.getByText(/GOOGLE_API_UNAVAILABLE/)).toBeInTheDocument()
    expect(screen.queryByText("Aucune synchronisation n'a encore été effectuée")).not.toBeInTheDocument()
  })
})
