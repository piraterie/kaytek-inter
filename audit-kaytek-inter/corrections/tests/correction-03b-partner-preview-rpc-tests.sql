-- ================================================================
-- TESTS LOCAUX — Correction 3 bis (RLS-07)
-- get_partner_requests_preview() — contrôle admin
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE. NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration : ne jamais le copier dans
-- supabase/migrations/. Enveloppé dans BEGIN...ROLLBACK : aucune
-- donnée de test ne doit persister, même en cas d'exécution
-- accidentelle.
--
-- Prérequis : 20260724000001_secure_get_partner_requests_preview.sql
-- doit déjà être appliquée sur la base cible.
--
-- Simulation de auth.uid() : même mécanisme que les fichiers de tests
-- des Corrections 2 et 3 (request.jwt.claim.sub + SET LOCAL role).
--
-- Exécution attendue (NON exécutée dans cette session — voir rapport) :
--   supabase start
--   psql "$(supabase status -o json | jq -r '.DB_URL')" \
--     -f audit-kaytek-inter/corrections/tests/correction-03b-partner-preview-rpc-tests.sql
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures de test ==='; END $$;

-- ── Organisations : g1 = source, g2 = cible, g3 = tierce ─────────
INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('00000000-0000-0000-0000-000000000021', 'test-preview-source', 'Test Preview Source', 'pro', true),
  ('00000000-0000-0000-0000-000000000022', 'test-preview-target', 'Test Preview Target', 'pro', true),
  ('00000000-0000-0000-0000-000000000023', 'test-preview-tierce', 'Test Preview Tierce', 'pro', true)
ON CONFLICT (id) DO NOTHING;

-- ── auth.users ────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000031', 'source-admin@preview.test'),
  ('00000000-0000-0000-0000-000000000032', 'source-assistant@preview.test'),
  ('00000000-0000-0000-0000-000000000033', 'source-intervenant@preview.test'),
  ('00000000-0000-0000-0000-000000000034', 'target-admin@preview.test'),
  ('00000000-0000-0000-0000-000000000035', 'target-assistant@preview.test'),
  ('00000000-0000-0000-0000-000000000036', 'target-intervenant@preview.test'),
  ('00000000-0000-0000-0000-000000000037', 'target-admin-inactif@preview.test'),
  ('00000000-0000-0000-0000-000000000038', 'tierce-admin@preview.test')
ON CONFLICT (id) DO NOTHING;

-- ── Profils ───────────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('00000000-0000-0000-0000-000000000031', 'source-admin@preview.test',        'Admin',       'Source', 'admin',       '00000000-0000-0000-0000-000000000021', true),
  ('00000000-0000-0000-0000-000000000032', 'source-assistant@preview.test',    'Assistant',   'Source', 'assistant',   '00000000-0000-0000-0000-000000000021', true),
  ('00000000-0000-0000-0000-000000000033', 'source-intervenant@preview.test',  'Intervenant', 'Source', 'intervenant', '00000000-0000-0000-0000-000000000021', true),
  ('00000000-0000-0000-0000-000000000034', 'target-admin@preview.test',        'Admin',       'Target', 'admin',       '00000000-0000-0000-0000-000000000022', true),
  ('00000000-0000-0000-0000-000000000035', 'target-assistant@preview.test',    'Assistant',   'Target', 'assistant',   '00000000-0000-0000-0000-000000000022', true),
  ('00000000-0000-0000-0000-000000000036', 'target-intervenant@preview.test',  'Intervenant', 'Target', 'intervenant', '00000000-0000-0000-0000-000000000022', true),
  ('00000000-0000-0000-0000-000000000037', 'target-admin-inactif@preview.test','Admin',       'Inactif','admin',       '00000000-0000-0000-0000-000000000022', false),
  ('00000000-0000-0000-0000-000000000038', 'tierce-admin@preview.test',        'Admin',       'Tierce', 'admin',       '00000000-0000-0000-0000-000000000023', true)
ON CONFLICT (id) DO NOTHING;

-- ── Connexion acceptée entre g1 (source) et g2 (cible) ────────────
INSERT INTO public.partner_connections (id, requester_organisation_id, requester_profile_id, target_organisation_id, target_profile_id, status)
VALUES ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000034', 'accepted')
ON CONFLICT (id) DO NOTHING;

