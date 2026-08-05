-- ================================================================
-- TESTS LOCAUX — Correction 11 (fréquence de relance + suppressions, 2026-08-05)
-- Couvre : blocage FREQUENCE_BLOQUEE (réglages 90j/30j/jamais), blocage
-- CLIENT_DESABONNE (opt-out/bounce/plainte), et isolation cross-org de
-- google_review_suppressions (lecture réservée à l'organisation
-- propriétaire, aucune écriture possible pour un rôle authenticated quelle
-- que soit l'organisation — seul service_role peut écrire).
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST DÉDIÉE.
-- NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Prérequis : migration 20260804000002_google_review_frequency_and_suppressions.sql
-- déjà appliquée. Fixtures sous préfixe 50000000-... , transaction annulée
-- (ROLLBACK final).
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, clients, factures payées) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('50000000-0000-0000-0000-00000000a001', 'r11test-admin-a@test.local'),
  ('50000000-0000-0000-0000-00000000b001', 'r11test-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('50000000-0000-0000-0000-0000000000a1', 'r11test-org-a', 'R11Test Org A', 'pro', true),
  ('50000000-0000-0000-0000-0000000000b1', 'r11test-org-b', 'R11Test Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('50000000-0000-0000-0000-00000000a001', 'r11test-admin-a@test.local', 'R11Test', 'AdminA', 'admin', '50000000-0000-0000-0000-0000000000a1', true),
  ('50000000-0000-0000-0000-00000000b001', 'r11test-admin-b@test.local', 'R11Test', 'AdminB', 'admin', '50000000-0000-0000-0000-0000000000b1', true)
ON CONFLICT (id) DO NOTHING;

-- c001 : jamais contacté (référence). c002 : contacté il y a 10 jours
-- (< 90j, doit bloquer par défaut). c003 : contacté il y a 40 jours (>30j,
-- doit passer avec un réglage 30j). c004 : contacté il y a 200 jours mais
-- réglage 'jamais' (doit rester bloqué indéfiniment). c005 : désinscrit
-- (opt_out). c006 : même e-mail que le client d'org B pour prouver que les
-- suppressions ne se croisent jamais entre organisations.
INSERT INTO public.clients (id, organisation_id, nom, type, created_by, email) VALUES
  ('50000000-0000-0000-0000-00000000c001', '50000000-0000-0000-0000-0000000000a1', 'R11Test Client jamais contacté', 'particulier', '50000000-0000-0000-0000-00000000a001', 'r11-c001@test.local'),
  ('50000000-0000-0000-0000-00000000c002', '50000000-0000-0000-0000-0000000000a1', 'R11Test Client contacté récemment', 'particulier', '50000000-0000-0000-0000-00000000a001', 'r11-c002@test.local'),
  ('50000000-0000-0000-0000-00000000c003', '50000000-0000-0000-0000-0000000000a1', 'R11Test Client contacté il y a 40j', 'particulier', '50000000-0000-0000-0000-00000000a001', 'r11-c003@test.local'),
  ('50000000-0000-0000-0000-00000000c004', '50000000-0000-0000-0000-0000000000a1', 'R11Test Client contacté il y a 200j', 'particulier', '50000000-0000-0000-0000-00000000a001', 'r11-c004@test.local'),
  ('50000000-0000-0000-0000-00000000c005', '50000000-0000-0000-0000-0000000000a1', 'R11Test Client désinscrit', 'particulier', '50000000-0000-0000-0000-00000000a001', 'r11-c005@test.local'),
  ('50000000-0000-0000-0000-00000000c006', '50000000-0000-0000-0000-0000000000b1', 'R11Test Client org B (même email que c005)', 'particulier', '50000000-0000-0000-0000-00000000b001', 'r11-c005@test.local');

INSERT INTO public.factures (id, organisation_id, client_id, statut_paiement, montant_ttc, created_by, date_paiement) VALUES
  ('50000000-0000-0000-0000-00000000f001', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c001', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f002', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c002', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f003', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c003', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f004', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c004', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f005', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c005', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f006', '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000c002', 'payee', 150, '50000000-0000-0000-0000-00000000a001', CURRENT_DATE),
  ('50000000-0000-0000-0000-00000000f007', '50000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-00000000c006', 'payee', 150, '50000000-0000-0000-0000-00000000b001', CURRENT_DATE);

-- Réglage par défaut (90j) pour org A à ce stade.
INSERT INTO public.parametres_entreprise (organisation_id, raison_sociale, avis_google_relance_delai)
VALUES ('50000000-0000-0000-0000-0000000000a1', 'R11Test Org A SARL', '90j');

-- Historique d'envoi : c002 contacté il y a 10 jours (statut 'sent'),
-- c003 il y a 40 jours, c004 il y a 200 jours — insérés directement en
-- bypassant le trigger (created_by service_role via requête directe, hors
-- garde-fou puisqu'on simule un envoi déjà survenu par le passé).
INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by, delivery_status, sent_at)
VALUES
  ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f006', '50000000-0000-0000-0000-00000000c002', '50000000-0000-0000-0000-00000000a001', 'sent', now() - interval '10 days');

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

CREATE OR REPLACE FUNCTION pg_temp.assert_write_denied_reason(p_label text, p_uid uuid, p_sql text, p_expected_prefix text) RETURNS void AS $$
DECLARE v_message text := 'n/a'; v_matched boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_matched := v_message LIKE p_expected_prefix || '%';
  END;
  RESET role;
  IF NOT v_matched THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu un message commençant par "%", obtenu "%"', p_label, p_expected_prefix, v_message;
  ELSE
    RAISE NOTICE 'OK [%] — refusé avec le motif attendu (%)', p_label, v_message;
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

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — fréquence par défaut (90j) : client jamais contacté OK, client contacté il y a 10j bloqué ==='; END $$;

SELECT pg_temp.assert_write_allowed('review_requests INSERT — client c001 jamais contacté, réglage 90j', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f001', '50000000-0000-0000-0000-00000000c001', '50000000-0000-0000-0000-00000000a001')$sql$);

SELECT pg_temp.assert_write_denied_reason('review_requests INSERT — client c002 contacté il y a 10j, réglage 90j (FREQUENCE_BLOQUEE)', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f002', '50000000-0000-0000-0000-00000000c002', '50000000-0000-0000-0000-00000000a001')$sql$,
  'FREQUENCE_BLOQUEE');

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — réglage 30j : client contacté il y a 40j passe, client contacté il y a 10j reste bloqué ==='; END $$;

UPDATE public.parametres_entreprise SET avis_google_relance_delai = '30j' WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.assert_write_allowed('review_requests INSERT — client c003 contacté il y a 40j, réglage 30j (délai écoulé)', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by, sent_at, delivery_status) SELECT '50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f003', '50000000-0000-0000-0000-00000000c003', '50000000-0000-0000-0000-00000000a001', NULL, 'pending'$sql$);

-- On simule ensuite l'envoi effectif du c003 (40j) pour le scénario 3.
UPDATE public.review_requests SET delivery_status = 'sent', sent_at = now() - interval '40 days' WHERE client_id = '50000000-0000-0000-0000-00000000c003';

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — réglage jamais : client contacté il y a 200j reste bloqué indéfiniment ==='; END $$;

INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by, delivery_status, sent_at)
VALUES ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f004', '50000000-0000-0000-0000-00000000c004', '50000000-0000-0000-0000-00000000a001', 'sent', now() - interval '200 days')
ON CONFLICT DO NOTHING;

UPDATE public.parametres_entreprise SET avis_google_relance_delai = 'jamais' WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.assert_write_denied_reason('review_requests INSERT — client c004 contacté il y a 200j, réglage jamais (toujours bloqué)', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f004', '50000000-0000-0000-0000-00000000c004', '50000000-0000-0000-0000-00000000a001')$sql$,
  'FREQUENCE_BLOQUEE');

UPDATE public.parametres_entreprise SET avis_google_relance_delai = '90j' WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1';

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 4 — client désinscrit (opt_out) : bloqué même sans historique de relance récent ==='; END $$;

INSERT INTO public.google_review_suppressions (organisation_id, email, reason)
VALUES ('50000000-0000-0000-0000-0000000000a1', 'r11-c005@test.local', 'opt_out');

SELECT pg_temp.assert_write_denied_reason('review_requests INSERT — client c005 désinscrit (CLIENT_DESABONNE)', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by) VALUES ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-00000000f005', '50000000-0000-0000-0000-00000000c005', '50000000-0000-0000-0000-00000000a001')$sql$,
  'CLIENT_DESABONNE');

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 5 — isolation cross-org de google_review_suppressions ==='; END $$;

