-- ================================================================
-- MIGRATION : Rôle "assistant" — Phase 1 (fondations)
-- Date       : 2026-07-08
-- Objectif   : Ajouter un 3e rôle utilisateur "assistant" — accès
--              opérationnel (clients, interventions, photos) sans
--              accès aux données financières (devis, factures,
--              commissions, journal, paramètres entreprise, réseau
--              partenaires, catalogue, utilisateurs).
--
-- Portée stricte de cette migration :
--   1. Élargir le CHECK sur `role` à 'assistant' sur 3 tables
--      (profiles, guide_progress, guide_videos — ces 2 dernières
--      restent inertes tant qu'aucun contenu assistant n'existe).
--   2. Créer 2 helpers : is_assistant_in_org(), can_manage_operations().
--   3. Étendre UNIQUEMENT les branches SELECT/INSERT/UPDATE de
--      clients / interventions / photos (is_admin_in_org →
--      can_manage_operations). DELETE reste admin uniquement partout.
--
-- AUCUNE autre table touchée : devis, factures, commissions,
-- commission_receipts, journal, prestations, parametres_entreprise,
-- messages, notifications, profiles (policies), partner_* —
-- zéro changement. Aucune donnée financière n'est exposée par
-- cette migration.
-- Idempotent : DO $$ ... $$ dynamique pour les contraintes (noms
-- auto-générés non connus à l'avance), CREATE OR REPLACE pour les
-- fonctions, DROP POLICY IF EXISTS pour les policies.
-- ================================================================


-- ================================================================
-- 1. CONTRAINTES CHECK — ajout de 'assistant'
-- ================================================================
-- Recherche dynamique du nom de contrainte CHECK existante sur la
-- colonne `role` de chaque table (noms auto-générés par Postgres,
-- jamais renommés dans les migrations précédentes).

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'profiles' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%role%IN%'
  ORDER BY con.conname LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'intervenant', 'assistant'));
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'guide_progress' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%role%IN%'
  ORDER BY con.conname LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guide_progress DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.guide_progress
    ADD CONSTRAINT guide_progress_role_check CHECK (role IN ('admin', 'intervenant', 'assistant'));
END $$;

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'guide_videos' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%role%IN%'
  ORDER BY con.conname LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guide_videos DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.guide_videos
    ADD CONSTRAINT guide_videos_role_check CHECK (role IN ('admin', 'intervenant', 'assistant'));
END $$;


-- ================================================================
-- 2. HELPERS RLS
-- ================================================================

-- is_assistant_in_org() : même modèle que is_admin_in_org() (Phase 0
-- multi-tenant, 20260610000016) — inchangée, non modifiée ici.
CREATE OR REPLACE FUNCTION public.is_assistant_in_org(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role = 'assistant' AND actif = true
      FROM public.profiles
      WHERE id = auth.uid() AND organisation_id = org_id
      LIMIT 1
    ),
    false
  )
$$;

-- can_manage_operations() : accès opérationnel (clients/interventions/
-- photos) — admin OU assistant. Un seul helper "capacité" plutôt que
-- deux redondants (is_admin_or_assistant_in_org proposé initialement
-- fusionné ici).
CREATE OR REPLACE FUNCTION public.can_manage_operations(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin_in_org(org_id) OR public.is_assistant_in_org(org_id)
$$;


-- ================================================================
-- 3. RLS — clients (SELECT/INSERT/UPDATE étendus, DELETE inchangé)
-- ================================================================
DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;

-- SELECT : identique à 20260610000029, seule la branche admin devient can_manage_operations
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.client_id = clients.id
          AND i.intervenant_id = auth.uid()
          AND i.organisation_id = clients.organisation_id
      )
      OR EXISTS (
        SELECT 1 FROM public.devis d
        WHERE d.client_id = clients.id
          AND d.intervenant_id = auth.uid()
          AND d.organisation_id = clients.organisation_id
      )
    )
  );

CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (
    can_manage_operations(current_org_id())
    AND organisation_id = current_org_id()
  );

CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND can_manage_operations(organisation_id)
  )
  WITH CHECK (
    can_manage_operations(current_org_id())
    AND organisation_id = current_org_id()
  );

-- clients_delete : NON MODIFIÉE — reste is_admin_in_org (déjà en place, aucun DROP/CREATE ici).


-- ================================================================
-- 4. RLS — interventions (SELECT/INSERT/UPDATE étendus, DELETE inchangé)
-- ================================================================
DROP POLICY IF EXISTS "interventions_select" ON public.interventions;
DROP POLICY IF EXISTS "interventions_insert" ON public.interventions;
DROP POLICY IF EXISTS "interventions_update" ON public.interventions;

CREATE POLICY "interventions_select" ON public.interventions
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR intervenant_id = auth.uid()
    )
  );

CREATE POLICY "interventions_insert" ON public.interventions
  FOR INSERT
  WITH CHECK (
    can_manage_operations(current_org_id())
    AND organisation_id = current_org_id()
  );

CREATE POLICY "interventions_update" ON public.interventions
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR intervenant_id = auth.uid()
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR intervenant_id = auth.uid()
    )
  );

-- interventions_delete : NON MODIFIÉE — reste is_admin_in_org.


-- ================================================================
-- 5. RLS — photos (SELECT étendu uniquement, INSERT/DELETE inchangés)
-- ================================================================
DROP POLICY IF EXISTS "photos_select" ON public.photos;

CREATE POLICY "photos_select" ON public.photos
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.id = photos.intervention_id
          AND i.organisation_id = photos.organisation_id
          AND i.intervenant_id = auth.uid()
      )
    )
  );

-- photos_insert / photos_delete : NON MODIFIÉES.


-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('clients', 'interventions', 'photos')
ORDER BY tablename, cmd;
