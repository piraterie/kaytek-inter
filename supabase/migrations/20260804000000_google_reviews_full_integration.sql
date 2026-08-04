-- ================================================================
-- MIGRATION : finalisation Google Ads / Google Business Profile
-- Date      : 2026-08-04
-- ================================================================
-- Contexte : la connexion OAuth (Ads + GBP) est en production et
-- fonctionnelle. Cette migration ajoute les fondations manquantes pour :
--   1. Réponses aux avis Google Business Profile (colonnes de cache local
--      — l'écriture réelle passe par l'API Google, service_role only).
--   2. Demandes d'avis post-facture PAYÉE (et non plus "envoyée" — décision
--      produit du 2026-08-04 qui remplace celle du design d'origine) :
--      colonnes de planification/annulation/statut de livraison, e-mail
--      UNIQUEMENT (SMS explicitement redemandé puis re-abandonné le même
--      jour — voir mémoire projet).
--   3. Paramètres d'organisation pour activer/configurer ces demandes.
--   4. Table de métriques quotidiennes GBP Performance API (appels, clics
--      site, demandes d'itinéraire, vues/recherches).
--   5. pg_cron + pg_net (si disponibles sur ce projet) pour la
--      synchronisation quotidienne et la distribution des demandes d'avis
--      programmées — non bloquant si l'extension est indisponible.
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1. gbp_reviews — réponse (cache local ; l'écriture réelle se fait
--    contre l'API Google Business Profile, jamais directement ici)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.gbp_reviews
  ADD COLUMN IF NOT EXISTS response_text         text,
  ADD COLUMN IF NOT EXISTS response_updated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS response_synced_at     timestamptz;

COMMENT ON COLUMN public.gbp_reviews.response_text IS
  'Cache local de la réponse publiée sur Google (reviews.updateReply). Source de vérité = Google ; ce champ est resynchronisé à chaque appel réussi de google-gbp-review-reply et à chaque synchronisation des avis.';

-- ────────────────────────────────────────────────────────────────
-- 2. review_requests — passage au déclenchement "facture payée" (et non
--    plus "facture envoyée"), planification, annulation, statut de
--    livraison. Email uniquement — colonne channel verrouillée par CHECK.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.review_requests
  ADD COLUMN IF NOT EXISTS channel            text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  ADD COLUMN IF NOT EXISTS scheduled_send_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_status    text NOT NULL DEFAULT 'pending'
                             CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS delivery_error     text;

CREATE INDEX IF NOT EXISTS idx_review_requests_due
  ON public.review_requests (scheduled_send_at)
  WHERE delivery_status = 'pending' AND cancelled_at IS NULL;

-- Remplace la policy INSERT d'origine (déclenchement sur envoyee_le) par
-- le nouveau déclenchement produit : la facture référencée doit être au
-- statut 'payee'. Mêmes garde-fous anti-forgery (org, client réel de la
-- facture, rôle autorisé à facturer) que la version d'origine.
DROP POLICY IF EXISTS "review_requests_insert" ON public.review_requests;
CREATE POLICY "review_requests_insert" ON public.review_requests
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.factures f
      WHERE f.id = review_requests.facture_id
        AND f.organisation_id = current_org_id()
        AND f.statut_paiement = 'payee'
        AND f.client_id = review_requests.client_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organisation_id = current_org_id()
        AND p.actif = true
        AND (p.role = 'admin' OR (p.can_create_documents AND p.can_bypass_validation))
    )
  );

-- Garde-fou data-layer (pas seulement UI) : aucune demande d'avis ne peut
-- être créée pour un client sans e-mail — canal unique = email.
CREATE OR REPLACE FUNCTION public.trg_review_requests_require_client_email()
RETURNS trigger AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.clients WHERE id = NEW.client_id;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'review_requests: le client % n''a pas d''adresse e-mail — aucune demande d''avis possible (canal email uniquement)', NEW.client_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_review_requests_require_email ON public.review_requests;
CREATE TRIGGER trg_review_requests_require_email
  BEFORE INSERT ON public.review_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_review_requests_require_client_email();

-- Annulation par un admin (avant envoi) : déjà couvert par la policy
-- UPDATE existante (review_requests_update_admin, is_admin_in_org) — pas
-- de nouvelle policy nécessaire, seulement documenté ici pour mémoire.
-- L'application doit vérifier delivery_status='pending' avant d'autoriser
-- le bouton "Annuler" côté frontend (une demande déjà 'sent' ne peut plus
-- être annulée — un envoi ne se rappelle pas).

