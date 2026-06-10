-- ================================================================
-- MIGRATION : Étape 6 — factures.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–5 appliquées
-- Impact     :
--   · ALTER TABLE factures : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_factures_organisation_id
--   · Aucune policy modifiée
--   · Aucun trigger modifié (set_facture_numero inchangé)
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.factures
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : toutes les factures existantes → kaytek-inter ──
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.factures
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une facture n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.factures
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des factures liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'factures_organisation_id_fkey'
      AND table_name      = 'factures'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.factures
      ADD CONSTRAINT factures_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
--    Requis pour toutes les futures requêtes WHERE organisation_id = ?
CREATE INDEX IF NOT EXISTS idx_factures_organisation_id
  ON public.factures(organisation_id);