-- ── Demandes de test (une par statut), toutes g1 → g2 ─────────────
-- pending : partage description + montant activé (teste la non-régression du masquage positif)
-- refused : partage désactivé (teste le masquage négatif — CHECK pir_share_consistency
--           impose description_partagee/montant_partage NULL quand le flag est false)
INSERT INTO public.partner_intervention_requests
  (id, connection_id, source_organisation_id, source_profile_id, target_organisation_id, status,
   share_description, description_partagee, share_montant, montant_partage)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', 'pending',     true,  'Fuite sous évier',  true,  120),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', 'refused',     false, NULL,                false, NULL),
  ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', 'accepted',    false, NULL,                false, NULL),
  ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', 'in_progress', false, NULL,                false, NULL),
  ('00000000-0000-0000-0000-000000000045', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000022', 'completed',   false, NULL,                false, NULL)
ON CONFLICT (id) DO NOTHING;
UPDATE public.partner_intervention_requests SET note_refus = 'Test refus (RLS-07)' WHERE id = '00000000-0000-0000-0000-000000000042' AND note_refus IS NULL;


-- ── Helpers de test ───────────────────────────────────────────────

-- Vérifie qu'un appel est refusé (exception levée), quelle qu'en soit la cause
-- (refus applicatif is_admin_in_org, ou refus de privilège EXECUTE pour anon).
CREATE OR REPLACE FUNCTION pg_temp.assert_preview_denied(p_label text, p_uid uuid, p_status text DEFAULT 'pending')
RETURNS void AS $$
DECLARE
  v_failed boolean := false;
BEGIN
  IF p_uid IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL role = 'anon';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
    SET LOCAL role = 'authenticated';
  END IF;

  BEGIN
    PERFORM * FROM public.get_partner_requests_preview(p_status);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  RESET role;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu : refus/exception, obtenu : appel réussi', p_label;
  ELSE
    RAISE NOTICE 'OK [%] — refusé comme attendu', p_label;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Vérifie qu'un appel autorisé renvoie exactement le nombre de lignes attendu.
CREATE OR REPLACE FUNCTION pg_temp.assert_preview_count(p_label text, p_uid uuid, p_status text, p_expected int)
RETURNS void AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';

  SELECT count(*) INTO v_count FROM public.get_partner_requests_preview(p_status);

  RESET role;

  IF v_count <> p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu % ligne(s), obtenu %', p_label, p_expected, v_count;
  ELSE
    RAISE NOTICE 'OK [%] — % ligne(s) comme attendu', p_label, v_count;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Vérifie le masquage conditionnel de description_partagee/montant_partage
-- pour la première ligne renvoyée.
CREATE OR REPLACE FUNCTION pg_temp.assert_preview_masking(p_label text, p_uid uuid, p_status text, p_expect_desc_null boolean, p_expect_montant_null boolean)
RETURNS void AS $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';

  SELECT * INTO r FROM public.get_partner_requests_preview(p_status) LIMIT 1;

  RESET role;

  IF r IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC [%] — aucune ligne renvoyée, masquage non vérifiable', p_label;
  END IF;
  IF (r.description_partagee IS NULL) IS DISTINCT FROM p_expect_desc_null THEN
    RAISE EXCEPTION 'ÉCHEC [%] — masquage description incorrect (valeur=%)', p_label, r.description_partagee;
  END IF;
  IF (r.montant_partage IS NULL) IS DISTINCT FROM p_expect_montant_null THEN
    RAISE EXCEPTION 'ÉCHEC [%] — masquage montant incorrect (valeur=%)', p_label, r.montant_partage;
  END IF;
  RAISE NOTICE 'OK [%] — masquage conforme', p_label;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- AUTORISATIONS
-- ================================================================
SELECT pg_temp.assert_preview_count('admin cible actif, pending (autorisé)',  '00000000-0000-0000-0000-000000000034'::uuid, 'pending', 1);
SELECT pg_temp.assert_preview_denied('assistant cible (doit être refusé)',    '00000000-0000-0000-0000-000000000035'::uuid, 'pending');
SELECT pg_temp.assert_preview_denied('intervenant cible (doit être refusé)', '00000000-0000-0000-0000-000000000036'::uuid, 'pending');
SELECT pg_temp.assert_preview_denied('assistant source (doit être refusé)',  '00000000-0000-0000-0000-000000000032'::uuid, 'pending');
SELECT pg_temp.assert_preview_denied('intervenant source (doit être refusé)','00000000-0000-0000-0000-000000000033'::uuid, 'pending');
SELECT pg_temp.assert_preview_denied('utilisateur anonyme (doit être refusé)', NULL, 'pending');
SELECT pg_temp.assert_preview_denied('admin cible désactivé (doit être refusé)', '00000000-0000-0000-0000-000000000037'::uuid, 'pending');
SELECT pg_temp.assert_preview_count('admin organisation tierce (autorisé à appeler, 0 ligne)', '00000000-0000-0000-0000-000000000038'::uuid, 'pending', 0);
SELECT pg_temp.assert_preview_count('admin source, pas la cible (0 ligne)', '00000000-0000-0000-0000-000000000031'::uuid, 'pending', 0);


-- ================================================================
-- STATUTS
-- ================================================================
SELECT pg_temp.assert_preview_count('admin cible, pending → 1 ligne (org cible uniquement)',     '00000000-0000-0000-0000-000000000034'::uuid, 'pending', 1);
SELECT pg_temp.assert_preview_count('admin cible, refused → 1 ligne',    '00000000-0000-0000-0000-000000000034'::uuid, 'refused', 1);
SELECT pg_temp.assert_preview_count('admin cible, accepted → 0 ligne (hors périmètre RPC)',   '00000000-0000-0000-0000-000000000034'::uuid, 'accepted', 0);
SELECT pg_temp.assert_preview_count('admin cible, in_progress → 0 ligne', '00000000-0000-0000-0000-000000000034'::uuid, 'in_progress', 0);
SELECT pg_temp.assert_preview_count('admin cible, completed → 0 ligne',  '00000000-0000-0000-0000-000000000034'::uuid, 'completed', 0);
SELECT pg_temp.assert_preview_count('admin cible, statut arbitraire → 0 ligne', '00000000-0000-0000-0000-000000000034'::uuid, 'statut_inexistant', 0);


-- ================================================================
-- DONNÉES / MASQUAGE
-- ================================================================
SELECT pg_temp.assert_preview_masking('pending, share_description/montant=true → visibles', '00000000-0000-0000-0000-000000000034'::uuid, 'pending', false, false);
SELECT pg_temp.assert_preview_masking('refused, share_description/montant=false → masqués', '00000000-0000-0000-0000-000000000034'::uuid, 'refused', true, true);

-- Vérifie qu'aucune colonne sensible n'apparaît dans le résultat.
-- Un SELECT direct des colonnes interdites échouerait dès la planification
-- de la requête (colonne inexistante) si le type de retour ne les contient
-- pas — c'est un test structurel plus fort qu'une inspection après coup :
-- si l'une de ces colonnes existait un jour sur cette fonction, ce bloc
-- cesserait de compiler et la migration serait immédiatement suspecte.
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000034', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE 'SELECT adresse_partagee, telephone_client_partage, nom_client_partage, photos_partagees, consignes_partagees, source_intervention_id FROM public.get_partner_requests_preview(''pending'') LIMIT 1';
    v_failed := true; -- si la requête ci-dessus compile, c'est un échec du test
  EXCEPTION WHEN undefined_column THEN
    v_failed := false; -- attendu : ces colonnes n'existent pas sur le type de retour
  END;
  RESET role;

  IF v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [structure] — une colonne sensible interdite existe sur get_partner_requests_preview';
  ELSE
    RAISE NOTICE 'OK [structure] — aucune colonne sensible (adresse/téléphone/nom/photos/consignes/source_intervention_id) sur le type de retour';
  END IF;
END $$;


-- ================================================================
-- PRIVILÈGES
-- ================================================================
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC [privilèges] — anon a EXECUTE sur get_partner_requests_preview';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC [privilèges] — authenticated n''a pas EXECUTE sur get_partner_requests_preview';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ÉCHEC [privilèges] — service_role n''a pas EXECUTE sur get_partner_requests_preview';
  END IF;
  RAISE NOTICE 'OK [privilèges] — anon refusé, authenticated et service_role autorisés';
END $$;


-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
-- Correction TEST-02 (section 5 — isolation) : trg_pir_after_insert_notify
-- (migration 20260708000005) crée une ligne public.notifications à chaque
-- INSERT de partner_intervention_requests (fixtures ci-dessus) — sans ce
-- DELETE préalable, la suppression de public.profiles échoue sur la
-- contrainte notifications_user_id_fkey.
DELETE FROM public.notifications WHERE organisation_id IN (
  '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023'
);
DELETE FROM public.partner_intervention_requests WHERE source_organisation_id = '00000000-0000-0000-0000-000000000021';
DELETE FROM public.partner_connections WHERE id = '00000000-0000-0000-0000-000000000024';
DELETE FROM public.profiles WHERE organisation_id IN (
  '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023'
);
DELETE FROM public.organisations WHERE id IN (
  '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000023'
);
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000034',
  '00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000036',
  '00000000-0000-0000-0000-000000000037', '00000000-0000-0000-0000-000000000038'
);

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister.
ROLLBACK;
