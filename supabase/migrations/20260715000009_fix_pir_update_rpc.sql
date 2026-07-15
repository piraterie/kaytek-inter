-- ================================================================
-- MIGRATION : Correction définitive du bug pir_update
-- Date       : 2026-07-15
--
-- CAUSE RÉELLE (confirmée empiriquement, testée avec USING(true) isolé
-- sur pir_update seul puis sur pir_select+pir_update ensemble) :
-- PostgreSQL exige qu'une ligne soit visible via la policy SELECT de
-- la table pour être matchable par un UPDATE — même quand une policy
-- UPDATE dédiée l'autoriserait seule. Ce n'est pas un bug de
-- configuration : c'est le comportement documenté de Postgres RLS
-- (la policy SELECT sert de filtre de base pour "quelles lignes
-- existent" avant que le filtre UPDATE ne s'applique).
--
-- Or pir_select (20260714000002) masque délibérément les lignes
-- 'pending' à l'organisation cible (c'est l'objectif du masquage :
-- ne pas exposer les données confidentielles avant acceptation).
-- Conséquence directe : la cible ne peut plus non plus METTRE À JOUR
-- (accepter/refuser) une ligne qu'elle ne peut plus SELECT — un
-- conflit structurel entre "masquer avant décision" et "permettre la
-- décision", qu'aucune policy RLS pure ne peut résoudre : autoriser
-- assez de SELECT pour permettre l'UPDATE reviendrait à exposer les
-- colonnes confidentielles, ce qui est précisément ce qu'on veut
-- éviter.
--
-- CORRECTIF :
--   1. pir_select : remise à sa forme correcte (masquage par statut).
--   2. pir_update : remise à sa forme correcte (org membre + admin) —
--      reste valide pour les transitions où la cible a déjà accès en
--      lecture (accepted → in_progress → completed) et pour toutes
--      les transitions côté source (qui a toujours accès complet).
--   3. Nouvelle RPC SECURITY DEFINER dédiée à la SEULE transition
--      bloquée par ce conflit (pending → accepted/refused par la
--      cible) : bypasse RLS en interne mais revalide elle-même
--      identité, organisation, statut actuel et transition autorisée
--      — au moins aussi strict que la policy + le trigger existant.
-- ================================================================

-- ── 1. pir_select — remise en forme (masquage par statut) ────────
DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    current_org_id() = source_organisation_id
    OR (
      current_org_id() = target_organisation_id
      AND status IN ('accepted', 'in_progress', 'completed')
    )
  );

-- ── 2. pir_update — remise en forme (org membre + admin) ─────────
DROP POLICY IF EXISTS "pir_update" ON public.partner_intervention_requests;
CREATE POLICY "pir_update" ON public.partner_intervention_requests
  FOR UPDATE
  USING (
    (current_org_id() = source_organisation_id OR current_org_id() = target_organisation_id)
    AND is_admin_in_org(current_org_id())
  )
  WITH CHECK (
    (current_org_id() = source_organisation_id OR current_org_id() = target_organisation_id)
    AND is_admin_in_org(current_org_id())
  );

-- ── 3. RPC dédiée pending → accepted/refused ──────────────────────
-- Revalide tout elle-même (SECURITY DEFINER = bypass RLS interne) :
--   · appelant authentifié, admin de son organisation ;
--   · appelant = organisation CIBLE de la ligne (jamais la source) ;
--   · statut actuel de la ligne = 'pending' (une ligne déjà acceptée/
--     refusée/annulée ne peut plus être re-répondue — pas de règle
--     explicite pour ça, donc refusé par défaut) ;
--   · motif de refus obligatoire si réponse = 'refused'.
-- Le trigger existant (partner_intervention_requests_before_update)
-- s'exécute quand même (les triggers ne sont jamais court-circuités
-- par SECURITY DEFINER ni par le bypass RLS) : défense en profondeur,
-- revalide indépendamment la même transition.
-- Retour masqué : les colonnes confidentielles ne sont incluses que
-- si la réponse est 'accepted' — jamais en cas de refus.
CREATE OR REPLACE FUNCTION public.respond_to_partner_intervention_request(
  p_id uuid,
  p_response text,
  p_note_refus text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, connection_id uuid, source_organisation_id uuid, target_organisation_id uuid,
  status text, type_intervention text, urgence boolean, date_souhaitee timestamptz, ville text,
  adresse_partagee text, telephone_client_partage text, nom_client_partage text,
  description_partagee text, consignes_partagees text, montant_partage numeric,
  photos_partagees jsonb, note_refus text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      public.partner_intervention_requests;
  v_caller_org uuid;
BEGIN
  IF p_response NOT IN ('accepted', 'refused') THEN
    RAISE EXCEPTION 'Réponse invalide : % (attendu accepted ou refused)', p_response;
  END IF;

  v_caller_org := public.current_org_id();
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Organisation introuvable pour l''utilisateur courant';
  END IF;

  IF NOT public.is_admin_in_org(v_caller_org) THEN
    RAISE EXCEPTION 'Seul un administrateur peut répondre à une demande partenaire';
  END IF;

  SELECT * INTO v_row FROM public.partner_intervention_requests r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF v_row.target_organisation_id <> v_caller_org THEN
    RAISE EXCEPTION 'Seule l''organisation destinataire peut répondre à cette demande';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Cette demande n''est plus en attente (statut actuel : %)', v_row.status;
  END IF;

  IF p_response = 'refused' AND (p_note_refus IS NULL OR length(trim(p_note_refus)) = 0) THEN
    RAISE EXCEPTION 'Un motif de refus est requis';
  END IF;

  UPDATE public.partner_intervention_requests r
  SET status = p_response,
      note_refus = CASE WHEN p_response = 'refused' THEN p_note_refus ELSE NULL END
  WHERE r.id = p_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.connection_id, v_row.source_organisation_id, v_row.target_organisation_id,
    v_row.status, v_row.type_intervention, v_row.urgence, v_row.date_souhaitee, v_row.ville,
    CASE WHEN v_row.status = 'accepted' THEN v_row.adresse_partagee ELSE NULL END,
    CASE WHEN v_row.status = 'accepted' THEN v_row.telephone_client_partage ELSE NULL END,
    CASE WHEN v_row.status = 'accepted' THEN v_row.nom_client_partage ELSE NULL END,
    v_row.description_partagee,
    CASE WHEN v_row.status = 'accepted' THEN v_row.consignes_partagees ELSE NULL END,
    v_row.montant_partage,
    CASE WHEN v_row.status = 'accepted' THEN v_row.photos_partagees ELSE NULL END,
    v_row.note_refus, v_row.created_at, v_row.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_partner_intervention_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_partner_intervention_request(uuid, text, text) TO authenticated;

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='partner_intervention_requests'
ORDER BY policyname;

SELECT proname, prosecdef AS security_definer
FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname='respond_to_partner_intervention_request';
