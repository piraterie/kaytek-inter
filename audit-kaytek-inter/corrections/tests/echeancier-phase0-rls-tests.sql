-- ================================================================
-- TESTS LOCAUX — Échéanciers de paiement / acomptes, Phase 0
-- (schéma + RLS + RPC create_echeancier + recalcul automatique des
-- paiements). Couvre : arrondis conformes à l'exemple du cahier des
-- charges (619,08 € / 30 % d'acompte), validations serveur (nombre
-- d'échéances, somme des %, somme des montants, doublon d'échéancier),
-- isolation multi-tenant, cascade paiement -> statut échéance ->
-- statut échéancier, et l'absence de policy DELETE sur paiements/
-- journal_echeancier (suppression toujours logique).
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE (`supabase start`).
-- NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
--
-- Ce fichier N'EST PAS une migration. Fixtures sous le préfixe UUID
-- '20000000-...', dédié à cette suite (distinct des autres suites de
-- tests locaux du dépôt). Tout est enveloppé dans une transaction
-- annulée (ROLLBACK final) : rien ne persiste.
--
-- Simulation de auth.uid() : identique aux autres suites du dépôt
-- (`SET LOCAL role authenticated` + `set_config('request.jwt.claim.sub', ...)`).
-- ================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '=== Préparation des fixtures (org A/B, profils, client, devis 619.08 €) ==='; END $$;

INSERT INTO auth.users (id, email) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'echtest-admin-a@test.local'),
  ('20000000-0000-0000-0000-00000000a002', 'echtest-assistant-a@test.local'),
  ('20000000-0000-0000-0000-00000000a003', 'echtest-intervenant-a-owner@test.local'),
  ('20000000-0000-0000-0000-00000000a004', 'echtest-intervenant-a-other@test.local'),
  ('20000000-0000-0000-0000-00000000b001', 'echtest-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('20000000-0000-0000-0000-0000000000a1', 'echtest-org-a', 'EchTest Org A', 'pro', true),
  ('20000000-0000-0000-0000-0000000000b1', 'echtest-org-b', 'EchTest Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif, can_create_documents, can_bypass_validation) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'echtest-admin-a@test.local',            'EchTest', 'AdminA',      'admin',       '20000000-0000-0000-0000-0000000000a1', true, true,  true),
  ('20000000-0000-0000-0000-00000000a002', 'echtest-assistant-a@test.local',        'EchTest', 'AssistantA',  'assistant',   '20000000-0000-0000-0000-0000000000a1', true, false, false),
  ('20000000-0000-0000-0000-00000000a003', 'echtest-intervenant-a-owner@test.local','EchTest', 'IntervOwner', 'intervenant', '20000000-0000-0000-0000-0000000000a1', true, false, false),
  ('20000000-0000-0000-0000-00000000a004', 'echtest-intervenant-a-other@test.local','EchTest', 'IntervOther', 'intervenant', '20000000-0000-0000-0000-0000000000a1', true, false, false),
  ('20000000-0000-0000-0000-00000000b001', 'echtest-admin-b@test.local',            'EchTest', 'AdminB',      'admin',       '20000000-0000-0000-0000-0000000000b1', true, true,  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clients (id, organisation_id, nom, type, created_by) VALUES
  ('20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-0000000000a1', 'EchTest Client A1', 'particulier', '20000000-0000-0000-0000-00000000a001')
ON CONFLICT (id) DO NOTHING;

-- Devis 619,08 € TTC — reprend exactement l'exemple du cahier des charges.
-- Créé par (et intervenant sur) le profil "IntervOwner" pour tester la RLS
-- fine échéancier <-> propriétaire du devis.
INSERT INTO public.devis (id, organisation_id, client_id, intervenant_id, numero, statut, lignes, total_ht, tva_montant, total_ttc, created_by) VALUES
  ('20000000-0000-0000-0000-00000000d001', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001',
   '20000000-0000-0000-0000-00000000a003', 'ECHTEST-D001', 'accepte', '[]'::jsonb, 500, 119.08, 619.08, '20000000-0000-0000-0000-00000000a003')
ON CONFLICT (id) DO NOTHING;

-- Un second devis, refusé, pour tester le refus de create_echeancier sur devis invalide.
INSERT INTO public.devis (id, organisation_id, client_id, intervenant_id, numero, statut, lignes, total_ht, tva_montant, total_ttc, created_by) VALUES
  ('20000000-0000-0000-0000-00000000d002', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001',
   '20000000-0000-0000-0000-00000000a003', 'ECHTEST-D002', 'refuse', '[]'::jsonb, 100, 20, 120, '20000000-0000-0000-0000-00000000a003')
ON CONFLICT (id) DO NOTHING;

-- ── Helpers d'assertion (repris tels quels du pattern déjà utilisé dans
-- correction-06-google-integrations-rls-tests.sql) ──────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_label text, p_actual anyelement, p_expected anyelement) RETURNS void AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu %, obtenu %', p_label, p_expected, p_actual;
  ELSE
    RAISE NOTICE 'OK [%] — %', p_label, p_actual;
  END IF;
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

CREATE OR REPLACE FUNCTION pg_temp.assert_rpc_denied(p_label text, p_uid uuid, p_sql text) RETURNS void AS $$
DECLARE v_denied boolean := false; v_sqlstate text := 'n/a';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_denied := true;
  END;
  RESET role;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'ÉCHEC [%] — l''appel a réussi alors qu''il devait être refusé', p_label;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%)', p_label, v_sqlstate;
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
    RAISE EXCEPTION 'ÉCHEC [%] — écriture réussie (% ligne(s)) alors qu''elle devait être refusée', p_label, v_rowcount;
  ELSE
    RAISE NOTICE 'OK [%] — refusé (SQLSTATE=%, lignes=%)', p_label, v_sqlstate, v_rowcount;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 1 — create_echeancier() : validations serveur ==='; END $$;

