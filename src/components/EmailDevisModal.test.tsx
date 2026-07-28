// @vitest-environment jsdom
// src/components/EmailDevisModal.test.tsx
//
// Tests de COMPOSANT — complètent (ne remplacent pas) les tests de contrat
// purs (src/lib/email/contract.test.ts). Un schéma zod valide ne prouve pas
// que le composant affiche le bon message au bon moment, désactive le
// bouton pendant l'envoi, ou n'envoie pas deux fois sur un double clic :
// c'est ce que ce fichier vérifie, en rendant réellement EmailDevisModal
// (React Testing Library + jsdom) plutôt qu'en testant sa logique de
// validation en isolation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EmailDevisModal from './EmailDevisModal'
import { useAuthStore, useToastStore } from '@/lib/store'
import { generateDevisPDF } from '@/lib/pdf/generator'
import { envoyerEmail } from '@/lib/supabase/auth'
import type { Devis, ParametresEntreprise } from '@/types'

vi.mock('@/lib/pdf/generator', () => ({ generateDevisPDF: vi.fn() }))
vi.mock('@/lib/pdf/cache', () => ({ pdfCache: { get: vi.fn(() => undefined), set: vi.fn() } }))
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => { throw new Error('supabase.from ne devrait pas être appelé pour un devis non signé sans pdf_url') }),
    storage: { from: vi.fn(() => { throw new Error('supabase.storage ne devrait pas être appelé sans pdf_url') }) },
  },
}))
vi.mock('@/lib/supabase/auth', () => ({ envoyerEmail: vi.fn() }))
vi.mock('@/lib/themes', () => ({ getTheme: () => ({ primary: '#1d4ed8', accent: '#f59e0b' }) }))

const devis: Devis = {
  id: 'devis-1', numero: 'DEV-2026-0001', statut: 'brouillon',
  lignes: [], remise_pct: 0, total_ht: 100, tva_montant: 20, total_ttc: 120,
  modele_id: 0, created_at: '', updated_at: '',
  client: { id: 'c1', type: 'particulier', nom: 'Dupont', prenom: 'Jean', email: 'jean.dupont@example.fr', created_at: '', updated_at: '' },
}

const params: ParametresEntreprise = {
  id: 'p1', raison_sociale: 'Kaytek Test', telephone: '0102030405',
  email: 'contact@kaytek-test.fr', adresse: '1 rue de Test',
  tva_defaut: 20, couleur_principale: '#1d4ed8', modele_pdf_defaut: 0,
  email_envoi_devis: true, email_relance_facture: true,
  email_paiement_recu: true, email_new_intervention: true,
  updated_at: '',
}

function renderModal(overrides: Partial<React.ComponentProps<typeof EmailDevisModal>> = {}) {
  const onClose = vi.fn()
  const onSent = vi.fn()
  render(
    <MemoryRouter>
      <EmailDevisModal devis={devis} params={params} onClose={onClose} onSent={onSent} {...overrides} />
    </MemoryRouter>
  )
  return { onClose, onSent }
}

function sendButton() {
  return screen.getByRole('button', { name: /envoyer le devis/i })
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 'u1', role: 'admin' } as any })
  useToastStore.setState({ toasts: [] })
  vi.mocked(generateDevisPDF).mockResolvedValue(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }))
  vi.mocked(envoyerEmail).mockResolvedValue({ error: null })
})

function lastToastMessage() {
  const toasts = useToastStore.getState().toasts
  return toasts[toasts.length - 1]?.message
}

