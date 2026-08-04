-- ================================================================
-- TESTS LOCAUX — Correction 8 (Phase 3 : découverte et sélection des
-- comptes Google Ads / établissements Google Business Profile)
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE (ex. `supabase start` local). NE JAMAIS EXÉCUTER CONTRE LA
-- PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Fixtures sous UUID dédiés
-- distincts de toute autre fixture connue de ce dépôt, transaction
-- annulée (ROLLBACK final) — aucune donnée ne doit persister.
--
-- Prérequis : migration 20260728000008 (colonnes de sélection +
-- vues de statut étendues) déjà appliquée.
--
-- Ce que ce fichier NE teste PAS (voir phase-3-account-discovery-and-
-- selection.md, section limites) : les appels réels aux APIs Google
-- Ads/Business Profile (mockés en Deno, voir google-ads-api.test.ts /
-- google-business-api.test.ts), ni la revérification côté serveur
-- qu'un identifiant sélectionné appartient bien à la liste fraîche
-- (logique applicative dans google-select-connection, hors RLS). Ce
-- fichier couvre uniquement la frontière RLS : les nouvelles colonnes
-- restent deny-all comme le reste de la table (seul service_role peut
-- écrire une sélection, jamais authenticated — la restriction "admin
-- uniquement" pour la sélection vient de google-select-connection qui
-- appelle requireActiveAdmin(), pas d'une policy RLS supplémentaire,
-- puisque authenticated n'a de toute façon aucun droit d'écriture sur
-- ces tables, admin ou non).
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, connexions Google A avec sélection) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('30000000-0000-0000-0000-00000000a001', 'gtest3-admin-a@test.local'),
  ('30000000-0000-0000-0000-00000000a002', 'gtest3-assistant-a@test.local'),
  ('30000000-0000-0000-0000-00000000b001', 'gtest3-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('30000000-0000-0000-0000-0000000000a1', 'gtest3-org-a', 'GTest3 Org A', 'pro', true),
  ('30000000-0000-0000-0000-0000000000b1', 'gtest3-org-b', 'GTest3 Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('30000000-0000-0000-0000-00000000a001', 'gtest3-admin-a@test.local',     'GTest3', 'AdminA',     'admin',     '30000000-0000-0000-0000-0000000000a1', true),
  ('30000000-0000-0000-0000-00000000a002', 'gtest3-assistant-a@test.local', 'GTest3', 'AssistantA', 'assistant', '30000000-0000-0000-0000-0000000000a1', true),
  ('30000000-0000-0000-0000-00000000b001', 'gtest3-admin-b@test.local',     'GTest3', 'AdminB',     'admin',     '30000000-0000-0000-0000-0000000000b1', true)
ON CONFLICT (id) DO NOTHING;

-- Connexion Ads org A avec une sélection déjà enregistrée (fictive,
-- aucun token réel — colonnes *_secret_id volontairement NULL).
INSERT INTO public.google_ads_connections (
  organisation_id, google_customer_id, customer_descriptive_name, is_manager_account,
  currency_code, time_zone, status, connected_by, connected_at, selected_at, selected_by
) VALUES (
  '30000000-0000-0000-0000-0000000000a1', '1112223333', 'Compte Test A', false,
  'EUR', 'Europe/Paris', 'connected', '30000000-0000-0000-0000-00000000a001', now(), now(), '30000000-0000-0000-0000-00000000a001'
);

-- Connexion GBP org A avec une sélection déjà enregistrée.
INSERT INTO public.gbp_connections (
  organisation_id, google_location_id, google_account_id, account_name,
  location_title, location_address, location_open_status, status, connected_by, connected_at, selected_at, selected_by
) VALUES (
  '30000000-0000-0000-0000-0000000000a1', 'accounts/123/locations/456', 'accounts/123', 'Ma Société',
  'Agence Centre', '12 rue Test, 75001, Paris, FR', 'OPEN', 'connected', '30000000-0000-0000-0000-00000000a001', now(), now(), '30000000-0000-0000-0000-00000000a001'
);

CREATE OR REPLACE FUNCTION pg_temp.assert_visible_count(p_label text, p_uid uuid, p_sql text, p_expected bigint) RETURNS void AS $$
DECLARE v_actual bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  EXECUTE p_sql INTO v_actual;
  RESET role;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu %, obtenu %', p_label, p_expected, v_actual;
  ELSE
    RAISE NOTICE 'OK [%] — %', p_label, v_actual;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.assert_select_denied(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_count bigint; v_denied boolean := false; v_sqlstate text := 'n/a';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql INTO v_count;
    IF v_count = 0 THEN v_denied := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := true;
  END;
  RESET role;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'ÉCHEC [%] — la lecture a réussi (% ligne(s)) alors qu''elle devait être refusée', p_label, v_count;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%, lignes=%)', p_label, v_sqlstate, coalesce(v_count, 0);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.assert_write_denied(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_denied boolean := false; v_sqlstate text := 'n/a'; v_rowcount bigint := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN v_denied := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := true;
  END;
  RESET role;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'ÉCHEC [%] — l''écriture a réussi (% ligne(s)) alors qu''elle devait être refusée', p_label, v_rowcount;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%, lignes=%)', p_label, v_sqlstate, v_rowcount;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — tables de connexion : les nouvelles colonnes de sélection restent en LECTURE admin-only (même org, voir correction-06/09) et toujours en ÉCRITURE deny-all pour authenticated (admin inclus) ==='; END $$;

-- Depuis 20260731000000, admin A voit désormais SA propre ligne (1) en
-- lecture directe sur la table de base — l'écriture directe (contournement
-- de google-select-connection), elle, reste refusée, testée juste après.
SELECT pg_temp.assert_visible_count('google_ads_connections (base, avec sélection) — admin A, même org', '30000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 1);
SELECT pg_temp.assert_write_denied('google_ads_connections UPDATE sélection — admin A tente d''écrire directement (contournement de google-select-connection)', '30000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_ads_connections SET google_customer_id = '9999999999' WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_connections UPDATE sélection — admin A tente d''écrire directement', '30000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.gbp_connections SET location_title = 'Falsifié' WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — vues de statut : nouvelles colonnes de sélection restituées correctement, admin-only, org-scoped ==='; END $$;

DO $$
DECLARE v_name text; v_currency text; v_selected_at timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-00000000a001', true);
  SET LOCAL role = 'authenticated';
  SELECT customer_descriptive_name, currency_code, selected_at
    INTO v_name, v_currency, v_selected_at
    FROM public.google_ads_connection_status
    WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1';
  RESET role;
  IF v_name IS DISTINCT FROM 'Compte Test A' OR v_currency IS DISTINCT FROM 'EUR' OR v_selected_at IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC — google_ads_connection_status ne restitue pas correctement les colonnes de sélection (admin A, même org)';
  END IF;
  RAISE NOTICE 'OK [google_ads_connection_status — colonnes de sélection] — restituées correctement pour admin A';
END $$;

DO $$
DECLARE v_title text; v_address text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-00000000a001', true);
  SET LOCAL role = 'authenticated';
  SELECT location_title, location_address INTO v_title, v_address
    FROM public.gbp_connection_status
    WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1';
  RESET role;
  IF v_title IS DISTINCT FROM 'Agence Centre' OR v_address IS DISTINCT FROM '12 rue Test, 75001, Paris, FR' THEN
    RAISE EXCEPTION 'ÉCHEC — gbp_connection_status ne restitue pas correctement les colonnes de sélection (admin A, même org)';
  END IF;
  RAISE NOTICE 'OK [gbp_connection_status — colonnes de sélection] — restituées correctement pour admin A';
END $$;

SELECT pg_temp.assert_select_denied('google_ads_connection_status — admin B ne voit pas la sélection de org A', '30000000-0000-0000-0000-00000000b001'::uuid, $sql$SELECT count(*) FROM public.google_ads_connection_status WHERE customer_descriptive_name = 'Compte Test A'$sql$);
SELECT pg_temp.assert_select_denied('gbp_connection_status — admin B ne voit pas la sélection de org A', '30000000-0000-0000-0000-00000000b001'::uuid, $sql$SELECT count(*) FROM public.gbp_connection_status WHERE location_title = 'Agence Centre'$sql$);
SELECT pg_temp.assert_select_denied('google_ads_connection_status — assistant A (non-admin) ne voit rien', '30000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status');
SELECT pg_temp.assert_select_denied('gbp_connection_status — assistant A (non-admin) ne voit rien', '30000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.gbp_connection_status');

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — aucun droit d''écriture résiduel ni colonne de secret sur les vues (répète la vérification intégrée à la migration, en conditions de test) ==='; END $$;

DO $$
DECLARE v_bad_grants text;
BEGIN
  SELECT string_agg(table_name || '.' || grantee || ':' || privilege_type, ', ') INTO v_bad_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grants IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — droit d''écriture résiduel après ajout des colonnes de sélection : %', v_bad_grants;
  END IF;
  RAISE NOTICE 'OK [vues de statut] — toujours aucun droit d''écriture résiduel après Phase 3';
END $$;

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 8 ont réussi ==='; END $$;

-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.google_ads_connections WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1';
DELETE FROM public.gbp_connections WHERE organisation_id = '30000000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE organisation_id IN ('30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN (
  '30000000-0000-0000-0000-00000000a001', '30000000-0000-0000-0000-00000000a002', '30000000-0000-0000-0000-00000000b001'
);

ROLLBACK;
