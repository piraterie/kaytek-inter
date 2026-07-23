-- ================================================================
-- TESTS LOCAUX — Correction 3 (RLS-01)
-- pir_select — restauration du contrôle admin
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE. NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration : ne jamais le copier dans
-- supabase/migrations/. Enveloppé dans une transaction annulée
-- (ROLLBACK final) : aucune donnée de test ne doit persister, même
-- en cas d'exécution accidentelle.
--
-- Prérequis : la migration 20260723000001_fix_pir_select_admin_check.sql
-- doit déjà être appliquée sur la base cible.
--
-- Simulation de auth.uid() : voir audit-kaytek-inter/corrections/tests/
-- correction-02-helper-tests.sql pour le détail du mécanisme
-- (request.jwt.claim.sub + SET LOCAL role). Même pattern ici.
--
-- Exécution attendue (NON exécutée dans cette session — voir rapport) :
--   supabase start
--   psql "$(supabase status -o json | jq -r '.DB_URL')" \
--     -f audit-kaytek-inter/corrections/tests/correction-03-partner-rls-tests.sql
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures de test ==='; END $$;

-- ── Organisations de test ────────────────────────────────────────
-- a1 = source, a2 = cible (connexion acceptée entre a1 et a2)
-- a3 = tierce (aucune relation), a4 = utilisée uniquement pour créer
-- une demande "étrangère" (entre a3 et a4) servant à tester l'accès
-- à un identifiant de demande externe.
INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'test-pir-source',  'Test PIR Source',  'pro', true),
  ('00000000-0000-0000-0000-0000000000c2', 'test-pir-target',  'Test PIR Target',  'pro', true),
  ('00000000-0000-0000-0000-0000000000c3', 'test-pir-tierce',  'Test PIR Tierce',  'pro', true),
  ('00000000-0000-0000-0000-0000000000c4', 'test-pir-foreign', 'Test PIR Foreign', 'pro', true)
ON CONFLICT (id) DO NOTHING;

-- ── auth.users (profiles.id et *_profile_id référencent auth.users) ──
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'source-admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'source-assistant@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'source-intervenant@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'target-admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d5', 'target-assistant@test.local'),
  ('00000000-0000-0000-0000-0000000000d6', 'target-intervenant@test.local'),
  ('00000000-0000-0000-0000-0000000000d7', 'tierce-admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d8', 'foreign-admin@test.local')
ON CONFLICT (id) DO NOTHING;

-- ── Profils (un par rôle et par organisation testée) ─────────────
INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'source-admin@test.local',       'Admin',       'Source', 'admin',       '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-0000000000d2', 'source-assistant@test.local',   'Assistant',   'Source', 'assistant',   '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-0000000000d3', 'source-intervenant@test.local', 'Intervenant', 'Source', 'intervenant', '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-0000000000d4', 'target-admin@test.local',       'Admin',       'Target', 'admin',       '00000000-0000-0000-0000-0000000000c2', true),
  ('00000000-0000-0000-0000-0000000000d5', 'target-assistant@test.local',   'Assistant',   'Target', 'assistant',   '00000000-0000-0000-0000-0000000000c2', true),
  ('00000000-0000-0000-0000-0000000000d6', 'target-intervenant@test.local', 'Intervenant', 'Target', 'intervenant', '00000000-0000-0000-0000-0000000000c2', true),
  ('00000000-0000-0000-0000-0000000000d7', 'tierce-admin@test.local',       'Admin',       'Tierce', 'admin',       '00000000-0000-0000-0000-0000000000c3', true),
  ('00000000-0000-0000-0000-0000000000d8', 'foreign-admin@test.local',      'Admin',       'Foreign','admin',       '00000000-0000-0000-0000-0000000000c4', true)
ON CONFLICT (id) DO NOTHING;

-- ── Connexion partenaire acceptée entre c1 (source) et c2 (cible) ──
INSERT INTO public.partner_connections (id, requester_organisation_id, requester_profile_id, target_organisation_id, target_profile_id, status)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d4', 'accepted')
ON CONFLICT (id) DO NOTHING;

-- ── Connexion partenaire (non pertinente) entre c3 (tierce) et c4 (foreign) ──
INSERT INTO public.partner_connections (id, requester_organisation_id, requester_profile_id, target_organisation_id, target_profile_id, status)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d8', 'accepted')
ON CONFLICT (id) DO NOTHING;

-- ── Demandes de test (une par statut), toutes entre c1 (source) et c2 (cible) ──
-- Insertion directe (contourne pir_insert car exécutée par le
-- propriétaire de la session de test) — seul le comportement de
-- lecture (pir_select) est sous test ici, pas la création.
INSERT INTO public.partner_intervention_requests
  (id, connection_id, source_organisation_id, source_profile_id, target_organisation_id, status,
   nom_client_partage, share_nom_client, telephone_client_partage, share_telephone)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'pending',     'Client Pending',     true, '0600000001', true),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'accepted',    'Client Accepted',    true, '0600000002', true),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'in_progress', 'Client InProgress',  true, '0600000003', true),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'completed',   'Client Completed',   true, '0600000004', true),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'refused',     'Client Refused',     true, '0600000005', true)
