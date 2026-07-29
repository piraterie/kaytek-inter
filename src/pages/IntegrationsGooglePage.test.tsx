// @vitest-environment jsdom
// src/pages/IntegrationsGooglePage.test.tsx
//
// Tests de COMPOSANT pour la page de connexion Google (Ads + Business
// Profile), accessible depuis l'entrée de navigation "Connexion Google"
// (Administration → réservé aux administrateurs, voir AppLayout.tsx et
// App.tsx). Les hooks réseau (@/lib/hooks/googleIntegrations) sont
// intégralement mockés : ce fichier vérifie le comportement du composant
// face aux différents statuts renvoyés par le backend (non connecté /
// connecté / jeton expiré / erreur), et garantit qu'aucun jeton ne peut
// jamais apparaître dans le DOM rendu ni qu'une déconnexion ne parte sans
// confirmation explicite. La logique des Edge Functions elles-mêmes (state
// OAuth, parsing Google Ads/Business) est couverte séparément par
// supabase/functions/_shared/*.test.ts (voir npm run test:deno).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import IntegrationsGooglePage from './IntegrationsGooglePage'
import { useToastStore } from '@/lib/store'

const FAKE_SECRET = 'ya29.FAKE_ACCESS_TOKEN_SHOULD_NEVER_RENDER'

const hooks = vi.hoisted(() => ({
  useGoogleOAuthStatus: vi.fn(),
  useConnectGoogle: vi.fn(),
  useDisconnectGoogle: vi.fn(),
  useLoadGoogleAdsAccounts: vi.fn(),
  useLoadGoogleBusinessLocations: vi.fn(),
  useSelectGoogleAdsAccount: vi.fn(),
  useSelectGoogleBusinessLocation: vi.fn(),
}))

vi.mock('@/lib/hooks/googleIntegrations', () => ({
  useGoogleOAuthStatus: hooks.useGoogleOAuthStatus,
  useConnectGoogle: hooks.useConnectGoogle,
  useDisconnectGoogle: hooks.useDisconnectGoogle,
  useLoadGoogleAdsAccounts: hooks.useLoadGoogleAdsAccounts,
  useLoadGoogleBusinessLocations: hooks.useLoadGoogleBusinessLocations,
  useSelectGoogleAdsAccount: hooks.useSelectGoogleAdsAccount,
  useSelectGoogleBusinessLocation: hooks.useSelectGoogleBusinessLocation,
}))

function mutationStub(overrides: Partial<{ mutate: (...a: any[]) => void; isPending: boolean; variables: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides }
}

function disconnectedStatus() {
  return {
    google_ads: { status: 'disconnected' as const },
    google_business: { status: 'disconnected' as const },
  }
}

function statusQuery(overrides: Partial<{ data: any; isLoading: boolean; isError: boolean; error: unknown; refetch: (...a: any[]) => void }> = {}) {
  return { data: disconnectedStatus(), isLoading: false, isError: false, error: null, refetch: vi.fn(), ...overrides }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IntegrationsGooglePage />
    </MemoryRouter>
  )
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.setState({ toasts: [] })
  hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery())
  hooks.useConnectGoogle.mockReturnValue(mutationStub())
  hooks.useDisconnectGoogle.mockReturnValue(mutationStub())
  hooks.useLoadGoogleAdsAccounts.mockReturnValue(mutationStub())
  hooks.useLoadGoogleBusinessLocations.mockReturnValue(mutationStub())
  hooks.useSelectGoogleAdsAccount.mockReturnValue(mutationStub())
  hooks.useSelectGoogleBusinessLocation.mockReturnValue(mutationStub())
})

describe('IntegrationsGooglePage — état non connecté', () => {
  it('affiche un bouton de connexion pour chaque intégration, aucun faux statut connecté', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /connecter google ads/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connecter google business profile/i })).toBeInTheDocument()
    expect(screen.getAllByText('Non connecté')).toHaveLength(2)
    expect(screen.queryByText('Connecté')).not.toBeInTheDocument()
  })
})

