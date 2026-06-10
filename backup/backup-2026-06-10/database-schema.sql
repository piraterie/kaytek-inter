-- ================================================================
-- KAYTEK INTER — Schéma base de données
-- Date       : 2026-06-10
-- Projet     : dimrukkxehcwzemslwiz
-- État       : Post-migration multi-tenant (Étapes 1–7 + fonctions SQL)
-- Note       : Ce fichier reflète l'état produit par les migrations
--              + les fonctions SQL appliquées manuellement en production.
--              Pour le schéma exact en temps réel, exécuter la requête
--              de snapshot dans Supabase SQL Editor.
-- ================================================================


-- ================================================================
-- [TABLES] — ordre de création (respecter les FK)
-- ================================================================

-- organisations (Étape 1)
CREATE TABLE IF NOT EXISTS public.organisations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL,
  nom        text        NOT NULL,
  plan       text        NOT NULL DEFAULT 'pro',
  actif      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_slug_unique UNIQUE (slug),
  CONSTRAINT organisations_plan_check  CHECK (plan IN ('starter', 'pro', 'enterprise'))
);

-- profiles
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
  organisation_id                 uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- clients
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
  organisation_id       uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- prestations
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

-- interventions
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
  cout_pieces           numeric,
  materiel_payeur       text        CHECK (materiel_payeur IN ('admin', 'intervenant')),
  materiel_confirme     boolean     DEFAULT false,
  materiel_confirme_par uuid        REFERENCES public.profiles(id),
  materiel_confirme_at  timestamptz,
  notes_admin           text,
  archive               boolean     NOT NULL DEFAULT false,
  created_by            uuid        REFERENCES public.profiles(id),
  organisation_id       uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- devis
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
  valide_jusqu_au date,
  envoye_le       timestamptz,
  notes           text,
  pdf_url         text,
  created_by      uuid        REFERENCES public.profiles(id),
  organisation_id uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- factures
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
  organisation_id  uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- commissions
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
  organisation_id      uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- photos
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

-- messages
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

-- notifications
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

-- push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id),
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- devices
CREATE TABLE IF NOT EXISTS public.devices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id),
  device_id   text        NOT NULL,
  name        text,
  last_seen   timestamptz DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, device_id)
);

-- parametres_entreprise
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
  cgv                     text,
  signature_dirigeant_url text,
  modele_pdf_defaut       integer     NOT NULL DEFAULT 1,
  email_envoi_devis       boolean     NOT NULL DEFAULT true,
  email_relance_facture   boolean     NOT NULL DEFAULT true,
  email_paiement_recu     boolean     NOT NULL DEFAULT true,
  email_new_intervention  boolean     NOT NULL DEFAULT true,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- journal
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

-- commission_receipts
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
-- [INDEX]
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_organisation_id     ON public.profiles(organisation_id);
CREATE INDEX IF NOT EXISTS idx_clients_organisation_id      ON public.clients(organisation_id);
CREATE INDEX IF NOT EXISTS idx_interventions_organisation_id ON public.interventions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_devis_organisation_id        ON public.devis(organisation_id);
CREATE INDEX IF NOT EXISTS idx_factures_organisation_id     ON public.factures(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commissions_organisation_id  ON public.commissions(organisation_id);


-- ================================================================
-- [FONCTIONS SQL]
-- ================================================================

-- handle_new_user — Trigger auth.users → INSERT profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom',    ''),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'role',   'intervenant'),
    (SELECT id FROM public.organisations WHERE slug = 'kaytek-inter')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- auto_commission — Trigger interventions → INSERT commissions (statut = 'termine')
CREATE OR REPLACE FUNCTION public.auto_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_pct NUMERIC;
  v_part NUMERIC;
  v_comm NUMERIC;
BEGIN
  IF NEW.statut = 'termine'
     AND OLD.statut <> 'termine'
     AND NEW.montant_ttc IS NOT NULL
     AND NEW.intervenant_id IS NOT NULL
  THEN
    SELECT commission_pct INTO v_pct
    FROM public.profiles WHERE id = NEW.intervenant_id;

    v_pct := COALESCE(v_pct, 30);
    v_comm := ROUND(NEW.montant_ttc * v_pct / 100, 2);
    v_part := NEW.montant_ttc - v_comm;

    INSERT INTO public.commissions (
      intervention_id,
      intervenant_id,
      montant_total_client,
      commission_pct,
      part_intervenant,
      commission_admin,
      statut,
      organisation_id
    )
    SELECT NEW.id, NEW.intervenant_id, NEW.montant_ttc, v_pct, v_part, v_comm, 'a_payer', NEW.organisation_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commissions WHERE intervention_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- generate_intervention_numero — Trigger BEFORE INSERT interventions
CREATE OR REPLACE FUNCTION public.generate_intervention_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_int$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'INT-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('int_numero_lock'));
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0)
    INTO maxn
    FROM public.interventions
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_int$;