ON CONFLICT (id) DO NOTHING;
UPDATE public.partner_intervention_requests SET note_refus = 'Test refus' WHERE id = '00000000-0000-0000-0000-0000000000f5' AND note_refus IS NULL;

-- ── Demande "étrangère" (entre c3 et c4) — sert au test d'accès à un
-- identifiant de demande externe depuis l'organisation source (c1) ──
INSERT INTO public.partner_intervention_requests
  (id, connection_id, source_organisation_id, source_profile_id, target_organisation_id, status)
VALUES
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000c4', 'accepted')
ON CONFLICT (id) DO NOTHING;


-- ── Helper de test : visibilité d'une ligne via pir_select ───────
CREATE OR REPLACE FUNCTION pg_temp.assert_pir_visible(
  p_label     text,
  p_uid       uuid,
  p_request_id uuid,
  p_expected  boolean
) RETURNS void AS $$
DECLARE
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';

  SELECT count(*) INTO v_count
  FROM public.partner_intervention_requests
  WHERE id = p_request_id;

  IF (v_count > 0) IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu visible=%, obtenu count=%', p_label, p_expected, v_count;
  ELSE
    RAISE NOTICE 'OK [%] — count=%', p_label, v_count;
  END IF;

  RESET role;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- ORGANISATION SOURCE
