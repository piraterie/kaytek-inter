// src/types/index.ts
export type Role = 'admin' | 'intervenant' | 'assistant'
export type TypeIntervenant = 'entrepreneur' | 'salarie'
export type StatutIntervention = 'en_attente'|'accepte'|'refuse'|'en_cours'|'termine'|'annule'|'facture'
export type StatutDevis = 'en_attente_validation'|'brouillon'|'envoye'|'accepte'|'refuse'|'expire'
export type StatutPaiement = 'en_attente_validation'|'impayee'|'payee'|'acompte'|'partiel'|'annulee'
export type ModePaiement = 'cb'|'especes'|'virement'|'cheque'
export type Categorie = 'serrurerie'|'vitrerie'|'plomberie'|'electricite'|'chauffagiste'
export type TypePhoto = 'avant'|'apres'|'autre'

export interface Profile {
  id: string; role: Role; type_intervenant?: TypeIntervenant; nom: string; prenom: string; email: string
  telephone?: string; commission_pct: number; actif: boolean; can_create_documents?: boolean
  can_bypass_validation?: boolean
  telegram_chat_id?: string
  telegram_notifications_enabled?: boolean
  avatar_url?: string; created_at: string; updated_at: string
  organisation_id: string
  welcome_dismissed?: boolean
}

// ── Guide ──────────────────────────────────────────────────────────────────
export interface GuideVideo {
  id: string; organisation_id: string; slug: string; role: Role
  section_slug: string; titre: string; description?: string
  duree_secondes?: number; storage_path: string; ordre: number
  actif: boolean; created_at: string; updated_at: string
}

export interface GuideProgress {
  id: string; user_id: string; organisation_id: string
  section_slug: string; role: Role; completed_at: string
}

