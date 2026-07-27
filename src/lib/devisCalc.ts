// src/lib/devisCalc.ts
//
// Calcul centralisé des totaux d'un devis (HT / TVA / TTC / remise),
// à partir des données métier sources (quantité, prix unitaire HT,
// taux de TVA par ligne) — jamais à partir de totaux déjà arrondis.
//
// Fonctions pures : aucune dépendance React, aucune dépendance Supabase.
//
// ────────────────────────────────────────────────────────────────────
// CONVENTION DE CALCUL (obligatoire, ne pas dévier sans mettre à jour
// ce commentaire et les tests associés) :
//
//   · total_ht      = total HT APRÈS remise
//   · tva_montant   = TVA calculée sur le HT après remise
//   · total_ttc     = total_ht + tva_montant (toujours, par construction)
//   · remise_montant    = montant TTC économisé par rapport au total TTC
//                         avant remise (sémantique de la colonne existante
//                         devis.remise_montant — inchangée, on ne renomme
//                         ni ne redéfinit ce champ)
//   · remise_montant_ht = montant HT économisé par rapport au total HT
//                         avant remise — utilisé UNIQUEMENT pour l'affichage
//                         (le sous-total "Remise" dans le bloc HT du
//                         récapitulatif/PDF), jamais stocké tel quel.
//
// Invariant garanti par construction, dans TOUS les cas (0 à 100 % de
// remise, 0 à N taux de TVA différents) :
//
//     total_ht + tva_montant === total_ttc   (exact au centime)
//
// ────────────────────────────────────────────────────────────────────
// GESTION MULTI-TAUX DE TVA :
//
// La remise (un pourcentage unique appliqué à l'ensemble du devis) est
// répartie proportionnellement sur le HT de chaque taux de TVA présent
// sur le devis : chaque groupe de lignes partageant le même taux voit
// son propre HT réduit du même pourcentage, puis la TVA de ce groupe
// est recalculée sur son HT net. Cela évite qu'un devis mêlant par
// exemple des lignes à 10 % et 20 % ne produise un montant de TVA
// incohérent ou négatif.
//
// ────────────────────────────────────────────────────────────────────
// MÉTHODE D'ARRONDI (unique, documentée) :
//
// Arrondi standard "au plus proche" à 2 décimales (équivalent de
// Math.round), avec une correction d'epsilon flottant
// (`Number.EPSILON`) pour neutraliser les cas limites classiques de
// représentation binaire des décimales (ex. 1.005 qui, en IEEE754, est
// stocké légèrement en dessous de 1.005 et arrondirait sinon à tort
// vers 1.00). Cette correction ne change pas la méthode d'arrondi
// elle-même, elle en neutralise uniquement un artefact de
// représentation binaire connu — ce n'est pas un correctif arbitraire.
//
// Le HT net de chaque groupe de taux de TVA est arrondi à 2 décimales
// AVANT de calculer sa TVA (la TVA doit porter sur le HT net tel qu'il
// sera réellement affiché/stocké, pas sur une valeur intermédiaire non
// arrondie) — conforme à la convention ci-dessus
// ("tva_montant = TVA calculée sur le HT après remise").
//
// RÉCONCILIATION DE L'ARRONDI ENTRE GROUPES DE TAUX :
//
// Arrondir chaque groupe séparément peut, par construction
// mathématique (somme d'arrondis ≠ arrondi d'une somme), produire un
// écart d'au plus quelques centimes entre :
//   (a) la somme des HT nets arrondis groupe par groupe, et
//   (b) le HT net total arrondi une seule fois sur la somme exacte
//       (non arrondie) de tous les groupes.
// Cette fonction calcule (b) comme valeur cible faisant autorité, puis
// ajuste de façon déterministe le groupe ayant la base HT (avant
// remise) la PLUS IMPORTANTE pour que la somme des HT nets par groupe
// corresponde exactement à cette cible. Choix déterministe : toujours
// le même groupe pour les mêmes données en entrée, documenté et testé
// (voir devisCalc.test.ts, cas "écart d'arrondi").
// ────────────────────────────────────────────────────────────────────

/** Donnée source minimale nécessaire au calcul — jamais une structure qui contient déjà un total. */
export interface LigneSourceCalcul {
  quantite: number
  prix_ht: number
  tva_pct: number
}

/** Résultat du calcul d'une ligne individuelle (HT et TTC de cette seule ligne). */
export interface LigneCalculee {
  total_ht: number
  total_ttc: number
}

