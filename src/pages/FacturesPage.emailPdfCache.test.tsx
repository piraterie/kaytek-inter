// @vitest-environment jsdom
// src/pages/FacturesPage.emailPdfCache.test.tsx
//
// Régression — bug "facture payée envoyée par e-mail affiche IMPAYÉE" :
// pdfCache (src/lib/pdf/cache.ts) est un cache mémoire indexé par facture.id,
// pré-rempli dès l'ouverture de la fiche (openSheet) avec le statut affiché à
// ce moment-là. Si l'utilisateur marque ensuite la facture payée puis
// l'envoie par e-mail, handleEmail() lisait ce cache en priorité et
// réutilisait le PDF "impayée" généré avant le changement de statut — alors
// que le téléchargement manuel (dlPDF) ignore le cache et régénère toujours
// à la volée, donc affichait toujours le bon statut. Le correctif fait
// invalider pdfCache par useUpdateFacture (comme c'était déjà le cas pour
// useUpdateDevis). Ce test reproduit le scénario exact : ouverture de la
// fiche (impayée, pré-génère le cache) → marquage payée → envoi email → le
// PDF joint doit refléter PAYÉE, jamais le blob périmé.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import FacturesPage from './FacturesPage'
import { useAuthStore, useParamsStore } from '@/lib/store'
import { pdfCache } from '@/lib/pdf/cache'
import type { Facture, ParametresEntreprise, Profile } from '@/types'

// État partagé, accessible depuis les factories vi.mock (hoisted) et le corps du test.
const shared = vi.hoisted(() => ({ statut: 'impayee' as string }))
const captured = vi.hoisted(() => ({ payload: null as any }))

// Encode le statut reçu dans le contenu du blob — permet de vérifier, sans
// dépendre du rendu binaire réel de @react-pdf/renderer, quelle donnée de
// facture a servi à générer le PDF joint à l'email.
vi.mock('@/lib/pdf/generator', () => ({
  generateFacturePDF: vi.fn(async (facture: Facture) =>
    new Blob([facture.statut_paiement === 'payee' ? 'STATUT:PAYEE' : 'STATUT:IMPAYEE'], { type: 'application/pdf' })
  ),
  downloadBlob: vi.fn(),
}))

vi.mock('@/lib/supabase/auth', () => ({
  envoyerEmail: vi.fn(async (payload: any) => { captured.payload = payload; return { error: null } }),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (data: any) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            if (data.statut_paiement) shared.statut = data.statut_paiement
            return { data: [{ id, statut_paiement: shared.statut }], error: null }
          },
        }),
      }),
    })),
    storage: { from: vi.fn(() => ({ download: vi.fn() })) },
  },
}))

vi.mock('@/lib/hooks/googleReviewRequests', () => ({
  useCreateReviewRequest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

const paramsFixture: ParametresEntreprise = {
  id: 'p1', raison_sociale: 'Kaytek Inter', telephone: '0102030405',
  email: 'contact@kaytekinter.fr', adresse: '1 rue des Serruriers',
  code_postal: '75001', ville: 'Paris', siret: '12345678900011',
  rc_pro: 'RC12345', tva_defaut: 20, couleur_principale: '#1d4ed8',
  modele_pdf_defaut: 0,
  email_envoi_devis: true, email_relance_facture: true,
  email_paiement_recu: true, email_new_intervention: true,
  updated_at: new Date().toISOString(),
  delai_impaye_jours: 30, rappel_defaut_actif: true,
  rappel_defaut_decalages: [], modeles_relance_echeance: {},
}

function makeFacture(): Facture {
  return {
    id: 'f1', numero: 'FAC-2026-0099', statut_paiement: shared.statut as Facture['statut_paiement'],
    montant_ht: 100, tva_montant: 20, montant_ttc: 120, acompte_recu: 0,
    date_emission: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    client: { id: 'c1', type: 'particulier', nom: 'Dupont', prenom: 'Jean', email: 'jean@example.fr', created_at: '', updated_at: '' },
  }
}

// useFactures est remplacé par un vrai useQuery sur la même clé ['factures']
// que celle invalidée par useUpdateFacture (conservé réel) — pour que le
// refetch déclenché par la mutation se propage jusqu'au composant, exactement
// comme en production.
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>()
  return {
    ...actual,
    useFactures: () => useQuery({ queryKey: ['factures'], queryFn: async () => [makeFacture()] }),
    useParametres: () => ({ data: paramsFixture, isLoading: false }),
    usePublicParametres: () => ({ data: paramsFixture, isLoading: false }),
    useCreatePublicLink: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    notifyAdmins: vi.fn(async () => {}),
  }
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FacturesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

beforeEach(() => {
  shared.statut = 'impayee'
  captured.payload = null
  pdfCache.del('f1')
  useAuthStore.setState({
    user: {
      id: 'u1', role: 'intervenant', nom: 'Martin', prenom: 'Alex', email: 'alex@kaytekinter.fr',
      commission_pct: 0, actif: true, can_create_documents: true, can_bypass_validation: true,
      created_at: '', updated_at: '', organisation_id: 'org1',
    } as Profile,
  })
  useParamsStore.setState({ params: paramsFixture })
})

describe('FacturesPage — régression PDF email périmé après marquage payé', () => {
  it('facture payée → envoi e-mail → PDF joint reflète PAYÉE, pas le PDF pré-généré en cache quand elle était impayée', async () => {
    const user = userEvent.setup()
    renderPage()

    // La page rend simultanément une liste mobile et un tableau desktop
    // (masqués l'un/l'autre en CSS, tous deux présents dans le DOM jsdom) —
    // on scope les vérifications de ligne au tableau desktop pour éviter les
    // doublons, et on clique via le bouton "Email" (texte, mobile) qui reste
    // unique dans tout le document.
    const table = await screen.findByRole('table')
    await within(table).findByText('FAC-2026-0099')
    expect(within(table).getByText('Impayée')).toBeInTheDocument()

    // Ouvre la fiche facture (impayée) → pré-génère et met en cache le PDF "impayée" (openSheet)
    await user.click(within(table).getByRole('button', { name: 'Actions' }))
    await screen.findByText("C'est payé")
    await waitFor(() => expect(pdfCache.get('f1')).toBeDefined())
    expect(await pdfCache.get('f1')!.text()).toBe('STATUT:IMPAYEE')

    // Marque la facture payée depuis la fiche
    await user.click(screen.getByText("C'est payé"))
    await waitFor(() => expect(within(table).getByText('Payée')).toBeInTheDocument())

    // Envoie la facture (désormais payée) par e-mail
    await user.click(screen.getByRole('button', { name: 'Email' }))

    await waitFor(() => expect(captured.payload).not.toBeNull())
    const pdfText = atob(captured.payload.pdfBase64)
    expect(pdfText).toBe('STATUT:PAYEE')
    expect(pdfText).not.toBe('STATUT:IMPAYEE')
  })
})
