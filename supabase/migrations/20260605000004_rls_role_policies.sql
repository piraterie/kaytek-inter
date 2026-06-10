-- ─────────────────────────────────────────────────────────────────────────────
-- Fonction helper : vérifie si l'utilisateur connecté est admin
-- SECURITY DEFINER = bypass RLS pour lire profiles sans récursion
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FACTURES — admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'factures' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.factures'; END LOOP;
END $$;

CREATE POLICY "factures_select" ON public.factures FOR SELECT USING (is_admin());
CREATE POLICY "factures_insert" ON public.factures FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "factures_update" ON public.factures FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "factures_delete" ON public.factures FOR DELETE USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- DEVIS — admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'devis' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.devis'; END LOOP;
END $$;

CREATE POLICY "devis_select" ON public.devis FOR SELECT USING (is_admin());
CREATE POLICY "devis_insert" ON public.devis FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "devis_update" ON public.devis FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "devis_delete" ON public.devis FOR DELETE USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENTS — admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'clients' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.clients'; END LOOP;
END $$;

CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (is_admin());
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- PARAMETRES_ENTREPRISE — admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'parametres_entreprise' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.parametres_entreprise'; END LOOP;
END $$;

CREATE POLICY "params_select" ON public.parametres_entreprise FOR SELECT USING (is_admin());
CREATE POLICY "params_insert" ON public.parametres_entreprise FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "params_update" ON public.parametres_entreprise FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "params_delete" ON public.parametres_entreprise FOR DELETE USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- INTERVENTIONS — admin voit tout, intervenant voit seulement les siennes
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'interventions' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.interventions'; END LOOP;
END $$;

CREATE POLICY "interventions_select" ON public.interventions FOR SELECT
  USING (is_admin() OR intervenant_id = auth.uid());

CREATE POLICY "interventions_insert" ON public.interventions FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "interventions_update" ON public.interventions FOR UPDATE
  USING (is_admin() OR intervenant_id = auth.uid())
  WITH CHECK (is_admin() OR intervenant_id = auth.uid());

CREATE POLICY "interventions_delete" ON public.interventions FOR DELETE
  USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMISSIONS — admin voit tout, intervenant voit seulement les siennes
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'commissions' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.commissions'; END LOOP;
END $$;

CREATE POLICY "commissions_select" ON public.commissions FOR SELECT
  USING (is_admin() OR intervenant_id = auth.uid());

CREATE POLICY "commissions_insert" ON public.commissions FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "commissions_update" ON public.commissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "commissions_delete" ON public.commissions FOR DELETE USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- MESSAGES — chaque utilisateur voit uniquement ses propres conversations
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'messages' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.messages'; END LOOP;
END $$;

CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (expediteur_id = auth.uid() OR destinataire_id = auth.uid());

CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (expediteur_id = auth.uid());

CREATE POLICY "messages_update" ON public.messages FOR UPDATE
  USING (destinataire_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES — tous peuvent lire (nécessaire pour la messagerie)
--            chacun peut modifier son propre profil, admin peut tout modifier
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.profiles'; END LOOP;
END $$;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR is_admin())
  WITH CHECK (auth.uid() = id OR is_admin());

CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE
  USING (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- PHOTOS — même accès que l'intervention liée
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'photos' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.photos'; END LOOP;
END $$;

CREATE POLICY "photos_select" ON public.photos FOR SELECT
  USING (
    is_admin() OR
    EXISTS (
      SELECT 1 FROM public.interventions i
      WHERE i.id = photos.intervention_id
        AND (is_admin() OR i.intervenant_id = auth.uid())
    )
  );

CREATE POLICY "photos_insert" ON public.photos FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "photos_delete" ON public.photos FOR DELETE
  USING (is_admin() OR uploaded_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- JOURNAL — admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'journal' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.journal'; END LOOP;
END $$;

CREATE POLICY "journal_select" ON public.journal FOR SELECT USING (is_admin());
CREATE POLICY "journal_insert" ON public.journal FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- PRESTATIONS — lecture par tous les authentifiés, écriture admin uniquement
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'prestations' AND schemaname = 'public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.prestations'; END LOOP;
END $$;

CREATE POLICY "prestations_select" ON public.prestations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "prestations_insert" ON public.prestations FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "prestations_update" ON public.prestations FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "prestations_delete" ON public.prestations FOR DELETE USING (is_admin());
