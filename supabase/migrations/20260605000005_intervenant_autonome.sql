-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : intervenants autonomes (entrepreneur / salarié)
-- Permet aux intervenants de créer devis + factures sur leurs interventions
-- terminées, avec validation admin obligatoire (statut en_attente_validation)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne type_intervenant sur profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS type_intervenant text
  CHECK (type_intervenant IS NULL OR type_intervenant IN ('entrepreneur', 'salarie'));

-- 2. Mise à jour contrainte statut sur devis (ajout en_attente_validation)
DO $$ BEGIN
  ALTER TABLE public.devis DROP CONSTRAINT IF EXISTS devis_statut_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.devis ADD CONSTRAINT devis_statut_check
    CHECK (statut IN ('en_attente_validation','brouillon','envoye','accepte','refuse','expire'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Mise à jour contrainte statut_paiement sur factures
DO $$ BEGIN
  ALTER TABLE public.factures DROP CONSTRAINT IF EXISTS factures_statut_paiement_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.factures ADD CONSTRAINT factures_statut_paiement_check
    CHECK (statut_paiement IN ('en_attente_validation','impayee','payee','acompte','partiel','annulee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEVIS — admin + intervenants (seulement leurs interventions terminées)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'devis' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.devis'; END LOOP;
END $$;

-- Lecture : admin voit tout, intervenant voit ses propres devis
CREATE POLICY "devis_select" ON public.devis FOR SELECT
  USING (
    is_admin() OR created_by = auth.uid()
  );

-- Insertion : admin toujours, intervenant uniquement si intervention est 'termine'
CREATE POLICY "devis_insert" ON public.devis FOR INSERT
  WITH CHECK (
    is_admin() OR (
      created_by = auth.uid() AND
      EXISTS (
        SELECT 1 FROM public.interventions
        WHERE id = intervention_id
          AND intervenant_id = auth.uid()
          AND statut = 'termine'
      )
    )
  );

-- Mise à jour : admin uniquement (pour valider / rejeter)
CREATE POLICY "devis_update" ON public.devis FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());

-- Suppression : admin uniquement
CREATE POLICY "devis_delete" ON public.devis FOR DELETE
  USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- FACTURES — admin + intervenants (seulement leurs interventions terminées)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'factures' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.factures'; END LOOP;
END $$;

CREATE POLICY "factures_select" ON public.factures FOR SELECT
  USING (
    is_admin() OR created_by = auth.uid()
  );

CREATE POLICY "factures_insert" ON public.factures FOR INSERT
  WITH CHECK (
    is_admin() OR (
      created_by = auth.uid() AND
      EXISTS (
        SELECT 1 FROM public.interventions
        WHERE id = intervention_id
          AND intervenant_id = auth.uid()
          AND statut = 'termine'
      )
    )
  );

CREATE POLICY "factures_update" ON public.factures FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "factures_delete" ON public.factures FOR DELETE
  USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENTS — admin + intervenants (lecture des clients de leurs interventions)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'clients' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.clients'; END LOOP;
END $$;

CREATE POLICY "clients_select" ON public.clients FOR SELECT
  USING (
    is_admin() OR
    EXISTS (
      SELECT 1 FROM public.interventions
      WHERE interventions.client_id = clients.id
        AND interventions.intervenant_id = auth.uid()
    )
  );

CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (is_admin());
