// src/types/index.ts
export type Role = 'admin' | 'intervenant'
export type StatutIntervention = 'en_attente'|'accepte'|'refuse'|'en_cours'|'termine'|'annule'|'facture'
export type StatutDevis = 'brouillon'|'envoye'|'accepte'|'refuse'|'expire'
export type StatutPaiement = 'impayee'|'payee'|'acompte'|'partiel'|'annulee'
export type ModePaiement = 'cb'|'especes'|'virement'|'cheque'
export type Categorie = 'serrurerie'|'vitrerie'
export type TypePhoto = 'avant'|'apres'|'autre'

export interface Profile {
  id: string; role: Role; nom: string; prenom: string; email: string
  telephone?: string; commission_pct: number; actif: boolean
  avatar_url?: string; created_at: string; updated_at: string
}

export interface ParametresEntreprise {
  id: string; raison_sociale: string; logo_url?: string; telephone?: string
  email?: string; site_web?: string; adresse?: string; code_postal?: string; ville?: string
  siret?: string; numero_tva?: string; iban?: string; bic?: string; rc_pro?: string
  tva_defaut: number; couleur_principale: string; cgv?: string
  signature_dirigeant_url?: string; modele_pdf_defaut: number
  email_envoi_devis: boolean; email_relance_facture: boolean
  email_paiement_recu: boolean; email_new_intervention: boolean; updated_at: string
}

export interface Client {
  id: string; type: string; nom: string; prenom?: string; raison_sociale?: string
  telephone?: string; email?: string; adresse_intervention?: string
  cp_intervention?: string; ville_intervention?: string; adresse_facturation?: string
  notes_internes?: string; created_by?: string; created_at: string; updated_at: string
}

export interface Prestation {
  id: string; nom: string; categorie: Categorie; sous_categorie?: string
  description?: string; prix_min?: number; prix_conseille?: number; prix_urgence?: number
  tva_pct: number; actif: boolean; ordre: number
}

export interface Intervention {
  id: string; numero: string; client_id?: string; intervenant_id?: string
  type?: Categorie; statut: StatutIntervention; urgence: boolean
  adresse?: string; code_postal?: string; ville?: string; code_acces?: string
  date_prevue?: string; date_debut?: string; date_fin?: string
  description?: string; travail_realise?: string; materiel_utilise?: string
  temps_passe_min?: number; montant_ht?: number; tva_pct: number
  montant_ttc?: number; notes_admin?: string; created_by?: string
  created_at: string; updated_at: string
  client?: Client; intervenant?: Profile; photos?: Photo[]
}

export interface LigneDevis {
  id: string; description: string; quantite: number; prix_ht: number
  tva_pct: number; total_ht: number; total_ttc: number
}

export interface Devis {
  id: string; numero: string; client_id?: string; intervenant_id?: string
  intervention_id?: string; activite?: Categorie; statut: StatutDevis
  lignes: LigneDevis[]; remise_pct: number; remise_montant?: number
  total_ht: number; tva_montant: number; total_ttc: number; modele_id: number
  signature_url?: string; signe_le?: string; signe_par?: string
  valide_jusqu_au?: string; envoye_le?: string; notes?: string; pdf_url?: string
  created_by?: string; created_at: string; updated_at: string
  client?: Client; intervenant?: Profile
}

export interface Facture {
  id: string; numero: string; devis_id?: string; intervention_id?: string
  client_id?: string; statut_paiement: StatutPaiement; mode_paiement?: ModePaiement
  montant_ht: number; tva_montant: number; montant_ttc: number; acompte_recu: number
  date_emission: string; date_echeance?: string; date_paiement?: string
  relance_1_le?: string; relance_2_le?: string; notes?: string; pdf_url?: string
  created_by?: string; created_at: string; updated_at: string
  client?: Client; devis?: Devis
}

export interface Commission {
  id: string; intervention_id: string; facture_id?: string; intervenant_id: string
  montant_total_client: number; commission_pct: number; part_intervenant: number
  commission_admin: number; statut: 'a_payer'|'paye'; paye_le?: string
  created_at: string; updated_at: string
  intervenant?: Profile; intervention?: Intervention
}

export interface Message {
  id: string; expediteur_id: string; destinataire_id: string
  intervention_id?: string; contenu: string
  type: 'texte'|'intervention'|'photo'|'audio'|'system'
  media_url?: string
  metadata?: Record<string, unknown>; lu: boolean; lu_le?: string
  created_at: string; expediteur?: Profile
}

export interface Photo {
  id: string; intervention_id: string; url: string; storage_path: string
  type?: TypePhoto; taille_octets?: number; uploaded_by?: string; created_at: string
}

export interface Notification {
  id: string; user_id: string; titre: string; contenu?: string
  type: 'info'|'succes'|'alerte'|'erreur'; lue: boolean; lien?: string; created_at: string
}

export interface JournalEntry {
  id: string; user_id?: string; user_nom?: string; action: string
  table_name: string; record_id?: string; description?: string
  old_value?: Record<string, unknown>; new_value?: Record<string, unknown>; created_at: string
}

export interface DashboardStats {
  interventions_today: number; ca_mois: number; factures_impayees: number
  montant_impaye: number; commissions_dues: number; devis_en_attente: number
  messages_non_lus: number
}
