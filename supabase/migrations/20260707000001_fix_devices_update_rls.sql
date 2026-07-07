-- ================================================================
-- MIGRATION : fix devices_update RLS (WITH CHECK incomplet)
-- Date       : 2026-07-07
-- Problème   : la policy devices_update (créée dans
--              20260610000017_rls_phase1_personal_tables.sql)
--              autorise l'admin dans USING mais pas dans WITH CHECK.
--              Résultat : un admin ne peut pas révoquer/réinitialiser
--              les appareils d'un autre utilisateur de sa propre
--              organisation (403 silencieux côté UPDATE).
-- Correction : ajoute "OR is_admin_in_org(organisation_id)" au
--              WITH CHECK, symétrique à ce qui existe déjà dans
--              USING. Aucune autre policy ni fonction modifiée.
-- Impact     : strictement limité à la table devices, commande UPDATE.
--              current_org_id() / is_admin_in_org() sont calculés
--              côté serveur (SECURITY DEFINER) — pas de valeur
--              cliente injectable. Pas d'accès cross-organisation.
-- ================================================================

DROP POLICY IF EXISTS "devices_update" ON public.devices;

CREATE POLICY "devices_update" ON public.devices
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      user_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      user_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );

-- ================================================================
-- VÉRIFICATION — résultat attendu : 1 ligne, cmd = UPDATE,
--                with_check contenant "is_admin_in_org"
-- ================================================================
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'devices' AND policyname = 'devices_update';