-- generate_devis_numero — Trigger BEFORE INSERT devis
CREATE OR REPLACE FUNCTION public.generate_devis_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_dev$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'DEV-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('dev_numero_lock'));
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0)
    INTO maxn
    FROM public.devis
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_dev$;

-- generate_facture_numero — Trigger BEFORE INSERT factures
CREATE OR REPLACE FUNCTION public.generate_facture_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_fac$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'FAC-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('fac_numero_lock'));
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0)
    INTO maxn
    FROM public.factures
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_fac$;

-- is_admin() — Helper SECURITY DEFINER (bypass RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


-- ================================================================
-- [TRIGGERS]
-- ================================================================

-- auth.users → profiles
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- interventions → commissions (statut termine)
CREATE OR REPLACE TRIGGER trg_auto_commission
  AFTER UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.auto_commission();

-- numérotation interventions
CREATE TRIGGER set_intervention_numero
  BEFORE INSERT ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.generate_intervention_numero();

-- numérotation devis
CREATE TRIGGER set_devis_numero
  BEFORE INSERT ON public.devis
  FOR EACH ROW EXECUTE FUNCTION public.generate_devis_numero();

-- numérotation factures
CREATE TRIGGER set_facture_numero
  BEFORE INSERT ON public.factures
  FOR EACH ROW EXECUTE FUNCTION public.generate_facture_numero();


-- ================================================================
-- [RLS — POLICIES]
-- ================================================================

ALTER TABLE public.organisations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devis                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parametres_entreprise ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal               ENABLE ROW LEVEL SECURITY;

-- organisations
CREATE POLICY "organisations_select" ON public.organisations
  FOR SELECT TO authenticated
  USING (id = (SELECT organisation_id FROM public.profiles WHERE id = auth.uid()));

-- profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR is_admin()) WITH CHECK (auth.uid() = id OR is_admin());
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE USING (is_admin());

-- clients
CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (is_admin());
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (is_admin());

-- interventions
CREATE POLICY "interventions_select" ON public.interventions FOR SELECT
  USING (is_admin() OR intervenant_id = auth.uid());
CREATE POLICY "interventions_insert" ON public.interventions FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "interventions_update" ON public.interventions FOR UPDATE
  USING (is_admin() OR intervenant_id = auth.uid())
  WITH CHECK (is_admin() OR intervenant_id = auth.uid());
CREATE POLICY "interventions_delete" ON public.interventions FOR DELETE USING (is_admin());

-- devis
CREATE POLICY "devis_select" ON public.devis FOR SELECT USING (is_admin());
CREATE POLICY "devis_insert" ON public.devis FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "devis_update" ON public.devis FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "devis_delete" ON public.devis FOR DELETE USING (is_admin());

-- factures
CREATE POLICY "factures_select" ON public.factures FOR SELECT USING (is_admin());
CREATE POLICY "factures_insert" ON public.factures FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "factures_update" ON public.factures FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "factures_delete" ON public.factures FOR DELETE USING (is_admin());

-- commissions
CREATE POLICY "commissions_select" ON public.commissions FOR SELECT
  USING (is_admin() OR intervenant_id = auth.uid());
CREATE POLICY "commissions_insert" ON public.commissions FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "commissions_update" ON public.commissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "commissions_delete" ON public.commissions FOR DELETE USING (is_admin());

-- messages
CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (expediteur_id = auth.uid() OR destinataire_id = auth.uid());
CREATE POLICY "messages_insert" ON public.messages FOR INSERT WITH CHECK (expediteur_id = auth.uid());
CREATE POLICY "messages_update" ON public.messages FOR UPDATE USING (destinataire_id = auth.uid());

-- photos
CREATE POLICY "photos_select" ON public.photos FOR SELECT
  USING (is_admin() OR EXISTS (
    SELECT 1 FROM public.interventions i
    WHERE i.id = photos.intervention_id AND (is_admin() OR i.intervenant_id = auth.uid())
  ));
CREATE POLICY "photos_insert" ON public.photos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "photos_delete" ON public.photos FOR DELETE USING (is_admin() OR uploaded_by = auth.uid());

-- prestations
CREATE POLICY "prestations_select" ON public.prestations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "prestations_insert" ON public.prestations FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "prestations_update" ON public.prestations FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "prestations_delete" ON public.prestations FOR DELETE USING (is_admin());

-- parametres_entreprise
CREATE POLICY "params_select" ON public.parametres_entreprise FOR SELECT USING (is_admin());
CREATE POLICY "params_insert" ON public.parametres_entreprise FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "params_update" ON public.parametres_entreprise FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "params_delete" ON public.parametres_entreprise FOR DELETE USING (is_admin());

-- journal
CREATE POLICY "journal_select" ON public.journal FOR SELECT USING (is_admin());
CREATE POLICY "journal_insert" ON public.journal FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);


-- ================================================================
-- [SEED] — Données initiales
-- ================================================================

INSERT INTO public.organisations (slug, nom, plan)
VALUES ('kaytek-inter', 'Kaytek Inter', 'pro')
ON CONFLICT (slug) DO NOTHING;