-- Devis refusé -> rejeté.
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier sur devis refusé',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d002'::uuid, 1, 'egale',
    '[{"numero_ordre":1,"libelle":"Paiement intégral","pourcentage":100,"montant_ht":100,"tva_montant":20,"montant_ttc":120,"date_prevue":"2026-08-01"}]'::jsonb
  ) $sql$
);

-- 5 échéances -> rejeté (max 4).
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier avec 5 échéances',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 5, 'egale', '[]'::jsonb
  ) $sql$
);

-- Somme des pourcentages != 100 -> rejeté.
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier avec somme des % != 100',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 2, 'pourcentages',
    '[{"numero_ordre":1,"libelle":"Acompte","pourcentage":30,"montant_ht":150,"tva_montant":35.72,"montant_ttc":185.72,"date_prevue":"2026-08-01"},
      {"numero_ordre":2,"libelle":"Solde","pourcentage":60,"montant_ht":300,"tva_montant":71.63,"montant_ttc":371.63,"date_prevue":"2026-09-01"}]'::jsonb
  ) $sql$
);

-- Somme des montants TTC != TTC du devis -> rejeté.
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier avec somme TTC != devis',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 2, 'pourcentages',
    '[{"numero_ordre":1,"libelle":"Acompte","pourcentage":30,"montant_ht":150,"tva_montant":35.72,"montant_ttc":185.72,"date_prevue":"2026-08-01"},
      {"numero_ordre":2,"libelle":"Solde","pourcentage":70,"montant_ht":300,"tva_montant":71.63,"montant_ttc":371.63,"date_prevue":"2026-09-01"}]'::jsonb
  ) $sql$
);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 2 — create_echeancier() : RLS par rôle ==='; END $$;

-- Assistant : ne peut pas créer d'échéancier (donnée financière, cf. SEC-01).
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier — assistant A refusé',
  '20000000-0000-0000-0000-00000000a002'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 1, 'egale',
    '[{"numero_ordre":1,"libelle":"Paiement intégral","pourcentage":100,"montant_ht":500,"tva_montant":119.08,"montant_ttc":619.08,"date_prevue":"2026-08-01"}]'::jsonb
  ) $sql$
);

-- Intervenant NON propriétaire du devis : refusé.
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier — intervenant non propriétaire refusé',
  '20000000-0000-0000-0000-00000000a004'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 1, 'egale',
    '[{"numero_ordre":1,"libelle":"Paiement intégral","pourcentage":100,"montant_ht":500,"tva_montant":119.08,"montant_ttc":619.08,"date_prevue":"2026-08-01"}]'::jsonb
  ) $sql$
);

