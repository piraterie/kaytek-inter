-- ================================================================
-- MIGRATION : Étape 4 — interventions.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étape 1 (organisations) + Étape 2 (profiles) + Étape 3 (clients)
-- Impact     :
--   · ALTER TABLE interventions : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_interventions_organisation_id
--   · Aucune policy modifiée
--   · Aucun trigger modifié (numérotation inchangée)
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : toutes les interventions existantes → kaytek-inter
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.interventions
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une intervention n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.interventions
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des interventions liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'interventions_organisation_id_fkey'
      AND table_name      = 'interventions'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.interventions
      ADD CONSTRAINT interventions_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
--    Requis pour toutes les futures requêtes WHERE organisation_id = ?
CREATE INDEX IF NOT EXISTS idx_interventions_organisation_id
  ON public.interventions(organisation_id);
