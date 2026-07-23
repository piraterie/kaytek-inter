-- ================================================================
-- TESTS LOCAUX — Correction 2 (SEC2-01)
-- current_organisation_has_app_access() / get_my_app_access_status()
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE (ex. `supabase start` local, ou un projet Supabase de test
-- séparé de la production). NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration : il ne doit jamais être copié
-- dans supabase/migrations/. Il crée des données de test (organisations,
-- profils, lignes subscriptions) et les nettoie explicitement à la fin
-- de chaque scénario. L'ensemble est en plus enveloppé dans une
-- transaction annulée (ROLLBACK final) : même en cas d'exécution
-- accidentelle, aucune donnée de test ne doit persister.
--
-- Prérequis : la migration 20260722000001_subscription_access_enforcement.sql
-- doit déjà être appliquée sur la base cible.
--
-- Simulation de auth.uid() : Supabase définit auth.uid() à partir du
-- claim JWT "sub" exposé via le GUC request.jwt.claim.sub (ou
-- request.jwt.claims en JSON selon la version). Ce script utilise
-- `SET LOCAL request.jwt.claim.sub` + `SET LOCAL role authenticated`
-- pour se faire passer pour chaque utilisateur de test, comme c'est
-- l'usage standard pour tester des policies RLS Supabase en local.
-- Si la définition réelle de auth.uid() sur ce projet diffère,
-- adapter uniquement ces deux lignes par scénario.
--
-- Exécution attendue :
--   supabase start   (si pas déjà démarré)
--   psql "$(supabase status -o json | jq -r '.DB_URL')" \
--     -f audit-kaytek-inter/corrections/tests/correction-02-helper-tests.sql
-- ================================================================

BEGIN;

-- ── Fixtures communes ────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '=== Préparation des fixtures de test ===';
END $$;