export interface GuideNews {
  id: string; organisation_id: string; titre: string; description: string
  date_publication: string; visible_admin: boolean; visible_intervenant: boolean
  actif: boolean; created_at: string; updated_at: string
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

// Sous-ensemble non sensible de ParametresEntreprise (vue
// parametres_entreprise_public) — jamais iban/bic. Accessible à tout
// membre de l'organisation, quel que soit le rôle.
export type ParametresEntreprisePublic = Omit<ParametresEntreprise, 'iban' | 'bic'>

export interface Client {
  id: string; type: string; nom: string; prenom?: string; raison_sociale?: string
  telephone?: string; email?: string; adresse_intervention?: string
  cp_intervention?: string; ville_intervention?: string; adresse_facturation?: string
  notes_internes?: string; archive?: boolean; created_by?: string; created_at: string; updated_at: string
}

// Coordonnées client normalisées pour affichage sur un document (devis/
// facture) — voir src/lib/clientIdentity.ts pour la construction et le
// formatage. Stockée telle quelle dans devis.client_snapshot/
// factures.client_snapshot (colonne jsonb).
export interface ClientDocumentIdentity {
  displayName: string
  companyName?: string
  contactName?: string
  addressLine1?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  country?: string
  email?: string
  phone?: string
}

export interface Prestation {
  id: string; nom: string; categorie: Categorie; sous_categorie?: string
  description?: string; prix_min?: number; prix_conseille?: number; prix_urgence?: number
  tva_pct: number; actif: boolean; ordre: number; created_at?: string
}

export interface Intervention {
  id: string; numero: string; client_id?: string; intervenant_id?: string
  type?: Categorie; statut: StatutIntervention; urgence: boolean
  adresse?: string; code_postal?: string; ville?: string; code_acces?: string
  date_prevue?: string; date_debut?: string; date_fin?: string
  description?: string; travail_realise?: string; materiel_utilise?: string
  temps_passe_min?: number; montant_ht?: number; tva_pct: number
  montant_ttc?: number; cout_pieces?: number; materiel_payeur?: 'admin' | 'intervenant' | null
  materiel_confirme?: boolean; materiel_confirme_par?: string | null; materiel_confirme_at?: string | null
  notes_admin?: string; archive?: boolean; created_by?: string
  rappel_24h_envoye_at?: string | null
  rappel_2h_envoye_at?: string | null
  rappel_30min_envoye_at?: string | null
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
  signature_url?: string; signature_client?: string; signature_date?: string
  signe_le?: string; signe_par?: string
  valide_jusqu_au?: string; envoye_le?: string; notes?: string; pdf_url?: string
  created_by?: string; created_at: string; updated_at: string
  client?: Client; intervenant?: Profile
  // Coordonnées client figées au moment de la création — voir
  // src/lib/clientIdentity.ts. NULL pour les devis créés avant cette
  // fonctionnalité (repli sur `client` ci-dessus).
  client_snapshot?: ClientDocumentIdentity | null
}

export interface Facture {
  id: string; numero: string; devis_id?: string; intervention_id?: string
  client_id?: string; statut_paiement: StatutPaiement; mode_paiement?: ModePaiement
  montant_ht: number; tva_montant: number; montant_ttc: number; acompte_recu: number
  date_emission: string; date_echeance?: string; date_paiement?: string
  relance_1_le?: string; relance_2_le?: string; notes?: string; pdf_url?: string
  created_by?: string; created_at: string; updated_at: string
  client?: Client; devis?: Devis
  // Coordonnées client figées au moment de la création (reprises du devis
  // source en cas de conversion) — voir src/lib/clientIdentity.ts.
  client_snapshot?: ClientDocumentIdentity | null
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
  mes_commissions_mois?: number; mes_commissions_dues?: number
  interventions_a_planifier?: number
}

// ── Réseau partenaires (Phase 1 — fondations + connexions) ──────────────────
export type PartnerConnectionStatus = 'pending'|'accepted'|'refused'|'blocked'|'archived'

export interface PartnerProfile {
  id: string; organisation_id: string; created_by_profile_id?: string
  code_partenaire: string; nom_public: string; metier?: string; ville?: string; bio?: string
  visible_reseau: boolean; created_at: string; updated_at: string
}

export interface PartnerConnection {
  id: string
  requester_organisation_id: string; requester_profile_id: string
  target_organisation_id: string; target_profile_id?: string
  status: PartnerConnectionStatus
  blocked_by_organisation_id?: string; message?: string
  created_at: string; updated_at: string
  partner_profile?: PartnerProfile | null
}

export interface PartnerConnectionEvent {
  id: string; connection_id: string; actor_profile_id?: string; actor_organisation_id?: string
  action: string; note?: string; created_at: string
}

export interface PartnerSearchResult {
  organisation_id: string; code_partenaire: string; nom_public: string
  metier?: string; ville?: string; bio?: string; contact_profile_id?: string
  connection_status: PartnerConnectionStatus | 'none'
}

// ── Réseau partenaires (Phase 2 — messagerie partenaire) ─────────────────────
export interface PartnerMessage {
  id: string; connection_id: string
  sender_profile_id: string; sender_organisation_id: string
  contenu: string
  intervention_request_id?: string
  lu_at?: string | null
  created_at: string; updated_at: string
}

// ── Réseau partenaires (Phase 3 v1 — demandes d'intervention) ────────────────
export type PartnerInterventionStatus = 'pending'|'accepted'|'refused'|'in_progress'|'completed'|'cancelled'

export interface PartnerPhotoMeta { id: string; type?: string }

export interface PartnerInterventionRequest {
  id: string
  connection_id: string
  source_organisation_id: string; source_profile_id: string
  target_organisation_id: string; target_profile_id?: string
  // Présent uniquement côté émetteur pour son propre usage interne —
  // ne jamais afficher côté partenaire (voir composants UI).
  source_intervention_id?: string
  status: PartnerInterventionStatus
  type_intervention?: string
  urgence: boolean
  date_souhaitee?: string
  ville?: string
  adresse_partagee?: string
  telephone_client_partage?: string
  nom_client_partage?: string
  description_partagee?: string
  consignes_partagees?: string
  montant_partage?: number
  photos_partagees?: PartnerPhotoMeta[] | null
  share_adresse: boolean
  share_telephone: boolean
  share_nom_client: boolean
  share_description: boolean
  share_montant: boolean
  share_photos: boolean
  note_refus?: string
  compte_rendu?: string
  resulting_intervention_id?: string
  created_at: string; updated_at: string
  partner_profile?: PartnerProfile | null
}

export interface PartnerInterventionEvent {
  id: string; request_id: string
  actor_profile_id?: string; actor_organisation_id?: string
  action: string; note?: string; created_at: string
}
