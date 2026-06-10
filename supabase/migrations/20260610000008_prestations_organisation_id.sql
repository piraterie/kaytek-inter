-- ================================================================
-- MIGRATION : prestations.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–8 appliquées
-- Impact     :
--   · ALTER TABLE prestations : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_prestations_organisation_id
--   · Aucune policy modifiée
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.prestations
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : toutes les prestations existantes → kaytek-inter
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.prestations
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une prestation n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.prestations
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des prestations liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'prestations_organisation_id_fkey'
      AND table_name      = 'prestations'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.prestations
      ADD CONSTRAINT prestations_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prestations_organisation_id
  ON public.prestations(organisation_id);
