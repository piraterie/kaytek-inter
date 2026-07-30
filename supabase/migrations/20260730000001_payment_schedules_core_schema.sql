-- ================================================================
-- MIGRATION : Échéanciers de paiement / acomptes — schéma de base
-- Date       : 2026-07-30
-- Objectif   : Créer les 5 tables du système d'échéancier de paiement
--              (acompte + jusqu'à 4 échéances) sur les devis, sans
--              toucher aux tables existantes devis/factures/clients
--              (uniquement des lectures via FK).
-- Portée     : Purement additif. N'altère aucune donnée existante.
--              Ne modifie ni devis.statut ni la transformation
--              devis -> facture (useDevisToFacture reste inchangé).
-- Tables     : echeanciers, echeances, paiements, relances_paiement,
--              journal_echeancier.
-- Note       : `public.set_updated_at()` est utilisée en production
--              (cf. 20260710000001_provision_subscriber_organisation.sql)
--              mais n'a jamais été définie dans une migration trackée
--              (dérive de schéma déjà documentée pour ce dépôt). On la
--              (re)crée ici en CREATE OR REPLACE, sans risque pour la
--              prod (même comportement standard NEW.updated_at = now()).
-- ================================================================

-- ── Fonction générique updated_at (idempotente, sûre à rejouer) ───
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── 1. echeanciers ──────────────────────────────────────────────
-- Un échéancier par devis actif (acompte + jusqu'à 4 échéances au total).
CREATE TABLE IF NOT EXISTS public.echeanciers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id),
  devis_id              uuid NOT NULL REFERENCES public.devis(id),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  montant_ht            numeric NOT NULL CHECK (montant_ht >= 0),
  tva_montant           numeric NOT NULL CHECK (tva_montant >= 0),
  montant_ttc           numeric NOT NULL CHECK (montant_ttc >= 0),
  montant_paye          numeric NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
  montant_restant       numeric NOT NULL DEFAULT 0,
  nombre_echeances      integer NOT NULL CHECK (nombre_echeances BETWEEN 1 AND 4),
  mode_repartition      text NOT NULL DEFAULT 'egale'
                          CHECK (mode_repartition IN ('egale', 'pourcentages', 'montants')),
  statut                text NOT NULL DEFAULT 'brouillon'
                          CHECK (statut IN (
                            'brouillon', 'a_facturer', 'facture', 'en_attente_paiement',
                            'paiement_partiel', 'paye', 'en_retard', 'impaye', 'annule'
                          )),
  note_interne          text,
  note_visible_client    boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  annule_le             timestamptz,
  annule_par            uuid REFERENCES public.profiles(id),
  motif_annulation      text
);

-- Un seul échéancier actif (non annulé) par devis.
CREATE UNIQUE INDEX IF NOT EXISTS echeanciers_devis_actif_unique
  ON public.echeanciers (devis_id)
  WHERE annule_le IS NULL;

CREATE INDEX IF NOT EXISTS echeanciers_organisation_id_idx ON public.echeanciers (organisation_id);
CREATE INDEX IF NOT EXISTS echeanciers_devis_id_idx        ON public.echeanciers (devis_id);
CREATE INDEX IF NOT EXISTS echeanciers_client_id_idx        ON public.echeanciers (client_id);
CREATE INDEX IF NOT EXISTS echeanciers_statut_idx           ON public.echeanciers (statut);

DROP TRIGGER IF EXISTS echeanciers_set_updated_at ON public.echeanciers;
CREATE TRIGGER echeanciers_set_updated_at
  BEFORE UPDATE ON public.echeanciers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. echeances ────────────────────────────────────────────────
