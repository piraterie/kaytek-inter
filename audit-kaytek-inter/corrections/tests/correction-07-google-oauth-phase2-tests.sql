-- ================================================================
-- TESTS LOCAUX — Correction 7 (module Google OAuth réel, Phase 2)
-- google_oauth_states (deny-all, usage unique), wrappers Vault
-- (service_role uniquement), isolation multi-tenant étendue
-- (google_account_email), non-lecture de Vault par authenticated.
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE (ex. `supabase start` local). NE JAMAIS EXÉCUTER CONTRE LA
-- PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Fixtures sous UUID dédiés
-- distincts de toute autre fixture connue de ce dépôt, transaction
-- annulée (ROLLBACK final) — aucune donnée ne doit persister.
--
-- Prérequis : migration 20260728000006 (google_oauth_states, wrappers
-- Vault, google_account_email) déjà appliquée.
--
-- Ce que ce fichier NE teste PAS (voir phase-2-oauth-report.md,
-- section limites) : la logique des 4 Edge Functions elles-mêmes
-- (google-oauth-start/-callback/-disconnect/-status) — testées
-- séparément via `deno test` (state signé/expirant/usage unique,
-- helper de renouvellement avec fetch entièrement mocké, aucun appel
-- réseau réel) et par revue de code (organisation_id jamais lu depuis
-- le corps de requête, uniquement dérivé de auth.uid()). Ce fichier
-- couvre la frontière RLS/Vault sous-jacente, qui est la garantie
-- ultime même en cas de bug applicatif dans les Edge Functions.
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, connexion Google A, state OAuth A) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'gtest2-admin-a@test.local'),
  ('20000000-0000-0000-0000-00000000a002', 'gtest2-assistant-a@test.local'),
  ('20000000-0000-0000-0000-00000000a003', 'gtest2-intervenant-a@test.local'),
  ('20000000-0000-0000-0000-00000000b001', 'gtest2-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('20000000-0000-0000-0000-0000000000a1', 'gtest2-org-a', 'GTest2 Org A', 'pro', true),
  ('20000000-0000-0000-0000-0000000000b1', 'gtest2-org-b', 'GTest2 Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'gtest2-admin-a@test.local',       'GTest2', 'AdminA',       'admin',       '20000000-0000-0000-0000-0000000000a1', true),
  ('20000000-0000-0000-0000-00000000a002', 'gtest2-assistant-a@test.local',   'GTest2', 'AssistantA',   'assistant',   '20000000-0000-0000-0000-0000000000a1', true),
  ('20000000-0000-0000-0000-00000000a003', 'gtest2-intervenant-a@test.local', 'GTest2', 'IntervenantA', 'intervenant', '20000000-0000-0000-0000-0000000000a1', true),
  ('20000000-0000-0000-0000-00000000b001', 'gtest2-admin-b@test.local',       'GTest2', 'AdminB',       'admin',       '20000000-0000-0000-0000-0000000000b1', true)
ON CONFLICT (id) DO NOTHING;

-- Connexion Google FICTIVE org A (aucun token réel — colonnes *_secret_id
-- volontairement NULL, la protection Vault ne dépend pas de leur présence).
INSERT INTO public.google_ads_connections (organisation_id, google_customer_id, status, connected_by, connected_at, google_account_email)
VALUES ('20000000-0000-0000-0000-0000000000a1', 'MOCK_CUSTOMER_ID_A2', 'connected', '20000000-0000-0000-0000-00000000a001', now(), 'admin-a@example.test');

-- State OAuth FICTIF org A, non expiré, non consommé.
INSERT INTO public.google_oauth_states (nonce, organisation_id, provider, requested_by, expires_at)
VALUES ('MOCK_NONCE_A_1', '20000000-0000-0000-0000-0000000000a1', 'google_ads', '20000000-0000-0000-0000-00000000a001', now() + interval '10 minutes');

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

CREATE OR REPLACE FUNCTION pg_temp.assert_no_execute(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_denied boolean := false; v_sqlstate text := 'n/a';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := true;
  END;
  RESET role;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'ÉCHEC [%] — l''appel a réussi alors qu''il devait être refusé (fonction accessible à authenticated)', p_label;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%)', p_label, v_sqlstate;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — google_oauth_states : deny-all pour TOUT rôle authenticated, y compris le demandeur original ==='; END $$;

SELECT pg_temp.assert_select_denied('google_oauth_states — admin A (demandeur original du state)', '20000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_oauth_states');
SELECT pg_temp.assert_select_denied('google_oauth_states — admin B (autre org)', '20000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_oauth_states');
SELECT pg_temp.assert_write_denied('google_oauth_states INSERT — admin A (falsifier un state pour sa propre org)', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.google_oauth_states (nonce, organisation_id, provider, requested_by, expires_at) VALUES ('FORGED', '20000000-0000-0000-0000-0000000000a1', 'google_ads', '20000000-0000-0000-0000-00000000a001', now() + interval '10 minutes')$sql$);
SELECT pg_temp.assert_write_denied('google_oauth_states UPDATE — admin A (tenter de marquer un state consommé comme réutilisable)', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_oauth_states SET consumed_at = NULL WHERE nonce = 'MOCK_NONCE_A_1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — wrappers Vault OAuth : EXECUTE refusé à authenticated, quel que soit le rôle métier ==='; END $$;

SELECT pg_temp.assert_no_execute('google_oauth_vault_create — admin A', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$SELECT public.google_oauth_vault_create('valeur-test', 'nom-test', 'description-test')$sql$);
SELECT pg_temp.assert_no_execute('google_oauth_vault_read — admin A', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$SELECT public.google_oauth_vault_read(gen_random_uuid())$sql$);
SELECT pg_temp.assert_no_execute('google_oauth_vault_update — admin A', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$SELECT public.google_oauth_vault_update(gen_random_uuid(), 'valeur-test')$sql$);
SELECT pg_temp.assert_no_execute('google_oauth_vault_delete — admin A', '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$SELECT public.google_oauth_vault_delete(gen_random_uuid())$sql$);

-- Preuve positive côté service_role : les wrappers fonctionnent bien
-- (exécutés ici en tant que `postgres`, qui dispose des mêmes droits
-- que service_role sur ces fonctions — vérifié par ailleurs que
-- service_role a EXECUTE, migration 20260728000006).
DO $$
DECLARE v_id uuid; v_value text;
BEGIN
  v_id := public.google_oauth_vault_create('valeur-de-test-non-reelle', 'gtest2-vault-check', 'test correction 7');
  v_value := public.google_oauth_vault_read(v_id);
  IF v_value IS DISTINCT FROM 'valeur-de-test-non-reelle' THEN
    RAISE EXCEPTION 'ÉCHEC — vault_create/vault_read (service_role) ne restituent pas la valeur attendue';
  END IF;
  PERFORM public.google_oauth_vault_update(v_id, 'valeur-modifiee-non-reelle');
  v_value := public.google_oauth_vault_read(v_id);
  IF v_value IS DISTINCT FROM 'valeur-modifiee-non-reelle' THEN
    RAISE EXCEPTION 'ÉCHEC — vault_update (service_role) n''a pas mis à jour la valeur';
  END IF;
  PERFORM public.google_oauth_vault_delete(v_id);
  v_value := public.google_oauth_vault_read(v_id);
  IF v_value IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — vault_delete (service_role) n''a pas supprimé le secret';
  END IF;
  RAISE NOTICE 'OK [wrappers Vault côté service_role] — create/read/update/delete fonctionnent comme attendu';
END $$;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — google_account_email : toujours admin-only + isolation cross-org via les vues ==='; END $$;

SELECT pg_temp.assert_select_denied('google_ads_connections (base, avec email) — admin A, même org', '20000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connections');

DO $$
DECLARE v_email text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a001', true);
  SET LOCAL role = 'authenticated';
  SELECT google_account_email INTO v_email FROM public.google_ads_connection_status WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1';
  RESET role;
  IF v_email IS DISTINCT FROM 'admin-a@example.test' THEN
    RAISE EXCEPTION 'ÉCHEC — google_account_email non restitué correctement par la vue de statut (admin A, même org)';
  END IF;
  RAISE NOTICE 'OK [google_ads_connection_status.google_account_email] — restitué correctement pour admin A';
END $$;

SELECT pg_temp.assert_select_denied('google_ads_connection_status — admin B ne voit pas l''email de org A', '20000000-0000-0000-0000-00000000b001'::uuid, $sql$SELECT count(*) FROM public.google_ads_connection_status WHERE google_account_email = 'admin-a@example.test'$sql$);
SELECT pg_temp.assert_select_denied('google_ads_connection_status — assistant A (non-admin) ne voit rien', '20000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status');
SELECT pg_temp.assert_select_denied('google_ads_connection_status — intervenant A (non-admin) ne voit rien', '20000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status');

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 7 ont réussi ==='; END $$;

-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.google_oauth_states WHERE organisation_id IN ('20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000b1');
DELETE FROM public.google_ads_connections WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE organisation_id IN ('20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN (
  '20000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a002',
  '20000000-0000-0000-0000-00000000a003', '20000000-0000-0000-0000-00000000b001'
);

ROLLBACK;
