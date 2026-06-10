-- ================================================================
-- MIGRATION : Étape 2 — profiles.organisation_id
-- Date       : 2026-06-10
-- Prérequis  : Étape 1 appliquée (table organisations + seed kaytek-inter)
-- Impact     :
--   · ALTER TABLE profiles : ADD COLUMN organisation_id + FK + NOT NULL
--   · CREATE INDEX idx_profiles_organisation_id
--   · UPDATE policy organisations_select (placeholder → scope réel)
--   · Aucune autre table modifiée
--   · Aucune donnée supprimée
--   · Script idempotent (ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS)
-- ================================================================

-- ── 1. Ajouter organisation_id (nullable en premier) ─────────────
--    Nullable pour permettre le backfill avant SET NOT NULL.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organisation_id uuid;

-- ── 2. Backfill : tous les profils existants → kaytek-inter ──────
--    Utilise un subquery sur le slug (pas d'UUID hardcodé).
UPDATE public.profiles
SET organisation_id = (
  SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
)
WHERE organisation_id IS NULL;

-- ── 3. SET NOT NULL après backfill complet ───────────────────────
--    Échouera si un profil n'a pas été backfillé (détection d'erreur).
ALTER TABLE public.profiles
  ALTER COLUMN organisation_id SET NOT NULL;

-- ── 4. Contrainte FK (idempotente) ──────────────────────────────
--    ON DELETE RESTRICT : impossible de supprimer une organisation
--    tant qu'elle a des profils liés.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'profiles_organisation_id_fkey'
      AND table_name      = 'profiles'
      AND table_schema    = 'public'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_organisation_id_fkey
      FOREIGN KEY (organisation_id)
      REFERENCES public.organisations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 5. Index pour les performances ──────────────────────────────
--    Requis pour toutes les futures requêtes WHERE organisation_id = ?
CREATE INDEX IF NOT EXISTS idx_profiles_organisation_id
  ON public.profiles(organisation_id);

-- ── 6. Remplacer la policy organisations_select ─────────────────
--    Passe du placeholder (auth.uid() IS NOT NULL) à la version
--    scopée : chaque utilisateur ne voit que son organisation.
DROP POLICY IF EXISTS "organisations_select" ON public.organisations;
CREATE POLICY "organisations_select" ON public.organisations
  FOR SELECT TO authenticated
  USING (
    id = (
      SELECT organisation_id
      FROM public.profiles
      WHERE id = auth.uid()
    )
  );
