-- ================================================================
-- MIGRATION : commission_receipts.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–10 appliquées (organisations + tables métier + journal + photos)
-- Impact     :
--   · ALTER TABLE commission_receipts : ADD COLUMN organisation_id + FK + NOT NULL
--   · Backfill : facture_id → factures.organisation_id (couverture 100 %)
--   · Fallback : kaytek-inter pour les entrées sans backfill (théoriquement 0)
--   · CREATE INDEX idx_commission_receipts_organisation_id
--   · Aucune policy modifiée
--   · 1 hook frontend patché séparément : useMarkCommissionReceived()
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.commission_receipts
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill via facture_id → factures.organisation_id ────────
--    facture_id est NOT NULL → couverture garantie à 100 %.
UPDATE public.commission_receipts cr
SET organisation_id = f.organisation_id
FROM public.factures f
WHERE cr.facture_id = f.id
  AND cr.organisation_id IS NULL;

-- ── 3. Fallback kaytek-inter (théoriquement 0 ligne — garde-fou idempotent)
UPDATE public.commission_receipts
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 4. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une entrée n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.commission_receipts
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 5. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des commission_receipts liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'commission_receipts_organisation_id_fkey'
      AND table_name      = 'commission_receipts'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.commission_receipts
      ADD CONSTRAINT commission_receipts_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 6. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_commission_receipts_organisation_id
  ON public.commission_receipts(organisation_id);