-- profiles.id et subscriptions.user_id référencent tous les deux
-- auth.users(id) (ON DELETE CASCADE) — ces lignes doivent exister
-- AVANT les profils/abonnements de test, sinon les INSERT échouent
-- sur la contrainte FK. Insertion minimale (id + email), les autres
-- colonnes de auth.users ont des valeurs par défaut/nullable côté
-- GoTrue sur une instance Supabase locale standard.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 't1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 't3@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 't4@test.local'),
  ('00000000-0000-0000-0000-0000000000b5', 't5@test.local'),
  ('00000000-0000-0000-0000-00000000005b', 't5b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'test-org-active',   'Test Org Active',   'pro', true),
  ('00000000-0000-0000-0000-0000000000a2', 'test-org-inactive', 'Test Org Inactive', 'pro', false),
  ('00000000-0000-0000-0000-0000000000a3', 'test-org-nosub',    'Test Org Sans Abo', 'pro', true),
  ('00000000-0000-0000-0000-0000000000a4', 'test-org-multi',    'Test Org Multi',    'pro', true)
ON CONFLICT (id) DO NOTHING;

-- Profils de test — un par scénario. auth.users n'est pas peuplé ici
-- (pas nécessaire : profiles.id est comparé directement à la valeur
-- simulée de auth.uid(), aucune FK n'est vérifiée par le helper lui-même).
INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 't1@test.local', 'T1', 'Actif',        'admin', '00000000-0000-0000-0000-0000000000a1', true),
  ('00000000-0000-0000-0000-0000000000b2', 't2@test.local', 'T2', 'ProfilInactif','admin', '00000000-0000-0000-0000-0000000000a1', false),
  ('00000000-0000-0000-0000-0000000000b3', 't3@test.local', 'T3', 'OrgInactive',  'admin', '00000000-0000-0000-0000-0000000000a2', true),
  ('00000000-0000-0000-0000-0000000000b4', 't4@test.local', 'T4', 'SansAbo',      'admin', '00000000-0000-0000-0000-0000000000a3', true),
  ('00000000-0000-0000-0000-0000000000b5', 't5@test.local', 'T5', 'Multi',        'admin', '00000000-0000-0000-0000-0000000000a4', true)
ON CONFLICT (id) DO NOTHING;

-- ── Petite fonction utilitaire de test (locale à cette session) ──
-- Réservée aux scénarios AUTHENTIFIÉS (p_uid NOT NULL) depuis TEST-02 :
-- voir pg_temp.assert_anon_denied_app_access() ci-dessous pour le
-- scénario anonyme, qui ne peut plus reposer sur un simple retour
-- booléen depuis que SEC2-02 révoque explicitement EXECUTE pour anon
-- sur current_organisation_has_app_access().
CREATE OR REPLACE FUNCTION pg_temp.assert_access(
  p_label      text,
  p_uid        uuid,       -- NOT NULL — utilisateur authentifié simulé
  p_expected   boolean
) RETURNS void AS $$
DECLARE
  v_actual boolean;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'pg_temp.assert_access ne doit plus être appelée avec p_uid NULL depuis TEST-02 — utiliser pg_temp.assert_anon_denied_app_access() pour le scénario anonyme (label reçu : %)', p_label;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';

  SELECT public.current_organisation_has_app_access() INTO v_actual;

  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu %, obtenu %', p_label, p_expected, v_actual;
  ELSE
    RAISE NOTICE 'OK [%] — %', p_label, v_actual;
  END IF;

  RESET role;
END;
$$ LANGUAGE plpgsql;

-- ── Correction TEST-02 — remplace l'ancien scénario anonyme ──────
-- Ancien comportement testé (avant SEC2-02) : anon pouvait appeler
-- current_organisation_has_app_access() directement et obtenait `false`
-- (fail-closed applicatif). Depuis SEC2-02, anon n'a plus AUCUN droit
-- EXECUTE effectif sur cette fonction (privilège par défaut de la
-- plateforme explicitement révoqué) : l'appel doit désormais échouer
-- AVANT même de retourner une valeur, avec une erreur de permission
-- (SQLSTATE 42501 / insufficient_privilege) — un refus d'exécution est
-- ici le comportement CORRECT et attendu, pas un échec du test.
-- Ce helper vérifie, sans modifier aucune donnée :
--   1. le droit effectif (has_function_privilege) est bien `false` ;
--   2. l'appel réel sous le rôle anon échoue avec une erreur de
--      permission (jamais un simple retour `false`) ;
--   3. si l'appel réussissait malgré tout (régression de SEC2-02), le
--      test échoue explicitement plutôt que de l'accepter silencieusement.
CREATE OR REPLACE FUNCTION pg_temp.assert_anon_denied_app_access()
RETURNS void AS $$
DECLARE
  v_has_execute boolean;
  v_denied      boolean := false;
  v_sqlstate    text;
BEGIN
  SELECT has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE')
    INTO v_has_execute;
  IF v_has_execute THEN
    RAISE EXCEPTION 'ÉCHEC [anon EXECUTE current_organisation_has_app_access] — anon possède encore EXECUTE (régression SEC2-02)';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL role = anon;
    PERFORM public.current_organisation_has_app_access();
    -- Si on atteint cette ligne, l'appel a réussi malgré l'absence
    -- d'EXECUTE : échec critique, pas un simple avertissement.
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      v_denied := true;
  END;
  RESET role;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'ÉCHEC [anon appel direct current_organisation_has_app_access] — l''appel a réussi (ou a échoué pour une autre raison que insufficient_privilege) alors qu''il devait être refusé par permission';
  END IF;
  RAISE NOTICE 'OK [anon refusé sur current_organisation_has_app_access] — has_function_privilege=false, appel refusé (SQLSTATE=%)', v_sqlstate;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- SCÉNARIO 1 — utilisateur anonyme (refus attendu depuis SEC2-02) / profil absent
-- ================================================================
SELECT pg_temp.assert_anon_denied_app_access();
SELECT pg_temp.assert_access('profil absent (uid random)', '00000000-0000-0000-0000-00000000ffff'::uuid, false);


-- ================================================================
-- SCÉNARIO 2 — profil actif / inactif, organisation active / inactive
-- (tous testés SANS ligne subscriptions → doivent refléter le
-- fail-open historique UNIQUEMENT si profil/org sont valides)
-- ================================================================
SELECT pg_temp.assert_access('profil actif, org active, aucune ligne subscriptions (fail-open attendu)', '00000000-0000-0000-0000-0000000000b1'::uuid, true);
SELECT pg_temp.assert_access('profil INACTIF (b2), org active, aucune ligne subscriptions', '00000000-0000-0000-0000-0000000000b2'::uuid, false);
SELECT pg_temp.assert_access('profil actif, org INACTIVE (b3/a2), aucune ligne subscriptions', '00000000-0000-0000-0000-0000000000b3'::uuid, false);
SELECT pg_temp.assert_access('profil actif, org active, aucune ligne subscriptions (b4/a3 — cas kaytek-inter)', '00000000-0000-0000-0000-0000000000b4'::uuid, true);


-- ================================================================
-- SCÉNARIO 3 — une seule ligne subscriptions, tous les statuts
-- ================================================================

-- 3a. active
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'active');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions active', '00000000-0000-0000-0000-0000000000b1'::uuid, true);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3b. trialing, trial_ends_at NULL
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'trialing', NULL);
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions trialing, trial_ends_at NULL', '00000000-0000-0000-0000-0000000000b1'::uuid, true);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3c. trialing, essai encore valide (futur)
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'trialing', now() + interval '3 days');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions trialing, essai valide (futur)', '00000000-0000-0000-0000-0000000000b1'::uuid, true);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3d. trialing, essai expiré (passé) → doit bloquer
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'trialing', now() - interval '1 day');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions trialing, essai EXPIRÉ', '00000000-0000-0000-0000-0000000000b1'::uuid, false);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3e. past_due
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'past_due');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions past_due', '00000000-0000-0000-0000-0000000000b1'::uuid, false);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3f. unpaid
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'unpaid');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions unpaid', '00000000-0000-0000-0000-0000000000b1'::uuid, false);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';

