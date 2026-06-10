-- ================================================================
-- FIX DÉFINITIF — DEVIS RLS + CONTRAINTE STATUT
-- Copier-coller intégralement dans Supabase > SQL Editor > Run
-- ================================================================

-- ── Étape 1 : Supprimer TOUTES les policies devis existantes ─────
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'devis' AND schemaname = 'public'
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.devis';
  END LOOP;
END $$;

-- ── Étape 2 : Corriger la contrainte statut (ajoute en_attente_validation) ──
ALTER TABLE public.devis DROP CONSTRAINT IF EXISTS devis_statut_check;
ALTER TABLE public.devis
  ADD CONSTRAINT devis_statut_check
  CHECK (statut IN (
    'en_attente_validation',
    'brouillon',
    'envoye',
    'accepte',
    'refuse',
    'expire'
  ));

-- ── Étape 3 : Nouvelles politiques RLS ───────────────────────────

-- SELECT : admin voit tout ; intervenant voit ses devis (créés ou liés à lui)
CREATE POLICY "devis_select" ON public.devis FOR SELECT
  USING (
    is_admin()
    OR created_by = auth.uid()
    OR intervenant_id = auth.uid()
  );

-- INSERT : tout utilisateur authentifié peut créer un devis pour lui-même
-- (la restriction "intervention terminée" est contrôlée côté application)
CREATE POLICY "devis_insert" ON public.devis FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

-- UPDATE : admin peut tout modifier ;
--          intervenant peut modifier ses propres devis en brouillon ou en attente
CREATE POLICY "devis_update" ON public.devis FOR UPDATE
  USING (
    is_admin()
    OR (created_by = auth.uid() AND statut IN ('brouillon', 'en_attente_validation'))
  )
  WITH CHECK (
    is_admin()
    OR (created_by = auth.uid() AND statut IN ('brouillon', 'en_attente_validation'))
  );

-- DELETE : admin uniquement
CREATE POLICY "devis_delete" ON public.devis FOR DELETE
  USING (is_admin());

-- ── Étape 4 : Vérification — doit afficher 4 lignes ─────────────
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'devis' AND schemaname = 'public'
ORDER BY cmd;
