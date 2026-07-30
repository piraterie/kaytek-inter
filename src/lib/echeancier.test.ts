// src/lib/echeancier.test.ts
import { describe, it, expect } from 'vitest'
import {
  repartirEgale,
  repartirParPourcentages,
  repartirParMontants,
  calculerEcheances,
  validerEcheances,
  dateDecalage,
  type DevisMontants,
} from './echeancier'

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

describe('repartirParPourcentages', () => {
  it('reproduit exactement l\'exemple du cahier des charges (619,08 € / 30% acompte)', () => {
    const devis: DevisMontants = { montant_ht: 500, tva_montant: 119.08, montant_ttc: 619.08 }
    const lignes = repartirParPourcentages(devis, [30, 70])
    expect(lignes[0].montant_ttc).toBe(185.72)
    expect(lignes[1].montant_ttc).toBe(433.36)
    expect(round2sum(lignes.map(l => l.montant_ttc))).toBe(619.08)
  })

  it('rejette un total de pourcentages différent de 100', () => {
    const devis: DevisMontants = { montant_ht: 100, tva_montant: 20, montant_ttc: 120 }
    expect(() => repartirParPourcentages(devis, [30, 60])).toThrow(/100/)
  })

  it('rejette plus de 4 échéances', () => {
    const devis: DevisMontants = { montant_ht: 100, tva_montant: 20, montant_ttc: 120 }
    expect(() => repartirParPourcentages(devis, [20, 20, 20, 20, 20])).toThrow(/entre 1 et 4/)
  })

  it('chaque ligne vérifie ht + tva = ttc', () => {
    const devis: DevisMontants = { montant_ht: 500, tva_montant: 119.08, montant_ttc: 619.08 }
    const lignes = repartirParPourcentages(devis, [10, 20, 30, 40])
    for (const l of lignes) {
      expect(round2sum([l.montant_ht, l.tva_montant])).toBeCloseTo(l.montant_ttc, 2)
    }
  })
})

describe('repartirEgale', () => {
  it.each([1, 2, 3, 4])('somme exactement au TTC et à 100%% pour %i échéance(s)', (n) => {
    const devis: DevisMontants = { montant_ht: 83.33, tva_montant: 16.67, montant_ttc: 100 }
    const lignes = repartirEgale(devis, n)
    expect(lignes).toHaveLength(n)
    expect(round2sum(lignes.map(l => l.montant_ttc))).toBe(100)
    expect(round2sum(lignes.map(l => l.pourcentage))).toBe(100)
    expect(round2sum(lignes.map(l => l.montant_ht))).toBe(83.33)
    expect(round2sum(lignes.map(l => l.tva_montant))).toBe(16.67)
  })

  it('absorbe l\'écart d\'arrondi sur la dernière échéance (100 / 3)', () => {
    const devis: DevisMontants = { montant_ht: 83.33, tva_montant: 16.67, montant_ttc: 100 }
    const lignes = repartirEgale(devis, 3)
    expect(lignes[0].montant_ttc).toBe(33.33)
    expect(lignes[1].montant_ttc).toBe(33.33)
    expect(lignes[2].montant_ttc).toBe(33.34)
  })

  it('utilise les libellés par défaut attendus', () => {
    const devis: DevisMontants = { montant_ht: 100, tva_montant: 20, montant_ttc: 120 }
    expect(repartirEgale(devis, 1).map(l => l.libelle)).toEqual(['Paiement intégral'])
    expect(repartirEgale(devis, 2).map(l => l.libelle)).toEqual(['Acompte', 'Solde'])
    expect(repartirEgale(devis, 3).map(l => l.libelle)).toEqual(['Acompte', 'Échéance 2', 'Solde'])
    expect(repartirEgale(devis, 4).map(l => l.libelle)).toEqual(['Acompte', 'Échéance 2', 'Échéance 3', 'Solde'])
  })
})

