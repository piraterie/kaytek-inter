-- 20260615000004_storage_guide_videos.sql
-- Bucket Supabase Storage 'guide-videos' + politiques RLS Storage
-- Structure des chemins : {organisation_id}/{role}/{slug}.webm

-- ── 1. Création du bucket ──────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'guide-videos',
  'guide-videos',
  false,
  524288000,  -- 500 Mo max par fichier
  ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Politiques RLS Storage ─────────────────────────────────────────────

-- SELECT : utilisateur authentifié de la même org
--   chemin : {org_id}/{role}/{slug}.webm → dossier[1] = org_id
CREATE POLICY "guide_videos_storage_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'guide-videos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = (current_org_id())::text
  );

-- INSERT : admin uniquement
CREATE POLICY "guide_videos_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'guide-videos'
    AND auth.role() = 'authenticated'
    AND is_admin_in_org(current_org_id())
    AND (storage.foldername(name))[1] = (current_org_id())::text
  );

-- UPDATE : admin uniquement
CREATE POLICY "guide_videos_storage_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'guide-videos'
    AND auth.role() = 'authenticated'
    AND is_admin_in_org(current_org_id())
    AND (storage.foldername(name))[1] = (current_org_id())::text
  );

-- DELETE : admin uniquement
CREATE POLICY "guide_videos_storage_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'guide-videos'
    AND auth.role() = 'authenticated'
    AND is_admin_in_org(current_org_id())
    AND (storage.foldername(name))[1] = (current_org_id())::text
  );