-- 3g. canceled
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'canceled');
SELECT pg_temp.assert_access('org avec 1 ligne subscriptions canceled', '00000000-0000-0000-0000-0000000000b1'::uuid, false);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a1';


-- ================================================================
-- SCÉNARIO 4 — plusieurs lignes subscriptions pour la même organisation
-- (DB-06 : aucune contrainte d'unicité sur organisation_id — plusieurs
-- users de la même org peuvent chacun avoir leur propre ligne)
-- ================================================================

-- 4a. une active + une canceled → doit autoriser (au moins une valide)
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status) VALUES
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a4', 'canceled'),
  ('00000000-0000-0000-0000-00000000005b', '00000000-0000-0000-0000-0000000000a4', 'active')
ON CONFLICT (user_id) DO NOTHING;
SELECT pg_temp.assert_access('org multi-abonnements : 1 active + 1 canceled → autorisé', '00000000-0000-0000-0000-0000000000b5'::uuid, true);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a4';

-- 4b. toutes bloquées (canceled + unpaid) → doit refuser
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status) VALUES
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a4', 'canceled'),
  ('00000000-0000-0000-0000-00000000005b', '00000000-0000-0000-0000-0000000000a4', 'unpaid')
ON CONFLICT (user_id) DO NOTHING;
SELECT pg_temp.assert_access('org multi-abonnements : toutes bloquées (canceled + unpaid) → refusé', '00000000-0000-0000-0000-0000000000b5'::uuid, false);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a4';

-- 4c. plusieurs lignes dont une seule valide (trialing valide + past_due) → autorisé
INSERT INTO public.subscriptions (user_id, organisation_id, subscription_status, trial_ends_at) VALUES
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a4', 'past_due', NULL),
  ('00000000-0000-0000-0000-00000000005b', '00000000-0000-0000-0000-0000000000a4', 'trialing', now() + interval '2 days')
ON CONFLICT (user_id) DO NOTHING;
SELECT pg_temp.assert_access('org multi-abonnements : 1 seule valide (trialing) parmi plusieurs → autorisé', '00000000-0000-0000-0000-0000000000b5'::uuid, true);
DELETE FROM public.subscriptions WHERE organisation_id = '00000000-0000-0000-0000-0000000000a4';


-- ================================================================
-- SCÉNARIO 5 — get_my_app_access_status() (RPC utilisée par les
-- Edge Functions) reflète bien le même résultat que le helper
-- ================================================================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b4', true);
SET LOCAL role = 'authenticated';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.get_my_app_access_status();
  IF r.allowed IS DISTINCT FROM true OR r.has_subscription IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ÉCHEC [get_my_app_access_status, org sans abonnement] — allowed=% has_subscription=%', r.allowed, r.has_subscription;
  END IF;
  RAISE NOTICE 'OK [get_my_app_access_status, org sans abonnement] — allowed=% has_subscription=%', r.allowed, r.has_subscription;
END $$;
RESET role;


-- ================================================================
-- Nettoyage explicite des fixtures (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.subscriptions WHERE organisation_id IN (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4'
);
DELETE FROM public.profiles WHERE organisation_id IN (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4'
);
DELETE FROM public.organisations WHERE id IN (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4'
);
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4',
  '00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000005b'
);

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister,
-- même en cas d'exécution répétée ou accidentelle.
ROLLBACK;