describe('repartirParMontants', () => {
  it('conserve les montants saisis et fait absorber le reste par la dernière échéance', () => {
    const devis: DevisMontants = { montant_ht: 500, tva_montant: 119.08, montant_ttc: 619.08 }
    const lignes = repartirParMontants(devis, 3, [200, 200])
    expect(lignes[0].montant_ttc).toBe(200)
    expect(lignes[1].montant_ttc).toBe(200)
    expect(lignes[2].montant_ttc).toBe(219.08)
    expect(round2sum(lignes.map(l => l.montant_ttc))).toBe(619.08)
  })

  it('rejette des montants dont la somme (hors dernier) dépasse le TTC du devis', () => {
    const devis: DevisMontants = { montant_ht: 100, tva_montant: 20, montant_ttc: 120 }
    expect(() => repartirParMontants(devis, 2, [130])).toThrow(/dépasse/)
  })

  it("rejette si le nombre de montants fournis ne correspond pas à nombreEcheances - 1", () => {
    const devis: DevisMontants = { montant_ht: 100, tva_montant: 20, montant_ttc: 120 }
    expect(() => repartirParMontants(devis, 3, [50])).toThrow(/attendu/)
  })
})

describe('calculerEcheances (dispatch par mode)', () => {
  const devis: DevisMontants = { montant_ht: 500, tva_montant: 119.08, montant_ttc: 619.08 }

  it('mode egale', () => {
    expect(calculerEcheances(devis, 2, 'egale', {})).toHaveLength(2)
  })
  it('mode pourcentages', () => {
    const lignes = calculerEcheances(devis, 2, 'pourcentages', { pourcentages: [30, 70] })
    expect(lignes[0].montant_ttc).toBe(185.72)
  })
  it('mode montants', () => {
    const lignes = calculerEcheances(devis, 2, 'montants', { montantsSaufDernier: [200] })
    expect(lignes[1].montant_ttc).toBe(419.08)
  })
})

describe('validerEcheances', () => {
  const base = [
    { numero_ordre: 1, pourcentage: 30, montant_ht: 150, tva_montant: 35.72, montant_ttc: 185.72, date_prevue: '2026-08-01' },
    { numero_ordre: 2, pourcentage: 70, montant_ht: 350, tva_montant: 83.36, montant_ttc: 433.36, date_prevue: '2026-09-01' },
  ]

  it('valide un échéancier correct', () => {
    expect(validerEcheances(619.08, base).valide).toBe(true)
  })

  it('rejette si le total des pourcentages n\'est pas 100', () => {
    const r = validerEcheances(619.08, [{ ...base[0], pourcentage: 20 }, base[1]])
    expect(r.valide).toBe(false)
    expect(r.erreurs.some(e => e.includes('100'))).toBe(true)
  })

  it('rejette si le total des montants ne correspond pas au TTC du devis', () => {
    const r = validerEcheances(700, base)
    expect(r.valide).toBe(false)
    expect(r.erreurs.some(e => e.includes('TTC du devis'))).toBe(true)
  })

  it('rejette un montant négatif', () => {
    const r = validerEcheances(619.08, [{ ...base[0], montant_ttc: -10 }, base[1]])
    expect(r.valide).toBe(false)
  })

  it('rejette une date manquante', () => {
    const r = validerEcheances(619.08, [{ ...base[0], date_prevue: null }, base[1]])
    expect(r.valide).toBe(false)
    expect(r.erreurs.some(e => e.includes('date prévue'))).toBe(true)
  })

  it('rejette un ordre chronologique incohérent', () => {
    const r = validerEcheances(619.08, [
      { ...base[0], date_prevue: '2026-09-01' },
      { ...base[1], date_prevue: '2026-08-01' },
    ])
    expect(r.valide).toBe(false)
    expect(r.erreurs.some(e => e.includes('chronologique'))).toBe(true)
  })

  it('rejette plus de 4 échéances', () => {
    const cinq = [base[0], base[1], base[0], base[1], base[0]]
    expect(validerEcheances(619.08 * 3, cinq).valide).toBe(false)
  })
})

describe('dateDecalage', () => {
  it('calcule correctement les raccourcis de date', () => {
    const base = new Date('2026-07-30T12:00:00Z')
    expect(dateDecalage(0, base)).toBe('2026-07-30')
    expect(dateDecalage(7, base)).toBe('2026-08-06')
    expect(dateDecalage(15, base)).toBe('2026-08-14')
    expect(dateDecalage(30, base)).toBe('2026-08-29')
  })
})

function round2sum(arr: number[]): number {
  return Math.round((sum(arr) + Number.EPSILON) * 100) / 100
}
