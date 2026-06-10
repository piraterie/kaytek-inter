-- ================================================================
-- MIGRATION : photos.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–9 appliquées (organisations + tables métier + journal)
-- Impact     :
--   · ALTER TABLE photos : ADD COLUMN organisation_id + FK + NOT NULL
--   · Backfill : intervention_id → interventions.organisation_id (couverture 100 %)
--   · Fallback : kaytek-inter pour les entrées sans backfill (théoriquement 0)
--   · CREATE INDEX idx_photos_organisation_id
--   · Aucune policy modifiée
--   · 1 hook frontend patché séparément : useUploadPhoto()
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill via intervention_id → interventions.organisation_id
--    intervention_id est NOT NULL → couverture garantie à 100 %.
UPDATE public.photos ph
SET organisation_id = i.organisation_id
FROM public.interventions i
WHERE ph.intervention_id = i.id
  AND ph.organisation_id IS NULL;

-- ── 3. Fallback kaytek-inter (théoriquement 0 ligne — garde-fou idempotent)
UPDATE public.photos
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 4. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une photo n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.photos
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 5. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des photos liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'photos_organisation_id_fkey'
      AND table_name      = 'photos'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.photos
      ADD CONSTRAINT photos_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 6. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_photos_organisation_id
  ON public.photos(organisation_id);