-- Admin d'une AUTRE organisation : le devis n'est pas visible via RLS ->
-- "Devis introuvable" côté RPC (pas de fuite d'existence cross-org).
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier — admin org B (cross-org) refusé',
  '20000000-0000-0000-0000-00000000b001'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 1, 'egale',
    '[{"numero_ordre":1,"libelle":"Paiement intégral","pourcentage":100,"montant_ht":500,"tva_montant":119.08,"montant_ttc":619.08,"date_prevue":"2026-08-01"}]'::jsonb
  ) $sql$
);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 3 — create_echeancier() : chemin nominal, exemple exact du cahier des charges ==='; END $$;

DO $$
DECLARE
  v_echeancier_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';

  SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 2, 'pourcentages',
    '[{"numero_ordre":1,"libelle":"Acompte","pourcentage":30,"montant_ht":150,"tva_montant":35.72,"montant_ttc":185.72,"date_prevue":"2026-08-01"},
      {"numero_ordre":2,"libelle":"Solde","pourcentage":70,"montant_ht":350,"tva_montant":83.36,"montant_ttc":433.36,"date_prevue":"2026-09-01"}]'::jsonb
  ) INTO v_echeancier_id;

  RESET role;

  IF v_echeancier_id IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC — create_echeancier n''a renvoyé aucun id';
  END IF;

  -- Rend l'id accessible aux blocs suivants via une table temporaire.
  CREATE TEMP TABLE echtest_ctx (echeancier_id uuid);
  INSERT INTO echtest_ctx VALUES (v_echeancier_id);
  GRANT SELECT ON echtest_ctx TO authenticated;

  RAISE NOTICE 'OK [create_echeancier chemin nominal] — échéancier créé %', v_echeancier_id;
END;
$$;

-- Vérifie les montants exacts de l'exemple du cahier des charges (619,08 € / 30%).
SELECT pg_temp.assert_eq('echeance 1 (acompte) montant_ttc', montant_ttc, 185.72::numeric)
  FROM public.echeances e JOIN echtest_ctx c ON c.echeancier_id = e.echeancier_id WHERE e.numero_ordre = 1;
SELECT pg_temp.assert_eq('echeance 2 (solde) montant_ttc', montant_ttc, 433.36::numeric)
  FROM public.echeances e JOIN echtest_ctx c ON c.echeancier_id = e.echeancier_id WHERE e.numero_ordre = 2;
SELECT pg_temp.assert_eq('somme des échéances = TTC devis (aucun écart d''arrondi)',
  (SELECT sum(montant_ttc) FROM public.echeances e JOIN echtest_ctx c ON c.echeancier_id = e.echeancier_id), 619.08::numeric);
SELECT pg_temp.assert_eq('libellés par défaut (Acompte / Solde)',
  (SELECT array_agg(libelle ORDER BY numero_ordre) FROM public.echeances e JOIN echtest_ctx c ON c.echeancier_id = e.echeancier_id),
  ARRAY['Acompte', 'Solde']);
SELECT pg_temp.assert_eq('échéancier statut initial = a_facturer',
  (SELECT statut FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 'a_facturer');

-- Un échéancier actif existe déjà pour ce devis -> une seconde création est refusée.
SELECT pg_temp.assert_rpc_denied(
  'create_echeancier — refus si échéancier déjà actif pour ce devis',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  $sql$ SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d001'::uuid, 1, 'egale',
    '[{"numero_ordre":1,"libelle":"Paiement intégral","pourcentage":100,"montant_ht":500,"tva_montant":119.08,"montant_ttc":619.08,"date_prevue":"2026-08-01"}]'::jsonb
  ) $sql$
);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 4 — RLS SELECT sur echeanciers/echeances ==='; END $$;

SELECT pg_temp.assert_visible_count('echeanciers — admin A voit', '20000000-0000-0000-0000-00000000a001'::uuid,
  format('SELECT count(*) FROM public.echeanciers WHERE id = %L', (SELECT echeancier_id FROM echtest_ctx)), 1);
SELECT pg_temp.assert_visible_count('echeanciers — intervenant propriétaire voit', '20000000-0000-0000-0000-00000000a003'::uuid,
  format('SELECT count(*) FROM public.echeanciers WHERE id = %L', (SELECT echeancier_id FROM echtest_ctx)), 1);
