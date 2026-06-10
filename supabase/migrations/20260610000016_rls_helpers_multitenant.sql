-- ================================================================
-- MIGRATION : RLS helpers multi-tenant (Phase 0)
-- Date       : 2026-06-10
-- Objectif   : Créer trois fonctions helper réutilisables par toutes
--              les policies RLS multi-tenant.
--              Ne modifie AUCUNE policy existante.
--              Ne modifie PAS is_admin() existant.
-- Idempotent : CREATE OR REPLACE — sûr à rejouer.
-- ================================================================

-- ── 1. current_org_id() ─────────────────────────────────────────
-- Retourne l'organisation_id du user actuellement authentifié.
-- Retourne NULL si :
--   · auth.uid() est NULL (non authentifié)
--   · le profil n'existe pas
-- Conséquence : toute policy USING/WITH CHECK basée sur cette
-- fonction retourne false pour un user sans profil valide.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organisation_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

-- ── 2. is_same_org(row_org_id uuid) ────────────────────────────
-- Retourne true si la ligne appartient à la même organisation
-- que le user authentifié.
-- Usage dans USING  : is_same_org(organisation_id)
-- Usage dans WITH CHECK : organisation_id = current_org_id()
--   (WITH CHECK préfère la forme directe pour les INSERT/UPDATE)
CREATE OR REPLACE FUNCTION public.is_same_org(row_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id              = auth.uid()
      AND organisation_id = row_org_id
  )
$$;

-- ── 3. is_admin_in_org(org_id uuid) ────────────────────────────
-- Retourne true si le user est admin actif ET appartient à l'org
-- passée en paramètre.
-- Remplace is_admin() dans les policies multi-tenant.
-- is_admin() existant est conservé tel quel (pas de modification).
CREATE OR REPLACE FUNCTION public.is_admin_in_org(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role = 'admin' AND actif = true
      FROM public.profiles
      WHERE id              = auth.uid()
        AND organisation_id = org_id
      LIMIT 1
    ),
    false
  )
$$;
