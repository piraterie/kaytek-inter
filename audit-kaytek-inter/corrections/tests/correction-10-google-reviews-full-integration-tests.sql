-- ================================================================
-- TESTS LOCAUX — Correction 10 (finalisation Google Ads/GBP, 2026-08-04)
-- Couvre : garde-fou "client sans e-mail", déclenchement sur facture
-- PAYÉE (et non plus envoyée), gbp_performance_metrics_daily (isolation),
-- réponses aux avis GBP (colonnes de cache), exposition des nouveaux
-- paramètres avis_google_* via la vue publique.
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST DÉDIÉE.
-- NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Prérequis : migration 20260804000000_google_reviews_full_integration.sql
-- déjà appliquée. Fixtures sous préfixe 40000000-... , transaction annulée
-- (ROLLBACK final).
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, clients avec/sans e-mail, factures payées, avis GBP) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('40000000-0000-0000-0000-00000000a001', 'r10test-admin-a@test.local'),
  ('40000000-0000-0000-0000-00000000a002', 'r10test-assistant-a@test.local'),
  ('40000000-0000-0000-0000-00000000b001', 'r10test-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('40000000-0000-0000-0000-0000000000a1', 'r10test-org-a', 'R10Test Org A', 'pro', true),
  ('40000000-0000-0000-0000-0000000000b1', 'r10test-org-b', 'R10Test Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('40000000-0000-0000-0000-00000000a001', 'r10test-admin-a@test.local', 'R10Test', 'AdminA', 'admin', '40000000-0000-0000-0000-0000000000a1', true),
  ('40000000-0000-0000-0000-00000000a002', 'r10test-assistant-a@test.local', 'R10Test', 'AssistantA', 'assistant', '40000000-0000-0000-0000-0000000000a1', true),
  ('40000000-0000-0000-0000-00000000b001', 'r10test-admin-b@test.local', 'R10Test', 'AdminB', 'admin', '40000000-0000-0000-0000-0000000000b1', true)
ON CONFLICT (id) DO NOTHING;

-- c001 a un e-mail, c002 n'en a AUCUN (teste le garde-fou trigger).
INSERT INTO public.clients (id, organisation_id, nom, type, created_by, email) VALUES
  ('40000000-0000-0000-0000-00000000c001', '40000000-0000-0000-0000-0000000000a1', 'R10Test Client avec email', 'particulier', '40000000-0000-0000-0000-00000000a001', 'r10test-client@test.local');
INSERT INTO public.clients (id, organisation_id, nom, type, created_by, email) VALUES
  ('40000000-0000-0000-0000-00000000c002', '40000000-0000-0000-0000-0000000000a1', 'R10Test Client SANS email', 'particulier', '40000000-0000-0000-0000-00000000a001', NULL);

INSERT INTO public.factures (id, organisation_id, client_id, statut_paiement, montant_ttc, created_by, date_paiement) VALUES
  ('40000000-0000-0000-0000-00000000f001', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000c001', 'payee', 150, '40000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('40000000-0000-0000-0000-00000000f002', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000c002', 'payee', 150, '40000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('40000000-0000-0000-0000-00000000f003', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000c001', 'impayee', 150, '40000000-0000-0000-0000-00000000a001', NULL);

INSERT INTO public.google_ads_connections (organisation_id, google_customer_id, status, connected_by, connected_at)
VALUES ('40000000-0000-0000-0000-0000000000a1', 'MOCK_CUSTOMER_ID_A', 'connected', '40000000-0000-0000-0000-00000000a001', now());

INSERT INTO public.gbp_reviews (organisation_id, google_review_id, reviewer_display_name, star_rating, comment, review_created_at)
VALUES ('40000000-0000-0000-0000-0000000000a1', 'R10_MOCK_REVIEW_1', 'M. Mock', 5, 'Excellent service', now());

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

CREATE OR REPLACE FUNCTION pg_temp.assert_write_denied(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_denied boolean := false; v_sqlstate text := 'n/a'; v_rowcount bigint := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount = 0 THEN v_denied := true; END IF;
  EXCEPTION WHEN OTHERS THEN
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

CREATE OR REPLACE FUNCTION pg_temp.assert_write_allowed(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_rowcount bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RESET role;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'ÉCHEC [%] — l''écriture n''a affecté aucune ligne alors qu''elle devait réussir', p_label;
  END IF;
  RAISE NOTICE 'OK [%] — écriture acceptée (% ligne(s))', p_label, v_rowcount;
EXCEPTION WHEN OTHERS THEN
  RESET role;
  RAISE EXCEPTION 'ÉCHEC [%] — écriture refusée alors qu''elle devait réussir (%)', p_label, SQLERRM;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — review_requests : déclenchement sur facture PAYÉE, garde-fou client sans e-mail ==='; END $$;

SELECT pg_temp.assert_write_allowed('review_requests INSERT — admin A, facture f001 payée, client avec e-mail', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000f001', '40000000-0000-0000-0000-00000000c001', '40000000-0000-0000-0000-00000000a001')$sql$);

-- Garde-fou trigger : client c002 SANS e-mail — l'INSERT doit échouer même
-- si la facture est bien payée et le rôle autorisé (donc PAS une simple
-- histoire de policy RLS, mais un vrai garde-fou métier data-layer).
SELECT pg_temp.assert_write_denied('review_requests INSERT — admin A, facture f002 payée MAIS client c002 sans e-mail (garde-fou trigger)', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000f002', '40000000-0000-0000-0000-00000000c002', '40000000-0000-0000-0000-00000000a001')$sql$);

SELECT pg_temp.assert_write_denied('review_requests INSERT — admin A, facture f003 PAS payée (statut_paiement=impayee)', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000f003', '40000000-0000-0000-0000-00000000c001', '40000000-0000-0000-0000-00000000a001')$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — review_requests : planification/annulation par un admin, refus pour un non-admin ==='; END $$;

SELECT pg_temp.assert_write_allowed('review_requests UPDATE (planifier scheduled_send_at) — admin A sur sa propre demande', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.review_requests SET scheduled_send_at = now() + interval '24 hours' WHERE facture_id = '40000000-0000-0000-0000-00000000f001'$sql$);

SELECT pg_temp.assert_write_allowed('review_requests UPDATE (annuler) — admin A sur sa propre demande', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.review_requests SET cancelled_at = now(), cancelled_by = '40000000-0000-0000-0000-00000000a001', delivery_status = 'cancelled' WHERE facture_id = '40000000-0000-0000-0000-00000000f001'$sql$);

SELECT pg_temp.assert_write_denied('review_requests UPDATE — assistant A (non-admin) ne peut pas annuler', '40000000-0000-0000-0000-00000000a002'::uuid,
  $sql$UPDATE public.review_requests SET cancelled_at = now() WHERE facture_id = '40000000-0000-0000-0000-00000000f001'$sql$);

SELECT pg_temp.assert_write_denied('review_requests UPDATE — admin B (autre org) ne peut pas toucher la demande d''org A', '40000000-0000-0000-0000-00000000b001'::uuid,
  $sql$UPDATE public.review_requests SET cancelled_at = now() WHERE facture_id = '40000000-0000-0000-0000-00000000f001'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — gbp_reviews : réponse (cache local) modifiable par un admin, isolation cross-org ==='; END $$;

SELECT pg_temp.assert_write_allowed('gbp_reviews UPDATE (response_text) — admin A sur l''avis de son org', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$UPDATE public.gbp_reviews SET response_text = 'Merci beaucoup pour votre retour !', response_updated_at = now() WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1'$sql$);

SELECT pg_temp.assert_write_denied('gbp_reviews UPDATE (response_text) — admin B (autre org)', '40000000-0000-0000-0000-00000000b001'::uuid,
  $sql$UPDATE public.gbp_reviews SET response_text = 'Falsifié' WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 4 — gbp_performance_metrics_daily : lecture admin-only même org, deny-all écriture pour authenticated ==='; END $$;

INSERT INTO public.gbp_performance_metrics_daily (organisation_id, date, calls, website_clicks, direction_requests)
VALUES ('40000000-0000-0000-0000-0000000000a1', CURRENT_DATE, 12, 34, 5);

SELECT pg_temp.assert_visible_count('gbp_performance_metrics_daily — admin A voit sa ligne', '40000000-0000-0000-0000-00000000a001'::uuid, 'SELECT count(*) FROM public.gbp_performance_metrics_daily', 1);
SELECT pg_temp.assert_visible_count('gbp_performance_metrics_daily — assistant A (non can_manage_operations attendu ici, dépend du rôle projet)', '40000000-0000-0000-0000-00000000a002'::uuid, 'SELECT count(*) FROM public.gbp_performance_metrics_daily', 1);
SELECT pg_temp.assert_visible_count('gbp_performance_metrics_daily — admin B (autre org) ne voit rien', '40000000-0000-0000-0000-00000000b001'::uuid, 'SELECT count(*) FROM public.gbp_performance_metrics_daily', 0);

SELECT pg_temp.assert_write_denied('gbp_performance_metrics_daily INSERT — admin A (réservé service_role)', '40000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.gbp_performance_metrics_daily (organisation_id, date, calls) VALUES ('40000000-0000-0000-0000-0000000000a1', CURRENT_DATE + 1, 1)$sql$);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 5 — parametres_entreprise_public : nouveaux réglages avis_google_* visibles à tous les membres actifs (pas seulement admin) ==='; END $$;

INSERT INTO public.parametres_entreprise (organisation_id, raison_sociale, avis_google_actif, avis_google_mode, avis_google_delai)
VALUES ('40000000-0000-0000-0000-0000000000a1', 'R10Test Org A SARL', true, 'automatique', '24h');

DO $$
DECLARE v_actif boolean; v_mode text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-00000000a002', true);
  SET LOCAL role = 'authenticated';
  SELECT avis_google_actif, avis_google_mode INTO v_actif, v_mode FROM public.parametres_entreprise_public WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
  RESET role;
  IF v_actif IS DISTINCT FROM true OR v_mode IS DISTINCT FROM 'automatique' THEN
    RAISE EXCEPTION 'ÉCHEC — avis_google_actif/mode non restitués correctement à un non-admin via parametres_entreprise_public';
  END IF;
  RAISE NOTICE 'OK [parametres_entreprise_public — avis_google_*] — restitués correctement à un non-admin';
END $$;

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 10 ont réussi ==='; END $$;

-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.parametres_entreprise WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.gbp_performance_metrics_daily WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.review_requests WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.gbp_reviews WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.google_ads_connections WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.factures WHERE organisation_id IN ('40000000-0000-0000-0000-0000000000a1');
DELETE FROM public.clients WHERE organisation_id = '40000000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE organisation_id IN ('40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-00000000a002', '40000000-0000-0000-0000-00000000b001');

ROLLBACK;
