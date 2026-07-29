-- ================================================================
-- TESTS LOCAUX — Correction 6 (modules Google Ads / Google Business
-- Profile, Phase 1 fondations) — isolation multi-tenant et RLS des
-- nouvelles tables (google_ads_connections, gbp_connections,
-- google_ads_metrics_daily, gbp_reviews, review_requests,
-- google_oauth_events) + vues de statut. Canal de demande d'avis :
-- E-MAIL UNIQUEMENT (SMS abandonné — aucune référence ici).
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE (ex. `supabase start` local). NE JAMAIS EXÉCUTER CONTRE LA
-- PRODUCTION.
--
-- Ce fichier N'EST PAS une migration : il ne doit jamais être copié
-- dans supabase/migrations/. Il crée ses propres fixtures (organisations,
-- profils, connexions Google FICTIVES) sous des UUID dédiés et
-- distincts de toute autre fixture de test connue de ce dépôt, et
-- l'ensemble est enveloppé dans une transaction annulée (ROLLBACK
-- final) : aucune donnée ne doit persister même en cas d'exécution
-- accidentelle ou répétée. Aucun token/secret réel n'est utilisé nulle
-- part dans ce fichier.
--
-- Prérequis : les migrations 20260728000003 (factures.envoyee_le),
-- 20260728000004 (fondations) et 20260728000005 (vues) doivent déjà
-- être appliquées sur la base ciblée, DANS CET ORDRE (envoyee_le doit
-- exister avant que review_requests_insert ne puisse la référencer).
--
-- Simulation de auth.uid() : identique à correction-02-helper-tests.sql
-- (`SET LOCAL role authenticated` + `set_config('request.jwt.claim.sub', ...)`).
-- ================================================================

BEGIN;

