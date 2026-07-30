// src/lib/echeancier.ts
// Service métier centralisé pour le calcul des échéanciers de paiement
// (répartition, arrondis, validation). Miroir côté client des règles
// appliquées côté base par la RPC create_echeancier() — sert à donner un
// retour immédiat dans l'UI, la RPC reste la source de vérité finale.
import type { StatutEcheancier, ModeRepartition } from '@/types'

export interface DevisMontants {
  montant_ht: number
  tva_montant: number
  montant_ttc: number
}

export interface EcheanceCalculee {
  numero_ordre: number
  libelle: string
  pourcentage: number
  montant_ht: number
  tva_montant: number
  montant_ttc: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const LIBELLES_PAR_DEFAUT: Record<number, string[]> = {
  1: ['Paiement intégral'],
  2: ['Acompte', 'Solde'],
  3: ['Acompte', 'Échéance 2', 'Solde'],
  4: ['Acompte', 'Échéance 2', 'Échéance 3', 'Solde'],
}

export const POURCENTAGES_ACOMPTE_RAPIDES = [10, 20, 30, 40, 50]

function ratioHT(devis: DevisMontants): number {
  return devis.montant_ttc === 0 ? 0 : devis.montant_ht / devis.montant_ttc
}

// Répartit le montant TTC selon des pourcentages exacts fournis par
// l'appelant (doivent sommer à 100, tolérance 0.01). La dernière échéance
// absorbe systématiquement l'écart d'arrondi sur HT, TVA et TTC afin que
// la somme des échéances soit toujours rigoureusement égale au devis.
export function repartirParPourcentages(devis: DevisMontants, pourcentages: number[]): EcheanceCalculee[] {
  const n = pourcentages.length
  if (n < 1 || n > 4) throw new Error("Le nombre d'échéances doit être entre 1 et 4")

  const sommePct = pourcentages.reduce((a, b) => a + b, 0)
  if (Math.abs(sommePct - 100) > 0.01) {
    throw new Error(`La somme des pourcentages (${sommePct.toFixed(2)} %) doit être égale à 100 %`)
  }

  const libelles = LIBELLES_PAR_DEFAUT[n]
  const ratio = ratioHT(devis)
  const lignes: EcheanceCalculee[] = []
  let sommeHT = 0
  let sommeTVA = 0
  let sommeTTC = 0

  for (let i = 0; i < n; i++) {
    const dernier = i === n - 1
    let ttc: number, ht: number, tva: number

    if (dernier) {
      ttc = round2(devis.montant_ttc - sommeTTC)
      ht = round2(devis.montant_ht - sommeHT)
      tva = round2(devis.tva_montant - sommeTVA)
    } else {
      ttc = round2((devis.montant_ttc * pourcentages[i]) / 100)
      ht = round2(ttc * ratio)
      tva = round2(ttc - ht)
    }

    sommeHT += ht
    sommeTVA += tva
    sommeTTC += ttc

    lignes.push({
      numero_ordre: i + 1,
      libelle: libelles[i],
      pourcentage: round2(pourcentages[i]),
      montant_ht: ht,
      tva_montant: tva,
      montant_ttc: ttc,
    })
  }

  return lignes
}

// Répartition égale entre N échéances (la dernière absorbe l'écart, y
// compris sur le pourcentage affiché, pour sommer exactement à 100).
export function repartirEgale(devis: DevisMontants, nombreEcheances: number): EcheanceCalculee[] {
  if (nombreEcheances < 1 || nombreEcheances > 4) {
    throw new Error("Le nombre d'échéances doit être entre 1 et 4")
  }
  const pctBase = round2(100 / nombreEcheances)
  const pourcentages = Array(nombreEcheances).fill(pctBase)
  pourcentages[nombreEcheances - 1] = round2(100 - pctBase * (nombreEcheances - 1))
  return repartirParPourcentages(devis, pourcentages)
}

// Répartition à partir de montants TTC saisis par l'utilisateur pour
// toutes les échéances SAUF la dernière (qui absorbe systématiquement
// l'écart, pour garantir l'égalité stricte avec le TTC du devis — c'est
// elle qui joue le rôle de "solde").
export function repartirParMontants(
  devis: DevisMontants,
  nombreEcheances: number,
  montantsSaufDernier: number[]
): EcheanceCalculee[] {
  if (nombreEcheances < 1 || nombreEcheances > 4) {
    throw new Error("Le nombre d'échéances doit être entre 1 et 4")
  }
  if (montantsSaufDernier.length !== nombreEcheances - 1) {
    throw new Error(`${nombreEcheances - 1} montant(s) attendu(s) (toutes les échéances sauf la dernière)`)
  }

  const sommeSaufDernier = montantsSaufDernier.reduce((a, b) => a + b, 0)
  if (sommeSaufDernier - devis.montant_ttc > 0.01) {
    throw new Error('La somme des montants saisis dépasse le montant TTC du devis')
  }

  const libelles = LIBELLES_PAR_DEFAUT[nombreEcheances]
  const ratio = ratioHT(devis)
  const lignes: EcheanceCalculee[] = []
  let sommeHT = 0
  let sommeTVA = 0
  let sommeTTC = 0

  for (let i = 0; i < nombreEcheances; i++) {
    const dernier = i === nombreEcheances - 1
    let ttc: number, ht: number, tva: number

    if (dernier) {
      ttc = round2(devis.montant_ttc - sommeTTC)
      ht = round2(devis.montant_ht - sommeHT)
      tva = round2(devis.tva_montant - sommeTVA)
    } else {
      ttc = round2(montantsSaufDernier[i])
      ht = round2(ttc * ratio)
      tva = round2(ttc - ht)
    }

    const pct = devis.montant_ttc === 0 ? 0 : round2((ttc / devis.montant_ttc) * 100)

    sommeHT += ht
    sommeTVA += tva
    sommeTTC += ttc

    lignes.push({
      numero_ordre: i + 1,
      libelle: libelles[i],
      pourcentage: pct,
      montant_ht: ht,
      tva_montant: tva,
      montant_ttc: ttc,
    })
  }

  return lignes
}

export function calculerEcheances(
  devis: DevisMontants,
  nombreEcheances: number,
  mode: ModeRepartition,
  config: { pourcentages?: number[]; montantsSaufDernier?: number[] }
): EcheanceCalculee[] {
  if (mode === 'egale') return repartirEgale(devis, nombreEcheances)
  if (mode === 'pourcentages') {
    if (!config.pourcentages) throw new Error('Pourcentages requis pour ce mode de répartition')
    return repartirParPourcentages(devis, config.pourcentages)
  }
  if (!config.montantsSaufDernier) throw new Error('Montants requis pour ce mode de répartition')
  return repartirParMontants(devis, nombreEcheances, config.montantsSaufDernier)
}

// ── Validation (miroir des contraintes appliquées par create_echeancier) ──
export interface LigneEcheanceValidation {
  numero_ordre: number
  pourcentage: number
  montant_ht: number
  tva_montant: number
  montant_ttc: number
  date_prevue: string | null
}

export interface ResultatValidation {
  valide: boolean
  erreurs: string[]
}

export function validerEcheances(devisTTC: number, echeances: LigneEcheanceValidation[]): ResultatValidation {
  const erreurs: string[] = []

  if (echeances.length < 1 || echeances.length > 4) {
    erreurs.push("Le nombre d'échéances doit être entre 1 et 4")
  }

  const sommePct = echeances.reduce((a, e) => a + e.pourcentage, 0)
  if (Math.abs(sommePct - 100) > 0.01) {
    erreurs.push(`La somme des pourcentages (${sommePct.toFixed(2)} %) doit être égale à 100 %`)
  }

  const sommeTTC = echeances.reduce((a, e) => a + e.montant_ttc, 0)
  if (Math.abs(sommeTTC - devisTTC) > 0.01) {
    erreurs.push(`La somme des échéances (${sommeTTC.toFixed(2)} €) doit être égale au montant TTC du devis (${devisTTC.toFixed(2)} €)`)
  }

  echeances.forEach((e, i) => {
    if (!e.date_prevue) erreurs.push(`L'échéance ${i + 1} doit avoir une date prévue`)
    if (e.montant_ttc < 0 || e.montant_ht < 0 || e.tva_montant < 0) {
      erreurs.push(`L'échéance ${i + 1} a un montant négatif`)
    }
    if (e.pourcentage < 0) erreurs.push(`L'échéance ${i + 1} a un pourcentage négatif`)
  })

  for (let i = 1; i < echeances.length; i++) {
    const prev = echeances[i - 1].date_prevue
    const cur = echeances[i].date_prevue
    if (prev && cur && new Date(cur) < new Date(prev)) {
      erreurs.push(`L'ordre chronologique est incohérent entre l'échéance ${i} et l'échéance ${i + 1}`)
    }
  }

  return { valide: erreurs.length === 0, erreurs }
}

// ── Raccourcis de date pour la saisie ────────────────────────────
export function dateDecalage(joursDepuisAujourdhui: number, base: Date = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + joursDepuisAujourdhui)
  return d.toISOString().slice(0, 10)
}

