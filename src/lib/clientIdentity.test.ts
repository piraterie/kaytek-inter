// src/lib/clientIdentity.test.ts
// Tests unitaires de la normalisation des coordonnées client pour les
// devis/factures (aperçu, PDF, e-mail). Exécution : npx vitest run
// src/lib/clientIdentity.test.ts
import { describe, it, expect } from 'vitest'
import { buildClientIdentity, resolveClientIdentity, formatAddressLines, formatFullIdentityBlock } from './clientIdentity'
import type { Client } from '@/types'

const baseClient = (overrides: Partial<Client> = {}): Partial<Client> => ({
  id: 'c1', type: 'particulier', nom: 'Dupont', prenom: 'Marie',
  telephone: '0601020304', email: 'marie@example.test',
  ...overrides,
})

describe('buildClientIdentity — particulier', () => {
  it('adresse complète', () => {
    const identity = buildClientIdentity(baseClient({ adresse_intervention: '12 Rue des Lilas 31450 Baziège' }))
    expect(identity?.displayName).toBe('Marie Dupont')
    expect(identity?.companyName).toBeUndefined()
    expect(identity?.contactName).toBeUndefined() // pas de répétition du nom pour un particulier
    expect(identity?.addressLine1).toBe('12 Rue des Lilas 31450 Baziège')
    expect(formatAddressLines(identity)).toEqual(['12 Rue des Lilas 31450 Baziège'])
  })

  it('caractères accentués conservés', () => {
    const identity = buildClientIdentity(baseClient({ nom: 'Béranger', prenom: 'Émilie', adresse_intervention: '3 Allée du Château 75001 Paris' }))
    expect(identity?.displayName).toBe('Émilie Béranger')
    expect(formatAddressLines(identity)).toEqual(['3 Allée du Château 75001 Paris'])
  })

  it('adresse partielle (rien du tout)', () => {
    const identity = buildClientIdentity(baseClient())
    expect(identity?.displayName).toBe('Marie Dupont')
    expect(identity?.addressLine1).toBeUndefined()
    expect(formatAddressLines(identity)).toEqual([])
  })

  it('adresse longue', () => {
    const longue = '128 bis Avenue du Général de Gaulle, Résidence Les Terrasses du Parc, Bâtiment C 3ème étage 31450 Baziège'
    const identity = buildClientIdentity(baseClient({ adresse_intervention: longue }))
    expect(identity?.addressLine1).toBe(longue)
    expect(formatAddressLines(identity)).toEqual([longue])
  })

  it('cp_intervention/ville_intervention utilisées si présentes (ligne séparée)', () => {
    const identity = buildClientIdentity(baseClient({
      adresse_intervention: '12 Rue des Lilas', cp_intervention: '31450', ville_intervention: 'Baziège',
    }))
    expect(formatAddressLines(identity)).toEqual(['12 Rue des Lilas', '31450 Baziège'])
  })

  it('pays non renseigné — jamais affiché', () => {
    const identity = buildClientIdentity(baseClient({ adresse_intervention: '12 Rue des Lilas 31450 Baziège' }))
    expect(identity?.country).toBeUndefined()
    expect(formatAddressLines(identity).join(' ')).not.toContain('undefined')
  })
})

describe('buildClientIdentity — professionnel', () => {
  it('société + adresse complète', () => {
    const identity = buildClientIdentity(baseClient({
      type: 'professionnel', raison_sociale: 'Société Exemple', adresse_intervention: '12 rue des Lilas 31450 Baziège',
    }))
    expect(identity?.displayName).toBe('Société Exemple')
    expect(identity?.companyName).toBe('Société Exemple')
    expect(identity?.contactName).toBe('Marie Dupont')
    expect(formatFullIdentityBlock(identity)).toEqual([
      'Société Exemple', 'Marie Dupont', '12 rue des Lilas 31450 Baziège',
    ])
  })
})

describe('formatAddressLines / formatFullIdentityBlock — hygiène du texte', () => {
  it('aucune ligne vide, aucun undefined/null/N/A/virgule isolée', () => {
    const identity = buildClientIdentity(baseClient({ nom: 'Martin', prenom: undefined, adresse_intervention: undefined }))
    const block = formatFullIdentityBlock(identity)
    for (const line of block) {
      expect(line).not.toMatch(/undefined|null|N\/A/i)
      expect(line.trim()).not.toBe('')
      expect(line.trim()).not.toBe(',')
    }
  })

  it('pas de double espace même avec des champs mal saisis (espaces superflus)', () => {
    const identity = buildClientIdentity(baseClient({ nom: '  Martin  ', prenom: '  Paul  ' }))
    expect(identity?.displayName).toBe('Paul Martin')
    expect(identity?.displayName).not.toMatch(/ {2,}/)
  })

  it('client absent — identité null, aucune ligne', () => {
    expect(buildClientIdentity(null)).toBeNull()
    expect(buildClientIdentity(undefined)).toBeNull()
    expect(formatAddressLines(null)).toEqual([])
    expect(formatFullIdentityBlock(undefined)).toEqual([])
  })
})

describe('resolveClientIdentity — priorité snapshot > fiche client (règle de non-rétroactivité)', () => {
  it('snapshot présent : utilisé tel quel, même si la fiche client "actuelle" a changé depuis', () => {
    const snapshot = {
      displayName: 'Ancien Nom', addressLine1: '1 Ancienne Rue 75000 Paris',
    }
    const currentClient = baseClient({ nom: 'NouveauNom', adresse_intervention: '99 Nouvelle Rue 69000 Lyon' })
    const identity = resolveClientIdentity(snapshot, currentClient)
    expect(identity?.displayName).toBe('Ancien Nom')
    expect(formatAddressLines(identity)).toEqual(['1 Ancienne Rue 75000 Paris'])
  })

  it('aucun snapshot (document ancien) : repli sur la fiche client', () => {
    const currentClient = baseClient({ adresse_intervention: '5 Rue Actuelle 33000 Bordeaux' })
    const identity = resolveClientIdentity(null, currentClient)
    expect(identity?.displayName).toBe('Marie Dupont')
    expect(formatAddressLines(identity)).toEqual(['5 Rue Actuelle 33000 Bordeaux'])
  })

  it('snapshot ET client absents : identité null (jamais de fausse adresse inventée)', () => {
    expect(resolveClientIdentity(null, null)).toBeNull()
  })

  it('snapshot malformé (pas un objet identity valide) : traité comme absent, repli sur le client', () => {
    const currentClient = baseClient()
    const identity = resolveClientIdentity('texte-invalide', currentClient)
    expect(identity?.displayName).toBe('Marie Dupont')
  })
})
