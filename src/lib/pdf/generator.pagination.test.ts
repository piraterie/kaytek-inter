// src/lib/pdf/generator.pagination.test.ts
// Régression — "CGV dessinées par-dessus le devis" (bug historique : un pied
// de page en `position: 'absolute'` contenant le texte INTÉGRAL des CGV).
// Un élément en position absolue dans react-pdf n'est jamais redimensionné
// par son contenu et ne déclenche jamais de saut de page — un texte long y
// chevauche donc mécaniquement tout ce qui se trouve au-dessus, quelle que
// soit sa longueur.
//
// Ce fichier ne se contente pas de vérifier qu'un Blob non vide est produit :
// il vérifie une propriété STRUCTURELLE du PDF généré — le nombre de pages —
// qui ne peut physiquement pas être correcte si le bug historique revenait.
// Avec un pied de page absolu contenant les CGV, le nombre de pages ne varie
// JAMAIS avec la longueur des CGV (elles sont juste comprimées/chevauchées
// dans la même page) ; avec les CGV dans le flux normal d'une page dédiée,
// le nombre de pages croît strictement avec leur longueur. C'est cette
// propriété — vérifiable sans dépendance de parsing PDF — qui est testée
// ici plutôt qu'une simple absence de crash.
import { describe, it, expect } from 'vitest'
import { generateDevisPDF, generateFacturePDF } from './generator'
import type { Devis, Facture, ParametresEntreprise, LigneDevis } from '@/types'

// Compte les objets PDF de type Page (jamais "Pages", le nœud d'arbre
// racine) directement dans les octets bruts du fichier — chaque page réelle
// du document produit exactement une entrée `/Type /Page` dans sa table
// d'objets, y compris pour un moteur qui compresse ses object streams
// (@react-pdf/renderer n'en génère pas ici : vérifié empiriquement sur les
// PDF produits par ce générateur).
function countPdfPages(blob: Blob): Promise<number> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = Buffer.from(buf).toString('latin1')
    const matches = bytes.match(/\/Type\s*\/Page(?!s)\b/g)
    return matches ? matches.length : 0
  })
}

const baseParams: ParametresEntreprise = {
  id: 'p1', raison_sociale: 'Kaytek Inter', telephone: '0102030405',
  email: 'contact@kaytekinter.fr', adresse: '1 rue des Serruriers',
  code_postal: '75001', ville: 'Paris', siret: '12345678900011',
  rc_pro: 'RC12345', tva_defaut: 20, couleur_principale: '#1d4ed8',
  modele_pdf_defaut: 0,
  email_envoi_devis: true, email_relance_facture: true,
  email_paiement_recu: true, email_new_intervention: true,
  updated_at: new Date().toISOString(),
  delai_impaye_jours: 30, rappel_defaut_actif: true,
  rappel_defaut_decalages: [-7, -3, -1, 0, 3, 7], modeles_relance_echeance: {},
}

function manyLignes(n: number): LigneDevis[] {
  return Array.from({ length: n }, (_, i) => ({
    description: `Prestation serrurerie n°${i + 1} — remplacement barillet et renforcement porte`,
    quantite: 1, prix_ht: 100, tva_pct: 20, total_ttc: 120,
  })) as LigneDevis[]
}

// Un devis court — une seule page de contenu commercial quel que soit le
// scénario CGV, pour isoler strictement la variable testée (longueur CGV).
const devis: Devis = {
  id: 'd1', numero: 'DEV-2026-0001', statut: 'envoye',
  lignes: manyLignes(3),
  remise_pct: 0, total_ht: 300, tva_montant: 60, total_ttc: 360,
  modele_id: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  client: { id: 'c1', type: 'particulier', nom: 'Dupont', prenom: 'Jean', email: 'jean.dupont@example.fr', created_at: '', updated_at: '' },
}

const CGV_COURTES = 'Article 1 — Objet. Les présentes conditions générales régissent la vente.'
const CGV_MOYENNES = 'Article 1 — Objet. '.repeat(40) // quelques paragraphes, tient sur 1 page dédiée
const CGV_TRES_LONGUES = 'Article 1 — Objet. '.repeat(600) // doit déborder sur plusieurs pages

describe('generateDevisPDF — pagination des CGV (non-régression chevauchement)', () => {
  it('sans CGV : une seule page, aucune page légale ajoutée', async () => {
    const blob = await generateDevisPDF(devis, { ...baseParams, cgv: undefined }, 0)
    expect(await countPdfPages(blob)).toBe(1)
  })

  it('CGV courtes : le contenu commercial + une page CGV dédiée (2 pages), jamais compressées sur la page 1', async () => {
    const blob = await generateDevisPDF(devis, { ...baseParams, cgv: CGV_COURTES }, 0)
    expect(await countPdfPages(blob)).toBe(2)
  })

  it('CGV moyennes : toujours une page dédiée distincte du contenu commercial', async () => {
    const blob = await generateDevisPDF(devis, { ...baseParams, cgv: CGV_MOYENNES }, 0)
    const pages = await countPdfPages(blob)
    expect(pages).toBeGreaterThanOrEqual(2)
  })

  it('CGV très longues : débordent automatiquement sur plusieurs pages (jamais écrasées/chevauchées sur 1 page)', async () => {
    const [shortBlob, longBlob] = await Promise.all([
      generateDevisPDF(devis, { ...baseParams, cgv: CGV_COURTES }, 0),
      generateDevisPDF(devis, { ...baseParams, cgv: CGV_TRES_LONGUES }, 0),
    ])
    const shortPages = await countPdfPages(shortBlob)
    const longPages = await countPdfPages(longBlob)
    // La propriété clé du bug historique : avec un pied de page absolu
    // contenant les CGV, ce nombre ne bougeait JAMAIS avec la longueur.
    expect(longPages).toBeGreaterThan(shortPages)
    // Preuve que les CGV très longues produisent réellement "plusieurs
    // pages" de CGV (page de contenu commercial + au moins 2 pages CGV).
    expect(longPages).toBeGreaterThanOrEqual(3)
  })

  it('reste sous la limite de pièce jointe email même avec des CGV très longues et de nombreuses lignes', async () => {
    const bigDevis: Devis = { ...devis, lignes: manyLignes(60) }
    const blob = await generateDevisPDF(bigDevis, { ...baseParams, cgv: CGV_TRES_LONGUES }, 0)
    expect(blob.size).toBeLessThan(10 * 1024 * 1024)
    expect(await countPdfPages(blob)).toBeGreaterThan(3)
  })
})

describe('generateFacturePDF — pagination des CGV (même moteur, même garde)', () => {
  const facture: Facture = {
    id: 'f1', numero: 'FAC-2026-0001', statut_paiement: 'impayee',
    montant_ht: 300, tva_montant: 60, montant_ttc: 360, acompte_recu: 0,
    date_emission: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    client: devis.client,
  }

  it('sans CGV : une seule page', async () => {
    const blob = await generateFacturePDF(facture, devis, { ...baseParams, cgv: undefined })
    expect(await countPdfPages(blob)).toBe(1)
  })

  it('CGV très longues : page dédiée qui déborde sur plusieurs pages, jamais chevauchée avec le contenu commercial', async () => {
    const blob = await generateFacturePDF(facture, devis, { ...baseParams, cgv: CGV_TRES_LONGUES })
    expect(await countPdfPages(blob)).toBeGreaterThanOrEqual(3)
  })
})
