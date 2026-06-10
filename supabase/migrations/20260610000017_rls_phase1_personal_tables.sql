-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 1
-- Tables    : push_subscriptions, devices
-- Date      : 2026-06-10
-- Prérequis : Phase 0 appliquée (current_org_id, is_same_org,
--             is_admin_in_org disponibles en base)
-- Objectif  : Ajouter le filtre organisation_id sur les tables
--             à portée personnelle (uid-scoped).
--             Aucune autre table modifiée.
--             is_admin() non modifié.
-- ================================================================

-- ================================================================
-- TABLE : push_subscriptions
-- ================================================================

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes policies (noms connus d'après migrations précédentes)
DROP POLICY IF EXISTS "push_sub_insert"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_sub_select"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_sub_update"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_sub_delete"  ON public.push_subscriptions;

-- SELECT : uniquement ses propres abonnements dans son org
CREATE POLICY "push_sub_select" ON public.push_subscriptions
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  );

-- INSERT : uniquement pour soi-même dans son org
CREATE POLICY "push_sub_insert" ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND organisation_id = current_org_id()
  );

-- UPDATE : uniquement ses propres abonnements dans son org
CREATE POLICY "push_sub_update" ON public.push_subscriptions
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organisation_id = current_org_id()
  );

-- DELETE : uniquement ses propres abonnements dans son org
CREATE POLICY "push_sub_delete" ON public.push_subscriptions
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  );

-- ================================================================
-- TABLE : devices
-- ================================================================

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues (noms issus des migrations et scripts ad-hoc)
DROP POLICY IF EXISTS "devices_select"      ON public.devices;
DROP POLICY IF EXISTS "devices_insert"      ON public.devices;
DROP POLICY IF EXISTS "devices_update"      ON public.devices;
DROP POLICY IF EXISTS "devices_delete"      ON public.devices;
DROP POLICY IF EXISTS "devices_insert_own"  ON public.devices;
DROP POLICY IF EXISTS "devices_update_own"  ON public.devices;
DROP POLICY IF EXISTS "devices_delete_own"  ON public.devices;

-- SELECT : ses propres appareils OU admin de l'org, dans l'org uniquement
CREATE POLICY "devices_select" ON public.devices
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      user_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );

-- INSERT : uniquement pour soi-même dans son org
CREATE POLICY "devices_insert" ON public.devices
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND organisation_id = current_org_id()
  );

-- UPDATE : ses propres appareils OU admin de l'org ; reste dans l'org
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
    user_id = auth.uid()
    AND organisation_id = current_org_id()
  );

-- DELETE : ses propres appareils OU admin de l'org, dans l'org uniquement
CREATE POLICY "devices_delete" ON public.devices
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND (
      user_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );

-- ================================================================
-- VÉRIFICATION — résultat attendu : 4 lignes push_subscriptions,
--                                   4 lignes devices
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('push_subscriptions', 'devices')
ORDER BY tablename, cmd;