-- Même adresse e-mail que c005 (org A, désinscrite), mais côté org B —
-- la désinscription d'org A ne doit JAMAIS empêcher org B d'envoyer une
-- demande d'avis à son propre client portant le même e-mail.
SELECT pg_temp.assert_write_allowed('review_requests INSERT — client c006 org B, même e-mail que c005 (org A) mais AUCUNE suppression pour org B', '50000000-0000-0000-0000-00000000b001'::uuid,
  $sql$INSERT INTO public.review_requests (organisation_id, facture_id, client_id, created_by)
      SELECT '50000000-0000-0000-0000-0000000000b1', f.id, '50000000-0000-0000-0000-00000000c006', '50000000-0000-0000-0000-00000000b001'
      FROM public.factures f WHERE f.client_id = '50000000-0000-0000-0000-00000000c006' AND f.statut_paiement = 'payee' LIMIT 1$sql$);

SELECT pg_temp.assert_visible_count('google_review_suppressions — admin A voit la suppression de son organisation', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$SELECT count(*) FROM public.google_review_suppressions WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1'$sql$, 1);

SELECT pg_temp.assert_visible_count('google_review_suppressions — admin B ne voit RIEN de la suppression d''org A (même e-mail)', '50000000-0000-0000-0000-00000000b001'::uuid,
  $sql$SELECT count(*) FROM public.google_review_suppressions WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1'$sql$, 0);

-- Aucune policy INSERT/UPDATE/DELETE pour authenticated (service_role
-- uniquement) — un admin, même de l'organisation propriétaire, ne peut PAS
-- modifier ou retirer une suppression, ni pour sa propre organisation, ni a
-- fortiori pour une autre.
SELECT pg_temp.assert_write_denied('google_review_suppressions DELETE — admin A ne peut pas retirer une suppression de SA PROPRE organisation (service_role uniquement)', '50000000-0000-0000-0000-00000000a001'::uuid,
  $sql$DELETE FROM public.google_review_suppressions WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1'$sql$);

SELECT pg_temp.assert_write_denied('google_review_suppressions INSERT — admin B ne peut pas créer une suppression pour org A', '50000000-0000-0000-0000-00000000b001'::uuid,
  $sql$INSERT INTO public.google_review_suppressions (organisation_id, email, reason) VALUES ('50000000-0000-0000-0000-0000000000a1', 'r11-injection@test.local', 'opt_out')$sql$);

SELECT pg_temp.assert_write_denied('google_review_suppressions UPDATE — admin B ne peut pas modifier une suppression d''org A', '50000000-0000-0000-0000-00000000b001'::uuid,
  $sql$UPDATE public.google_review_suppressions SET reason = 'complaint' WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1'$sql$);

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 11 ont réussi ==='; END $$;

-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.google_review_suppressions WHERE organisation_id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM public.review_requests WHERE organisation_id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM public.parametres_entreprise WHERE organisation_id = '50000000-0000-0000-0000-0000000000a1';
DELETE FROM public.factures WHERE organisation_id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM public.clients WHERE organisation_id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM public.profiles WHERE organisation_id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM public.organisations WHERE id IN ('50000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000b1');
DELETE FROM auth.users WHERE id IN ('50000000-0000-0000-0000-00000000a001', '50000000-0000-0000-0000-00000000b001');

ROLLBACK;
