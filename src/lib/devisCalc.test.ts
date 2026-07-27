// src/lib/devisCalc.test.ts
// Tests unitaires de la fonction centrale de calcul des totaux devis
// (FONC-01 — audit-kaytek-inter/phase-06-audit-fonctionnel.md).
// Voir src/lib/devisCalc.ts pour la convention et la méthode d'arrondi retenues.
import { describe, it, expect } from 'vitest'
import { calculerLigne, calculerTotauxDevis, validerLignesPourRecalcul, type LigneSourceCalcul } from './devisCalc'

const ligne = (quantite: number, prix_ht: number, tva_pct: number): LigneSourceCalcul => ({ quantite, prix_ht, tva_pct })

describe('calculerLigne — cas simples par taux de TVA', () => {
  it('TVA 0 %', () => {
    expect(calculerLigne(ligne(1, 100, 0))).toEqual({ total_ht: 100, total_ttc: 100 })
  })
  it('TVA 5.5 %', () => {
    expect(calculerLigne(ligne(1, 100, 5.5))).toEqual({ total_ht: 100, total_ttc: 105.5 })
  })
  it('TVA 10 %', () => {
    expect(calculerLigne(ligne(2, 100, 10))).toEqual({ total_ht: 200, total_ttc: 220 })
  })
  it('TVA 20 %', () => {
    expect(calculerLigne(ligne(1, 200, 20))).toEqual({ total_ht: 200, total_ttc: 240 })
  })
})

describe('calculerTotauxDevis — cas simples (une ligne, sans remise)', () => {
  it('TVA 0 %', () => {
    const t = calculerTotauxDevis([ligne(1, 100, 0)], 0)
    expect(t.total_ht).toBe(100)
    expect(t.tva_montant).toBe(0)
    expect(t.total_ttc).toBe(100)
  })
  it('TVA 5.5 %', () => {
    const t = calculerTotauxDevis([ligne(1, 100, 5.5)], 0)
    expect(t.total_ht).toBe(100)
    expect(t.tva_montant).toBe(5.5)
    expect(t.total_ttc).toBe(105.5)
  })
  it('TVA 10 %', () => {
    const t = calculerTotauxDevis([ligne(1, 1000, 10)], 0)
    expect(t.total_ht).toBe(1000)
    expect(t.tva_montant).toBe(100)
    expect(t.total_ttc).toBe(1100)
  })
  it('TVA 20 %', () => {
    const t = calculerTotauxDevis([ligne(1, 200, 20)], 0)
    expect(t.total_ht).toBe(200)
    expect(t.tva_montant).toBe(40)
    expect(t.total_ttc).toBe(240)
  })
})

describe('calculerTotauxDevis — remises, TVA 10 % (référence du bug FONC-01)', () => {
  // Devis de référence : 1000 € HT / TVA 10 % / 1100 € TTC avant remise.
  // Le rapport d'audit montrait une TVA négative dès qu'une remise > ~9,1 %
  // était appliquée avec l'ancien calcul (remise sur le TTC agrégé).
  const lignes = [ligne(1, 1000, 10)]

  it.each([0, 10, 20, 50, 100])('remise %i %% — TVA jamais négative, HT+TVA=TTC', (remisePct) => {
    const t = calculerTotauxDevis(lignes, remisePct)
    expect(t.tva_montant).toBeGreaterThanOrEqual(0)
    expect(t.total_ht).toBeGreaterThanOrEqual(0)
    expect(t.total_ttc).toBeGreaterThanOrEqual(0)
    expect(t.total_ht + t.tva_montant).toBeCloseTo(t.total_ttc, 10)
  })

  it('remise 0 % — inchangé', () => {
    const t = calculerTotauxDevis(lignes, 0)
    expect(t).toMatchObject({ total_ht: 1000, tva_montant: 100, total_ttc: 1100, remise_montant: 0 })
  })

  it('remise 10 % — HT net 900, TVA 90, TTC 990', () => {
    const t = calculerTotauxDevis(lignes, 10)
    expect(t.total_ht).toBe(900)
    expect(t.tva_montant).toBe(90)
    expect(t.total_ttc).toBe(990)
    expect(t.remise_montant).toBe(110) // 1100 - 990
  })

  it('remise 20 % — reproduit exactement le scénario FONC-01 (devait donner -120 € de TVA avant correctif)', () => {
    const t = calculerTotauxDevis(lignes, 20)
    expect(t.total_ht).toBe(800)
    expect(t.tva_montant).toBe(80) // et surtout PAS -120
    expect(t.total_ttc).toBe(880)
    expect(t.tva_montant).toBeGreaterThan(0)
  })

  it('remise 50 %', () => {
    const t = calculerTotauxDevis(lignes, 50)
    expect(t.total_ht).toBe(500)
    expect(t.tva_montant).toBe(50)
    expect(t.total_ttc).toBe(550)
  })

  it('remise 100 % — tout à zéro, jamais négatif', () => {
    const t = calculerTotauxDevis(lignes, 100)
    expect(t.total_ht).toBe(0)
    expect(t.tva_montant).toBe(0)
    expect(t.total_ttc).toBe(0)
    expect(t.remise_montant).toBe(1100)
  })
})

