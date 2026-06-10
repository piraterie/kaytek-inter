-- ================================================================
-- MIGRATION : Étape 3 — clients.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étape 1 (organisations) + Étape 2 (profiles.organisation_id)
-- Impact     :
--   · ALTER TABLE clients : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_clients_organisation_id
--   · Aucune policy modifiée
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DO $$ IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : tous les clients existants → kaytek-inter ──────
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.clients
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si un client n'a pas été backfillé (détection d'erreur).
ALTER TABLE public.clients
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des clients liés.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clients_organisation_id_fkey'
      AND table_name      = 'clients'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
--    Requis pour toutes les futures requêtes WHERE organisation_id = ?
CREATE INDEX IF NOT EXISTS idx_clients_organisation_id
  ON public.clients(organisation_id);
