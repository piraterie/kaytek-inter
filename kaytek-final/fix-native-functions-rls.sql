-- ================================================================
-- FIX NATIVE FUNCTIONS RLS — KAYTEK INTER
-- Exécuter dans Supabase SQL Editor → Run
-- ================================================================

-- 1. Corriger is_admin() — robuste
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' AND actif = true FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    false
  );
$$;

-- 2. Corriger get_user_role()
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), 'anonymous');
$$;

-- ================================================================
-- 3. RLS DEVIS — admin tout, intervenant ses devis
-- ================================================================
ALTER TABLE devis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS devis_select ON devis;
DROP POLICY IF EXISTS devis_insert ON devis;
DROP POLICY IF EXISTS devis_update ON devis;
DROP POLICY IF EXISTS devis_delete ON devis;

CREATE POLICY devis_select ON devis FOR SELECT TO authenticated
  USING (is_admin() OR intervenant_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY devis_insert ON devis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY devis_update ON devis FOR UPDATE TO authenticated
  USING (is_admin() OR intervenant_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY devis_delete ON devis FOR DELETE TO authenticated
  USING (is_admin() OR created_by = auth.uid());

-- ================================================================
-- 4. RLS FACTURES
-- ================================================================
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS factures_select ON factures;
DROP POLICY IF EXISTS factures_insert ON factures;
DROP POLICY IF EXISTS factures_update ON factures;
DROP POLICY IF EXISTS factures_delete ON factures;

CREATE POLICY factures_select ON factures FOR SELECT TO authenticated USING (true);
CREATE POLICY factures_insert ON factures FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY factures_update ON factures FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY factures_delete ON factures FOR DELETE TO authenticated USING (is_admin());

-- ================================================================
-- 5. RLS INTERVENTIONS
-- ================================================================
ALTER TABLE interventions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interventions_select ON interventions;
DROP POLICY IF EXISTS interventions_insert ON interventions;
DROP POLICY IF EXISTS interventions_update ON interventions;
DROP POLICY IF EXISTS interventions_delete ON interventions;

CREATE POLICY interventions_select ON interventions FOR SELECT TO authenticated
  USING (is_admin() OR intervenant_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY interventions_insert ON interventions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY interventions_update ON interventions FOR UPDATE TO authenticated
  USING (is_admin() OR intervenant_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY interventions_delete ON interventions FOR DELETE TO authenticated
  USING (is_admin());

-- ================================================================
-- 6. RLS CLIENTS
-- ================================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_select ON clients;
DROP POLICY IF EXISTS clients_insert ON clients;
DROP POLICY IF EXISTS clients_update ON clients;
DROP POLICY IF EXISTS clients_delete ON clients;

CREATE POLICY clients_select ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON clients FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY clients_update ON clients FOR UPDATE TO authenticated USING (is_admin() OR created_by = auth.uid());
CREATE POLICY clients_delete ON clients FOR DELETE TO authenticated USING (is_admin());

-- ================================================================
-- 7. RLS MESSAGES
-- ================================================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;
DROP POLICY IF EXISTS messages_update ON messages;

CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (expediteur_id = auth.uid() OR destinataire_id = auth.uid() OR is_admin());
CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated
  WITH CHECK (expediteur_id = auth.uid());
CREATE POLICY messages_update ON messages FOR UPDATE TO authenticated
  USING (destinataire_id = auth.uid() OR is_admin());

-- ================================================================
-- 8. RLS PHOTOS
-- ================================================================
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS photos_select ON photos;
DROP POLICY IF EXISTS photos_insert ON photos;
DROP POLICY IF EXISTS photos_delete ON photos;

CREATE POLICY photos_select ON photos FOR SELECT TO authenticated USING (true);
CREATE POLICY photos_insert ON photos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY photos_delete ON photos FOR DELETE TO authenticated USING (is_admin() OR uploaded_by = auth.uid());

-- ================================================================
-- 9. RLS NOTIFICATIONS
-- ================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;

CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- ================================================================
-- 10. RLS COMMISSIONS
-- ================================================================
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commissions_select ON commissions;
DROP POLICY IF EXISTS commissions_insert ON commissions;
DROP POLICY IF EXISTS commissions_update ON commissions;

CREATE POLICY commissions_select ON commissions FOR SELECT TO authenticated
  USING (is_admin() OR intervenant_id = auth.uid());
CREATE POLICY commissions_insert ON commissions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY commissions_update ON commissions FOR UPDATE TO authenticated USING (is_admin());

-- ================================================================
-- 11. RLS PROFILES
-- ================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;

CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_admin());

-- ================================================================
-- 12. RLS PARAMETRES ENTREPRISE
-- ================================================================
ALTER TABLE parametres_entreprise ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS params_select ON parametres_entreprise;
DROP POLICY IF EXISTS params_insert ON parametres_entreprise;
DROP POLICY IF EXISTS params_update ON parametres_entreprise;

CREATE POLICY params_select ON parametres_entreprise FOR SELECT TO authenticated USING (true);
CREATE POLICY params_insert ON parametres_entreprise FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY params_update ON parametres_entreprise FOR UPDATE TO authenticated USING (is_admin());

-- ================================================================
-- 13. Activer Realtime sur messages
-- ================================================================
ALTER TABLE messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- ================================================================
-- 14. Storage — bucket messages (si pas déjà créé)
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('intervention-photos', 'intervention-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Policy upload médias messagerie
DROP POLICY IF EXISTS "media_upload" ON storage.objects;
CREATE POLICY "media_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'intervention-photos' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "media_read" ON storage.objects;
CREATE POLICY "media_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'intervention-photos');

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, COUNT(*) as nb_policies
FROM pg_policies WHERE schemaname = 'public'
GROUP BY tablename ORDER BY tablename;
