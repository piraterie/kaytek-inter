-- ================================================================
-- TESTS LOCAUX — Correction 5 (FONC-02)
-- Uniformisation du calcul des commissions
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST
-- DÉDIÉE. NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Enveloppé dans BEGIN...ROLLBACK :
-- aucune donnée de test ne doit persister, même en cas d'exécution
-- accidentelle.
--
-- Prérequis : 20260726000001_unify_commission_calculation.sql doit
-- déjà être appliquée sur la base cible.
--
-- Simulation de auth.uid() : même mécanisme que les fichiers de tests
-- des Corrections 2/3/3 bis/4.
--
-- Exécution attendue (NON exécutée dans cette session — voir rapport) :
--   supabase start
--   psql "$(supabase status -o json | jq -r '.DB_URL')" \
--     -f audit-kaytek-inter/corrections/tests/correction-05-commission-tests.sql
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures de test ==='; END $$;

-- ── Organisations : m1 = principale, m2 = tierce (cross-tenant) ──
INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('00000000-0000-0000-0000-000000000071', 'test-commissions-a', 'Test Commissions A', 'pro', true),
  ('00000000-0000-0000-0000-000000000072', 'test-commissions-b', 'Test Commissions B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000081', 'admin-comm@test.local'),
  ('00000000-0000-0000-0000-000000000082', 'intervenant-comm@test.local'),
  ('00000000-0000-0000-0000-000000000083', 'admin-inactif-comm@test.local'),
  ('00000000-0000-0000-0000-000000000084', 'admin-tierce-comm@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif, commission_pct) VALUES
  ('00000000-0000-0000-0000-000000000081', 'admin-comm@test.local',        'Admin',      'Comm',    'admin',       '00000000-0000-0000-0000-000000000071', true,  30),
  ('00000000-0000-0000-0000-000000000082', 'intervenant-comm@test.local',  'Intervenant','Comm',    'intervenant', '00000000-0000-0000-0000-000000000071', true,  20),
  ('00000000-0000-0000-0000-000000000083', 'admin-inactif-comm@test.local','Admin',      'Inactif', 'admin',       '00000000-0000-0000-0000-000000000071', false, 30),
  ('00000000-0000-0000-0000-000000000084', 'admin-tierce-comm@test.local', 'Admin',      'Tierce',  'admin',       '00000000-0000-0000-0000-000000000072', true,  30)
ON CONFLICT (id) DO NOTHING;


-- ── Helper : crée une intervention + facture, retourne les ids ──────
CREATE OR REPLACE FUNCTION pg_temp.make_intervention_facture(
  p_org uuid, p_intervenant uuid, p_ttc numeric,
  p_cout_pieces numeric, p_materiel_confirme boolean,
  p_statut_paiement text DEFAULT 'impayee'
) RETURNS TABLE(intervention_id uuid, facture_id uuid) AS $$
DECLARE
  v_int_id uuid;
  v_fac_id uuid;
BEGIN
  INSERT INTO public.interventions (organisation_id, intervenant_id, statut, cout_pieces, materiel_confirme, montant_ttc)
  VALUES (p_org, p_intervenant, 'termine', p_cout_pieces, p_materiel_confirme, p_ttc)
  RETURNING id INTO v_int_id;

  INSERT INTO public.factures (organisation_id, intervention_id, montant_ttc, statut_paiement)
  VALUES (p_org, v_int_id, p_ttc, p_statut_paiement)
  RETURNING id INTO v_fac_id;

  RETURN QUERY SELECT v_int_id, v_fac_id;
END;
$$ LANGUAGE plpgsql;

-- ── Helper d'assertion générique ─────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_label text, p_expected numeric, p_actual numeric)
RETURNS void AS $$
BEGIN
  IF p_expected IS DISTINCT FROM p_actual THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu %, obtenu %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'OK [%] — %', p_label, p_actual;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- CALCUL
-- ================================================================

-- 1. Facture 1000€, taux 20%, sans matériel → base 1000, comm 200, part 800
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('sans matériel — base', 1000, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('sans matériel — commission intervenant (part_intervenant)', 200, c.part_intervenant);
  PERFORM pg_temp.assert_eq('sans matériel — part entreprise (commission_admin)', 800, c.commission_admin);
  PERFORM pg_temp.assert_eq('sans matériel — formule_version', 2, c.formule_version);
END $$;

-- 2. Facture 1000€, taux 20%, matériel confirmé 100 → base 900, comm 180, part 720
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 100, true, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('matériel confirmé 100 — base', 900, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('matériel confirmé 100 — commission intervenant', 180, c.part_intervenant);
  PERFORM pg_temp.assert_eq('matériel confirmé 100 — part entreprise', 720, c.commission_admin);
  PERFORM pg_temp.assert_eq('matériel confirmé 100 — cout_pieces_applique', 100, c.cout_pieces_applique);
END $$;

-- 3. Matériel NON confirmé (cout_pieces=100 mais materiel_confirme=false) → aucune déduction
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 100, false, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('matériel non confirmé — base (pas de déduction)', 1000, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('matériel non confirmé — cout_pieces_applique figé à 0', 0, c.cout_pieces_applique);
END $$;

-- 4. Matériel égal au TTC → base 0, parts 0
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 500, 500, true, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('matériel = TTC — base', 0, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('matériel = TTC — commission intervenant', 0, c.part_intervenant);
  PERFORM pg_temp.assert_eq('matériel = TTC — part entreprise', 0, c.commission_admin);
END $$;

-- 5. Matériel supérieur au TTC → base plafonnée à 0 (jamais négative)
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 500, 700, true, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('matériel > TTC — base plafonnée à 0', 0, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('matériel > TTC — commission intervenant', 0, c.part_intervenant);
END $$;

-- 6. Taux 0% (profil temporaire à 0)
DO $$
DECLARE r record; c record;
BEGIN
  UPDATE public.profiles SET commission_pct = 0 WHERE id = '00000000-0000-0000-0000-000000000082';
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('taux 0% — commission intervenant', 0, c.part_intervenant);
  PERFORM pg_temp.assert_eq('taux 0% — part entreprise = base', 1000, c.commission_admin);
  UPDATE public.profiles SET commission_pct = 20 WHERE id = '00000000-0000-0000-0000-000000000082';
END $$;

-- 7. Taux 100%
DO $$
DECLARE r record; c record;
BEGIN
  UPDATE public.profiles SET commission_pct = 100 WHERE id = '00000000-0000-0000-0000-000000000082';
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('taux 100% — commission intervenant = base', 1000, c.part_intervenant);
  PERFORM pg_temp.assert_eq('taux 100% — part entreprise = 0', 0, c.commission_admin);
  UPDATE public.profiles SET commission_pct = 20 WHERE id = '00000000-0000-0000-0000-000000000082';
END $$;

-- 8. Arrondis (333.33 TTC, taux 20% avec matériel 33.33 confirmé)
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 333.33, 33.33, true, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  -- base = 300.00 ; commission = ROUND(300 * 20/100, 2) = 60.00 ; part entreprise = 240.00
  PERFORM pg_temp.assert_eq('arrondis — base', 300.00, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('arrondis — commission intervenant', 60.00, c.part_intervenant);
  PERFORM pg_temp.assert_eq('arrondis — identité au centime (part+admin=base)', c.base_commissionnable, c.part_intervenant + c.commission_admin);
END $$;


-- ================================================================
-- DÉCLENCHEMENT
-- ================================================================

-- Facture créée DIRECTEMENT comme payée (pas de transition impayée→payée)
DO $$
DECLARE r record; v_count int;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC [création directe payée] — attendu 1 commission, obtenu %', v_count;
  END IF;
  RAISE NOTICE 'OK [création directe payée] — commission créée dès l''INSERT';
END $$;

-- Passage impayée → payée
DO $$
DECLARE r record; v_count int;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'impayee');
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC [avant paiement] — aucune commission attendue tant qu''impayée, obtenu %', v_count;
  END IF;

  UPDATE public.factures SET statut_paiement = 'payee' WHERE id = r.facture_id;
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC [transition vers payée] — attendu 1 commission, obtenu %', v_count;
  END IF;
  RAISE NOTICE 'OK [transition impayée → payée] — commission créée à la transition, pas avant';

  -- UPDATE d'une facture déjà payée sans changement pertinent (ex. notes) : pas de doublon
  UPDATE public.factures SET notes = 'note sans rapport' WHERE id = r.facture_id;
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC [UPDATE facture déjà payée] — toujours 1 commission attendue, obtenu %', v_count;
  END IF;
  RAISE NOTICE 'OK [UPDATE facture déjà payée sans changement pertinent] — aucune commission dupliquée';
END $$;

-- Double transition rejouée (statut repasse par un autre état puis revient à payée)
DO $$
DECLARE r record; v_count int;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  -- Rejoue explicitement le calcul (simule un double déclenchement concurrent)
  PERFORM public.calculate_commission_for_facture(r.facture_id);
  PERFORM public.calculate_commission_for_facture(r.facture_id);
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC [rejeu/double déclenchement] — attendu exactement 1 commission (idempotence), obtenu %', v_count;
  END IF;
  RAISE NOTICE 'OK [rejeu/double déclenchement] — idempotent, 1 seule commission';
END $$;


-- ================================================================
-- VALEURS FIGÉES
-- ================================================================

-- Changement ultérieur du taux du profil : aucune modification de la commission déjà créée
DO $$
DECLARE r record; c_before record; c_after record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT * INTO c_before FROM public.commissions WHERE facture_id = r.facture_id;

  UPDATE public.profiles SET commission_pct = 90 WHERE id = '00000000-0000-0000-0000-000000000082';
  SELECT * INTO c_after FROM public.commissions WHERE facture_id = r.facture_id;

  PERFORM pg_temp.assert_eq('taux modifié après coup — commission_pct figé inchangé', c_before.commission_pct, c_after.commission_pct);
  PERFORM pg_temp.assert_eq('taux modifié après coup — part_intervenant inchangée', c_before.part_intervenant, c_after.part_intervenant);
  UPDATE public.profiles SET commission_pct = 20 WHERE id = '00000000-0000-0000-0000-000000000082';
  RAISE NOTICE 'OK [taux modifié après coup] — aucun effet rétroactif';
END $$;

-- Matériel confirmé APRÈS le paiement : recalcul si non finalisée
DO $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('avant confirmation matériel — base', 1000, c.base_commissionnable);

  UPDATE public.interventions SET cout_pieces = 200, materiel_confirme = true WHERE id = r.intervention_id;
  SELECT * INTO c FROM public.commissions WHERE facture_id = r.facture_id;
  PERFORM pg_temp.assert_eq('après confirmation matériel (non finalisée) — base recalculée', 800, c.base_commissionnable);
  PERFORM pg_temp.assert_eq('après confirmation matériel — commission recalculée', 160, c.part_intervenant);
  RAISE NOTICE 'OK [matériel confirmé après paiement] — recalcul appliqué (commission non finalisée)';
END $$;

-- Matériel modifié après finalisation (statut='paye') : refusé/aucun recalcul
DO $$
DECLARE r record; c_before record; c_after record;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  UPDATE public.commissions SET statut = 'paye' WHERE facture_id = r.facture_id;
  SELECT * INTO c_before FROM public.commissions WHERE facture_id = r.facture_id;

  UPDATE public.interventions SET cout_pieces = 300, materiel_confirme = true WHERE id = r.intervention_id;
  SELECT * INTO c_after FROM public.commissions WHERE facture_id = r.facture_id;

  PERFORM pg_temp.assert_eq('matériel modifié après finalisation — base INCHANGÉE', c_before.base_commissionnable, c_after.base_commissionnable);
  PERFORM pg_temp.assert_eq('matériel modifié après finalisation — commission INCHANGÉE', c_before.part_intervenant, c_after.part_intervenant);
  RAISE NOTICE 'OK [matériel modifié après finalisation (paye)] — aucun recalcul, comme attendu';
END $$;


-- ================================================================
-- SÉCURITÉ
-- ================================================================

-- INSERT direct par intervenant refusé
DO $$
DECLARE v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    INSERT INTO public.commissions (intervention_id, intervenant_id, organisation_id, montant_total_client, commission_pct, part_intervenant, commission_admin)
    SELECT id, '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000071', 999999, 20, 999999, 0
    FROM public.interventions WHERE organisation_id = '00000000-0000-0000-0000-000000000071' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [INSERT direct intervenant] — aurait dû être refusé (commissions_insert = WITH CHECK false)';
  END IF;
  RAISE NOTICE 'OK [INSERT direct intervenant] — refusé (montant arbitraire impossible)';
END $$;

-- INSERT direct par admin également refusé (aucune procédure sécurisée exposée à authenticated)
DO $$
DECLARE v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', true);
  SET LOCAL role = 'authenticated';
  BEGIN
    INSERT INTO public.commissions (intervention_id, intervenant_id, organisation_id, montant_total_client, commission_pct, part_intervenant, commission_admin)
    SELECT id, '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000071', 1, 20, 1, 0
    FROM public.interventions WHERE organisation_id = '00000000-0000-0000-0000-000000000071' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  RESET role;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [INSERT direct admin] — aurait dû être refusé (commissions_insert = WITH CHECK false pour tous)';
  END IF;
  RAISE NOTICE 'OK [INSERT direct admin] — refusé également (création exclusivement serveur)';
END $$;

-- Lecture intervenant / admin conservée (non-régression — policies SELECT non touchées)
DO $$
DECLARE r record; v_count int;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', true);
  SET LOCAL role = 'authenticated';
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  RESET role;
  IF v_count <> 1 THEN RAISE EXCEPTION 'ÉCHEC [lecture intervenant] — devrait voir sa propre commission'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', true);
  SET LOCAL role = 'authenticated';
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  RESET role;
  IF v_count <> 1 THEN RAISE EXCEPTION 'ÉCHEC [lecture admin] — devrait voir la commission de son organisation'; END IF;

  -- Cross-tenant : admin d'une autre organisation ne doit rien voir
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000084', true);
  SET LOCAL role = 'authenticated';
  SELECT count(*) INTO v_count FROM public.commissions WHERE facture_id = r.facture_id;
  RESET role;
  IF v_count <> 0 THEN RAISE EXCEPTION 'ÉCHEC [cross-tenant] — admin tierce ne devrait voir aucune commission d''une autre organisation'; END IF;

  RAISE NOTICE 'OK [lecture intervenant/admin conservée, cross-tenant refusé] — policies SELECT non régressées';
END $$;


-- ================================================================
-- HISTORIQUE
-- ================================================================

-- Ligne historique (formule_version IS NULL, ancienne sémantique) : insérée
-- directement (l'ancien trigger n'existe plus) pour simuler l'état réel
-- d'une ligne produite jadis par auto_commission() — jamais touchée par
-- les nouveaux mécanismes.
DO $$
DECLARE
  v_int_id uuid;
  v_hist_id uuid;
  c_before record;
  c_after record;
BEGIN
  INSERT INTO public.interventions (organisation_id, intervenant_id, statut, montant_ttc, cout_pieces, materiel_confirme)
  VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 'termine', 1000, 500, true)
  RETURNING id INTO v_int_id;

  -- Reproduit fidèlement l'ancienne sémantique (pct = part entreprise) —
  -- valeurs qui violeraient certaines contraintes v2 si formule_version=2
  -- (ex. absence des champs v2), mais formule_version IS NULL les rend inapplicables.
  INSERT INTO public.commissions (intervention_id, intervenant_id, organisation_id, montant_total_client, commission_pct, part_intervenant, commission_admin, statut)
  VALUES (v_int_id, '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000071', 1000, 30, 700, 300, 'a_payer')
  RETURNING id INTO v_hist_id;

  SELECT * INTO c_before FROM public.commissions WHERE id = v_hist_id;
  IF c_before.formule_version IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC [fixture historique] — formule_version devrait être NULL par défaut';
  END IF;

  -- Confirme du matériel sur cette intervention (déclenche le trigger de
  -- recalcul matériel) — ne doit RIEN faire puisqu'aucune facture n'est
  -- liée par facture_id (toujours NULL sur les lignes historiques).
  UPDATE public.interventions SET cout_pieces = 999, materiel_confirme = true WHERE id = v_int_id;

  SELECT * INTO c_after FROM public.commissions WHERE id = v_hist_id;
  PERFORM pg_temp.assert_eq('ligne historique — part_intervenant inchangée après modif matériel', c_before.part_intervenant, c_after.part_intervenant);
  PERFORM pg_temp.assert_eq('ligne historique — commission_admin inchangée', c_before.commission_admin, c_after.commission_admin);
  IF c_after.formule_version IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC [ligne historique] — formule_version ne doit jamais être rétro-attribué';
  END IF;
  RAISE NOTICE 'OK [ligne historique formule_version IS NULL] — jamais recalculée, jamais retouchée';
END $$;


-- ================================================================
-- IMMUTABILITÉ
-- ================================================================

-- Commission statut='paye' : champs financiers immuables
DO $$
DECLARE r record; v_failed boolean := false;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  UPDATE public.commissions SET statut = 'paye' WHERE facture_id = r.facture_id;

  BEGIN
    UPDATE public.commissions SET part_intervenant = 1 WHERE facture_id = r.facture_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [immutabilité statut=paye] — la modification aurait dû être refusée';
  END IF;
  RAISE NOTICE 'OK [immutabilité statut=paye] — modification financière refusée comme attendu';
END $$;

-- Commission avec commission_receipts.recue=true : champs financiers immuables
DO $$
DECLARE r record; v_failed boolean := false;
BEGIN
  SELECT * INTO r FROM pg_temp.make_intervention_facture(
    '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000082', 1000, 0, false, 'payee');
  INSERT INTO public.commission_receipts (facture_id, intervention_id, intervenant_id, organisation_id, recue, recue_le)
  VALUES (r.facture_id, r.intervention_id, '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000071', true, now());

  BEGIN
    UPDATE public.commissions SET commission_admin = 1 WHERE facture_id = r.facture_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'ÉCHEC [immutabilité commission_receipts.recue] — la modification aurait dû être refusée';
  END IF;
  RAISE NOTICE 'OK [immutabilité commission_receipts.recue=true] — modification financière refusée comme attendu';

  -- Confirme aussi que le mécanisme de recalcul matériel respecte cette finalisation.
  UPDATE public.interventions SET cout_pieces = 500, materiel_confirme = true WHERE id = r.intervention_id;
  PERFORM 1; -- le trigger de recalcul appelle calculate_commission_for_facture, qui doit no-op silencieusement
END $$;


-- ================================================================
-- Nettoyage explicite (en plus du ROLLBACK global)
-- ================================================================
DELETE FROM public.commission_receipts WHERE organisation_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM public.commissions WHERE organisation_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM public.factures WHERE organisation_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM public.interventions WHERE organisation_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM public.profiles WHERE organisation_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM public.organisations WHERE id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000083', '00000000-0000-0000-0000-000000000084');

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister.
ROLLBACK;