/** Totaux agrégés d'un devis, après application de la remise. */
export interface TotauxDevis {
  /** Somme des HT de toutes les lignes, AVANT remise — pour affichage uniquement (jamais stocké tel quel dans devis.total_ht). */
  total_ht_avant_remise: number
  /** Total HT APRÈS remise — correspond à devis.total_ht selon la convention retenue. */
  total_ht: number
  /** TVA calculée sur le HT après remise, taux par taux — correspond à devis.tva_montant. */
  tva_montant: number
  /** total_ht + tva_montant, toujours exact au centime — correspond à devis.total_ttc. */
  total_ttc: number
  /** Montant TTC économisé par rapport au total TTC avant remise — correspond à devis.remise_montant (sémantique inchangée). */
  remise_montant: number
  /** Montant HT économisé par rapport au total HT avant remise — pour l'affichage du bloc "Remise" dans le récapitulatif HT uniquement. */
  remise_montant_ht: number
  /** Pourcentage de remise réellement appliqué, après clamp défensif à [0, 100]. */
  remise_pct: number
}

/**
 * Arrondi à 2 décimales, avec correction d'epsilon flottant.
 * Voir le commentaire d'en-tête du fichier pour la justification.
 */
function arrondi2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Ramène un pourcentage de remise à l'intervalle [0, 100].
 * Choix défensif volontaire : NaN, +Infinity et -Infinity retombent
 * tous sur 0 (aucune remise), jamais sur 100 — une valeur non finie
 * est un signe de donnée corrompue en amont, et le défaut le moins
 * risqué dans ce cas est "prix plein", pas "remise totale".
 */
function clampRemisePct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(100, pct))
}

