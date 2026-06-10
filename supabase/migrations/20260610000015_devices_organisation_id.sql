-- ================================================================
-- MIGRATION : devices.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–14 appliquées
-- Impact     :
--   · ALTER TABLE devices : ADD COLUMN organisation_id + FK + NOT NULL
--   · Backfill : user_id → profiles.organisation_id (couverture 100 %)
--   · Fallback : kaytek-inter pour les entrées sans backfill (théoriquement 0)
--   · CREATE INDEX idx_devices_organisation_id
--   · Aucune policy modifiée
--   · 2 fichiers frontend patchés séparément :
--     registerDevice() dans src/lib/devices.ts
--     signIn() dans src/lib/supabase/auth.ts
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill via user_id → profiles.organisation_id ───────────
--    user_id est NOT NULL → couverture garantie à 100 %.
UPDATE public.devices d
SET organisation_id = p.organisation_id
FROM public.profiles p
WHERE d.user_id = p.id
  AND d.organisation_id IS NULL;

-- ── 3. Fallback kaytek-inter (théoriquement 0 ligne — garde-fou idempotent)
UPDATE public.devices
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 4. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si un appareil n'a pas été backfillé (détection d'erreur).
ALTER TABLE public.devices
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 5. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des appareils liés.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'devices_organisation_id_fkey'
      AND table_name      = 'devices'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT devices_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 6. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_devices_organisation_id
  ON public.devices(organisation_id);