-- ────────────────────────────────────────────────────────────────
-- 3. Paramètres d'organisation — activation/mode/délai/modèle des
--    demandes d'avis (même convention que les colonnes email_* déjà
--    présentes sur parametres_entreprise).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.parametres_entreprise
  ADD COLUMN IF NOT EXISTS avis_google_actif            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avis_google_mode              text NOT NULL DEFAULT 'manuel'
                             CHECK (avis_google_mode IN ('manuel', 'automatique')),
  ADD COLUMN IF NOT EXISTS avis_google_delai              text NOT NULL DEFAULT 'immediat'
                             CHECK (avis_google_delai IN ('immediat', '1h', '24h', '48h', 'personnalise')),
  ADD COLUMN IF NOT EXISTS avis_google_delai_minutes       integer CHECK (avis_google_delai_minutes IS NULL OR avis_google_delai_minutes > 0),
  ADD COLUMN IF NOT EXISTS avis_google_message_template    text NOT NULL DEFAULT
    'Bonjour {{prenom}}, merci pour votre confiance ! Votre avis compte beaucoup pour nous — pourriez-vous prendre un instant pour le partager sur Google ? {{lien_avis}}';

-- avis_google_delai_minutes cohérent avec avis_google_delai='personnalise'
-- uniquement (pas de valeur orpheline pour les presets) — vérifié en
-- application (le calcul du délai réel se fait côté Edge Function/
-- frontend, pas en SQL, pour rester lisible et testable unitairement).

-- Ces colonnes exposées aux admins de l'organisation via la vue
-- parametres_entreprise_public existante (20260731000000) : elles sont
-- ajoutées à la LISTE EXPLICITE de colonnes de la vue ci-dessous (une vue
-- avec liste de colonnes explicite n'hérite jamais automatiquement des
-- nouvelles colonnes de la table de base).
-- CREATE OR REPLACE FUNCTION ne permet pas de changer la liste de colonnes
-- d'un RETURNS TABLE existant (SQLSTATE 42P13) — DROP explicite requis. La
-- vue publique en dépend (elle sera recréée juste après), donc DROP ... CASCADE.
DROP FUNCTION IF EXISTS public.parametres_entreprise_public_rows() CASCADE;

CREATE FUNCTION public.parametres_entreprise_public_rows()
RETURNS TABLE (
  id                      uuid,
  organisation_id         uuid,
  raison_sociale          text,
  logo_url                text,
  telephone               text,
  email                   text,
  site_web                text,
  adresse                 text,
  code_postal             text,
  ville                   text,
  siret                   text,
  numero_tva              text,
  rc_pro                  text,
  assurance_decennale     text,
  tva_defaut              numeric,
  couleur_principale      text,
  couleur_secondaire      text,
  cgv                     text,
  mentions_legales        text,
  signature_dirigeant_url text,
  modele_pdf_defaut       integer,
  email_envoi_devis       boolean,
  email_relance_facture   boolean,
  email_paiement_recu     boolean,
  email_new_intervention  boolean,
  email_commission        boolean,
  delai_relance_1         integer,
  delai_relance_2         integer,
  avis_google_actif           boolean,
  avis_google_mode             text,
  avis_google_delai             text,
  avis_google_delai_minutes     integer,
  avis_google_message_template  text,
  updated_at              timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, organisation_id, raison_sociale, logo_url, telephone, email, site_web,
    adresse, code_postal, ville, siret, numero_tva, rc_pro, assurance_decennale,
    tva_defaut, couleur_principale, couleur_secondaire, cgv, mentions_legales,
    signature_dirigeant_url, modele_pdf_defaut,
    email_envoi_devis, email_relance_facture, email_paiement_recu,
    email_new_intervention, email_commission,
    delai_relance_1, delai_relance_2,
    avis_google_actif, avis_google_mode, avis_google_delai, avis_google_delai_minutes, avis_google_message_template,
    updated_at
  FROM public.parametres_entreprise
  WHERE organisation_id = current_org_id();
$$;

ALTER FUNCTION public.parametres_entreprise_public_rows() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.parametres_entreprise_public_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.parametres_entreprise_public_rows() FROM anon;
GRANT EXECUTE ON FUNCTION public.parametres_entreprise_public_rows() TO authenticated;

-- Le DROP ... CASCADE plus haut a supprimé la vue publique (elle dépendait
-- de la fonction) — recréée à l'identique (même définition que 20260731000000).
CREATE VIEW public.parametres_entreprise_public
WITH (security_invoker = true) AS
SELECT * FROM public.parametres_entreprise_public_rows();

GRANT SELECT ON public.parametres_entreprise_public TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parametres_entreprise_public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parametres_entreprise_public FROM authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3bis. gbp_connections.place_id — nécessaire pour construire le lien
--    officiel de demande d'avis (https://search.google.com/local/writereview?placeid=...).
--    Renseigné par google-select-connection à la sélection de
--    l'établissement (métadonnée déjà présente dans la réponse Business
--    Information API — jamais recalculé/deviné).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.gbp_connections
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS location_phone text,
  ADD COLUMN IF NOT EXISTS location_website text;

