-- 20260615000003_guide_news.sql
-- Table guide_news : section 📢 Nouveautés (créée par les admins, visible par tous)

CREATE TABLE IF NOT EXISTS public.guide_news (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid    NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  titre                text    NOT NULL,
  description          text    NOT NULL,
  date_publication     date    NOT NULL DEFAULT CURRENT_DATE,
  visible_admin        boolean NOT NULL DEFAULT true,
  visible_intervenant  boolean NOT NULL DEFAULT true,
  actif                boolean NOT NULL DEFAULT true,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guide_news_org  ON public.guide_news (organisation_id);
CREATE INDEX IF NOT EXISTS idx_guide_news_date ON public.guide_news (organisation_id, date_publication DESC);

ALTER TABLE public.guide_news ENABLE ROW LEVEL SECURITY;

-- SELECT : même org, entrées actives uniquement
CREATE POLICY "guide_news_select" ON public.guide_news
  FOR SELECT
  USING (is_same_org(organisation_id) AND actif = true);

-- INSERT : admin uniquement
CREATE POLICY "guide_news_insert" ON public.guide_news
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : admin uniquement
CREATE POLICY "guide_news_update" ON public.guide_news
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
CREATE POLICY "guide_news_delete" ON public.guide_news
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );

-- Trigger updated_at automatique
CREATE OR REPLACE FUNCTION public.guide_news_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER guide_news_updated_at
  BEFORE UPDATE ON public.guide_news
  FOR EACH ROW EXECUTE FUNCTION public.guide_news_set_updated_at();
