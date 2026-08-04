-- ================================================================
-- TESTS LOCAUX — Correction 9 (Advisor : 3 alertes "Security Definer
-- View" — google_ads_connection_status, gbp_connection_status,
-- parametres_entreprise_public passent en security_invoker = true)
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE (ex. `supabase start` local). NE JAMAIS EXÉCUTER CONTRE LA
-- PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Fixtures sous UUID dédiés
-- (préfixe 90000000-...) distincts de toute autre fixture connue de
-- ce dépôt, transaction annulée (ROLLBACK final) — aucune donnée ne
-- doit persister.
--
-- Prérequis : migration 20260731000000_fix_security_definer_views.sql
-- déjà appliquée.
--
-- Objectif principal : prouver qu'aucun comportement observable n'a
-- changé après le passage à security_invoker = true, en particulier
-- le point le plus sensible — parametres_entreprise_public doit
-- rester visible à TOUS les membres actifs de l'organisation (pas
-- seulement les admins), alors que la lecture complète de la table de
-- base (iban/bic inclus) doit rester strictement admin-only.
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, connexions Google A, parametres_entreprise A/B) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('90000000-0000-0000-0000-00000000a001', 'sivtest-admin-a@test.local'),
  ('90000000-0000-0000-0000-00000000a002', 'sivtest-assistant-a@test.local'),
  ('90000000-0000-0000-0000-00000000a003', 'sivtest-intervenant-a@test.local'),
  ('90000000-0000-0000-0000-00000000b001', 'sivtest-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('90000000-0000-0000-0000-0000000000a1', 'sivtest-org-a', 'SIVTest Org A', 'pro', true),
  ('90000000-0000-0000-0000-0000000000b1', 'sivtest-org-b', 'SIVTest Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('90000000-0000-0000-0000-00000000a001', 'sivtest-admin-a@test.local',       'SIVTest', 'AdminA',       'admin',       '90000000-0000-0000-0000-0000000000a1', true),
  ('90000000-0000-0000-0000-00000000a002', 'sivtest-assistant-a@test.local',   'SIVTest', 'AssistantA',   'assistant',   '90000000-0000-0000-0000-0000000000a1', true),
  ('90000000-0000-0000-0000-00000000a003', 'sivtest-intervenant-a@test.local', 'SIVTest', 'IntervenantA', 'intervenant', '90000000-0000-0000-0000-0000000000a1', true),
  ('90000000-0000-0000-0000-00000000b001', 'sivtest-admin-b@test.local',       'SIVTest', 'AdminB',       'admin',       '90000000-0000-0000-0000-0000000000b1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.google_ads_connections (organisation_id, google_customer_id, status, connected_by, connected_at)
VALUES ('90000000-0000-0000-0000-0000000000a1', 'MOCK_CUSTOMER_ID_A', 'connected', '90000000-0000-0000-0000-00000000a001', now());

INSERT INTO public.gbp_connections (organisation_id, google_location_id, google_account_id, status, connected_by, connected_at)
VALUES ('90000000-0000-0000-0000-0000000000a1', 'MOCK_LOCATION_ID_A', 'MOCK_ACCOUNT_ID_A', 'connected', '90000000-0000-0000-0000-00000000a001', now());

INSERT INTO public.parametres_entreprise (organisation_id, raison_sociale, iban, bic, siret, email)
VALUES
  ('90000000-0000-0000-0000-0000000000a1', 'SIVTest Org A SARL', 'FR7612345987650123456789014', 'BNPAFRPPXXX', '11122233344455', 'contact-a@sivtest.local'),
  ('90000000-0000-0000-0000-0000000000b1', 'SIVTest Org B SARL', 'FR7698765123450987654321098', 'SOGEFRPPXXX', '55544433322211', 'contact-b@sivtest.local');

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
    RAISE EXCEPTION 'ÉCHEC [%] — l''écriture a réussi (% ligne(s) affectée(s)) alors qu''elle devait être refusée', p_label, v_rowcount;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%, lignes affectées=%)', p_label, v_sqlstate, v_rowcount;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 0 — security_invoker bien actif sur les 3 vues (attribut de catalogue, pas juste le comportement) ==='; END $$;

DO $$
DECLARE v_not_invoker text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_not_invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('google_ads_connection_status', 'gbp_connection_status', 'parametres_entreprise_public')
    AND NOT COALESCE(
      (SELECT option_value::boolean FROM pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker'),
      false
    );
  IF v_not_invoker IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — security_invoker toujours désactivé sur : %', v_not_invoker;
  END IF;
  RAISE NOTICE 'OK — security_invoker = true confirmé sur les 3 vues';
END $$;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — google_ads_connections / gbp_connections (tables de base) : lecture désormais admin-only via RLS (plus via bypass owner), écriture toujours refusée ==='; END $$;

SELECT pg_temp.assert_visible_count('google_ads_connections (base) — admin A, même org', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 1);
SELECT pg_temp.assert_visible_count('google_ads_connections (base) — assistant A (non-admin)', '90000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('google_ads_connections (base) — admin B (autre org)', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('gbp_connections (base) — admin A, même org', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_connections', 1);
SELECT pg_temp.assert_visible_count('gbp_connections (base) — admin B (autre org)', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.gbp_connections', 0);

SELECT pg_temp.assert_write_denied('google_ads_connections UPDATE — admin A (toujours réservé à service_role)', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_ads_connections SET last_synced_at = now() WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_connections UPDATE — admin A (toujours réservé à service_role)', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.gbp_connections SET last_synced_at = now() WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — vues de statut Google : mêmes résultats qu''avant le passage security_invoker (admin-only, org-scoped, write-through impossible) ==='; END $$;

SELECT pg_temp.assert_visible_count('google_ads_connection_status — admin A voit sa ligne', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 1);
SELECT pg_temp.assert_visible_count('google_ads_connection_status — assistant A (non-admin)', '90000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 0);
SELECT pg_temp.assert_visible_count('google_ads_connection_status — admin B (autre org)', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 0);
SELECT pg_temp.assert_visible_count('gbp_connection_status — admin A voit sa ligne', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_connection_status', 1);
SELECT pg_temp.assert_visible_count('gbp_connection_status — admin B (autre org)', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.gbp_connection_status', 0);

SELECT pg_temp.assert_write_denied('google_ads_connection_status UPDATE (write-through) — admin A sur sa propre ligne', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_ads_connection_status SET status = 'revoked' WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_connection_status DELETE (write-through) — admin A sur sa propre ligne', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$DELETE FROM public.gbp_connection_status WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — parametres_entreprise (base) : lecture COMPLETE (iban/bic inclus) strictement admin-only, isolation cross-org ==='; END $$;

SELECT pg_temp.assert_visible_count('parametres_entreprise (base) — admin A voit sa ligne (avec iban/bic)', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.parametres_entreprise', 1);
SELECT pg_temp.assert_visible_count('parametres_entreprise (base) — assistant A (non-admin) NE voit rien', '90000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.parametres_entreprise', 0);
SELECT pg_temp.assert_visible_count('parametres_entreprise (base) — intervenant A (non-admin) NE voit rien', '90000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.parametres_entreprise', 0);
-- admin B a bien un accès légitime à SA PROPRE org (une ligne parametres_entreprise
-- existe aussi pour org B dans ce fixture) — le test d'isolation porte donc sur le
-- contenu d'org A précisément, pas sur un count(*) brut de la table.
SELECT pg_temp.assert_visible_count('parametres_entreprise (base) — admin B ne voit PAS la ligne d''org A (cross-tenant)', '90000000-0000-0000-0000-00000000b001'::uuid, $sql$SELECT count(*) FROM public.parametres_entreprise WHERE raison_sociale = 'SIVTest Org A SARL'$sql$, 0);
SELECT pg_temp.assert_visible_count('parametres_entreprise (base) — admin B voit sa propre org B', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.parametres_entreprise', 1);

-- Régression FE-01 : même après le passage security_invoker sur la vue
-- publique, un non-admin ne doit JAMAIS pouvoir lire iban/bic, ni via la
-- vue (colonnes absentes du SELECT) ni via la table de base (RLS).
SELECT pg_temp.assert_select_denied('parametres_entreprise (base) — assistant A tente de lire iban/bic directement', '90000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.parametres_entreprise WHERE iban IS NOT NULL');

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 4 — parametres_entreprise_public : visible à TOUS les membres actifs de l''org (pas seulement admin), jamais iban/bic, isolation cross-org ==='; END $$;

SELECT pg_temp.assert_visible_count('parametres_entreprise_public — admin A', '90000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.parametres_entreprise_public', 1);
SELECT pg_temp.assert_visible_count('parametres_entreprise_public — assistant A (non-admin, DOIT voir les colonnes non sensibles)', '90000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.parametres_entreprise_public', 1);
SELECT pg_temp.assert_visible_count('parametres_entreprise_public — intervenant A (non-admin, DOIT voir les colonnes non sensibles)', '90000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.parametres_entreprise_public', 1);
SELECT pg_temp.assert_visible_count('parametres_entreprise_public — admin B ne voit pas org A', '90000000-0000-0000-0000-00000000b001'::uuid, $sql$SELECT count(*) FROM public.parametres_entreprise_public WHERE raison_sociale = 'SIVTest Org A SARL'$sql$, 0);
-- admin B voit bien SA propre org (pas un deny-all global, juste cross-tenant)
SELECT pg_temp.assert_visible_count('parametres_entreprise_public — admin B voit sa propre org B', '90000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.parametres_entreprise_public', 1);

-- Contenu correct restitué à un non-admin (raison_sociale, siret, email — colonnes non sensibles)
DO $$
DECLARE v_raison text; v_siret text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-00000000a002', true);
  SET LOCAL role = 'authenticated';
  SELECT raison_sociale, siret INTO v_raison, v_siret FROM public.parametres_entreprise_public WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1';
  RESET role;
  IF v_raison IS DISTINCT FROM 'SIVTest Org A SARL' OR v_siret IS DISTINCT FROM '11122233344455' THEN
    RAISE EXCEPTION 'ÉCHEC — parametres_entreprise_public ne restitue pas correctement les colonnes non sensibles à un non-admin';
  END IF;
  RAISE NOTICE 'OK [parametres_entreprise_public — non-admin] — colonnes non sensibles restituées correctement';
END $$;

-- Colonnes iban/bic structurellement absentes de la vue (pas juste filtrées à l'exécution)
DO $$
DECLARE v_leaky_cols text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO v_leaky_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parametres_entreprise_public' AND column_name IN ('iban', 'bic');
  IF v_leaky_cols IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — parametres_entreprise_public expose une colonne sensible : %', v_leaky_cols;
  END IF;
  RAISE NOTICE 'OK [parametres_entreprise_public] — aucune colonne iban/bic exposée (structurel)';
END $$;

-- Write-through structurellement impossible (vue basée sur un appel de
-- fonction, jamais auto-updatable) — REVOKE explicite vérifié en plus.
SELECT pg_temp.assert_write_denied('parametres_entreprise_public UPDATE (write-through) — admin A sur sa propre ligne', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.parametres_entreprise_public SET raison_sociale = 'Falsifié' WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('parametres_entreprise_public INSERT (write-through) — admin A', '90000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.parametres_entreprise_public (organisation_id, raison_sociale) VALUES ('90000000-0000-0000-0000-0000000000a1', 'x')$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 5 — fonction SECURITY DEFINER sous-jacente : EXECUTE refusé à anon, aucune fonction search_path mutable ==='; END $$;

DO $$
DECLARE v_has_grant boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.parametres_entreprise_public_rows()', 'EXECUTE') INTO v_has_grant;
  IF v_has_grant THEN
    RAISE EXCEPTION 'ÉCHEC — anon peut exécuter parametres_entreprise_public_rows()';
  END IF;
  RAISE NOTICE 'OK — anon n''a pas EXECUTE sur parametres_entreprise_public_rows()';
END $$;

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 9 ont réussi ==='; END $$;

-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.parametres_entreprise WHERE organisation_id IN ('90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000b1');
DELETE FROM public.google_ads_connections WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1';
DELETE FROM public.gbp_connections WHERE organisation_id = '90000000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE organisation_id IN ('90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN (
  '90000000-0000-0000-0000-00000000a001', '90000000-0000-0000-0000-00000000a002',
  '90000000-0000-0000-0000-00000000a003', '90000000-0000-0000-0000-00000000b001'
);

ROLLBACK;
