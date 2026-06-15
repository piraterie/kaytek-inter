-- 20260615000002_guide_videos.sql
-- Table guide_videos : métadonnées des vidéos stockées dans Supabase Storage (bucket guide-videos)

CREATE TABLE IF NOT EXISTS public.guide_videos (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid    NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  slug            text    NOT NULL,
  role            text    NOT NULL CHECK (role IN ('admin', 'intervenant')),
  section_slug    text    NOT NULL,
  titre           text    NOT NULL,
  description     text,
  duree_secondes  integer,
  storage_path    text    NOT NULL,   -- chemin dans le bucket 'guide-videos' : {org_id}/{role}/{slug}.webm
  ordre           integer NOT NULL DEFAULT 0,
  actif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (organisation_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_guide_videos_org  ON public.guide_videos (organisation_id);
CREATE INDEX IF NOT EXISTS idx_guide_videos_role ON public.guide_videos (organisation_id, role);

ALTER TABLE public.guide_videos ENABLE ROW LEVEL SECURITY;

-- SELECT : même org (actif filtré côté front ; admin voit tout pour la gestion)
CREATE POLICY "guide_videos_select" ON public.guide_videos
  FOR SELECT
  USING (is_same_org(organisation_id));

-- INSERT : admin uniquement
CREATE POLICY "guide_videos_insert" ON public.guide_videos
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : admin uniquement, reste dans la même org
CREATE POLICY "guide_videos_update" ON public.guide_videos
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- DELETE : admin uniquement
CREATE POLICY "guide_videos_delete" ON public.guide_videos
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );

-- Trigger updated_at automatique
CREATE OR REPLACE FUNCTION public.guide_videos_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER guide_videos_updated_at
  BEFORE UPDATE ON public.guide_videos
  FOR EACH ROW EXECUTE FUNCTION public.guide_videos_set_updated_at();