describe('calculerTotauxDevis — remises, TVA 20 %', () => {
  const lignes = [ligne(1, 1000, 20)] // 1000 HT / 1200 TTC avant remise

  it.each([0, 10, 20, 50, 100])('remise %i %% — TVA jamais négative', (remisePct) => {
    const t = calculerTotauxDevis(lignes, remisePct)
    expect(t.tva_montant).toBeGreaterThanOrEqual(0)
    expect(t.total_ht + t.tva_montant).toBeCloseTo(t.total_ttc, 10)
  })

  it('remise 20 % (seuil dépassé pour une TVA 20 %, ancien calcul aurait déjà été négatif au-delà de 16.7 %)', () => {
    const t = calculerTotauxDevis(lignes, 20)
    expect(t.total_ht).toBe(800)
    expect(t.tva_montant).toBe(160)
    expect(t.total_ttc).toBe(960)
  })
})

describe('calculerTotauxDevis — multi-taux de TVA', () => {
  it('une ligne à 10 % et une à 20 %, sans remise', () => {
    const t = calculerTotauxDevis([ligne(1, 1000, 10), ligne(1, 1000, 20)], 0)
    expect(t.total_ht).toBe(2000)
    expect(t.tva_montant).toBe(300) // 100 + 200
    expect(t.total_ttc).toBe(2300)
  })

  it('une ligne à 10 % et une à 20 %, avec remise de 20 %', () => {
    const t = calculerTotauxDevis([ligne(1, 1000, 10), ligne(1, 1000, 20)], 20)
    // Chaque groupe voit son HT réduit de 20 % : 800 (10%) + 800 (20%)
    expect(t.total_ht).toBe(1600)
    expect(t.tva_montant).toBe(80 + 160) // TVA du groupe 10% (800*10%) + groupe 20% (800*20%)
    expect(t.total_ttc).toBe(t.total_ht + t.tva_montant)
    expect(t.tva_montant).toBeGreaterThan(0)
  })

  it('plusieurs lignes avec quantités et prix différents, plusieurs taux', () => {
    const t = calculerTotauxDevis(
      [ligne(3, 45.9, 10), ligne(2, 199.99, 20), ligne(1.5, 60, 0), ligne(4, 12.34, 5.5)],
      15
    )
    expect(t.total_ht).toBeGreaterThan(0)
    expect(t.tva_montant).toBeGreaterThanOrEqual(0)
    expect(t.total_ht + t.tva_montant).toBeCloseTo(t.total_ttc, 10)
    expect(Number.isFinite(t.total_ttc)).toBe(true)
  })
})

describe('calculerTotauxDevis — réconciliation déterministe d\'un écart d\'arrondi', () => {
  // Construit volontairement un cas où l'arrondi groupe par groupe
  // diverge de l'arrondi global d'un centime, pour vérifier que
  // l'écart est bien attribué au groupe à la base HT la plus importante.
  it('écart d\'un centime réparti sur le groupe à la base HT la plus importante', () => {
    // Groupe A (10%) : HT brut = 100.005 (× exact non entier)
    // Groupe B (20%) : HT brut = 10.001
    // remise 33% choisie pour générer un résidu non multiple exact du centime
    const lignes = [ligne(1, 100.005, 10), ligne(1, 10.001, 20)]
    const t = calculerTotauxDevis(lignes, 33)

    // Le groupe A a la base HT la plus importante (100.005 > 10.001)
    // -> c'est lui qui doit absorber un éventuel écart de réconciliation.
    // On vérifie uniquement les invariants globaux (déterminisme prouvé
    // par la stabilité du résultat sur exécutions répétées ci-dessous).
    // total_ttc est lui-même arrondi (arrondi2) à partir de total_ht +
    // tva_montant à l'intérieur de la fonction ; la ré-addition faite
    // ici côté test peut porter un résidu flottant (ex. 81.74000000000001)
    // sans que cela ne remette en cause l'égalité au centime garantie
    // par la fonction elle-même — d'où toBeCloseTo plutôt que toBe.
    expect(t.total_ht + t.tva_montant).toBeCloseTo(t.total_ttc, 10)

    // Déterminisme : rejouer le même calcul donne exactement le même résultat.
    const t2 = calculerTotauxDevis(lignes, 33)
    expect(t2).toEqual(t)
  })
})

