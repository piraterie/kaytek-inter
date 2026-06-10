-- Fix : créer le bucket "signatures" dans Supabase Storage
-- À exécuter dans Supabase → SQL Editor

-- 1. Créer le bucket s'il n'existe pas
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Politique : les utilisateurs authentifiés peuvent uploader
CREATE POLICY "signatures_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'signatures');

-- 3. Politique : les utilisateurs authentifiés peuvent lire
CREATE POLICY "signatures_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures');

-- 4. Politique : les utilisateurs authentifiés peuvent mettre à jour (upsert)
CREATE POLICY "signatures_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'signatures');