/** Ramène une quantité/un prix à une valeur finie et non négative (0 sinon). */
function nombrePositifOuZero(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Calcule le HT et le TTC d'une seule ligne, à partir de ses données
 * sources (quantité, prix unitaire HT, taux de TVA). N'applique aucune
 * remise (la remise s'applique au niveau du devis entier, pas ligne
 * par ligne) — utilisée pour l'aperçu d'une ligne avant ajout et pour
 * le calcul par ligne affiché dans le formulaire.
 */
export function calculerLigne(source: LigneSourceCalcul): LigneCalculee {
  const quantite = nombrePositifOuZero(source.quantite)
  const prixHt = nombrePositifOuZero(source.prix_ht)
  const tvaPct = Number.isFinite(source.tva_pct) ? Math.max(0, source.tva_pct) : 0

  const total_ht = arrondi2(quantite * prixHt)
  const total_ttc = arrondi2(total_ht * (1 + tvaPct / 100))
  return { total_ht, total_ttc }
}

/**
 * Calcule les totaux agrégés d'un devis (HT/TVA/TTC/remise), en tenant
 * compte d'éventuels taux de TVA différents entre les lignes, à partir
 * des données sources (jamais à partir de totaux déjà arrondis).
 *
 * Garantit systématiquement :
 *   · total_ht >= 0, tva_montant >= 0, total_ttc >= 0 (aucun négatif,
 *     pour toute remise de 0 à 100 %) ;
 *   · total_ht + tva_montant === total_ttc, exact au centime ;
 *   · un tableau de lignes vide renvoie des totaux à 0 (jamais NaN).
 */
export function calculerTotauxDevis(lignes: LigneSourceCalcul[], remisePct: number): TotauxDevis {
  const pct = clampRemisePct(remisePct)

  // ── 1. Regroupement par taux de TVA — calcul exact (non arrondi) ──
  const groupes = new Map<number, number>() // taux TVA -> somme HT brut exacte
  for (const ligne of lignes ?? []) {
    const quantite = nombrePositifOuZero(ligne?.quantite)
    const prixHt = nombrePositifOuZero(ligne?.prix_ht)
    const tauxTva = Number.isFinite(ligne?.tva_pct) ? Math.max(0, ligne.tva_pct) : 0
    const htLigneExact = quantite * prixHt
    groupes.set(tauxTva, (groupes.get(tauxTva) ?? 0) + htLigneExact)
  }

  const entreesGroupes = Array.from(groupes.entries()) // [tauxTva, htBrutExact][]

  // ── 2. Totaux avant remise (informationnels, pour l'affichage) ───
  const totalHtAvantRemiseExact = entreesGroupes.reduce((s, [, htBrut]) => s + htBrut, 0)
  const total_ht_avant_remise = arrondi2(totalHtAvantRemiseExact)

  if (entreesGroupes.length === 0) {
    return {
      total_ht_avant_remise: 0,
      total_ht: 0,
      tva_montant: 0,
      total_ttc: 0,
      remise_montant: 0,
      remise_montant_ht: 0,
      remise_pct: pct,
    }
  }

  // ── 3. HT net par groupe (exact), cible d'arrondi faisant autorité ─
  const totalHtNetExact = totalHtAvantRemiseExact * (1 - pct / 100)
  const totalHtNetCible = arrondi2(totalHtNetExact)

  const groupesCalcules = entreesGroupes.map(([tauxTva, htBrutExact]) => {
    const htNetExact = htBrutExact * (1 - pct / 100)
    return { tauxTva, htBrutExact, htNetArrondi: arrondi2(htNetExact) }
  })

  // ── 4. Réconciliation déterministe de l'écart d'arrondi ───────────
  // (somme des HT nets arrondis par groupe vs cible arrondie une fois)
  const sommeProvisoire = arrondi2(groupesCalcules.reduce((s, g) => s + g.htNetArrondi, 0))
  const ecart = arrondi2(totalHtNetCible - sommeProvisoire)
  if (ecart !== 0) {
    let indexPlusGrand = 0
    for (let i = 1; i < groupesCalcules.length; i++) {
      if (groupesCalcules[i].htBrutExact > groupesCalcules[indexPlusGrand].htBrutExact) indexPlusGrand = i
    }
    groupesCalcules[indexPlusGrand].htNetArrondi = arrondi2(groupesCalcules[indexPlusGrand].htNetArrondi + ecart)
  }

  // ── 5. TVA par groupe, sur le HT net (déjà arrondi et réconcilié) ─
  let total_ht = 0
  let tva_montant = 0
  let totalTtcAvantRemise = 0
  for (const g of groupesCalcules) {
    total_ht = arrondi2(total_ht + g.htNetArrondi)
    tva_montant = arrondi2(tva_montant + arrondi2(g.htNetArrondi * (g.tauxTva / 100)))
    totalTtcAvantRemise = arrondi2(totalTtcAvantRemise + arrondi2(g.htBrutExact * (1 + g.tauxTva / 100)))
  }

  // total_ttc défini comme la somme des deux autres valeurs déjà
  // arrondies : garantit l'égalité exacte au centime par construction,
  // sans correction artificielle supplémentaire.
  const total_ttc = arrondi2(total_ht + tva_montant)

  const remise_montant = arrondi2(totalTtcAvantRemise - total_ttc)
  const remise_montant_ht = arrondi2(total_ht_avant_remise - total_ht)

  return {
    total_ht_avant_remise,
    total_ht,
    tva_montant,
    total_ttc,
    remise_montant,
    remise_montant_ht,
    remise_pct: pct,
  }
}

/**
 * Fonction de compatibilité pour les données historiques : valide
 * qu'une valeur quelconque (typiquement devis.lignes, un jsonb dont la
 * structure n'est pas garantie pour d'anciens enregistrements) est un
 * tableau non vide de lignes exploitables par calculerTotauxDevis
 * (quantite / prix_ht / tva_pct tous présents et numériques finis).
 *
 * Retourne `null` — jamais un tableau partiel, jamais de valeurs
 * silencieusement mises à 0 — dès qu'UNE seule ligne est invalide ou
 * que la structure globale n'est pas un tableau. L'appelant doit alors
 * renoncer au recalcul (conserver les anciens montants stockés, ou
 * bloquer l'opération) plutôt que d'utiliser un résultat partiel.
 */
export function validerLignesPourRecalcul(lignes: unknown): LigneSourceCalcul[] | null {
  if (!Array.isArray(lignes) || lignes.length === 0) return null

  const resultat: LigneSourceCalcul[] = []
  for (const ligne of lignes) {
    if (typeof ligne !== 'object' || ligne === null) return null
    const l = ligne as Record<string, unknown>
    const { quantite, prix_ht, tva_pct } = l
    if (typeof quantite !== 'number' || !Number.isFinite(quantite)) return null
    if (typeof prix_ht !== 'number' || !Number.isFinite(prix_ht)) return null
    if (typeof tva_pct !== 'number' || !Number.isFinite(tva_pct)) return null
    resultat.push({ quantite, prix_ht, tva_pct })
  }
  return resultat
}