-- Une ligne par échéance (acompte, échéance 2/3, solde). Max 4 par échéancier.
CREATE TABLE IF NOT EXISTS public.echeances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id),
  echeancier_id         uuid NOT NULL REFERENCES public.echeanciers(id) ON DELETE CASCADE,
  devis_id              uuid NOT NULL REFERENCES public.devis(id),
  facture_id            uuid REFERENCES public.factures(id),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  numero_ordre          integer NOT NULL CHECK (numero_ordre BETWEEN 1 AND 4),
  libelle               text NOT NULL,
  pourcentage           numeric NOT NULL CHECK (pourcentage >= 0 AND pourcentage <= 100),
  montant_ht            numeric NOT NULL CHECK (montant_ht >= 0),
  tva_montant           numeric NOT NULL CHECK (tva_montant >= 0),
  montant_ttc           numeric NOT NULL CHECK (montant_ttc >= 0),
  date_prevue           date NOT NULL,
  montant_paye          numeric NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
  montant_restant       numeric NOT NULL DEFAULT 0,
  statut                text NOT NULL DEFAULT 'brouillon'
                          CHECK (statut IN (
                            'brouillon', 'a_facturer', 'facture', 'en_attente_paiement',
                            'paiement_partiel', 'paye', 'en_retard', 'impaye', 'annule'
                          )),
  rappel_actif          boolean NOT NULL DEFAULT true,
  rappel_client_email   boolean NOT NULL DEFAULT true,
  dernier_rappel_le     timestamptz,
  prochain_rappel_le    timestamptz,
  paye_le               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  annule_le             timestamptz,

  UNIQUE (echeancier_id, numero_ordre)
);

CREATE INDEX IF NOT EXISTS echeances_organisation_id_idx ON public.echeances (organisation_id);
CREATE INDEX IF NOT EXISTS echeances_echeancier_id_idx   ON public.echeances (echeancier_id);
CREATE INDEX IF NOT EXISTS echeances_devis_id_idx         ON public.echeances (devis_id);
CREATE INDEX IF NOT EXISTS echeances_facture_id_idx       ON public.echeances (facture_id);
CREATE INDEX IF NOT EXISTS echeances_client_id_idx        ON public.echeances (client_id);
CREATE INDEX IF NOT EXISTS echeances_due_date_idx         ON public.echeances (date_prevue);
CREATE INDEX IF NOT EXISTS echeances_statut_idx           ON public.echeances (statut);

DROP TRIGGER IF EXISTS echeances_set_updated_at ON public.echeances;
CREATE TRIGGER echeances_set_updated_at
  BEFORE UPDATE ON public.echeances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. paiements ────────────────────────────────────────────────
-- Un versement réellement reçu. Peut y en avoir plusieurs par échéance.
CREATE TABLE IF NOT EXISTS public.paiements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  devis_id              uuid REFERENCES public.devis(id),
  facture_id            uuid REFERENCES public.factures(id),
  echeancier_id         uuid REFERENCES public.echeanciers(id),
  echeance_id           uuid REFERENCES public.echeances(id),
  montant               numeric NOT NULL CHECK (montant > 0),
  date_paiement         date NOT NULL,
  mode_paiement         text NOT NULL
                          CHECK (mode_paiement IN (
                            'cb', 'especes', 'virement', 'cheque', 'prelevement', 'paypal', 'autre'
                          )),
  reference             text,
  note                  text,
  piece_jointe_url      text,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES public.profiles(id),
  motif_suppression     text
);

CREATE INDEX IF NOT EXISTS paiements_organisation_id_idx ON public.paiements (organisation_id);
CREATE INDEX IF NOT EXISTS paiements_client_id_idx       ON public.paiements (client_id);
CREATE INDEX IF NOT EXISTS paiements_devis_id_idx        ON public.paiements (devis_id);
CREATE INDEX IF NOT EXISTS paiements_facture_id_idx      ON public.paiements (facture_id);
CREATE INDEX IF NOT EXISTS paiements_echeancier_id_idx   ON public.paiements (echeancier_id);
CREATE INDEX IF NOT EXISTS paiements_echeance_id_idx     ON public.paiements (echeance_id);