SELECT pg_temp.assert_visible_count('echeanciers — intervenant NON propriétaire ne voit pas', '20000000-0000-0000-0000-00000000a004'::uuid,
  format('SELECT count(*) FROM public.echeanciers WHERE id = %L', (SELECT echeancier_id FROM echtest_ctx)), 0);
SELECT pg_temp.assert_visible_count('echeanciers — assistant A ne voit pas', '20000000-0000-0000-0000-00000000a002'::uuid,
  format('SELECT count(*) FROM public.echeanciers WHERE id = %L', (SELECT echeancier_id FROM echtest_ctx)), 0);
SELECT pg_temp.assert_visible_count('echeanciers — admin org B (cross-org) ne voit pas', '20000000-0000-0000-0000-00000000b001'::uuid,
  format('SELECT count(*) FROM public.echeanciers WHERE id = %L', (SELECT echeancier_id FROM echtest_ctx)), 0);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 5 — paiements : RLS + recalcul automatique en cascade ==='; END $$;

-- Assistant : refusé à l'écriture d'un paiement.
SELECT pg_temp.assert_write_denied(
  'paiements insert — assistant A refusé',
  '20000000-0000-0000-0000-00000000a002'::uuid,
  format($sql$ INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, montant, date_paiement, mode_paiement, created_by)
    SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d001',
           e.echeancier_id, ec.id, 100, current_date, 'virement', '20000000-0000-0000-0000-00000000a002'
    FROM echtest_ctx e JOIN public.echeances ec ON ec.echeancier_id = e.echeancier_id AND ec.numero_ordre = 1 $sql$)
);

-- Intervenant non propriétaire : refusé.
SELECT pg_temp.assert_write_denied(
  'paiements insert — intervenant non propriétaire refusé',
  '20000000-0000-0000-0000-00000000a004'::uuid,
  format($sql$ INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, montant, date_paiement, mode_paiement, created_by)
    SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d001',
           e.echeancier_id, ec.id, 100, current_date, 'virement', '20000000-0000-0000-0000-00000000a004'
    FROM echtest_ctx e JOIN public.echeances ec ON ec.echeancier_id = e.echeancier_id AND ec.numero_ordre = 1 $sql$)
);

-- Paiement PARTIEL de l'acompte (100 € sur 185,72 €) par l'intervenant propriétaire -> succès + cascade.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, montant, date_paiement, mode_paiement, created_by)
  SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d001',
         e.echeancier_id, ec.id, 100, current_date, 'virement', '20000000-0000-0000-0000-00000000a003'
  FROM echtest_ctx e JOIN public.echeances ec ON ec.echeancier_id = e.echeancier_id AND ec.numero_ordre = 1;
  RESET role;
END;
$$;

