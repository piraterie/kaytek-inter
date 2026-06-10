-- ================================================================
-- MIGRATION : Correctif RLS devis_update — signature client
-- Date      : 2026-06-10
-- Problème  : WITH CHECK bloquait statut='accepte' pour les
--             intervenants lors de la signature client.
--             La transition envoye → accepte échouait avec
--             "new row violates row-level security policy".
-- Fix       : Autoriser statut='accepte' dans WITH CHECK si
--             signature_client IS NOT NULL ET signature_date IS NOT NULL.
--             Toutes les autres restrictions restent inchangées.
-- Autres tables : aucune.
-- ================================================================

DROP POLICY IF EXISTS "devis_update" ON public.devis;

-- USING   : devis doit être en statut actif AVANT la mise à jour
--           (empêche de modifier un devis déjà accepté/refusé/expiré)
-- WITH CHECK : branche signature ajoutée :
--   un intervenant peut passer à 'accepte' UNIQUEMENT si
--   signature_client et signature_date sont renseignés
CREATE POLICY "devis_update" ON public.devis
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        created_by = auth.uid()
        AND statut IN ('en_attente_validation', 'brouillon', 'envoye')
      )
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        created_by = auth.uid()
        AND (
          statut IN ('en_attente_validation', 'brouillon', 'envoye')
          OR (
            statut           = 'accepte'
            AND signature_client IS NOT NULL
            AND signature_date   IS NOT NULL
          )
        )
      )
    )
  );
