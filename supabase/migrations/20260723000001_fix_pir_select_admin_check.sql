-- ================================================================
-- MIGRATION : Correction 3 — RLS-01 : restauration du contrôle
--             admin manquant sur pir_select
-- Date       : 2026-07-23
-- ================================================================
-- Contexte (voir audit-kaytek-inter/phase-03-supabase-rls.md et
-- audit-kaytek-inter/corrections/correction-03-rls-partenaires.md
-- pour l'analyse complète) :
--
-- La policy "pir_select" sur public.partner_intervention_requests a
-- été créée sans aucune vérification de rôle
-- (20260708000005_partner_intervention_requests_phase3.sql), puis
-- corrigée le même jour par SEC-05
-- (20260708000008_security_phase1_critical_hardening.sql) qui a
-- ajouté is_admin_in_org(current_org_id()) — cohérent avec les 5
-- autres tables du réseau partenaires (partner_profiles,
-- partner_connections, partner_connection_events, partner_messages,
-- partner_intervention_events), toutes strictement admin-only.
--
-- Six jours plus tard, 20260714000002_partner_request_status_gating.sql
-- a recréé intégralement pir_select pour ajouter un masquage par
-- statut (objectif légitime et toujours souhaité), mais en réécrivant
-- la condition depuis la version PRÉ-SEC-05 plutôt qu'en ajoutant sa
-- nouvelle condition par AND à la version sécurisée — perdant
-- silencieusement is_admin_in_org(). 20260715000009_fix_pir_update_rpc.sql
-- (qui corrigeait par ailleurs un bug réel et distinct sur pir_update,
-- correctement résolu) a recréé pir_select à l'identique de cette
-- régression plutôt que de restaurer la version SEC-05, la pérennisant
-- jusqu'à ce jour.
--
-- Effet de la régression : tout membre authentifié non-admin
-- (assistant, intervenant) de l'organisation source pouvait lire
-- l'intégralité des colonnes de ses propres demandes envoyées (quel
-- que soit leur statut), et tout membre non-admin de l'organisation
-- cible pouvait les lire dès que la demande passait à
-- accepted/in_progress/completed — alors que la page /partenaires
-- est strictement réservée aux admins côté frontend (Guard adminOnly)
-- et que SEC-05 avait explicitement voulu la même restriction côté
-- serveur.
--
-- Portée STRICTE de cette migration : uniquement pir_select.
-- pir_insert, pir_update, les triggers, respond_to_partner_intervention_
-- request(), get_partner_requests_preview(), les autres tables
-- partner_*, les helpers existants et toute donnée existante restent
-- intégralement inchangés. Le masquage par statut déjà en place pour
-- l'organisation cible (accepted/in_progress/completed) est conservé
-- à l'identique — seule la condition de rôle admin est réintégrée,
-- par un AND supplémentaire, exactement comme pour les 5 tables
-- sœurs depuis SEC-05.
--
-- Note connexe (non traitée ici, voir RLS-07 dans le rapport de
-- correction) : get_partner_requests_preview() n'appelle jamais
-- is_admin_in_org() et reste donc accessible à authenticated sans
-- restriction de rôle — à corriger séparément, immédiatement après
-- cette correction.
-- ================================================================

DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;

CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    public.is_admin_in_org(public.current_org_id())
    AND (
      public.current_org_id() = source_organisation_id
      OR (
        public.current_org_id() = target_organisation_id
        AND status IN ('accepted', 'in_progress', 'completed')
      )
    )
  );


-- ================================================================
-- ASSERTIONS STATIQUES (schéma uniquement — aucune dépendance à un
-- utilisateur, une organisation ou une demande réelle)
-- ================================================================
DO $$
DECLARE
  v_qual text;
  v_count int;
BEGIN
  -- 1. pir_select existe et sa condition contient bien is_admin_in_org.
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'partner_intervention_requests' AND policyname = 'pir_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'Assertion échouée : la policy pir_select n''existe pas après la migration';
  END IF;

  IF v_qual NOT LIKE '%is_admin_in_org%' THEN
    RAISE EXCEPTION 'Assertion échouée : pir_select ne référence pas is_admin_in_org (USING: %)', v_qual;
  END IF;

  -- 2. Contrôle organisation source toujours présent.
  IF v_qual NOT LIKE '%source_organisation_id%' THEN
    RAISE EXCEPTION 'Assertion échouée : pir_select ne référence plus source_organisation_id (USING: %)', v_qual;
  END IF;

  -- 3. Contrôle organisation cible toujours présent.
  IF v_qual NOT LIKE '%target_organisation_id%' THEN
    RAISE EXCEPTION 'Assertion échouée : pir_select ne référence plus target_organisation_id (USING: %)', v_qual;
  END IF;

  -- 4. Masquage par statut toujours présent (les 3 statuts autorisés).
  IF v_qual NOT LIKE '%accepted%' OR v_qual NOT LIKE '%in_progress%' OR v_qual NOT LIKE '%completed%' THEN
    RAISE EXCEPTION 'Assertion échouée : pir_select ne référence plus les 3 statuts accepted/in_progress/completed (USING: %)', v_qual;
  END IF;

  -- 5. pir_insert et pir_update existent toujours (non supprimées par erreur).
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'partner_intervention_requests'
    AND policyname IN ('pir_insert', 'pir_update');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Assertion échouée : pir_insert et/ou pir_update manquantes après la migration (trouvé %)', v_count;
  END IF;

  -- 6. Exactement 3 policies sur la table (select/insert/update) — aucune
  -- policy supplémentaire inattendue créée par cette migration.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'partner_intervention_requests';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Assertion échouée : 3 policies attendues sur partner_intervention_requests, trouvé %', v_count;
  END IF;

  RAISE NOTICE 'Correction 3 (RLS-01) : toutes les assertions statiques ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partner_intervention_requests'
ORDER BY policyname;
