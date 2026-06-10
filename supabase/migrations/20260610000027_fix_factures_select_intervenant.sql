-- ================================================================
-- MIGRATION : Correctif RLS factures_select — visibilité intervenant
-- Date      : 2026-06-10
-- Problème  : factures_select autorisait uniquement :
--               admin OU created_by = auth.uid()
--             Deux chemins bloqués pour les intervenants :
--               1. useFactures : facture créée par un admin pour
--                  l'intervention de l'intervenant → created_by ≠ uid
--               2. useCommissions : query sur factures via
--                  intervention_id!inner sans filtre created_by
--                  → RLS bloque → commissions vides / erreur
-- Fix       : Ajouter une troisième branche OR :
--               EXISTS (interventions WHERE id = factures.intervention_id
--                       AND organisation_id = factures.organisation_id
--                       AND intervenant_id = auth.uid())
-- Validation :
--   · Le EXISTS sous-interroge interventions soumis à interventions_select
--     (USING : is_same_org AND (is_admin OR intervenant_id = auth.uid())).
--     La clause i.intervenant_id = auth.uid() satisfait directement
--     la branche intervenant_id de interventions_select → pas de blocage.
--   · Si factures.intervention_id IS NULL, EXISTS retourne false,
--     le fallback created_by = auth.uid() couvre ce cas.
--   · Aucune autre policy modifiée.
-- ================================================================

DROP POLICY IF EXISTS "factures_select" ON public.factures;

-- SELECT : même org ET (admin OU créateur OU intervenant lié)
--   · is_admin_in_org : admin voit toutes les factures de son org
--   · created_by = auth.uid() : intervenant voit ses propres factures
--   · EXISTS interventions : intervenant voit les factures dont son
--     intervention est l'intervention_id (cas facture créée par admin)
--     → couvre useCommissions (intervention_id!inner sans filtre created_by)
CREATE POLICY "factures_select" ON public.factures
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.interventions i
        WHERE i.id              = factures.intervention_id
          AND i.organisation_id = factures.organisation_id
          AND i.intervenant_id  = auth.uid()
      )
    )
  );


-- ================================================================
-- VÉRIFICATION
-- ================================================================

-- 1. Policy recréée
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'factures'
ORDER BY cmd;
-- Attendu : factures_select avec EXISTS dans qual

-- 2. Cohérence : toutes les policies factures présentes
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'factures'
ORDER BY cmd;
-- Attendu :
--   factures_delete | DELETE
--   factures_insert | INSERT
--   factures_select | SELECT
--   factures_update | UPDATE
