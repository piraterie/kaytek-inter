-- ================================================================
-- MIGRATION : Masquage réel des données client partenaire par statut
-- Date       : 2026-07-14
-- Contexte   : pir_select (20260708000005) autorisait la lecture
--              intégrale des colonnes (nom_client_partage, adresse_
--              partagee, telephone_client_partage, ...) dès la
--              création de la demande, quel que soit le statut —
--              une cible pouvait donc lire ces champs avant
--              acceptation, et continuait de le pouvoir même après
--              un refus (aucune expiration d'accès).
-- Correctif  :
--   1. pir_select resserré : l'organisation cible ne lit la ligne
--      brute (donc toutes ses colonnes) qu'une fois la demande
--      'accepted'/'in_progress'/'completed'. L'organisation source
--      garde un accès total à ses propres demandes, quel que soit
--      le statut (nécessaire pour son suivi).
--   2. RPC get_partner_requests_preview(p_status) : aperçu contrôlé
--      pour la cible sur les demandes 'pending'/'refused', sans les
--      colonnes identifiantes (adresse, téléphone, nom client,
--      photos, consignes, source_intervention_id).
-- Effet de bord attendu : pie_select (partner_intervention_events)
-- s'appuie sur un EXISTS non-SECURITY DEFINER vers
-- partner_intervention_requests — le resserrement de pir_select
-- restreint donc aussi, correctement, la fenêtre de visibilité de
-- l'historique d'événements pour la cible.
-- Ne modifie ni le trigger de transition de statut
-- (partner_intervention_requests_before_update), ni les colonnes,
-- ni les autres policies (pir_insert, pir_update, pie_select).
-- ================================================================

-- ── 1. pir_select resserré par statut ────────────────────────────
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

-- ── 2. Aperçu contrôlé pré-décision / post-refus pour la cible ──
CREATE OR REPLACE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id                    uuid,
  connection_id         uuid,
  source_organisation_id uuid,
  type_intervention     text,
  urgence               boolean,
  date_souhaitee        timestamptz,
  ville                 text,
  description_partagee  text,
  montant_partage       numeric,
  status                text,
  note_refus            text,
  created_at            timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
$$;

REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'partner_intervention_requests'
  AND policyname = 'pir_select';

SELECT proname, prosecdef AS security_definer, provolatile
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'get_partner_requests_preview';
