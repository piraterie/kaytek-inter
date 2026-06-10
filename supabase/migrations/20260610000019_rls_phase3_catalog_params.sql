-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 3
-- Tables    : prestations, parametres_entreprise
-- Date      : 2026-06-10
-- Prérequis : Phase 0 (helpers), Phase 1 (push_subscriptions,
--             devices), Phase 2 (notifications, journal,
--             commission_receipts) appliquées et validées.
-- Objectif  : Fermer les policies trop ouvertes :
--             · prestations  SELECT était auth.uid() IS NOT NULL
--               → tout authentifié lisait le catalogue de toutes
--                 les orgs.
--             · parametres   SELECT était USING (true) dans une
--               version → tout authentifié lisait les paramètres
--               (SIRET, IBAN, email) de toutes les orgs.
--             Les deux tables sont restreintes à is_same_org().
--             Les intervenants gardent accès SELECT (nécessaire
--             pour la génération PDF des devis/factures).
--             is_admin() non modifié.
--             Aucune autre table modifiée.
-- ================================================================


-- ================================================================
-- TABLE : prestations
-- ================================================================

ALTER TABLE public.prestations ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · 20260605000004_rls_role_policies.sql → prestations_*
-- · fix-native-functions-rls.sql         → prestations_*
-- · (idempotence des nouvelles policies)
DROP POLICY IF EXISTS "prestations_select" ON public.prestations;
DROP POLICY IF EXISTS "prestations_insert" ON public.prestations;
DROP POLICY IF EXISTS "prestations_update" ON public.prestations;
DROP POLICY IF EXISTS "prestations_delete" ON public.prestations;

-- SELECT : tout user authentifié de l'org peut lire le catalogue
--          (intervenants en ont besoin pour créer des devis)
CREATE POLICY "prestations_select" ON public.prestations
  FOR SELECT
  USING (
    is_same_org(organisation_id)
  );

-- INSERT : admin de l'org uniquement
CREATE POLICY "prestations_insert" ON public.prestations
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : admin de l'org uniquement, reste dans l'org
CREATE POLICY "prestations_update" ON public.prestations
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "prestations_delete" ON public.prestations
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- TABLE : parametres_entreprise
-- ================================================================

ALTER TABLE public.parametres_entreprise ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql        → params_select/insert/update
-- · fix-native-functions-rls  → params_select/insert/update/delete
-- · 20260605000004            → params_select/insert/update/delete
-- · (idempotence)
DROP POLICY IF EXISTS "params_select" ON public.parametres_entreprise;
DROP POLICY IF EXISTS "params_insert" ON public.parametres_entreprise;
DROP POLICY IF EXISTS "params_update" ON public.parametres_entreprise;
DROP POLICY IF EXISTS "params_delete" ON public.parametres_entreprise;

-- SELECT : tout user de l'org peut lire les paramètres
--          (nécessaire pour : génération PDF, numéro de devis/
--          facture, raison sociale, logo, coordonnées bancaires)
CREATE POLICY "params_select" ON public.parametres_entreprise
  FOR SELECT
  USING (
    is_same_org(organisation_id)
  );

-- INSERT : admin de l'org uniquement (création initiale des params)
CREATE POLICY "params_insert" ON public.parametres_entreprise
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : admin de l'org uniquement, reste dans l'org
CREATE POLICY "params_update" ON public.parametres_entreprise
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "params_delete" ON public.parametres_entreprise
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- VÉRIFICATION — résultats attendus :
--   prestations          : 4 lignes
--   parametres_entreprise: 4 lignes
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('prestations', 'parametres_entreprise')
ORDER BY tablename, cmd;