CREATE OR REPLACE VIEW public.gbp_connection_status AS
SELECT
  id,
  organisation_id,
  google_location_id,
  google_account_id,
  account_name,
  status,
  connected_at,
  last_synced_at,
  last_error,
  updated_at,
  google_account_email,
  location_title,
  location_address,
  location_open_status,
  selected_at,
  selected_by,
  place_id,
  location_phone,
  location_website
FROM public.gbp_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

ALTER VIEW public.gbp_connection_status SET (security_invoker = true);
GRANT SELECT ON public.gbp_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. gbp_performance_metrics_daily — statistiques Business Profile
--    Performance API (appels, clics site, itinéraires, vues/recherches).
--    Même conception que google_ads_metrics_daily (déjà en place).
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gbp_performance_metrics_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  calls                 integer NOT NULL DEFAULT 0,
  website_clicks        integer NOT NULL DEFAULT 0,
  direction_requests     integer NOT NULL DEFAULT 0,
  business_impressions_maps    integer NOT NULL DEFAULT 0,
  business_impressions_search  integer NOT NULL DEFAULT 0,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gbp_performance_metrics_daily_unique UNIQUE (organisation_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_perf_metrics_org_date
  ON public.gbp_performance_metrics_daily (organisation_id, date DESC);

ALTER TABLE public.gbp_performance_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gbp_performance_metrics_daily_select" ON public.gbp_performance_metrics_daily;
CREATE POLICY "gbp_performance_metrics_daily_select" ON public.gbp_performance_metrics_daily
  FOR SELECT
  USING (is_same_org(organisation_id) AND can_manage_operations(organisation_id));

-- Écriture exclusivement service_role (Edge Function de synchronisation) —
-- aucune policy INSERT/UPDATE/DELETE pour authenticated, même admin.

-- ────────────────────────────────────────────────────────────────
-- 5. google_ads_metrics_daily — colonnes "appels" manquantes pour le
--    dashboard Ads (impressions/clics/coût/conversions déjà présents,
--    voir 20260728000004). Ajout non destructif.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.google_ads_metrics_daily
  ADD COLUMN IF NOT EXISTS phone_calls integer NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────────
-- 6. pg_cron + pg_net — synchronisation quotidienne et distribution des
--    demandes d'avis programmées. Non bloquant : certains projets
--    Supabase n'ont pas ces extensions disponibles par défaut (add-on à
--    activer côté Dashboard) — la migration continue sans erreur fatale
--    si l'activation échoue, et le journal (RAISE NOTICE/WARNING) indique
--    clairement ce qui n'a pas pu être programmé.
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron indisponible sur ce projet (%). Activez l''extension pg_cron depuis le Dashboard Supabase (Database > Extensions) puis relancez la section planification de cette migration manuellement.', SQLERRM;
    RETURN;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_net indisponible sur ce projet (%). Les tâches planifiées ne pourront pas appeler les Edge Functions tant que cette extension n''est pas activée.', SQLERRM;
    RETURN;
  END;

  RAISE NOTICE 'pg_cron/pg_net actifs — voir migration suivante pour la déclaration des tâches planifiées (nécessite les secrets d''URL/clé, non disponibles à l''intérieur d''une migration SQL classique).';
END $$;

-- ================================================================
-- Vérification bloquante
-- ================================================================
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(missing, ', ') INTO v_missing FROM (
    SELECT 'gbp_reviews.response_text' AS missing WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gbp_reviews' AND column_name='response_text')
    UNION ALL
    SELECT 'review_requests.scheduled_send_at' WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='review_requests' AND column_name='scheduled_send_at')
    UNION ALL
    SELECT 'parametres_entreprise.avis_google_actif' WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parametres_entreprise' AND column_name='avis_google_actif')
    UNION ALL
    SELECT 'gbp_performance_metrics_daily' WHERE to_regclass('public.gbp_performance_metrics_daily') IS NULL
    UNION ALL
    SELECT 'gbp_connections.place_id' WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gbp_connections' AND column_name='place_id')
  ) t;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — objet(s) manquant(s) après migration : %', v_missing;
  END IF;

  RAISE NOTICE 'OK — schéma Google Reviews/Ads/GBP Performance mis à jour avec succès.';
END $$;
