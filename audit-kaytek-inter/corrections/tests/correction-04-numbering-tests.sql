-- ================================================================
-- TESTS LOCAUX — Correction 4 (DB-02)
-- Numérotation devis/factures/interventions par organisation
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE. NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Enveloppé dans BEGIN...ROLLBACK :
-- aucune donnée de test ne doit persister, même en cas d'exécution
-- accidentelle.
--
-- Prérequis : 20260725000001_organisation_scoped_document_numbering.sql
-- doit déjà être appliquée sur la base cible.
--
-- Simulation de auth.uid() : même mécanisme que les fichiers de tests
-- des Corrections 2/3/3 bis (request.jwt.claim.sub + SET LOCAL role).
--
-- Exécution attendue (NON exécutée dans cette session — voir rapport) :
--   supabase start
--   psql "$(supabase status -o json | jq -r '.DB_URL')" \
--     -f audit-kaytek-inter/corrections/tests/correction-04-numbering-tests.sql
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures de test ==='; END $$;

-- ── Organisations : j1 = org A, j2 = org B ────────────────────────
INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('00000000-0000-0000-0000-000000000051', 'test-numbering-a', 'Test Numbering A', 'pro', true),
  ('00000000-0000-0000-0000-000000000052', 'test-numbering-b', 'Test Numbering B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000061', 'admin-a@numbering.test'),
  ('00000000-0000-0000-0000-000000000062', 'admin-b@numbering.test'),
  ('00000000-0000-0000-0000-000000000063', 'admin-a-inactif@numbering.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif) VALUES
  ('00000000-0000-0000-0000-000000000061', 'admin-a@numbering.test',        'Admin', 'A',        'admin', '00000000-0000-0000-0000-000000000051', true),
  ('00000000-0000-0000-0000-000000000062', 'admin-b@numbering.test',        'Admin', 'B',        'admin', '00000000-0000-0000-0000-000000000052', true),
  ('00000000-0000-0000-0000-000000000063', 'admin-a-inactif@numbering.test','Admin', 'AInactif', 'admin', '00000000-0000-0000-0000-000000000051', false)
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- PARTIE A — COMPORTEMENT POST-MIGRATION (compteurs neufs)
-- ================================================================

-- ── Par organisation : premier/deuxième devis org A, premier devis org B ──
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_numero1 text; v_numero2 text; v_numero_b text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';

  INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING numero INTO v_numero1;
  INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING numero INTO v_numero2;
  RESET role;

  IF v_numero1 <> 'DEV-' || v_year || '-001' THEN
    RAISE EXCEPTION 'ÉCHEC [premier devis org A] — attendu DEV-%-001, obtenu %', v_year, v_numero1;
  END IF;
  IF v_numero2 <> 'DEV-' || v_year || '-002' THEN
    RAISE EXCEPTION 'ÉCHEC [deuxième devis org A] — attendu DEV-%-002, obtenu %', v_year, v_numero2;
  END IF;
  RAISE NOTICE 'OK [devis org A] — % puis %', v_numero1, v_numero2;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000062', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000062')
    RETURNING numero INTO v_numero_b;
  RESET role;

  IF v_numero_b <> 'DEV-' || v_year || '-001' THEN
    RAISE EXCEPTION 'ÉCHEC [premier devis org B] — attendu DEV-%-001 (même numéro que org A autorisé), obtenu %', v_year, v_numero_b;
  END IF;
  RAISE NOTICE 'OK [premier devis org B] — % — identique au premier numéro de org A, comportement voulu', v_numero_b;
END $$;