describe('IntegrationsGooglePage — état connecté', () => {
  it('affiche l\'email du compte Google et le statut, sans bouton "Connecter"', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      data: {
        google_ads: { status: 'connected', google_account_email: 'admin@kaytek-test.fr', connected_at: '2026-07-20T10:00:00.000Z' },
        google_business: { status: 'disconnected' },
      },
    }))
    renderPage()
    expect(screen.getByText('Connecté')).toBeInTheDocument()
    expect(screen.getByText(/admin@kaytek-test\.fr/)).toBeInTheDocument()
    expect(screen.getByText(/connecté le/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connecter google ads/i })).not.toBeInTheDocument()
  })
})

describe('IntegrationsGooglePage — jeton expiré', () => {
  it('affiche une action de reconnexion explicite, distincte de la déconnexion', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      data: {
        google_ads: { status: 'expired', google_account_email: 'admin@kaytek-test.fr' },
        google_business: { status: 'disconnected' },
      },
    }))
    renderPage()
    expect(screen.getByText(/connexion a expiré/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /se reconnecter/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^déconnecter$/i })).toBeInTheDocument()
  })
})

describe('IntegrationsGooglePage — erreur API', () => {
  it('affiche un message compréhensible avec une action pour réessayer', () => {
    const refetch = vi.fn()
    hooks.useGoogleOAuthStatus.mockReturnValue(
      statusQuery({ data: undefined, isError: true, error: new Error('Session invalide'), refetch })
    )
    renderPage()
    expect(screen.getByText(/impossible de récupérer le statut/i)).toBeInTheDocument()
    expect(screen.getByText(/session invalide/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('IntegrationsGooglePage — sécurité', () => {
  it('ne rend jamais un jeton/secret dans le DOM, même si le backend en renvoyait un par erreur', () => {
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      data: {
        google_ads: {
          status: 'connected', google_account_email: 'admin@kaytek-test.fr',
          // Champs qui ne devraient jamais exister sur la réponse réelle
          // (voir google-oauth-status/index.ts — SELECT explicite sans les
          // colonnes *_secret_id) — présents ici uniquement pour prouver
          // que le composant ne les afficherait pas s'ils fuitaient.
          access_token_secret_id: FAKE_SECRET, refresh_token_secret_id: FAKE_SECRET,
        },
        google_business: { status: 'disconnected' },
      },
    }))
    const { container } = renderPage()
    expect(container.textContent).not.toContain(FAKE_SECRET)
    expect(container.innerHTML).not.toContain(FAKE_SECRET)
  })
})

describe('IntegrationsGooglePage — déconnexion', () => {
  it('demande une confirmation avant d\'appeler la mutation de déconnexion', () => {
    const mutate = vi.fn()
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      data: {
        google_ads: { status: 'connected', google_account_email: 'admin@kaytek-test.fr' },
        google_business: { status: 'disconnected' },
      },
    }))
    hooks.useDisconnectGoogle.mockReturnValue(mutationStub({ mutate }))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^déconnecter$/i }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText(/déconnecter google ads ?\?/i)).toBeInTheDocument()

    // Deux boutons "Déconnecter" coexistent une fois la modale ouverte (celui
    // de la carte + celui de confirmation) — le dernier du DOM est celui de
    // la modale (rendue après les cartes dans l'arbre du composant).
    const buttons = screen.getAllByRole('button', { name: /^déconnecter$/i })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(buttons[buttons.length - 1])
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('annuler la confirmation n\'appelle jamais la mutation de déconnexion', () => {
    const mutate = vi.fn()
    hooks.useGoogleOAuthStatus.mockReturnValue(statusQuery({
      data: {
        google_ads: { status: 'connected', google_account_email: 'admin@kaytek-test.fr' },
        google_business: { status: 'disconnected' },
      },
    }))
    hooks.useDisconnectGoogle.mockReturnValue(mutationStub({ mutate }))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^déconnecter$/i }))
    fireEvent.click(screen.getByRole('button', { name: /annuler/i }))
    expect(mutate).not.toHaveBeenCalled()
  })
})