-- ── Fixtures : 2 organisations, 5 profils, 3 clients, 6 factures (dont 4
-- envoyées, 1 non envoyée, réparties org A / org B) ──────────────────────
DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, clients, factures, connexions Google mock) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-0000-0000-00000000a001', 'gtest-admin-a@test.local'),
  ('10000000-0000-0000-0000-00000000a002', 'gtest-assistant-a@test.local'),
  ('10000000-0000-0000-0000-00000000a003', 'gtest-intervenant-a@test.local'),
  ('10000000-0000-0000-0000-00000000a004', 'gtest-intervenant-a-cd@test.local'),
  ('10000000-0000-0000-0000-00000000b001', 'gtest-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'gtest-org-a', 'GTest Org A', 'pro', true),
  ('10000000-0000-0000-0000-0000000000b1', 'gtest-org-b', 'GTest Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif, can_create_documents, can_bypass_validation) VALUES
  ('10000000-0000-0000-0000-00000000a001', 'gtest-admin-a@test.local',        'GTest', 'AdminA',        'admin',       '10000000-0000-0000-0000-0000000000a1', true, true,  true),
  ('10000000-0000-0000-0000-00000000a002', 'gtest-assistant-a@test.local',    'GTest', 'AssistantA',    'assistant',   '10000000-0000-0000-0000-0000000000a1', true, false, false),
  ('10000000-0000-0000-0000-00000000a003', 'gtest-intervenant-a@test.local',  'GTest', 'IntervenantA',  'intervenant', '10000000-0000-0000-0000-0000000000a1', true, false, false),
  ('10000000-0000-0000-0000-00000000a004', 'gtest-intervenant-a-cd@test.local','GTest', 'IntervenantACD','intervenant','10000000-0000-0000-0000-0000000000a1', true, true,  true),
  ('10000000-0000-0000-0000-00000000b001', 'gtest-admin-b@test.local',        'GTest', 'AdminB',        'admin',       '10000000-0000-0000-0000-0000000000b1', true, true,  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clients (id, organisation_id, nom, type, created_by) VALUES
  ('10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-0000000000a1', 'GTest Client A1', 'particulier', '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000c002', '10000000-0000-0000-0000-0000000000a1', 'GTest Client A2', 'particulier', '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000c101', '10000000-0000-0000-0000-0000000000b1', 'GTest Client B1', 'particulier', '10000000-0000-0000-0000-00000000b001');

-- Factures : f001..f004 envoyées (org A), f005 NON envoyée (org A, teste le
-- refus "pas encore envoyée"), f101 envoyée (org B, teste le refus
-- cross-tenant). f003 est délibérément créée par l'intervenant A-CD
-- lui-même (created_by = a004) : la policy factures_select existante
-- (is_intervenant_in_org AND created_by = auth.uid()) exige que la
-- facture référencée soit RÉELLEMENT visible par l'appelant — reflète le
-- vrai flux (un intervenant ne peut "envoyer" que les factures qu'il peut
-- déjà voir), pas un artefact de la policy review_requests_insert elle-même.
INSERT INTO public.factures (id, organisation_id, client_id, statut_paiement, montant_ttc, created_by, envoyee_le) VALUES
  ('10000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000c001', 'impayee', 100, '10000000-0000-0000-0000-00000000a001', now()),
  ('10000000-0000-0000-0000-00000000f002', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000c002', 'impayee', 100, '10000000-0000-0000-0000-00000000a001', now()),
  ('10000000-0000-0000-0000-00000000f003', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000c001', 'impayee', 100, '10000000-0000-0000-0000-00000000a004', now()),
  ('10000000-0000-0000-0000-00000000f004', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000c001', 'impayee', 100, '10000000-0000-0000-0000-00000000a001', now()),
  ('10000000-0000-0000-0000-00000000f005', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000c001', 'impayee', 100, '10000000-0000-0000-0000-00000000a001', NULL),
  ('10000000-0000-0000-0000-00000000f101', '10000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000c101', 'impayee', 100, '10000000-0000-0000-0000-00000000b001', now());

-- Connexions Google FICTIVES pour l'org A uniquement (insérées en tant que
-- `postgres`, qui bypass RLS comme le fera service_role en Phase 2). Les
-- colonnes *_secret_id restent NULL ici : la protection Vault elle-même
-- (service_role uniquement, vérifiée séparément ci-dessous par requête
-- directe sur les grants) ne dépend pas de la présence d'une valeur.
INSERT INTO public.google_ads_connections
  (organisation_id, google_customer_id, google_login_customer_id, token_expires_at, scopes, status, connected_by, connected_at)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'MOCK_CUSTOMER_ID_A', 'MOCK_MCC_ID_A', now() + interval '1 hour', 'https://www.googleapis.com/auth/adwords', 'connected', '10000000-0000-0000-0000-00000000a001', now());

INSERT INTO public.gbp_connections
  (organisation_id, google_location_id, google_account_id, account_name, token_expires_at, scopes, status, connected_by, connected_at)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'MOCK_LOCATION_ID_A', 'MOCK_ACCOUNT_ID_A', 'GTest Org A (fiche mock)', now() + interval '1 hour', 'https://www.googleapis.com/auth/business.manage', 'connected', '10000000-0000-0000-0000-00000000a001', now());

INSERT INTO public.google_ads_metrics_daily
  (organisation_id, date, campaign_id, campaign_name, impressions, clicks, cost_micros, conversions, conversions_value)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', CURRENT_DATE, 'mock-campaign-1', 'Campagne Mock A', 1000, 42, 15000000, 3, 450.00);

INSERT INTO public.gbp_reviews
  (organisation_id, google_review_id, reviewer_display_name, star_rating, comment, review_created_at, match_confidence)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'MOCK_REVIEW_ID_A', 'M. Mock Reviewer', 5, 'Très bon service (avis fictif de test)', now(), 'none');

INSERT INTO public.google_oauth_events (organisation_id, provider, event_type, detail)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'google_ads', 'mock_connect', 'fixture de test — aucun événement réel');

-- Une seule demande d'avis pré-existante (rattachée à f001, déjà envoyée),
-- utilisée pour les scénarios de LECTURE (SELECT). Les scénarios d'ÉCRITURE
-- (INSERT) ci-dessous utilisent f002/f003/f004/f005/f101, chacune libre de
-- toute demande d'avis préalable (contrainte UNIQUE(facture_id)).
INSERT INTO public.review_requests (organisation_id, facture_id, client_id, status, sent_at, created_by)
VALUES
  ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-00000000c001', 'pending', now(), '10000000-0000-0000-0000-00000000a001');

-- ── Helper générique : compte de lignes visibles pour un rôle simulé ──
CREATE OR REPLACE FUNCTION pg_temp.assert_visible_count(
  p_label    text,
  p_uid      uuid,
  p_sql      text,
  p_expected bigint
) RETURNS void AS $$
DECLARE
  v_actual bigint;
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

-- ── Helper : un SELECT doit être refusé — soit par une erreur de
-- permission (ex. pas même USAGE sur le schéma, cas de `vault`), soit en
-- retournant 0 ligne (cas RLS classique). Les deux sont un refus valide ;
-- seul un résultat > 0 est un échec réel.
CREATE OR REPLACE FUNCTION pg_temp.assert_select_denied(
  p_label text,
  p_uid   uuid,
  p_sql   text
) RETURNS void AS $$
DECLARE
  v_count    bigint;
  v_denied   boolean := false;
  v_sqlstate text := 'n/a';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql INTO v_count;
    IF v_count = 0 THEN
      v_denied := true;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege OR others THEN
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

-- ── Helper : une INSERT/UPDATE doit être refusée. Deux formes de refus
-- existent selon la commande : une INSERT sans policy applicable (ou dont
-- le WITH CHECK échoue) lève une exception (row-level security policy
-- violation, ou toute autre contrainte comme UNIQUE) ; une UPDATE/DELETE
-- sans policy applicable ne lève PAS d'exception — la clause USING filtre
-- silencieusement toutes les lignes candidates, la commande "réussit" en
-- affectant 0 ligne. Les deux cas sont donc traités comme un refus valide ;
-- seul un nombre de lignes affectées > 0 est un échec réel du test.
CREATE OR REPLACE FUNCTION pg_temp.assert_write_denied(
  p_label text,
  p_uid   uuid,
  p_sql   text
) RETURNS void AS $$
DECLARE
  v_denied   boolean := false;
  v_sqlstate text := 'n/a';
  v_rowcount bigint := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN
      v_denied := true; -- RLS (USING) a filtré silencieusement toutes les lignes
    END IF;
  EXCEPTION
    WHEN insufficient_privilege OR others THEN
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

-- ── Helper : une INSERT/UPDATE doit réussir ET affecter réellement ≥1
-- ligne (une commande qui "réussit" sans exception mais affecte 0 ligne à
-- cause de RLS serait un faux positif si on ne vérifiait pas ROW_COUNT).
CREATE OR REPLACE FUNCTION pg_temp.assert_write_allowed(
  p_label text,
  p_uid   uuid,
  p_sql   text
) RETURNS void AS $$
DECLARE
  v_rowcount bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RESET role;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'ÉCHEC [%] — l''écriture n''a affecté aucune ligne (RLS a filtré silencieusement) alors qu''elle devait réussir', p_label;
  END IF;
  RAISE NOTICE 'OK [%] — écriture acceptée (% ligne(s))', p_label, v_rowcount;
EXCEPTION WHEN OTHERS THEN
  RESET role;
  RAISE EXCEPTION 'ÉCHEC [%] — écriture refusée alors qu''elle devait réussir (%)', p_label, SQLERRM;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — tables privées (tokens) : deny-all pour TOUT rôle authenticated, y compris admin de la même organisation ==='; END $$;

SELECT pg_temp.assert_visible_count('google_ads_connections — admin A (même org, propriétaire de la ligne)', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('google_ads_connections — assistant A', '10000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('google_ads_connections — intervenant A', '10000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('google_ads_connections — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_ads_connections', 0);
SELECT pg_temp.assert_visible_count('gbp_connections — admin A (même org, propriétaire de la ligne)', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_connections', 0);
SELECT pg_temp.assert_visible_count('google_oauth_events — admin A', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_oauth_events', 0);
-- vault.decrypted_secrets : accordé UNIQUEMENT à service_role (vérifié
-- statiquement par ailleurs) — confirmation comportementale ici : même un
-- admin authentifié ne peut rien y lire.
SELECT pg_temp.assert_select_denied('vault.decrypted_secrets — admin A (aucun droit, quel que soit le contenu)', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM vault.decrypted_secrets');

SELECT pg_temp.assert_write_denied('google_ads_connections INSERT — admin A (même org)', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.google_ads_connections (organisation_id, google_customer_id) VALUES ('10000000-0000-0000-0000-0000000000a1', 'x')$sql$);
SELECT pg_temp.assert_write_denied('google_ads_connections UPDATE — admin A', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_ads_connections SET last_synced_at = now() WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_connections INSERT — admin A', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.gbp_connections (organisation_id, google_location_id) VALUES ('10000000-0000-0000-0000-0000000000a1', 'x')$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — vues de statut (sans secrets) : admin-only, isolation cross-org, AUCUN write-through (droits du propriétaire de la vue) ==='; END $$;

SELECT pg_temp.assert_visible_count('google_ads_connection_status — admin A voit sa ligne', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 1);
SELECT pg_temp.assert_visible_count('google_ads_connection_status — assistant A (non-admin)', '10000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 0);
SELECT pg_temp.assert_visible_count('google_ads_connection_status — intervenant A (non-admin)', '10000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 0);
SELECT pg_temp.assert_visible_count('google_ads_connection_status — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_ads_connection_status', 0);
SELECT pg_temp.assert_visible_count('gbp_connection_status — admin A voit sa ligne', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_connection_status', 1);
SELECT pg_temp.assert_visible_count('gbp_connection_status — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.gbp_connection_status', 0);

-- Write-through : même l'admin PROPRIÉTAIRE de la ligne ne peut ni
-- INSERT/UPDATE/DELETE à travers la vue — le REVOKE explicite (migration
-- 005) doit bloquer AVANT même que le rewrite de la vue n'atteigne la
-- table de base (sinon l'écriture s'exécuterait avec les droits du
-- PROPRIÉTAIRE de la vue = contournement RLS complet).
SELECT pg_temp.assert_write_denied('google_ads_connection_status UPDATE (write-through) — admin A sur sa propre ligne', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.google_ads_connection_status SET status = 'revoked' WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('google_ads_connection_status INSERT (write-through) — admin A', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.google_ads_connection_status (organisation_id, google_customer_id) VALUES ('10000000-0000-0000-0000-0000000000a1', 'x')$sql$);
SELECT pg_temp.assert_write_denied('google_ads_connection_status DELETE (write-through) — admin A', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$DELETE FROM public.google_ads_connection_status WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_connection_status UPDATE (write-through) — admin A sur sa propre ligne', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.gbp_connection_status SET status = 'revoked' WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);

-- Vérification structurelle : la vue ne doit contenir AUCUNE colonne
-- sensible (jamais de colonne liée à un token/secret).
DO $$
DECLARE v_leaky_cols text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO v_leaky_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND column_name IN ('access_token', 'refresh_token', 'access_token_secret_id', 'refresh_token_secret_id');
  IF v_leaky_cols IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC [vues de statut] — colonne(s) sensible(s) exposée(s) : %', v_leaky_cols;
  END IF;
  RAISE NOTICE 'OK [vues de statut] — aucune colonne de secret exposée';
END $$;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — google_ads_metrics_daily : lecture admin-only, isolation cross-org, écriture service_role uniquement ==='; END $$;

SELECT pg_temp.assert_visible_count('google_ads_metrics_daily — admin A', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.google_ads_metrics_daily', 1);
SELECT pg_temp.assert_visible_count('google_ads_metrics_daily — assistant A (non-admin)', '10000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.google_ads_metrics_daily', 0);
SELECT pg_temp.assert_visible_count('google_ads_metrics_daily — intervenant A (non-admin)', '10000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.google_ads_metrics_daily', 0);
SELECT pg_temp.assert_visible_count('google_ads_metrics_daily — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.google_ads_metrics_daily', 0);
SELECT pg_temp.assert_write_denied('google_ads_metrics_daily INSERT — admin A (réservé à service_role)', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.google_ads_metrics_daily (organisation_id, date, campaign_id) VALUES ('10000000-0000-0000-0000-0000000000a1', CURRENT_DATE, 'x')$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 4 — gbp_reviews : lecture admin+assistant, confirmation manuelle admin-only, isolation cross-org ==='; END $$;

SELECT pg_temp.assert_visible_count('gbp_reviews — admin A', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_reviews', 1);
SELECT pg_temp.assert_visible_count('gbp_reviews — assistant A (can_manage_operations)', '10000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.gbp_reviews', 1);
SELECT pg_temp.assert_visible_count('gbp_reviews — intervenant A (hors can_manage_operations)', '10000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.gbp_reviews', 0);
SELECT pg_temp.assert_visible_count('gbp_reviews — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.gbp_reviews', 0);

SELECT pg_temp.assert_write_allowed('gbp_reviews UPDATE confirmation — admin A sur sa propre org', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.gbp_reviews SET match_confidence = 'confirmed', confirmed_by = '10000000-0000-0000-0000-00000000a001', confirmed_at = now() WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_reviews UPDATE confirmation — assistant A (non-admin, refusé même can_manage_operations)', '10000000-0000-0000-0000-00000000a002'::uuid,
  $sql$UPDATE public.gbp_reviews SET match_confidence = 'confirmed' WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);
SELECT pg_temp.assert_write_denied('gbp_reviews UPDATE — admin B tentant de modifier un avis d''org A (cross-tenant)', '10000000-0000-0000-0000-00000000b001'::uuid,
  $sql$UPDATE public.gbp_reviews SET match_confidence = 'confirmed' WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 5 — review_requests : lecture admin+assistant, insertion STRICTEMENT liée au workflow de facture envoyée ==='; END $$;

SELECT pg_temp.assert_visible_count('review_requests — admin A', '10000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.review_requests', 1);
SELECT pg_temp.assert_visible_count('review_requests — assistant A', '10000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.review_requests', 1);
SELECT pg_temp.assert_visible_count('review_requests — intervenant A (hors can_manage_operations)', '10000000-0000-0000-0000-00000000a003'::uuid, 'SELECT count(*) FROM public.review_requests', 0);
SELECT pg_temp.assert_visible_count('review_requests — admin B (autre org)', '10000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.review_requests', 0);

-- --- cas autorisés (workflow légitime) ---
SELECT pg_temp.assert_write_allowed('review_requests INSERT — admin A, facture f002 réellement envoyée, client correct', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f002', '10000000-0000-0000-0000-00000000c002', '10000000-0000-0000-0000-00000000a001')$sql$);
SELECT pg_temp.assert_write_allowed('review_requests INSERT — intervenant A avec can_create_documents+can_bypass_validation, facture f003 réellement envoyée (parité avec l''envoi de facture)', '10000000-0000-0000-0000-00000000a004'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f003', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000a004')$sql$);

-- --- cas refusés : rôle insuffisant ---
SELECT pg_temp.assert_write_denied('review_requests INSERT — intervenant A SANS can_create_documents/can_bypass_validation (facture f004 pourtant réellement envoyée)', '10000000-0000-0000-0000-00000000a003'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f004', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000a003')$sql$);

-- --- cas refusés : hors du workflow de facture autorisé (le cœur de la demande) ---
SELECT pg_temp.assert_write_denied('review_requests INSERT — admin A, facture f005 JAMAIS ENVOYÉE (envoyee_le IS NULL) : refusé même pour un admin', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f005', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000a001')$sql$);
SELECT pg_temp.assert_write_denied('review_requests INSERT — admin A, client_id ne correspond PAS au client réel de la facture (anti-mismatch)', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f002', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000a001')$sql$);
SELECT pg_temp.assert_write_denied('review_requests INSERT — admin B tentant d''utiliser une facture d''org A (f001) en se déclarant organisation_id=org A (cross-tenant)', '10000000-0000-0000-0000-00000000b001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000b001')$sql$);
SELECT pg_temp.assert_write_denied('review_requests INSERT — duplicata sur une facture déjà pourvue d''une demande (UNIQUE facture_id, f001)', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000a001')$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 6 — factures.envoyee_le : colonne présente et utilisable via les policies factures existantes (aucune RLS nouvelle) ==='; END $$;

SELECT pg_temp.assert_write_allowed('factures.envoyee_le UPDATE — admin A sur sa propre facture (f002)', '10000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.factures SET envoyee_le = now() WHERE id = '10000000-0000-0000-0000-00000000f002'$sql$);
SELECT pg_temp.assert_write_denied('factures.envoyee_le UPDATE — admin B tentant de modifier une facture d''org A (cross-tenant)', '10000000-0000-0000-0000-00000000b001'::uuid,
  $sql$UPDATE public.factures SET envoyee_le = now() WHERE id = '10000000-0000-0000-0000-00000000f001'$sql$);

-- ================================================================
-- Nettoyage explicite des fixtures (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.review_requests WHERE organisation_id IN ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
DELETE FROM public.factures WHERE organisation_id IN ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
DELETE FROM public.clients WHERE organisation_id IN ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
DELETE FROM public.gbp_reviews WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1';
DELETE FROM public.google_ads_metrics_daily WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1';
DELETE FROM public.gbp_connections WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1';
DELETE FROM public.google_ads_connections WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1';
DELETE FROM public.google_oauth_events WHERE organisation_id = '10000000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE organisation_id IN ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN (
  '10000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a002',
  '10000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-00000000a004',
  '10000000-0000-0000-0000-00000000b001'
);

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 6 ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister,
-- même en cas d'exécution répétée ou accidentelle.
ROLLBACK;
