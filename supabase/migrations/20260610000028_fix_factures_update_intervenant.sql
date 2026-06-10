-- ================================================================
-- MIGRATION : Correctif RLS factures_update — intervenants
-- Date      : 2026-06-10
-- Problème  : factures_update était admin-only (Phase 5 migration 00021).
--             Les intervenants avec canMarkPaid (can_create_documents &&
--             can_bypass_validation) appellent useUpdateFacture() pour
--             marquer une facture comme payée → RLS bloque →
--             0 lignes retournées → "Mise à jour impossible".
-- Fix       : Autoriser UPDATE si :
--               · admin de l'org         → accès total
--               · created_by = auth.uid() → peut modifier ses propres
--                 factures non-clôturées
--               · EXISTS intervention liée → peut modifier les factures
--                 de ses interventions non-clôturées (factures admin)
--             Restriction dans USING : statut_paiement NOT IN
--               ('payee', 'annulee') pour les non-admins → un intervenant
--               ne peut pas rouvrir une facture déjà clôturée.
--             WITH CHECK : org inchangée + même conditions d'appartenance
--               (sans restriction statut : la valeur cible 'payee' doit
--               être autorisée par le CHECK, c'est le USING qui limite
--               l'accès à la ligne source).
-- Autres policies : inchangées.
-- Frontend  : non modifié par cette migration.
-- ================================================================

DROP POLICY IF EXISTS "factures_update" ON public.factures;

-- UPDATE :
--   USING : admin tout / intervenant si non clôturée ET (created_by OU lié)
--   WITH CHECK : org OK + (admin OU created_by OU lié)
CREATE POLICY "factures_update" ON public.factures
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        statut_paiement NOT IN ('payee', 'annulee')
        AND (
          created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.interventions i
            WHERE i.id              = factures.intervention_id
              AND i.organisation_id = factures.organisation_id
              AND i.intervenant_id  = auth.uid()
          )
        )
      )
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.id              = factures.intervention_id
          AND i.organisation_id = factures.organisation_id
          AND i.intervenant_id  = auth.uid()
      )
    )
  );


-- ================================================================
-- VÉRIFICATION
-- ================================================================

-- 1. Policies factures après patch
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'factures'
ORDER BY cmd;
-- Attendu :
--   factures_delete | DELETE
--   factures_insert | INSERT
--   factures_select | SELECT  (migration 00027)
--   factures_update | UPDATE  ← nouvelle policy avec statut NOT IN

-- 2. Cohérence : 4 policies toujours présentes
SELECT COUNT(*) FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'factures';
-- Attendu : 4