-- ── Types indépendants : compteur devis/factures/interventions distincts ──
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_fac text; v_int text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.factures (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING numero INTO v_fac;
  INSERT INTO public.interventions (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING numero INTO v_int;
  RESET role;

  IF v_fac <> 'FAC-' || v_year || '-001' THEN
    RAISE EXCEPTION 'ÉCHEC [première facture org A] — attendu FAC-%-001, obtenu % (compteur devis semble avoir contaminé le compteur factures)', v_year, v_fac;
  END IF;
  IF v_int <> 'INT-' || v_year || '-001' THEN
    RAISE EXCEPTION 'ÉCHEC [première intervention org A] — attendu INT-%-001, obtenu %', v_year, v_int;
  END IF;
  RAISE NOTICE 'OK [compteurs indépendants] — facture=%, intervention=% (org A a déjà 2 devis, aucune contamination)', v_fac, v_int;
END $$;

-- ── Doublon refusé au sein d'une même organisation (contrainte UNIQUE) ──
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  -- Correction TEST-02 : DISABLE/ENABLE TRIGGER doit s'exécuter AVANT le
  -- SET LOCAL role (donc encore en tant que postgres, propriétaire de la
  -- table) — authenticated n'est jamais propriétaire de public.devis et
  -- ALTER TABLE échoue avec « must be owner of table devis » si le rôle
  -- est déjà basculé. Ce bloc n'avait encore jamais été exécuté jusqu'ici
  -- (fichier bloqué plus tôt par des UUID invalides puis par l'absence de
  -- psql natif), le défaut d'ordre n'avait donc jamais été révélé.
  -- Désactive temporairement le trigger pour forcer un numero explicite
  -- identique à un numero déjà attribué dans la MÊME organisation — seul
  -- moyen de tester la contrainte UNIQUE elle-même (le trigger écrase
  -- normalement toute valeur fournie, empêchant ce cas en usage réel).
  ALTER TABLE public.devis DISABLE TRIGGER set_devis_numero;
  SET LOCAL role = 'authenticated';
  BEGIN
    INSERT INTO public.devis (organisation_id, created_by, numero)
    VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061', 'DEV-' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY') || '-001');
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  RESET role;
  ALTER TABLE public.devis ENABLE TRIGGER set_devis_numero;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [doublon intra-org] — la contrainte UNIQUE(organisation_id, numero) aurait dû refuser ce doublon';
  END IF;
  RAISE NOTICE 'OK [doublon intra-org] — refusé par la contrainte UNIQUE comme attendu';
END $$;


-- ================================================================
-- SÉCURITÉ
-- ================================================================

-- ── Numéro falsifié dans le payload : ignoré et remplacé ──────────
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_numero text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.devis (organisation_id, created_by, numero)
  VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061', 'FAKE-NUMERO-falsifie-999')
  RETURNING numero INTO v_numero;
  RESET role;

  IF v_numero = 'FAKE-NUMERO-falsifie-999' THEN
    RAISE EXCEPTION 'ÉCHEC [numero falsifié] — le numéro fourni par le client a été conservé au lieu d''être écrasé';
  END IF;
  IF v_numero !~ ('^DEV-' || v_year || '-\d+$') THEN
    RAISE EXCEPTION 'ÉCHEC [numero falsifié] — numéro généré de forme inattendue : %', v_numero;
  END IF;
  RAISE NOTICE 'OK [numero falsifié] — ignoré, remplacé par % (comportement voulu : toujours écrasé, même non vide)', v_numero;
END $$;