describe('calculerTotauxDevis — protections / cas limites', () => {
  it('lignes vides -> totaux à 0, jamais NaN', () => {
    const t = calculerTotauxDevis([], 20)
    expect(t).toEqual({
      total_ht_avant_remise: 0,
      total_ht: 0,
      tva_montant: 0,
      total_ttc: 0,
      remise_montant: 0,
      remise_montant_ht: 0,
      remise_pct: 20,
    })
  })

  it('quantité nulle -> ligne neutre, pas d\'erreur', () => {
    const t = calculerTotauxDevis([ligne(0, 500, 20)], 10)
    expect(t.total_ht).toBe(0)
    expect(t.tva_montant).toBe(0)
    expect(t.total_ttc).toBe(0)
  })

  it('remise négative -> clampée à 0 (protection défensive interne)', () => {
    const t = calculerTotauxDevis([ligne(1, 100, 20)], -50)
    expect(t.remise_pct).toBe(0)
    expect(t.total_ht).toBe(100)
    expect(t.total_ttc).toBe(120)
  })

  it('remise supérieure à 100 -> clampée à 100 (protection défensive interne)', () => {
    const t = calculerTotauxDevis([ligne(1, 100, 20)], 150)
    expect(t.remise_pct).toBe(100)
    expect(t.total_ht).toBe(0)
    expect(t.total_ttc).toBe(0)
  })

  it('remise NaN/Infinity -> traitée comme 0 (choix défensif documenté : toute valeur non finie retombe sur 0 %, jamais sur 100 %, pour ne jamais appliquer une remise non voulue par défaut)', () => {
    expect(calculerTotauxDevis([ligne(1, 100, 20)], NaN).remise_pct).toBe(0)
    expect(calculerTotauxDevis([ligne(1, 100, 20)], Infinity).remise_pct).toBe(0)
    expect(calculerTotauxDevis([ligne(1, 100, 20)], -Infinity).remise_pct).toBe(0)
  })

  it('quantité/prix non finis dans une ligne -> traités comme 0, jamais NaN', () => {
    const t = calculerTotauxDevis([{ quantite: NaN, prix_ht: 100, tva_pct: 20 }], 0)
    expect(Number.isNaN(t.total_ht)).toBe(false)
    expect(t.total_ht).toBe(0)
  })

  it('aucun total négatif quelle que soit la combinaison remise/TVA testée', () => {
    for (const tva of [0, 5.5, 10, 20]) {
      for (const remise of [0, 10, 20, 50, 100]) {
        const t = calculerTotauxDevis([ligne(1, 733.33, tva)], remise)
        expect(t.total_ht).toBeGreaterThanOrEqual(0)
        expect(t.tva_montant).toBeGreaterThanOrEqual(0)
        expect(t.total_ttc).toBeGreaterThanOrEqual(0)
        expect(t.total_ht + t.tva_montant).toBeCloseTo(t.total_ttc, 10)
      }
    }
  })
})

describe('validerLignesPourRecalcul — données historiques incomplètes (duplication / transformation en facture)', () => {
  it('tableau valide complet -> lignes exploitables retournées', () => {
    const res = validerLignesPourRecalcul([
      { quantite: 1, prix_ht: 100, tva_pct: 10 },
      { quantite: 2, prix_ht: 50, tva_pct: 20 },
    ])
    expect(res).toEqual([
      { quantite: 1, prix_ht: 100, tva_pct: 10 },
      { quantite: 2, prix_ht: 50, tva_pct: 20 },
    ])
  })

  it('non-tableau -> null', () => {
    expect(validerLignesPourRecalcul(null)).toBeNull()
    expect(validerLignesPourRecalcul(undefined)).toBeNull()
    expect(validerLignesPourRecalcul('lignes')).toBeNull()
    expect(validerLignesPourRecalcul({})).toBeNull()
  })

  it('tableau vide -> null (rien à recalculer)', () => {
    expect(validerLignesPourRecalcul([])).toBeNull()
  })

  it('ligne sans tva_pct (donnée historique incomplète) -> null, ne génère pas un total à 0 silencieux', () => {
    expect(validerLignesPourRecalcul([{ quantite: 1, prix_ht: 100 }])).toBeNull()
  })

  it('ligne sans prix_ht -> null', () => {
    expect(validerLignesPourRecalcul([{ quantite: 1, tva_pct: 10 }])).toBeNull()
  })

  it('ligne avec un champ non numérique -> null', () => {
    expect(validerLignesPourRecalcul([{ quantite: '1', prix_ht: 100, tva_pct: 10 }])).toBeNull()
  })

  it('une seule ligne invalide parmi plusieurs valides -> null pour tout le tableau (pas de résultat partiel)', () => {
    const res = validerLignesPourRecalcul([
      { quantite: 1, prix_ht: 100, tva_pct: 10 },
      { quantite: 1, prix_ht: 100 }, // tva_pct manquant
    ])
    expect(res).toBeNull()
  })
})