-- ================================================================
SELECT pg_temp.assert_pir_visible('admin source, demande pending',     '00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000f1'::uuid, true);
SELECT pg_temp.assert_pir_visible('admin source, demande accepted',    '00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, true);
SELECT pg_temp.assert_pir_visible('admin source, demande refused',    '00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000f5'::uuid, true);
SELECT pg_temp.assert_pir_visible('assistant source, demande pending (doit être refusé)',  '00000000-0000-0000-0000-0000000000d2'::uuid, '00000000-0000-0000-0000-0000000000f1'::uuid, false);
SELECT pg_temp.assert_pir_visible('intervenant source, demande accepted (doit être refusé)', '00000000-0000-0000-0000-0000000000d3'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, false);


-- ================================================================
-- ORGANISATION CIBLE
-- ================================================================
SELECT pg_temp.assert_pir_visible('admin cible, demande pending (masquage statut — doit être refusé)',   '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f1'::uuid, false);
SELECT pg_temp.assert_pir_visible('admin cible, demande refused (masquage statut — doit être refusé)',    '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f5'::uuid, false);
SELECT pg_temp.assert_pir_visible('admin cible, demande accepted (doit être visible)',    '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, true);
SELECT pg_temp.assert_pir_visible('admin cible, demande in_progress (doit être visible)', '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f3'::uuid, true);
SELECT pg_temp.assert_pir_visible('admin cible, demande completed (doit être visible)',   '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f4'::uuid, true);
SELECT pg_temp.assert_pir_visible('assistant cible, demande accepted (doit être refusé — cœur de RLS-01)',   '00000000-0000-0000-0000-0000000000d5'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, false);
SELECT pg_temp.assert_pir_visible('intervenant cible, demande accepted (doit être refusé — cœur de RLS-01)', '00000000-0000-0000-0000-0000000000d6'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, false);


-- ================================================================
-- ISOLATION
-- ================================================================
SELECT pg_temp.assert_pir_visible('organisation tierce (admin, aucune relation), demande accepted (doit être refusé)', '00000000-0000-0000-0000-0000000000d7'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, false);
SELECT pg_temp.assert_pir_visible('identifiant de demande externe, depuis admin source (doit être refusé)', '00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000f9'::uuid, false);
SELECT pg_temp.assert_pir_visible('identifiant de demande externe, depuis admin cible (doit être refusé)', '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f9'::uuid, false);

-- Connexion non 'accepted' : bascule la connexion e1 vers 'blocked' (seule
-- transition valide hors de 'accepted' selon partner_connections_before_update(),
-- 'accepted -> pending' n'ayant jamais été une transition autorisée par le
-- trigger — cf. migration 20260708000002) et vérifie qu'une demande déjà
-- 'accepted' reste gouvernée uniquement par le statut DE LA DEMANDE
-- (pir_select ne relit jamais le statut de la connexion) — comportement
-- inchangé par cette correction, vérifié en non-régression. Restauration
-- ensuite via l'unique transition valide 'blocked -> accepted'.
UPDATE public.partner_connections SET status = 'blocked' WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.assert_pir_visible('admin cible, demande accepted, connexion redevenue blocked (comportement inchangé — reste visible)', '00000000-0000-0000-0000-0000000000d4'::uuid, '00000000-0000-0000-0000-0000000000f2'::uuid, true);
UPDATE public.partner_connections SET status = 'accepted' WHERE id = '00000000-0000-0000-0000-0000000000e1';


-- ================================================================
-- NON-RÉGRESSION — pir_insert / pir_update / RPC
-- ================================================================

-- pir_insert : admin source peut toujours créer une demande.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.partner_intervention_requests
    (connection_id, source_organisation_id, source_profile_id, target_organisation_id, status)
  VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2', 'pending');
  RAISE NOTICE 'OK [pir_insert admin source] — insertion réussie (non-régression)';
  RESET role;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'ÉCHEC [pir_insert admin source] — devrait réussir, a échoué : %', SQLERRM;
END $$;

-- pir_insert : assistant source doit rester refusé.
DO $$
DECLARE
  v_failed_as_expected boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    INSERT INTO public.partner_intervention_requests
      (connection_id, source_organisation_id, source_profile_id, target_organisation_id, status)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', 'pending');
  EXCEPTION WHEN OTHERS THEN
    -- Attendu : violation de la policy RLS pir_insert (SQLSTATE 42501,
    -- "new row violates row-level security policy").
    v_failed_as_expected := true;
  END;
  RESET role;

  IF NOT v_failed_as_expected THEN
    RAISE EXCEPTION 'ÉCHEC [pir_insert assistant source] — aurait dû être refusé par RLS, l''insertion a réussi';
  END IF;
  RAISE NOTICE 'OK [pir_insert assistant source] — refusé comme attendu (non-régression)';
END $$;

-- pir_update : admin cible peut toujours faire transiter accepted → in_progress.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', true);
  SET LOCAL role = 'authenticated';
  UPDATE public.partner_intervention_requests SET status = 'in_progress' WHERE id = '00000000-0000-0000-0000-0000000000f2';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ÉCHEC [pir_update admin cible] — devrait pouvoir démarrer l''intervention (accepted → in_progress)';
  END IF;
  RAISE NOTICE 'OK [pir_update admin cible] — transition réussie (non-régression)';
  -- Pas de remise à l'état initial ici : 'in_progress → accepted' n'est PAS
  -- une transition valide selon partner_intervention_requests_before_update()
  -- (migration 20260708000005) — le cycle de vie d'une demande d'intervention
  -- est intentionnellement à sens unique (pending → accepted → in_progress →
  -- completed, plus les échappatoires refused/cancelled), sans retour en
  -- arrière possible. Aucune assertion suivante dans ce fichier ne relit le
  -- statut de f2 : le laisser en 'in_progress' est donc sans incidence, et
  -- tenter de le restaurer lèverait à tort 'Transition de statut invalide'.
  RESET role;
END $$;

-- pir_update : non-admin (assistant cible) reste refusé.
DO $$
DECLARE
  v_rows int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d5', true);
  SET LOCAL role = 'authenticated';
  UPDATE public.partner_intervention_requests SET status = 'in_progress' WHERE id = '00000000-0000-0000-0000-0000000000f2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC [pir_update assistant cible] — aurait dû affecter 0 ligne (refusé par RLS), a affecté %', v_rows;
  END IF;
  RAISE NOTICE 'OK [pir_update assistant cible] — 0 ligne affectée, refusé comme attendu (non-régression)';
  RESET role;
END $$;

-- respond_to_partner_intervention_request() : comportement admin inchangé
-- (accepte une demande pending — f1 est encore 'pending' à ce stade).
DO $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', true);
  SET LOCAL role = 'authenticated';
  SELECT * INTO r FROM public.respond_to_partner_intervention_request('00000000-0000-0000-0000-0000000000f1'::uuid, 'accepted', NULL);
  IF r.status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'ÉCHEC [respond_to_partner_intervention_request admin cible] — statut attendu accepted, obtenu %', r.status;
  END IF;
  RAISE NOTICE 'OK [respond_to_partner_intervention_request admin cible] — comportement inchangé (non-régression)';
  RESET role;
END $$;


-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
-- Correction TEST-02 (section 5 — isolation) : trg_pir_after_insert_notify
-- (migration 20260708000005) crée une ligne public.notifications à chaque
-- INSERT/transition de partner_intervention_requests exécutée par ce
-- fichier (fixtures + respond_to_partner_intervention_request ci-dessus).
-- Sans ce DELETE préalable, la suppression de public.profiles échoue sur
-- la contrainte notifications_user_id_fkey — jamais atteint auparavant
-- car ce fichier n'avait encore jamais été exécuté avec succès jusqu'ici.
DELETE FROM public.notifications WHERE organisation_id IN (
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4'
);
DELETE FROM public.partner_intervention_requests WHERE source_organisation_id IN (
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3'
);
DELETE FROM public.partner_connections WHERE id IN (
  '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2'
);
DELETE FROM public.profiles WHERE organisation_id IN (
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4'
);
DELETE FROM public.organisations WHERE id IN (
  '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4'
);
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4',
  '00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d6',
  '00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000d8'
);

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister.
ROLLBACK;