-- ── Mauvaise organisation fournie : insertion refusée, aucun compteur persistant ──
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_failed boolean := false;
  v_counter_exists boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    -- k1 est admin de j1 (org A) — tente de créer un devis pour j2 (org B).
    -- devis_insert (WITH CHECK organisation_id = current_org_id()) doit refuser.
    INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000061');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  RESET role;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [organisation falsifiée] — l''insertion aurait dû être refusée par devis_insert (organisation_id ≠ current_org_id())';
  END IF;

  -- Vérifie qu'aucun incrément n'a persisté dans document_counters pour j2/devis/année
  -- courante suite à cette tentative avortée — confirme que le rollback de la
  -- transaction (déclenché par l'échec du WITH CHECK) annule bien l'incrément
  -- fait par le trigger BEFORE INSERT dans la même transaction.
  SELECT EXISTS (
    SELECT 1 FROM public.document_counters
    WHERE organisation_id = '00000000-0000-0000-0000-000000000052'
      AND document_type = 'devis' AND period_key = v_year AND current_value > 0
  ) INTO v_counter_exists;
  -- Org B a déjà un devis légitime (partie A) donc current_value=1 est attendu
  -- pour cette clé — le test pertinent est qu'il ne soit PAS passé à 2 suite
  -- à la tentative falsifiée ci-dessus.
  IF (SELECT current_value FROM public.document_counters WHERE organisation_id = '00000000-0000-0000-0000-000000000052' AND document_type = 'devis' AND period_key = v_year) > 1 THEN
    RAISE EXCEPTION 'ÉCHEC [organisation falsifiée] — le compteur de org B a été incrémenté par une tentative refusée par RLS';
  END IF;
  RAISE NOTICE 'OK [organisation falsifiée] — insertion refusée, aucun incrément résiduel dans document_counters';
END $$;

-- ── Appel direct de next_document_number() par authenticated : refusé ──
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    PERFORM public.next_document_number('00000000-0000-0000-0000-000000000051'::uuid, 'devis');
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [appel direct next_document_number] — authenticated ne devrait jamais pouvoir l''appeler directement';
  END IF;
  RAISE NOTICE 'OK [appel direct next_document_number] — refusé (permission denied attendu)';
END $$;

-- ── Accès direct à document_counters par authenticated : refusé ──
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    PERFORM * FROM public.document_counters LIMIT 1;
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [accès direct document_counters] — authenticated ne devrait jamais pouvoir lire cette table';
  END IF;
  RAISE NOTICE 'OK [accès direct document_counters] — refusé (permission denied attendu)';
END $$;

-- ── Utilisateur anonyme refusé ────────────────────────────────────
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL role = 'anon';
  BEGIN
    PERFORM public.next_document_number('00000000-0000-0000-0000-000000000051'::uuid, 'devis');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [anonyme] — anon ne devrait jamais pouvoir appeler next_document_number';
  END IF;
  RAISE NOTICE 'OK [anonyme] — refusé';
END $$;

-- ── Profil désactivé : soumis aux policies existantes (non-régression) ──
DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000063', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000063');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [profil désactivé] — devis_insert (is_admin_in_org, actif=true) aurait dû refuser, comportement inchangé attendu';
  END IF;
  RAISE NOTICE 'OK [profil désactivé] — refusé par les policies existantes (non-régression, non modifié par cette correction)';
END $$;


-- ================================================================
-- PARTIE B — RÉ-VALIDATION DE LA LOGIQUE D'INITIALISATION
-- ================================================================
-- L'initialisation réelle (migration §5) ne s'exécute qu'une seule
-- fois, au moment de l'application de la migration, sur les données
-- alors existantes — elle ne peut pas être redéclenchée ici. Ce bloc
-- reproduit exactement la même requête d'agrégation sur des données
-- historiques fraîchement injectées (trigger temporairement désactivé,
-- comme pour les fixtures de test des migrations précédentes -
-- 20260714000012) et vérifie que le résultat est celui attendu :
-- suffixe > 999 pris en compte, plusieurs années distinguées, formats
-- non conformes exclus sans erreur.
DO $$
DECLARE
  v_max_2025 bigint;
  v_max_2024 bigint;
  v_nonconforme_count int;
  v_conforme_count int;
BEGIN
  ALTER TABLE public.devis DISABLE TRIGGER set_devis_numero;

  INSERT INTO public.devis (organisation_id, numero) VALUES
    ('00000000-0000-0000-0000-000000000051', 'DEV-2025-001'),
    ('00000000-0000-0000-0000-000000000051', 'DEV-2025-1500'),  -- suffixe > 999
    ('00000000-0000-0000-0000-000000000051', 'DEV-2024-007'),   -- année différente
    ('00000000-0000-0000-0000-000000000051', 'DEVIS-FORMAT-INCONNU-42'); -- non conforme

  ALTER TABLE public.devis ENABLE TRIGGER set_devis_numero;

  -- Reproduction exacte de la requête d'agrégation de la migration (§5),
  -- restreinte à cette organisation de test.
  SELECT MAX(substring(numero from '(\d+)$')::bigint) INTO v_max_2025
  FROM public.devis
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051'
    AND numero ~ '^DEV-2025-\d+$';

  SELECT MAX(substring(numero from '(\d+)$')::bigint) INTO v_max_2024
  FROM public.devis
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051'
    AND numero ~ '^DEV-2024-\d+$';

  SELECT count(*) INTO v_conforme_count FROM public.devis
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051' AND numero ~ '^DEV-\d{4}-\d+$';

  SELECT count(*) INTO v_nonconforme_count FROM public.devis
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051' AND numero !~ '^DEV-\d{4}-\d+$';

  IF v_max_2025 <> 1500 THEN
    RAISE EXCEPTION 'ÉCHEC [init — suffixe > 999] — attendu 1500 pour 2025, obtenu %', v_max_2025;
  END IF;
  IF v_max_2024 <> 7 THEN
    RAISE EXCEPTION 'ÉCHEC [init — plusieurs années] — attendu 7 pour 2024, obtenu %', v_max_2024;
  END IF;

  RAISE NOTICE 'OK [logique d''initialisation] — 2025 → max=%, 2024 → max=%, % numéro(s) conforme(s), % non conforme(s) exclu(s) sans erreur',
    v_max_2025, v_max_2024, v_conforme_count, v_nonconforme_count;
  -- Comptage attendu sur ce jeu de fixtures : 3 conformes (2025-001, 2025-1500,
  -- 2024-007), 1 non conforme (DEVIS-FORMAT-INCONNU-42), correctement exclu.

  -- Nettoyage immédiat de ces lignes fictives (n'affecte pas les compteurs
  -- réels créés en Partie A pour cette organisation, sur des clés d'année
  -- différentes de 2024/2025 dans la plupart des cas réels).
  DELETE FROM public.devis WHERE organisation_id = '00000000-0000-0000-0000-000000000051'
    AND numero IN ('DEV-2025-001', 'DEV-2025-1500', 'DEV-2024-007', 'DEVIS-FORMAT-INCONNU-42');
