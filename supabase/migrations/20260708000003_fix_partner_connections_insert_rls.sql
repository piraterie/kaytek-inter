-- ================================================================
-- MIGRATION : Fix RLS — partner_connections_insert
-- Date       : 2026-07-08
-- Bug        : la policy INSERT de partner_connections utilisait des
--              sous-requêtes EXISTS directes sur `profiles` et
--              `partner_profiles`. Ces sous-requêtes s'exécutent
--              sous les RLS de l'utilisateur appelant, qui n'a pas
--              le droit de lire les lignes d'une autre organisation
--              (profiles) ou d'un profil partenaire non opt-in
--              (partner_profiles) — la vérification échouait donc
--              silencieusement même pour des données valides.
-- Fix        : deux fonctions SECURITY DEFINER dédiées, sur le même
--              modèle que current_org_id()/is_admin_in_org(), pour
--              contourner la RLS de ces deux tables UNIQUEMENT pour
--              cette vérification d'existence (aucune donnée n'est
--              retournée par ces fonctions, seulement un booléen).
-- Tables     : aucune modification de schéma.
-- ================================================================

CREATE OR REPLACE FUNCTION public.partner_profile_exists(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_profiles WHERE organisation_id = org_id)
$$;

CREATE OR REPLACE FUNCTION public.profile_belongs_to_org(profile_id uuid, org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = profile_id AND organisation_id = org_id)
$$;

DROP POLICY IF EXISTS "partner_connections_insert" ON public.partner_connections;

CREATE POLICY "partner_connections_insert" ON public.partner_connections
  FOR INSERT
  WITH CHECK (
    requester_organisation_id = current_org_id()
    AND requester_profile_id = auth.uid()
    AND is_admin_in_org(current_org_id())
    AND status = 'pending'
    AND target_organisation_id <> current_org_id()
    AND public.partner_profile_exists(target_organisation_id)
    AND (
      target_profile_id IS NULL
      OR public.profile_belongs_to_org(target_profile_id, target_organisation_id)
    )
  );

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partner_connections'
ORDER BY cmd;
