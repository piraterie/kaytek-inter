-- ================================================================
-- PERMISSION can_create_documents
-- Permet à l'admin d'autoriser un intervenant à créer devis/factures
-- Par défaut : désactivé pour tous les intervenants
-- ================================================================

-- [1] Ajouter la colonne au profil
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_create_documents boolean DEFAULT false;

-- [2] Vérifier l'état actuel des policies INSERT sur devis
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'devis' AND schemaname = 'public' AND cmd = 'INSERT';

-- [3] Supprimer les policies INSERT existantes sur devis
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'devis' AND schemaname = 'public' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.devis', pol.policyname);
    RAISE NOTICE 'Supprimé devis INSERT : %', pol.policyname;
  END LOOP;
END $$;

-- [4] Nouvelle policy INSERT devis :
--   - admin : toujours autorisé
--   - intervenant : uniquement si can_create_documents = true
CREATE POLICY "devis_insert" ON public.devis
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      OR
      (SELECT can_create_documents FROM public.profiles WHERE id = auth.uid()) = true
    )
  );

-- [5] Vérifier l'état actuel des policies INSERT sur factures
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'factures' AND schemaname = 'public' AND cmd = 'INSERT';

-- [6] Supprimer les policies INSERT existantes sur factures
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'factures' AND schemaname = 'public' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.factures', pol.policyname);
    RAISE NOTICE 'Supprimé factures INSERT : %', pol.policyname;
  END LOOP;
END $$;

-- [7] Nouvelle policy INSERT factures :
--   - admin : toujours autorisé
--   - intervenant : uniquement si can_create_documents = true
CREATE POLICY "factures_insert" ON public.factures
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      OR
      (SELECT can_create_documents FROM public.profiles WHERE id = auth.uid()) = true
    )
  );

-- [8] Vérification finale
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('devis','factures') AND schemaname = 'public' AND cmd = 'INSERT'
ORDER BY tablename, policyname;