SELECT pg_temp.assert_eq('echeance 1 après paiement partiel — montant_paye',
  (SELECT montant_paye FROM public.echeances ec JOIN echtest_ctx c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 100::numeric);
SELECT pg_temp.assert_eq('echeance 1 après paiement partiel — montant_restant',
  (SELECT montant_restant FROM public.echeances ec JOIN echtest_ctx c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 85.72::numeric);
SELECT pg_temp.assert_eq('echeance 1 après paiement partiel — statut',
  (SELECT statut FROM public.echeances ec JOIN echtest_ctx c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 'paiement_partiel');
SELECT pg_temp.assert_eq('échéancier après paiement partiel d''une échéance — statut cascade',
  (SELECT statut FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 'paiement_partiel');
SELECT pg_temp.assert_eq('échéancier après paiement partiel — montant_paye total',
  (SELECT montant_paye FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 100::numeric);

-- Complète l'échéance 1 (85,72 € restants) -> passe à 'paye'.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, montant, date_paiement, mode_paiement, created_by)
  SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d001',
         e.echeancier_id, ec.id, 85.72, current_date, 'virement', '20000000-0000-0000-0000-00000000a003'
  FROM echtest_ctx e JOIN public.echeances ec ON ec.echeancier_id = e.echeancier_id AND ec.numero_ordre = 1;
  RESET role;
END;
$$;

SELECT pg_temp.assert_eq('echeance 1 totalement payée — statut', (SELECT statut FROM public.echeances ec JOIN echtest_ctx c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 'paye');
SELECT pg_temp.assert_eq('echeance 1 totalement payée — montant_restant', (SELECT montant_restant FROM public.echeances ec JOIN echtest_ctx c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 0::numeric);
SELECT pg_temp.assert_eq('échéancier — échéance 2 pas encore payée -> statut reste paiement_partiel',
  (SELECT statut FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 'paiement_partiel');

-- Paye intégralement le solde (433,36 €) -> échéancier passe à 'paye', reste à payer = 0.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, montant, date_paiement, mode_paiement, created_by)
  SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d001',
         e.echeancier_id, ec.id, 433.36, current_date, 'virement', '20000000-0000-0000-0000-00000000a003'
  FROM echtest_ctx e JOIN public.echeances ec ON ec.echeancier_id = e.echeancier_id AND ec.numero_ordre = 2;
  RESET role;
END;
$$;

SELECT pg_temp.assert_eq('échéancier totalement payé — statut', (SELECT statut FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 'paye');
SELECT pg_temp.assert_eq('échéancier totalement payé — montant_restant', (SELECT montant_restant FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 0::numeric);
SELECT pg_temp.assert_eq('échéancier totalement payé — montant_paye = TTC devis', (SELECT montant_paye FROM public.echeanciers e JOIN echtest_ctx c ON c.echeancier_id = e.id), 619.08::numeric);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 6 — aucune suppression réelle possible sur paiements/journal (traçabilité) ==='; END $$;

-- Aucune policy DELETE définie sur paiements : même l'admin ne peut pas
-- supprimer réellement une ligne (deny-by-default), la suppression doit
-- passer par UPDATE deleted_at (soft delete applicatif).
SELECT pg_temp.assert_write_denied(
  'paiements — DELETE réel toujours refusé, y compris pour l''admin',
  '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$ DELETE FROM public.paiements WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1' $sql$
);

SELECT pg_temp.assert_write_denied(
  'journal_echeancier — DELETE toujours refusé (audit immuable)',
  '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$ DELETE FROM public.journal_echeancier WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1' $sql$
);
SELECT pg_temp.assert_write_denied(
  'journal_echeancier — UPDATE toujours refusé (audit immuable)',
  '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$ UPDATE public.journal_echeancier SET action = 'modifie' WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1' $sql$
);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 7 — auto_expire_impayes() réservée à service_role ==='; END $$;

SELECT pg_temp.assert_rpc_denied(
  'auto_expire_impayes — admin authenticated refusé (service_role uniquement)',
  '20000000-0000-0000-0000-00000000a001'::uuid,
  $sql$ SELECT public.auto_expire_impayes() $sql$
);

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 8 — generate_facture_echeance() : type de facture, numérotation, cascade ==='; END $$;

INSERT INTO public.devis (id, organisation_id, client_id, intervenant_id, numero, statut, lignes, total_ht, tva_montant, total_ttc, created_by) VALUES
  ('20000000-0000-0000-0000-00000000d003', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001',
   '20000000-0000-0000-0000-00000000a003', 'ECHTEST-D003', 'accepte', '[]'::jsonb, 250, 50, 300, '20000000-0000-0000-0000-00000000a003')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_sched_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  SELECT public.create_echeancier(
    '20000000-0000-0000-0000-00000000d003'::uuid, 3, 'egale',
    '[{"numero_ordre":1,"libelle":"Acompte","pourcentage":33.33,"montant_ht":83.33,"tva_montant":16.67,"montant_ttc":100,"date_prevue":"2026-11-01"},
      {"numero_ordre":2,"libelle":"Échéance 2","pourcentage":33.33,"montant_ht":83.33,"tva_montant":16.67,"montant_ttc":100,"date_prevue":"2026-12-01"},
      {"numero_ordre":3,"libelle":"Solde","pourcentage":33.34,"montant_ht":83.34,"tva_montant":16.66,"montant_ttc":100,"date_prevue":"2027-01-01"}]'::jsonb
  ) INTO v_sched_id;
  RESET role;
  CREATE TEMP TABLE echtest_ctx3 (echeancier_id uuid);
  INSERT INTO echtest_ctx3 VALUES (v_sched_id);
  GRANT SELECT ON echtest_ctx3 TO authenticated;
END;
$$;

-- Assistant refusé (RLS echeances_select ne lui renvoie aucune ligne -> "introuvable").
SELECT pg_temp.assert_rpc_denied(
  'generate_facture_echeance — assistant refusé',
  '20000000-0000-0000-0000-00000000a002'::uuid,
  format($sql$ SELECT public.generate_facture_echeance(
    (SELECT id FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1)
  ) $sql$)
);

-- Génère la facture de l'échéance 1 (acompte) — chemin nominal.
DO $$
DECLARE v_facture_id uuid; v_ech_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  SELECT id INTO v_ech_id FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1;
  SELECT public.generate_facture_echeance(v_ech_id) INTO v_facture_id;
  RESET role;
  CREATE TEMP TABLE echtest_facture1 (facture_id uuid);
  INSERT INTO echtest_facture1 VALUES (v_facture_id);
  GRANT SELECT ON echtest_facture1 TO authenticated;
END;
$$;

SELECT pg_temp.assert_eq('facture échéance 1 — type_facture', (SELECT type_facture FROM public.factures f JOIN echtest_facture1 c ON c.facture_id = f.id), 'acompte');
SELECT pg_temp.assert_eq('facture échéance 1 — montant_ttc = montant de l''échéance (pas le total devis)',
  (SELECT montant_ttc FROM public.factures f JOIN echtest_facture1 c ON c.facture_id = f.id), 100::numeric);
SELECT pg_temp.assert_eq('facture échéance 1 — numéro au format FAC-YYYY-NNN',
  (SELECT numero ~ '^FAC-[0-9]{4}-[0-9]{3}$' FROM public.factures f JOIN echtest_facture1 c ON c.facture_id = f.id), true);
SELECT pg_temp.assert_eq('échéance 1 — facture_id renseigné et statut hors a_facturer',
  (SELECT ec.facture_id IS NOT NULL AND ec.statut IN ('en_attente_paiement', 'en_retard')
   FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), true);
SELECT pg_temp.assert_eq('échéancier — cascade statut = en_attente_paiement (1 facturée, 2 encore à facturer)',
  (SELECT statut FROM public.echeanciers e JOIN echtest_ctx3 c ON c.echeancier_id = e.id), 'en_attente_paiement');

-- Deuxième appel sur la même échéance (déjà facturée) -> refusé.
SELECT pg_temp.assert_rpc_denied(
  'generate_facture_echeance — refus si l''échéance a déjà une facture',
  '20000000-0000-0000-0000-00000000a003'::uuid,
  format($sql$ SELECT public.generate_facture_echeance(
    (SELECT id FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1)
  ) $sql$)
);

-- Génère la facture de l'échéance 3 (dernière) -> doit être typée 'solde'.
DO $$
DECLARE v_facture_id uuid; v_ech_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  SELECT id INTO v_ech_id FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 3;
  SELECT public.generate_facture_echeance(v_ech_id) INTO v_facture_id;
  RESET role;
  CREATE TEMP TABLE echtest_facture3 (facture_id uuid);
  INSERT INTO echtest_facture3 VALUES (v_facture_id);
END;
$$;
SELECT pg_temp.assert_eq('facture échéance 3 (dernière) — type_facture = solde',
  (SELECT type_facture FROM public.factures f JOIN echtest_facture3 c ON c.facture_id = f.id), 'solde');

DO $$ BEGIN RAISE NOTICE '=== SCÉNARIO 9 — paiements : trop-perçu et enregistrement via l''app ==='; END $$;

-- Paiement intégral de l'échéance 1 (déjà facturée) — doit passer à 'paye'.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000a003', true);
  SET LOCAL role = 'authenticated';
  INSERT INTO public.paiements (organisation_id, client_id, devis_id, echeancier_id, echeance_id, facture_id, montant, date_paiement, mode_paiement, created_by)
  SELECT '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000d003',
         ec.echeancier_id, ec.id, f.facture_id, 100, current_date, 'cb', '20000000-0000-0000-0000-00000000a003'
  FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id
  CROSS JOIN echtest_facture1 f
  WHERE ec.numero_ordre = 1;
  RESET role;
END;
$$;
SELECT pg_temp.assert_eq('échéance 1 payée intégralement après facturation — statut',
  (SELECT statut FROM public.echeances ec JOIN echtest_ctx3 c ON c.echeancier_id = ec.echeancier_id WHERE ec.numero_ordre = 1), 'paye');

DO $$ BEGIN RAISE NOTICE '=== TOUS LES TESTS ONT RÉUSSI ==='; END $$;

ROLLBACK;