DROP TRIGGER IF EXISTS paiements_set_updated_at ON public.paiements;
CREATE TRIGGER paiements_set_updated_at
  BEFORE UPDATE ON public.paiements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. relances_paiement ────────────────────────────────────────
-- Historique + planification des relances (idempotence via cle_idempotence).
CREATE TABLE IF NOT EXISTS public.relances_paiement (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  echeancier_id         uuid NOT NULL REFERENCES public.echeanciers(id),
  echeance_id           uuid NOT NULL REFERENCES public.echeances(id),
  facture_id            uuid REFERENCES public.factures(id),
  type_relance          text NOT NULL
                          CHECK (type_relance IN (
                            'rappel_avant', 'jour_echeance', 'relance_1', 'relance_2',
                            'mise_en_demeure', 'confirmation_paiement'
                          )),
  canal                 text NOT NULL DEFAULT 'email' CHECK (canal IN ('email', 'interne')),
  decalage_jours        integer,
  prevu_le              timestamptz NOT NULL,
  envoye_le             timestamptz,
  statut                text NOT NULL DEFAULT 'planifie'
                          CHECK (statut IN ('planifie', 'envoye', 'echec', 'annule')),
  destinataire          text,
  objet                 text,
  message               text,
  erreur_message        text,
  cle_idempotence       text NOT NULL UNIQUE,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS relances_paiement_organisation_id_idx ON public.relances_paiement (organisation_id);
CREATE INDEX IF NOT EXISTS relances_paiement_echeancier_id_idx   ON public.relances_paiement (echeancier_id);
CREATE INDEX IF NOT EXISTS relances_paiement_echeance_id_idx     ON public.relances_paiement (echeance_id);
CREATE INDEX IF NOT EXISTS relances_paiement_statut_idx          ON public.relances_paiement (statut);
CREATE INDEX IF NOT EXISTS relances_paiement_prevu_le_idx        ON public.relances_paiement (prevu_le);

-- ── 5. journal_echeancier ───────────────────────────────────────
-- Journal d'audit append-only (aucune policy UPDATE/DELETE ne sera créée).
CREATE TABLE IF NOT EXISTS public.journal_echeancier (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id),
  echeancier_id         uuid NOT NULL REFERENCES public.echeanciers(id),
  echeance_id           uuid REFERENCES public.echeances(id),
  paiement_id           uuid REFERENCES public.paiements(id),
  action                text NOT NULL,
  donnees_avant         jsonb,
  donnees_apres         jsonb,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_echeancier_organisation_id_idx ON public.journal_echeancier (organisation_id);
CREATE INDEX IF NOT EXISTS journal_echeancier_echeancier_id_idx   ON public.journal_echeancier (echeancier_id);

-- ── 6. Configuration entreprise : délai impayé + rappels par défaut ──
-- Additif uniquement. Les colonnes email_relance_facture / email_paiement_recu /
-- delai_relance_1 / delai_relance_2 existent déjà (schéma bootstrap non tracké,
-- confirmé par audit) et sont réutilisées telles quelles pour la facture classique ;
-- les colonnes ci-dessous sont spécifiques à l'échéancier.
ALTER TABLE public.parametres_entreprise
  ADD COLUMN IF NOT EXISTS delai_impaye_jours integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rappel_defaut_actif boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rappel_defaut_decalages integer[] NOT NULL DEFAULT ARRAY[-7, -3, -1, 0, 3, 7],
  ADD COLUMN IF NOT EXISTS modeles_relance_echeance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ================================================================
-- VÉRIFICATIONS
-- ================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
--   AND table_name IN ('echeanciers','echeances','paiements','relances_paiement','journal_echeancier');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='parametres_entreprise'
--   AND column_name IN ('delai_impaye_jours','rappel_defaut_actif','rappel_defaut_decalages','modeles_relance_echeance');
