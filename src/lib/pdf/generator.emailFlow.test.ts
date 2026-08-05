// src/lib/pdf/generator.emailFlow.test.ts
// Régression — bug "envoi devis par email" (2026-07-28) : le PDF joint à
// l'email doit se générer sans erreur et rester sous la limite de pièce
// jointe (10 Mo, voir EmailDevisModal.MAX_PDF_BYTES) même pour un devis
// multi-pages avec des CGV longues. Couvre aussi generateFacturePDF pour
// garantir la non-régression de l'envoi des factures (même moteur PDF).
import { describe, it, expect } from 'vitest'
import { generateDevisPDF, generateFacturePDF } from './generator'
import type { Devis, Facture, ParametresEntreprise, LigneDevis } from '@/types'

const params: ParametresEntreprise = {
  id: 'p1', raison_sociale: 'Kaytek Inter', telephone: '0102030405',
  email: 'contact@kaytekinter.fr', adresse: '1 rue des Serruriers',
  code_postal: '75001', ville: 'Paris', siret: '12345678900011',
  rc_pro: 'RC12345', tva_defaut: 20, couleur_principale: '#1d4ed8',
  cgv: 'Article 1 — Objet. '.repeat(400), // CGV longues, plusieurs pages
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

const devis: Devis = {
  id: 'd1', numero: 'DEV-2026-0001', statut: 'envoye',
  lignes: manyLignes(40), // assez de lignes pour dépasser une page
  remise_pct: 0, total_ht: 4000, tva_montant: 800, total_ttc: 4800,
  modele_id: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  client: { id: 'c1', type: 'particulier', nom: 'Dupont', prenom: 'Jean', email: 'jean.dupont@example.fr', created_at: '', updated_at: '' },
}

describe('generateDevisPDF — parcours envoi email', () => {
  it('génère un PDF non vide pour un devis multi-pages avec CGV longues', async () => {
    const blob = await generateDevisPDF(devis, params, 0)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    // Doit rester sous la limite de pièce jointe email (10 Mo)
    expect(blob.size).toBeLessThan(10 * 1024 * 1024)
  })

  it("génère un PDF pour un devis sans CGV (pas de page dédiée)", async () => {
    const blob = await generateDevisPDF(devis, { ...params, cgv: undefined }, 0)
    expect(blob.size).toBeGreaterThan(0)
  })
})

describe('generateFacturePDF — non-régression envoi facture', () => {
  it('génère un PDF non vide avec les mêmes paramètres CGV longues', async () => {
    const facture: Facture = {
      id: 'f1', numero: 'FAC-2026-0001', statut_paiement: 'impayee',
      montant_ht: 4000, tva_montant: 800, montant_ttc: 4800, acompte_recu: 0,
      date_emission: new Date().toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      client: devis.client,
    }
    const blob = await generateFacturePDF(facture, devis, params)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.size).toBeLessThan(10 * 1024 * 1024)
  })
})