END $$;


-- ================================================================
-- ANNÉE / FUSEAU HORAIRE (Europe/Paris)
-- ================================================================
-- Vérifie que la conversion de fuseau utilisée par next_document_number()
-- (Europe/Paris, PAS UTC) place bien un instant tardif du 31/12 en UTC
-- dans l'année SUIVANTE côté France (hiver, CET = UTC+1) — c'est
-- précisément le bug qu'un simple EXTRACT(YEAR FROM now()) en UTC aurait
-- laissé passer.
DO $$
DECLARE
  v_year_late_utc text;
  v_year_still_2025 text;
BEGIN
  v_year_late_utc := to_char(timestamptz '2025-12-31 23:30:00+00' AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_year_still_2025 := to_char(timestamptz '2025-12-31 22:00:00+00' AT TIME ZONE 'Europe/Paris', 'YYYY');

  IF v_year_late_utc <> '2026' THEN
    RAISE EXCEPTION 'ÉCHEC [fuseau Europe/Paris] — 31/12 23h30 UTC (= 00h30 le 1er janvier à Paris, hiver UTC+1) devrait donner 2026, obtenu %', v_year_late_utc;
  END IF;
  IF v_year_still_2025 <> '2025' THEN
    RAISE EXCEPTION 'ÉCHEC [fuseau Europe/Paris] — 31/12 22h00 UTC (= 23h00 encore le 31/12 à Paris) devrait donner 2025, obtenu %', v_year_still_2025;
  END IF;
  RAISE NOTICE 'OK [fuseau Europe/Paris] — 23h30 UTC 31/12 → %, 22h00 UTC 31/12 → % (bascule correcte à l''heure de Paris, pas UTC)', v_year_late_utc, v_year_still_2025;
END $$;


-- ================================================================
-- SUPPRESSION — le numéro n'est jamais réutilisé
-- ================================================================
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_id uuid;
  v_numero_before text;
  v_numero_after text;
  v_counter_before bigint;
  v_counter_after bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', true);

  -- Correction TEST-02 : les lectures de document_counters doivent
  -- s'exécuter en tant que postgres (avant/après le SET LOCAL role), pas
  -- sous authenticated — authenticated n'a jamais eu et ne doit jamais
  -- avoir de SELECT direct sur cette table interne (déjà vérifié plus
  -- haut dans ce même fichier, section « Accès direct à document_counters
  -- par authenticated : refusé »). Seules les opérations sur public.devis
  -- (qui passent par les policies RLS réelles de l'application) doivent
  -- s'exécuter sous authenticated. Ce bloc n'avait jamais été exécuté
  -- jusqu'ici (fichier bloqué plus tôt par des UUID invalides puis par
  -- l'absence de psql natif), le défaut n'avait donc jamais été révélé.
  SELECT current_value INTO v_counter_before FROM public.document_counters
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051' AND document_type = 'devis' AND period_key = v_year;

  SET LOCAL role = 'authenticated';
  INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING id, numero INTO v_id, v_numero_before;
  DELETE FROM public.devis WHERE id = v_id;

  INSERT INTO public.devis (organisation_id, created_by) VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000061')
    RETURNING numero INTO v_numero_after;
  RESET role;

  SELECT current_value INTO v_counter_after FROM public.document_counters
  WHERE organisation_id = '00000000-0000-0000-0000-000000000051' AND document_type = 'devis' AND period_key = v_year;

  IF v_numero_after = v_numero_before THEN
    RAISE EXCEPTION 'ÉCHEC [suppression] — le numéro % a été réutilisé après suppression du document', v_numero_before;
  END IF;
  IF v_counter_after <> v_counter_before + 2 THEN
    RAISE EXCEPTION 'ÉCHEC [suppression] — le compteur devrait avoir progressé de 2 (deux INSERT), avant=%, après=%', v_counter_before, v_counter_after;
  END IF;
  RAISE NOTICE 'OK [suppression] — % supprimé, nouveau document = % (jamais réutilisé), compteur % → %', v_numero_before, v_numero_after, v_counter_before, v_counter_after;
END $$;


-- ================================================================
-- AUCUNE MODIFICATION DES DOCUMENTS EXISTANTS (hors fixtures de ce test)
-- ================================================================
-- Vérification de principe : aucune ligne devis/factures/interventions
-- créée AVANT ce fichier de test (donc réellement historique/métier)
-- n'a été touchée par les opérations ci-dessus, qui ne portent que sur
-- des lignes de test explicitement créées et supprimées dans cette
-- transaction. Aucun UPDATE n'a été exécuté sur devis/factures/
-- interventions nulle part dans ce fichier — vérifiable par relecture
-- (grep "UPDATE public.devis" / "UPDATE public.factures" /
-- "UPDATE public.interventions" sur ce fichier → 0 occurrence).


-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.devis WHERE organisation_id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM public.factures WHERE organisation_id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM public.interventions WHERE organisation_id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM public.document_counters WHERE organisation_id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM public.profiles WHERE organisation_id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM public.organisations WHERE id IN ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000052');
DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000063');

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister.
ROLLBACK;


-- ================================================================
-- CONCURRENCE — À EXÉCUTER SÉPARÉMENT (plusieurs connexions réelles,
-- ne peut pas être simulé dans une seule session/transaction)
-- ================================================================
-- Instructions (non exécutées ici) :
--
-- 1. Créer une organisation de test dédiée et un admin actif (comme
--    ci-dessus), en dehors de toute transaction annulée (donc via un
--    script setup séparé, ou en retirant temporairement le ROLLBACK
--    final le temps du test, sur une base locale/jetable uniquement).
--
-- 2. Lancer N sessions concurrentes (ex. avec `pgbench -f script.sql -c 10 -t 5`,
--    ou N processus `psql` lancés en parallèle depuis un script shell),
--    chacune exécutant, avec le JWT du même admin de test :
--      INSERT INTO public.devis (organisation_id, created_by)
--      VALUES ('<org-test>', '<admin-test>') RETURNING numero;
--
-- 3. Vérifier après coup :
--      SELECT numero, count(*) FROM public.devis
--      WHERE organisation_id = '<org-test>' GROUP BY numero HAVING count(*) > 1;
--      -- Attendu : 0 ligne (aucune collision)
--
--      SELECT current_value FROM public.document_counters
--      WHERE organisation_id = '<org-test>' AND document_type = 'devis'
--        AND period_key = to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
--      -- Attendu : exactement N (compteur final cohérent avec le nombre
--      -- réel d'INSERT réussis)
--
--      Les numéros ne sont pas garantis dans l'ordre d'ARRIVÉE des
--      requêtes concurrentes (l'ordre d'obtention du verrou de ligne
--      `ON CONFLICT DO UPDATE` dépend du planificateur), mais sont
--      garantis uniques et strictement croissants sans trou pour un lot
--      de créations qui réussissent toutes.
--
-- 4. Lancer simultanément le même test pour une SECONDE organisation
--    (clé de compteur différente) et vérifier que les deux lots
--    progressent sans ralentissement mutuel mesurable (contrairement
--    au verrou advisory global du mécanisme précédent, qui sérialisait
--    TOUTES les organisations entre elles sur une même table) — test de
--    non-contention, pas de correction fonctionnelle.
--
-- NON EXÉCUTÉ dans cette session : Docker indisponible dans cet
-- environnement (voir rapport de correction).
