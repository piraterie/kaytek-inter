-- ================================================================
-- MIGRATION : Permissions intervenant — client & RDV depuis un devis
-- Date       : 2026-07-14
-- Objectif   : Aligner la RLS sur les nouvelles capacités intervenant
--              demandées côté devis :
--   · créer un client depuis le formulaire de devis
--   · créer un RDV/intervention depuis un devis (bouton RDV)
-- Ne touche à aucune autre policy (clients_select/update/delete,
-- interventions_select/update/delete inchangées). Le rôle assistant
-- garde exactement ses droits actuels (déjà couvert par
-- can_manage_operations, inchangé ici).
-- ================================================================

-- ================================================================
-- TABLE : clients — INSERT étendu à l'intervenant
-- ================================================================
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR is_intervenant_in_org(current_org_id())
    )
  );

-- ================================================================
-- TABLE : interventions — INSERT étendu à l'intervenant (créateur uniquement)
-- ================================================================
DROP POLICY IF EXISTS "interventions_insert" ON public.interventions;
CREATE POLICY "interventions_insert" ON public.interventions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
  );

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, policyname, cmd, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('clients', 'interventions')
  AND policyname IN ('clients_insert', 'interventions_insert');
