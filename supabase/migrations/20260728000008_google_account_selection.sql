-- Phase 3 (découverte et sélection des comptes) — ajouts additifs
-- uniquement : aucune suppression de colonne, aucune reconstruction de
-- table, aucune donnée existante modifiée.
--
-- Les identifiants du compte/établissement SÉLECTIONNÉ réutilisent les
-- colonnes déjà créées en Phase 1 (google_customer_id/
-- google_login_customer_id pour Ads ; google_location_id/google_account_id/
-- account_name pour GBP) — elles existaient déjà mais n'étaient encore
-- jamais renseignées (aucun appel Google Ads/Business Profile n'avait
-- encore été fait). Seules les colonnes vraiment absentes sont ajoutées
-- ici : informations descriptives (nom, devise, fuseau horaire, adresse,
-- statut) et traçabilité de la sélection (qui, quand).
--
-- Ces tables restent deny-all (RLS activée, zéro policy anon/authenticated
-- — voir 20260728000004) : seule google-select-connection (service_role)
-- peut écrire ces colonnes, jamais directement le frontend. La sélection
-- reste donc de facto réservée aux administrateurs actifs, la fonction
-- appelant requireActiveAdmin() avant toute écriture.

-- ────────────────────────────────────────────────────────────────────────
-- 1. google_ads_connections — informations du compte Ads sélectionné
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.google_ads_connections
  ADD COLUMN IF NOT EXISTS customer_descriptive_name text,
  ADD COLUMN IF NOT EXISTS is_manager_account boolean,
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS selected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────
-- 2. gbp_connections — informations de l'établissement GBP sélectionné
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.gbp_connections
  ADD COLUMN IF NOT EXISTS location_title text,
  ADD COLUMN IF NOT EXISTS location_address text,
  ADD COLUMN IF NOT EXISTS location_open_status text,
  ADD COLUMN IF NOT EXISTS selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS selected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Vues de statut — nouvelles colonnes ajoutées en DERNIÈRE position
--    (contrainte Postgres déjà rencontrée en Phase 2 : CREATE OR REPLACE
--    VIEW refuse toute insertion de colonne en position intermédiaire).
--    Toujours admin-only, org-scoped, write-through neutralisé.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.google_ads_connection_status AS
SELECT
  id,
  organisation_id,
  google_customer_id,
  google_login_customer_id,
  status,
  connected_at,
  last_synced_at,
  last_error,
  updated_at,
  google_account_email,
  customer_descriptive_name,
  is_manager_account,
  currency_code,
  time_zone,
  selected_at,
  selected_by
FROM public.google_ads_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

GRANT SELECT ON public.google_ads_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.google_ads_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.google_ads_connection_status FROM authenticated;

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
  selected_by
FROM public.gbp_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

GRANT SELECT ON public.gbp_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM authenticated;

-- Vérification bloquante (même garde-fou qu'en Phase 1/2) : aucun droit
-- d'écriture résiduel, aucune colonne de secret exposée par les vues.
DO $$
DECLARE
  v_bad_grants text;
  v_leaky_cols text;
BEGIN
  SELECT string_agg(table_name || '.' || grantee || ':' || privilege_type, ', ')
    INTO v_bad_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grants IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — droit d''écriture résiduel sur une vue de statut : %', v_bad_grants;
  END IF;

  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_leaky_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND column_name IN ('access_token_secret_id', 'refresh_token_secret_id', 'access_token', 'refresh_token');
  IF v_leaky_cols IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — colonne(s) liée(s) à un secret exposée(s) par une vue de statut : %', v_leaky_cols;
  END IF;

  RAISE NOTICE 'OK — vues de statut Google (Phase 3) : colonnes de sélection ajoutées, aucune fuite.';
END $$;
