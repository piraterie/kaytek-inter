// @vitest-environment jsdom
// src/components/ClientAutocomplete.test.tsx
//
// Couvre les critères obligatoires de la refonte du champ "Client" de
// /devis/nouveau (menu déroulant → recherche avec suggestions) : apparition
// dès la 1re lettre, recherche restreinte au prénom/nom (insensible à la
// casse et aux accents), plafond de 10 suggestions, non-sélection au
// défilement mobile, sélection uniquement sur clic/tap volontaire, et
// identifiant client correctement transmis au parent. L'isolation
// multi-organisation n'est pas testée ici : ce composant ne fait aucun
// appel réseau, il affiche uniquement la liste `clients` reçue en props —
// déjà scopée par organisation par useClients()/RLS (voir DevisFormPage).
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientAutocomplete } from './ClientAutocomplete'
import type { Client } from '@/types'

afterEach(cleanup)

function makeClient(overrides: Partial<Client> & { id: string; nom: string }): Client {
  return {
    type: 'particulier', created_at: '2026-01-01', updated_at: '2026-01-01',
    ...overrides,
  } as Client
}

const CLIENTS: Client[] = [
  makeClient({ id: '1', nom: 'Dupont', prenom: 'Marie', telephone: '0600000001' }),
  makeClient({ id: '2', nom: 'Martin', prenom: 'Éric', telephone: '0600000002' }),
  makeClient({ id: '3', nom: 'Durand', prenom: 'Paul', email: 'paul@example.com' }),
  makeClient({ id: '4', nom: 'Lefèvre', prenom: 'Amélie' }),
]

describe('ClientAutocomplete — apparition des suggestions', () => {
  it('affiche les suggestions dès la première lettre tapée (prénom)', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'M')
    expect(screen.getByRole('option', { name: 'Marie Dupont' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Paul Durand' })).not.toBeInTheDocument()
  })

  it('affiche les suggestions dès la première lettre tapée (nom)', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'D')
    expect(screen.getByRole('option', { name: 'Marie Dupont' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Paul Durand' })).toBeInTheDocument()
  })

  it('ne montre aucune suggestion tant que le champ est vide', () => {
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('se met à jour au fur et à mesure de la saisie', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'Ma')
    expect(screen.getByRole('option', { name: 'Marie Dupont' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Éric Martin' })).toBeInTheDocument()
    await user.type(input, 'rie')
    expect(screen.getByRole('option', { name: 'Marie Dupont' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Éric Martin' })).not.toBeInTheDocument()
  })
})

describe('ClientAutocomplete — insensibilité casse/accents', () => {
  it('ignore la casse', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'marie')
    expect(screen.getByRole('option', { name: 'Marie Dupont' })).toBeInTheDocument()
  })

  it('ignore les accents dans la requête', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'eric')
    expect(screen.getByRole('option', { name: 'Éric Martin' })).toBeInTheDocument()
  })

  it('ignore les accents portés par le client même si la requête en contient', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'lefevre')
    expect(screen.getByRole('option', { name: 'Amélie Lefèvre' })).toBeInTheDocument()
  })
})

describe('ClientAutocomplete — restriction du champ de recherche', () => {
  it('ne recherche pas sur le téléphone ou l\'email', async () => {
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), '0600000001')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('combobox'))
    await user.type(screen.getByRole('combobox'), 'example.com')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('ClientAutocomplete — plafond de suggestions', () => {
  it('n\'affiche jamais plus de 10 suggestions', async () => {
    const many: Client[] = Array.from({ length: 25 }, (_, i) =>
      makeClient({ id: String(i), nom: `Dupont${i}`, prenom: 'Jean' })
    )
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={many} value="" onSelect={vi.fn()} />)
    await user.type(screen.getByRole('combobox'), 'j')
    expect(screen.getAllByRole('option')).toHaveLength(10)
  })
})

describe('ClientAutocomplete — sélection volontaire uniquement', () => {
  it('un clic sur une suggestion sélectionne le client et transmet le bon identifiant', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={onSelect} />)
    await user.type(screen.getByRole('combobox'), 'Marie')
    await user.click(screen.getByRole('option', { name: 'Marie Dupont' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })

  it('affiche "Prénom Nom" dans le champ après sélection et ferme la liste', () => {
    const { rerender } = render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={vi.fn()} />)
    rerender(<ClientAutocomplete clients={CLIENTS} value="1" onSelect={vi.fn()} />)
    expect(screen.getByText('Marie Dupont')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('un clic sur "✕" efface la sélection et permet de rechercher à nouveau', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ClientAutocomplete clients={CLIENTS} value="1" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /effacer la sélection/i }))
    expect(onSelect).toHaveBeenCalledWith(null)
    rerender(<ClientAutocomplete clients={CLIENTS} value="" onSelect={onSelect} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('un simple défilement (pointerdown puis pointerup décalé) sur la liste ne sélectionne aucun client', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={onSelect} />)
    await user.type(screen.getByRole('combobox'), 'a')
    const option = screen.getAllByRole('option')[0]

    // Simule un doigt qui appuie puis glisse (défilement tactile) avant de
    // relâcher sur la suggestion — ne doit jamais déclencher la sélection.
    fireEvent.pointerDown(option, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(option, { clientX: 100, clientY: 40 })
    fireEvent.click(option)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('un tap sans déplacement significatif sélectionne bien le client', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ClientAutocomplete clients={CLIENTS} value="" onSelect={onSelect} />)
    await user.type(screen.getByRole('combobox'), 'Marie')
    const option = screen.getByRole('option', { name: 'Marie Dupont' })

    fireEvent.pointerDown(option, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(option, { clientX: 101, clientY: 99 })
    fireEvent.click(option)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })
})