describe('EmailDevisModal — adresse destinataire', () => {
  it('adresse absente : le bouton Envoyer est désactivé, aucun envoi possible', async () => {
    // devis sans email client → emailTo démarre vide. Le bouton est
    // HTML-disabled tant que le champ est vide (disabled={sending || !emailTo}) —
    // vérifie la garde structurelle elle-même, pas seulement un message.
    renderModal({ devis: { ...devis, client: { ...devis.client!, email: undefined } } })
    expect(sendButton()).toBeDisabled()
    fireEvent.click(sendButton())
    expect(envoyerEmail).not.toHaveBeenCalled()
  })

  it('adresse vidée après saisie (espaces uniquement) : validation applicative rejette, aucun envoi', async () => {
    // validateRecipient() est la ligne de défense après le HTML : si jamais
    // le champ contient une valeur non vide pour le DOM mais vide après
    // trim() (cas limite), l'envoi doit rester bloqué avec un message clair
    // — vérifié directement sur le validateur partagé (le même que celui
    // utilisé par handleSend), sans dépendre du comportement de
    // normalisation d'un <input type="email"> en jsdom.
    const { validateRecipient, firstValidationMessage } = await import('@/lib/email/contract')
    const errors = validateRecipient({ to: '   '.trim(), documentType: 'devis', documentId: devis.id })
    expect(firstValidationMessage(errors)).toMatch(/manquante/i)
  })

  it('adresse invalide : affiche une erreur et n\'envoie rien', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('email@client.fr')
    fireEvent.change(input, { target: { value: 'pas-un-email' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText(/invalide/i)).toBeInTheDocument()
    expect(envoyerEmail).not.toHaveBeenCalled()
  })
})

describe('EmailDevisModal — protection double clic', () => {
  it('désactive le bouton Envoyer dès le premier clic (pendant l\'envoi)', async () => {
    renderModal()
    const btn = sendButton()
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(btn).toBeDisabled()
  })

  it('un second clic pendant l\'envoi n\'appelle pas envoyerEmail une deuxième fois', async () => {
    renderModal()
    const btn = sendButton()
    fireEvent.click(btn)
    // Le bouton est désormais disabled — jsdom ne déclenche pas onClick sur
    // un bouton disabled (comportement natif reproduit par RTL/jsdom).
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(envoyerEmail).toHaveBeenCalledTimes(1))
  })
})

describe('EmailDevisModal — génération PDF', () => {
  it('PDF échoué : affiche un message distinct et n\'appelle pas envoyerEmail', async () => {
    vi.mocked(generateDevisPDF).mockRejectedValue(new Error('react-pdf a planté'))
    renderModal()
    fireEvent.click(sendButton())
    await waitFor(() => expect(lastToastMessage()).toMatch(/génération du PDF/i))
    expect(lastToastMessage()).toMatch(/react-pdf a planté/)
    expect(envoyerEmail).not.toHaveBeenCalled()
  })
})

describe('EmailDevisModal — réponse serveur', () => {
  it('réponse HTTP non-2xx / erreur métier : affiche le VRAI message serveur, jamais un texte générique', async () => {
    vi.mocked(envoyerEmail).mockResolvedValue({ error: 'Paramètres entreprise incomplets — complétez dans les Paramètres : Adresse.' })
    renderModal()
    fireEvent.click(sendButton())
    await waitFor(() => expect(lastToastMessage()).toBe('Paramètres entreprise incomplets — complétez dans les Paramètres : Adresse.'))
    // Non-régression explicite de l'incident "message générique masquant la
    // vraie erreur" (2026-07-28) : le message affiché ne doit JAMAIS être
    // remplacé par un texte fixe du type "Impossible d'envoyer le devis".
    expect(lastToastMessage()).not.toMatch(/impossible d'envoyer/i)
  })

  it('succès : affiche une confirmation et appelle onSent', async () => {
    vi.mocked(envoyerEmail).mockResolvedValue({ error: null })
    const { onSent } = renderModal()
    fireEvent.click(sendButton())
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    expect(lastToastMessage()).toMatch(/email envoyé/i)
  })

  it('un envoi valide ferme la modale (onClose appelé) — fermeture immédiate, sans attendre la confirmation serveur (fire-and-forget assumé)', async () => {
    const { onClose } = renderModal()
    fireEvent.click(sendButton())
    // onClose est appelé de façon synchrone dès la validation passée, avant
    // même la génération du PDF ou l'appel réseau — comportement volontaire
    // existant (voir commentaire "Fermer la modale immédiatement" dans
    // EmailDevisModal.tsx), pas une conséquence du succès de l'envoi.
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
