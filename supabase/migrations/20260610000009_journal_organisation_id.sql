-- ================================================================
-- MIGRATION : journal.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étapes 1–8 appliquées (organisations, profiles, clients,
--              interventions, devis, factures, commissions, parametres_entreprise,
--              prestations)
-- Impact     :
--   · ALTER TABLE journal : ADD COLUMN organisation_id + FK + NOT NULL
--   · Backfill : user_id → profiles.organisation_id, fallback kaytek-inter
--   · CREATE INDEX idx_journal_organisation_id
--   · Aucune policy modifiée
--   · Aucun hook frontend modifié (aucun INSERT journal actif dans le code)
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.journal
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill primaire : user_id → profiles.organisation_id ────
--    Couvre toutes les entrées dont user_id est renseigné.
UPDATE public.journal j
SET organisation_id = p.organisation_id
FROM public.profiles p
WHERE j.user_id = p.id
  AND j.organisation_id IS NULL;

-- ── 3. Backfill fallback : entrées sans user_id → kaytek-inter ───
--    Couvre les entrées avec user_id NULL (système, import, etc.).
UPDATE public.journal
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 4. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si une entrée n'a pas été backfillée (détection d'erreur).
ALTER TABLE public.journal
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 5. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des entrées de journal liées.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'journal_organisation_id_fkey'
      AND table_name      = 'journal'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.journal
      ADD CONSTRAINT journal_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 6. Index pour les performances ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_journal_organisation_id
  ON public.journal(organisation_id);