// ── Libellés / couleurs de statut pour l'UI ──────────────────────
export const STATUT_ECHEANCE_LABELS: Record<StatutEcheancier, string> = {
  brouillon: 'Brouillon',
  a_facturer: 'À facturer',
  facture: 'Facturée',
  en_attente_paiement: 'En attente de paiement',
  paiement_partiel: 'Paiement partiel',
  paye: 'Payée',
  en_retard: 'En retard',
  impaye: 'Impayée',
  annule: 'Annulée',
}

export const STATUT_ECHEANCE_COULEURS: Record<StatutEcheancier, string> = {
  brouillon: 'pill-gray',
  a_facturer: 'pill-blue',
  facture: 'pill-blue',
  en_attente_paiement: 'pill-blue',
  paiement_partiel: 'pill-orange',
  paye: 'pill-green',
  en_retard: 'pill-red',
  impaye: 'pill-purple',
  annule: 'pill-gray',
}

export const MODES_PAIEMENT_LABELS: Record<string, string> = {
  cb: 'Carte bancaire',
  especes: 'Espèces',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  prelevement: 'Prélèvement',
  paypal: 'PayPal',
  autre: 'Autre',
}

// Icônes textuelles (préfixe des libellés) : le statut ne doit jamais
// reposer uniquement sur la couleur (accessibilité, section 19 du cahier
// des charges).
export const STATUT_ECHEANCE_ICONES: Record<StatutEcheancier, string> = {
  brouillon: '📝',
  a_facturer: '🧾',
  facture: '📄',
  en_attente_paiement: '⏳',
  paiement_partiel: '🟠',
  paye: '✅',
  en_retard: '⚠️',
  impaye: '⛔',
  annule: '🚫',
}
