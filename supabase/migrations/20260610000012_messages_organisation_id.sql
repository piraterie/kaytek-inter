-- ================================================================
-- MIGRATION : messages.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–11 appliquées (organisations + tables métier + journal + photos + commission_receipts)
-- Impact     :
--   · ALTER TABLE messages : ADD COLUMN organisation_id + FK + NOT NULL
--   · Backfill : expediteur_id → profiles.organisation_id (couverture 100 %)
--   · Fallback : kaytek-inter pour les entrées sans backfill (théoriquement 0)
--   · CREATE INDEX idx_messages_organisation_id
--   · Aucune policy modifiée
--   · 2 points frontend patchés séparément : useSendMessage() + notifyAdminsMessage()
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill via expediteur_id → profiles.organisation_id ─────
--    expediteur_id est NOT NULL → couverture garantie à 100 %.
UPDATE public.messages m
SET organisation_id = p.organisation_id
FROM public.profiles p
WHERE m.expediteur_id = p.id
  AND m.organisation_id IS NULL;

-- ── 3. Fallback kaytek-inter (théoriquement 0 ligne — garde-fou idempotent)
UPDATE public.messages
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 4. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si un message n'a pas été backfillé (détection d'erreur).
ALTER TABLE public.messages
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 5. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des messages liés.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'messages_organisation_id_fkey'
      AND table_name      = 'messages'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 6. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_organisation_id
  ON public.messages(organisation_id);
