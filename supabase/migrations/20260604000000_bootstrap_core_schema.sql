-- ================================================================
-- MIGRATION : Correction MIG-01A — Socle applicatif absent de
--             l'historique des migrations (bootstrap)
-- Date de fichier (timestamp de version) : 2026-06-04 — choisi
--   antérieur à la première migration versionnée du dépôt
--   (20260605000000_push_subscriptions.sql) pour que ce socle soit
--   rejoué EN PREMIER sur une base vide.
-- Date de rédaction réelle : voir audit-kaytek-inter/corrections/
--   analyse-mig-01-bootstrap-migrations.md et correction-mig-01-
--   bootstrap.md pour l'analyse complète.
-- ================================================================
--
-- CONTEXTE (voir analyse-mig-01-bootstrap-migrations.md) :
-- Les 107 migrations existantes de ce dépôt (5 juin → 26 juillet 2026)
-- ne créent JAMAIS 13 tables métier fondamentales — profiles, clients,
-- prestations, interventions, devis, factures, commissions, photos,
-- messages, notifications, parametres_entreprise, journal,
-- commission_receipts — ni le trigger auth.users → profiles
-- (on_auth_user_created / handle_new_user). Ces objets ont été créés
-- directement sur le projet Supabase distant (Dashboard/éditeur SQL)
-- avant que le suivi par migrations versionnées ne commence. En
-- conséquence, `supabase start`/`supabase db reset` échouent sur une
-- base strictement vide dès la toute première migration
-- (20260605000000_push_subscriptions.sql, FK vers "profiles"
-- inexistante).
--
-- CETTE MIGRATION NE FAIT QUE COMBLER CE VIDE, POUR PERMETTRE UN
-- BOOTSTRAP LOCAL DEPUIS ZÉRO :
--   · Ne modifie, ne renomme, ne supprime AUCUNE migration existante.
--   · N'insère AUCUNE donnée métier, AUCUN utilisateur réel.
--   · Ne crée AUCUNE URL distante, AUCUN secret.
--   · N'active PAS Row Level Security et NE CRÉE AUCUNE policy — les
--     107 migrations existantes (à partir de 20260605000004 puis
--     20260610000016-000032) le font déjà elles-mêmes, avec leurs
--     propres DROP POLICY IF EXISTS / ENABLE ROW LEVEL SECURITY
--     (idempotents) — les reproduire ici serait redondant et risquerait
--     de diverger de leur définition réelle et déjà versionnée.
--   · N'ajoute PAS organisation_id sur ces tables, et ne crée PAS
--     public.organisations : cette table est déjà créée par
--     20260610000001_create_organisations.sql (confirmé : aucune
--     migration antérieure à ce fichier ne référence organisations) —
--     et les 14 migrations dédiées 20260610000002 à 000015 ajoutent
--     déjà organisation_id table par table, de façon strictement
--     idempotente (ADD COLUMN IF NOT EXISTS + backfill + FK conditionnelle
--     via bloc DO — vérifié explicitement sur profiles/clients/interventions
--     avant d'écrire ce fichier). Les laisser s'exécuter normalement
--     après cette migration exerce réellement leur logique de backfill,
--     plutôt que de la contourner.
--   · Chaque table est créée avec EXACTEMENT les colonnes et contraintes
--     du schéma de référence backup/backup-2026-06-10/database-schema.sql
--     (source autoritaire fournie), à l'exclusion de organisation_id et
--     de tout ce qui en dépend (index organisation_id, policy
--     organisations_select) — reconstruit comme l'état minimal requis
--     juste avant 20260605000000, pas l'état final de juillet.
--   · CREATE TABLE IF NOT EXISTS partout : sans effet sur une base où
--     ces tables existent déjà (aucune table recréée, aucune colonne
--     supprimée, aucune donnée modifiée, aucune contrainte dupliquée).
--     Ceci ne signifie PAS que cette migration est autorisée en
--     production sans réconciliation préalable du ledger de migrations
--     (voir correction-mig-01-bootstrap.md, section réconciliation).
--
-- ORDRE DE CRÉATION (respecte les dépendances FK) :
--   1. profiles (référence uniquement auth.users, fournie par la
--      plateforme Supabase)
--   2. clients, prestations, parametres_entreprise (indépendantes
--      entre elles ; clients référence profiles)
--   3. interventions (référence clients, profiles)
--   4. devis (référence clients, profiles, interventions)
--   5. factures (référence devis, interventions, clients, profiles)
--   6. commissions, photos, messages, notifications, journal,
--      commission_receipts (référencent interventions/factures/profiles,
--      indépendantes entre elles)
--   7. Fonction handle_new_user() (version minimale pré-multi-tenant,
--      sans organisation_id — sera intégralement remplacée par
--      20260610000026_phase7_security_definer_hygiene.sql via
--      CREATE OR REPLACE FUNCTION, qui ajoute la logique organisation_id
--      une fois la colonne créée)
--   8. Trigger on_auth_user_created (jamais créé par aucune migration
--      existante — confirmé par recherche exhaustive — nécessaire pour
--      que la création d'un utilisateur Supabase Auth produise
--      automatiquement un profil, comme en production)
--
-- SOURCES CROISÉES UTILISÉES (voir correction-mig-01-bootstrap.md pour
-- le détail table par table, niveau de confiance et éléments déduits) :
--   · backup/backup-2026-06-10/database-schema.sql (source autoritaire
--     principale, datée du lendemain de la première migration en échec)
--   · Les 107 migrations existantes (colonnes ajoutées plus tard,
--     contraintes CHECK modifiées, confirmation d'idempotence)
--   · Aucun fichier de types TypeScript Supabase généré n'existe dans
--     ce dépôt (vérifié : aucun résultat pour database.types.ts ni pour
--     un export Database quelconque sous src/) — non utilisé, non
--     nécessaire vu la qualité de la source principale.
-- ================================================================


-- ================================================================
-- 1. PROFILES
-- ================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role                            text        NOT NULL DEFAULT 'intervenant' CHECK (role IN ('admin', 'intervenant')),
  type_intervenant                text        CHECK (type_intervenant IN ('entrepreneur', 'salarie')),
  nom                             text        NOT NULL DEFAULT '',
  prenom                          text        NOT NULL DEFAULT '',
  email                           text        NOT NULL DEFAULT '',
  telephone                       text,
  commission_pct                  numeric     NOT NULL DEFAULT 30,
  actif                           boolean     NOT NULL DEFAULT true,
  can_create_documents            boolean     NOT NULL DEFAULT false,
  can_bypass_validation           boolean     NOT NULL DEFAULT false,
  telegram_chat_id                text,
  telegram_notifications_enabled  boolean     DEFAULT false,
  avatar_url                      text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
-- NB : role/type_intervenant utilisent CHECK sur text (pas de type ENUM
-- dédié) — cohérent avec le style constaté dans tout le reste du dépôt.


-- ================================================================
-- 2. TABLES INDÉPENDANTES (ne référencent que profiles, ou rien)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.clients (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  text        NOT NULL DEFAULT 'particulier',
  nom                   text        NOT NULL,
  prenom                text,
  raison_sociale        text,
  telephone             text,
  email                 text,
  adresse_intervention  text,
  cp_intervention       text,
  ville_intervention    text,
  adresse_facturation   text,
  notes_internes        text,
  archive               boolean     NOT NULL DEFAULT false,
  created_by            uuid        REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prestations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             text        NOT NULL,
  categorie       text        NOT NULL CHECK (categorie IN ('serrurerie', 'vitrerie', 'plomberie', 'electricite')),
  sous_categorie  text,
  description     text,
  prix_min        numeric,
  prix_conseille  numeric,
  prix_urgence    numeric,
  tva_pct         integer     NOT NULL DEFAULT 10,
  actif           boolean     NOT NULL DEFAULT true,
  ordre           integer     NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parametres_entreprise (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raison_sociale          text        NOT NULL DEFAULT '',
  logo_url                text,
  telephone               text,
  email                   text,
  site_web                text,
  adresse                 text,
  code_postal             text,
  ville                   text,
  siret                   text,
  numero_tva              text,
  iban                    text,
  bic                     text,
  rc_pro                  text,
  tva_defaut              numeric     NOT NULL DEFAULT 10,
  couleur_principale      text        NOT NULL DEFAULT '#1e3a5f',
  -- assurance_decennale/couleur_secondaire/mentions_legales/
  -- email_commission/delai_relance_1/delai_relance_2 : ABSENTES du
  -- schéma de référence (backup 2026-06-10), référencées pour la
  -- première fois par la vue public.parametres_entreprise_public créée
  -- dans 20260711000003_secure_sensitive_settings_and_founder_seats.sql,
  -- sans qu'aucune migration ne les ajoute — reconstruites par
  -- inférence à partir de leur seul nom et des colonnes voisines déjà
  -- connues (voir correction-mig-01-bootstrap.md, tableau de confiance) :
  --   · assurance_decennale : text, par analogie avec rc_pro/siret
  --     (référence d'assurance décennale, mention légale du bâtiment).
  --   · couleur_secondaire : text, par analogie avec couleur_principale,
  --     nullable (aucune évidence d'une valeur par défaut spécifique).
  --   · mentions_legales : text, contenu libre.
  --   · email_commission : boolean NOT NULL DEFAULT true, par analogie
  --     stricte avec les 4 autres colonnes email_* déjà connues.
  --   · delai_relance_1/delai_relance_2 : integer, nullable (nombre de
  --     jours avant relance, aucune évidence de valeur par défaut).
  assurance_decennale     text,
  couleur_secondaire      text,
  mentions_legales        text,
  cgv                     text,
  signature_dirigeant_url text,
  modele_pdf_defaut       integer     NOT NULL DEFAULT 1,
  email_envoi_devis       boolean     NOT NULL DEFAULT true,
  email_relance_facture   boolean     NOT NULL DEFAULT true,
  email_paiement_recu     boolean     NOT NULL DEFAULT true,
  email_new_intervention  boolean     NOT NULL DEFAULT true,
  email_commission        boolean     NOT NULL DEFAULT true,
  delai_relance_1         integer,
  delai_relance_2         integer,
  updated_at              timestamptz NOT NULL DEFAULT now()
);


-- ================================================================
-- 3. INTERVENTIONS (référence clients, profiles)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.interventions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text        NOT NULL DEFAULT '',
  client_id             uuid        REFERENCES public.clients(id),
  intervenant_id        uuid        REFERENCES public.profiles(id),
  type                  text        CHECK (type IN ('serrurerie', 'vitrerie', 'plomberie', 'electricite')),
  statut                text        NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','accepte','refuse','en_cours','termine','annule','facture')),
  urgence               boolean     NOT NULL DEFAULT false,
  adresse               text,
  code_postal           text,
  ville                 text,
  code_acces            text,
  date_prevue           timestamptz,
  date_debut            timestamptz,
  date_fin              timestamptz,
  description           text,
  travail_realise       text,
  materiel_utilise      text,
  temps_passe_min       integer,
  montant_ht            numeric,
  tva_pct               integer     NOT NULL DEFAULT 10,
  montant_ttc           numeric,
  cout_pieces           numeric     DEFAULT 0,
  materiel_payeur       text        CHECK (materiel_payeur IN ('admin', 'intervenant')),
  materiel_confirme     boolean     DEFAULT false,
  materiel_confirme_par uuid        REFERENCES public.profiles(id),
  materiel_confirme_at  timestamptz,
  notes_admin           text,
  archive               boolean     NOT NULL DEFAULT false,
  created_by            uuid        REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);


-- ================================================================
-- 4. DEVIS (référence clients, profiles, interventions)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.devis (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          text        NOT NULL DEFAULT '',
  client_id       uuid        REFERENCES public.clients(id),
  intervenant_id  uuid        REFERENCES public.profiles(id),
  intervention_id uuid        REFERENCES public.interventions(id),
  activite        text        CHECK (activite IN ('serrurerie', 'vitrerie', 'plomberie', 'electricite')),
  statut          text        NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('en_attente_validation','brouillon','envoye','accepte','refuse','expire')),
  lignes          jsonb       NOT NULL DEFAULT '[]',
  remise_pct      numeric     NOT NULL DEFAULT 0,
  remise_montant  numeric,
  total_ht        numeric     NOT NULL DEFAULT 0,
  tva_montant     numeric     NOT NULL DEFAULT 0,
  total_ttc       numeric     NOT NULL DEFAULT 0,
  modele_id       integer     NOT NULL DEFAULT 1,
  signature_url   text,
  signe_le        timestamptz,
  signe_par       text,
  -- signature_client/signature_date : ABSENTES du schéma de référence
  -- backup/backup-2026-06-10/database-schema.sql, mais référencées (IS
  -- NOT NULL uniquement, jamais d'autre opération dépendant du type
  -- exact) par 4 migrations ultérieures (20260610000022, 000029,
  -- 20260708000008, 20260722000001) sans qu'aucune ne les ajoute via
  -- ALTER TABLE — reconstruites par inférence à partir de leur seul
  -- usage (voir correction-mig-01-bootstrap.md, tableau de confiance
  -- par table) : types choisis par analogie avec signe_par/signe_le
  -- déjà présents dans la source autoritaire.
  signature_client text,
  signature_date   timestamptz,
  valide_jusqu_au date,
  envoye_le       timestamptz,
  notes           text,
  pdf_url         text,
  created_by      uuid        REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);


-- ================================================================
-- 5. FACTURES (référence devis, interventions, clients, profiles)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.factures (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           text        NOT NULL DEFAULT '',
  devis_id         uuid        REFERENCES public.devis(id),
  intervention_id  uuid        REFERENCES public.interventions(id),
  client_id        uuid        REFERENCES public.clients(id),
  statut_paiement  text        NOT NULL DEFAULT 'impayee' CHECK (statut_paiement IN ('en_attente_validation','impayee','payee','acompte','partiel','annulee')),
  mode_paiement    text        CHECK (mode_paiement IN ('cb','especes','virement','cheque')),
  montant_ht       numeric     NOT NULL DEFAULT 0,
  tva_montant      numeric     NOT NULL DEFAULT 0,
  montant_ttc      numeric     NOT NULL DEFAULT 0,
  acompte_recu     numeric     NOT NULL DEFAULT 0,
  date_emission    date        NOT NULL DEFAULT CURRENT_DATE,
  date_echeance    date,
  date_paiement    date,
  relance_1_le     date,
  relance_2_le     date,
  notes            text,
  pdf_url          text,
  created_by       uuid        REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);


-- ================================================================
-- 6. TABLES DÉPENDANTES DE INTERVENTIONS/FACTURES/PROFILES
--    (indépendantes entre elles)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.commissions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id      uuid        NOT NULL REFERENCES public.interventions(id),
  facture_id           uuid        REFERENCES public.factures(id),
  intervenant_id       uuid        NOT NULL REFERENCES public.profiles(id),
  montant_total_client numeric     NOT NULL,
  commission_pct       numeric     NOT NULL,
  part_intervenant     numeric     NOT NULL,
  commission_admin     numeric     NOT NULL,
  statut               text        NOT NULL DEFAULT 'a_payer' CHECK (statut IN ('a_payer', 'paye')),
  paye_le              timestamptz,
  -- organisation_id : ANOMALIE DISTINCTE trouvée pendant le premier
  -- test de reset (voir correction-mig-01-bootstrap.md) — contrairement
  -- à profiles/clients/interventions/devis/factures/commission_receipts/
  -- etc. (chacune dotée d'une migration dédiée
  -- 20260610000002-000015, avec FK + NOT NULL + backfill idempotents),
  -- AUCUNE migration n'ajoute organisation_id à commissions, alors que
  -- 20260610000025_rls_phase6_profiles_commissions.sql l'utilise déjà
  -- dans ses policies RLS. Colonne ajoutée ici nullable et SANS FK —
  -- reproduction fidèle du minimum requis pour que l'historique
  -- existant rejoue, PAS une amélioration de fond (ajouter la FK/NOT
  -- NULL manquante serait une correction distincte, hors périmètre de
  -- MIG-01, qui reproduit l'historique tel qu'il est plutôt que de le
  -- durcir).
  organisation_id      uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid        NOT NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  url             text        NOT NULL,
  storage_path    text        NOT NULL,
  type            text        CHECK (type IN ('avant', 'apres', 'autre')),
  taille_octets   integer,
  uploaded_by     uuid        REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  expediteur_id   uuid        NOT NULL REFERENCES public.profiles(id),
  destinataire_id uuid        NOT NULL REFERENCES public.profiles(id),
  intervention_id uuid        REFERENCES public.interventions(id),
  contenu         text        NOT NULL DEFAULT '',
  type            text        NOT NULL DEFAULT 'texte' CHECK (type IN ('texte','intervention','photo','audio','system')),
  media_url       text,
  metadata        jsonb,
  lu              boolean     NOT NULL DEFAULT false,
  lu_le           timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id),
  titre       text        NOT NULL,
  contenu     text,
  type        text        NOT NULL DEFAULT 'info' CHECK (type IN ('info','succes','alerte','erreur')),
  lue         boolean     NOT NULL DEFAULT false,
  lien        text,
  skip_push   boolean     DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.journal (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES public.profiles(id),
  user_nom    text,
  action      text        NOT NULL,
  table_name  text        NOT NULL,
  record_id   text,
  description text,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_receipts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id      uuid        NOT NULL REFERENCES public.factures(id),
  intervention_id uuid        REFERENCES public.interventions(id),
  intervenant_id  uuid        NOT NULL REFERENCES public.profiles(id),
  recue           boolean     NOT NULL DEFAULT false,
  recue_le        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facture_id, intervenant_id)
);


-- ================================================================
-- 6 bis. founder_seats + claim_founder_seat() — RECONSTRUCTION FAIBLE
--    CONFIANCE, PLACEHOLDER STRUCTUREL UNIQUEMENT.
--
-- Trouvé manquant pendant le premier test de reset :
-- 20260711000003_secure_sensitive_settings_and_founder_seats.sql fait
-- des REVOKE sur public.founder_seats et public.claim_founder_seat(),
-- qui échouent si ces objets n'existent pas (REVOKE, contrairement à
-- DROP, n'a pas de variante IF EXISTS). Cette table/fonction ne fait
-- PAS partie des 14 tables listées dans l'autorisation MIG-01A, n'est
-- référencée par AUCUNE des Corrections 1 à 6, ni par aucun code
-- frontend de ce dépôt (recherche exhaustive : 0 résultat) — il s'agit
-- d'une fonctionnalité de landing page ("places fondateur restantes"),
-- couplée au site externe kaytekinter.fr (Netlify), hors périmètre
-- métier de ce dépôt.
--
-- Confiance : SEULE certitude tirée du texte des migrations
-- existantes : une colonne "taken" est incrémentée par
-- claim_founder_seat(). Tout le reste (colonne "total"/limite, clé
-- primaire, policy de lecture publique "founder_seats_select_public"
-- mentionnée en commentaire mais jamais définie dans aucune migration)
-- est un PLACEHOLDER STRUCTUREL MINIMAL, suffisant uniquement pour que
-- les REVOKE de 20260711000003 ne échouent pas — PAS une reconstruction
-- fiable du schéma réel. Aucune policy n'est créée ici : aucune
-- migration existante n'essaie d'en créer une pour cette table (les
-- REVOKE seuls suffisent à faire échouer le reset), donc aucune n'est
-- nécessaire pour que l'historique rejoue.
--
-- Si cette fonctionnalité devait être exercée par un test futur, sa
-- structure réelle devra être vérifiée en lecture seule contre la
-- production avant toute utilisation — ne jamais se fier à ce
-- placeholder au-delà de "permettre au reset de terminer".
-- ================================================================
CREATE TABLE IF NOT EXISTS public.founder_seats (
  id         integer     PRIMARY KEY DEFAULT 1,
  taken      integer     NOT NULL DEFAULT 0,
  total      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.claim_founder_seat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $bootstrap_claim_founder_seat$
BEGIN
  UPDATE public.founder_seats SET taken = taken + 1, updated_at = now() WHERE id = 1;
END;
$bootstrap_claim_founder_seat$;


-- ================================================================
-- 7. FONCTION handle_new_user() — version minimale pré-multi-tenant
-- ================================================================
-- Volontairement SANS organisation_id : la colonne n'existe pas encore
-- à ce point de l'historique rejoué (créée par 20260610000002_profiles_
-- organisation_id.sql). Cette fonction sera intégralement remplacée par
-- 20260610000026_phase7_security_definer_hygiene.sql (CREATE OR REPLACE
-- FUNCTION), qui ajoute la logique organisation_id une fois la colonne
-- disponible — remplacement total du corps, aucune dépendance à cette
-- version minimale au-delà de ce point.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $bootstrap_handle_new_user$
BEGIN
  INSERT INTO public.profiles (id, email, nom, prenom, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom',    ''),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'role',   'intervenant')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$bootstrap_handle_new_user$;


-- ================================================================
-- 7 bis. FONCTION GÉNÉRIQUE public.set_updated_at() — trouvée manquante
--    pendant le premier test de reset (20260710000001_provision_
--    subscriber_organisation.sql échoue sans elle). Jamais créée par
--    aucune migration existante (seules des variantes nommément
--    différentes existent : guide_videos_set_updated_at(),
--    guide_news_set_updated_at(), propres à leur table). Fonction
--    générique standard (aucune dépendance à une table précise),
--    sans risque d'ambiguïté : son unique usage observé
--    (subscriptions_set_updated_at trigger) attend exactement ce
--    comportement (NEW.updated_at := now()).
-- ================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $bootstrap_set_updated_at$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$bootstrap_set_updated_at$;


-- ================================================================
-- 8. TRIGGER on_auth_user_created — jamais créé par aucune migration
--    existante (confirmé par recherche exhaustive dans les 107
--    fichiers : uniquement mentionné comme "inchangé" dans
--    20260610000026, jamais un CREATE TRIGGER) — nécessaire pour que
--    la création d'un utilisateur Supabase Auth crée automatiquement
--    un profil, comme c'est le cas en production.
-- ================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles', 'clients', 'prestations', 'parametres_entreprise',
    'interventions', 'devis', 'factures', 'commissions', 'photos',
    'messages', 'notifications', 'journal', 'commission_receipts'
  )
ORDER BY table_name;
-- Attendu : les 13 tables listées.

SELECT trigger_name, event_object_schema, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
-- Attendu : 1 ligne (auth.users).
