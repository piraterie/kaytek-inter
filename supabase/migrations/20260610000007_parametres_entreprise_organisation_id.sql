-- ================================================================
-- MIGRATION : parametres_entreprise.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–7 appliquées (organisations, profiles, clients,
--              interventions, devis, factures, commissions)
-- Impact     :
--   · ALTER TABLE parametres_entreprise : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_parametres_entreprise_organisation_id
--   · Aucune policy modifiée
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.parametres_entreprise
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : la ligne existante → kaytek-inter ──────────────
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.parametres_entreprise
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une ligne n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.parametres_entreprise
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des paramètres liés.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'parametres_entreprise_organisation_id_fkey'
      AND table_name      = 'parametres_entreprise'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.parametres_entreprise
      ADD CONSTRAINT parametres_entreprise_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parametres_entreprise_organisation_id
  ON public.parametres_entreprise(organisation_id);
