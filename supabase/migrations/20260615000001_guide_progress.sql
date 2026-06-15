-- 20260615000001_guide_progress.sql
-- Colonne welcome_dismissed dans profiles + table guide_progress (progression utilisateur)

-- ── 1. Colonne welcome_dismissed dans profiles ─────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_dismissed boolean NOT NULL DEFAULT false;

-- ── 2. Table guide_progress ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guide_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  organisation_id uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  section_slug    text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('admin', 'intervenant')),
  completed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, section_slug)
);

CREATE INDEX IF NOT EXISTS idx_guide_progress_user    ON public.guide_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_guide_progress_org     ON public.guide_progress (organisation_id);

ALTER TABLE public.guide_progress ENABLE ROW LEVEL SECURITY;

-- SELECT : ses propres lignes uniquement
CREATE POLICY "guide_progress_select" ON public.guide_progress
  FOR SELECT
  USING (user_id = auth.uid() AND is_same_org(organisation_id));

-- INSERT : ses propres lignes, dans sa propre org
CREATE POLICY "guide_progress_insert" ON public.guide_progress
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND organisation_id = current_org_id());

-- UPDATE : ses propres lignes
CREATE POLICY "guide_progress_update" ON public.guide_progress
  FOR UPDATE
  USING (user_id = auth.uid() AND is_same_org(organisation_id))
  WITH CHECK (user_id = auth.uid() AND organisation_id = current_org_id());

-- DELETE : ses propres lignes
CREATE POLICY "guide_progress_delete" ON public.guide_progress
  FOR DELETE
  USING (user_id = auth.uid() AND is_same_org(organisation_id));
