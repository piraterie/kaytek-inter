-- ================================================================
-- MIGRATION : Étape 1 — Création table organisations
-- Date       : 2026-06-10
-- Auteur     : migration multi-tenant
-- Impact     : CREATE TABLE uniquement
--              Aucune table existante modifiée
--              Aucune policy existante modifiée
--              Aucune donnée existante touchée
-- ================================================================

-- ── 1. Créer la table organisations ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.organisations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL,
  nom        text        NOT NULL,
  plan       text        NOT NULL DEFAULT 'pro',
  actif      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organisations_slug_unique UNIQUE (slug),
  CONSTRAINT organisations_plan_check  CHECK (plan IN ('starter', 'pro', 'enterprise'))
);

-- ── 2. Activer RLS ───────────────────────────────────────────────
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

-- ── 3. Policy SELECT ─────────────────────────────────────────────
-- PLACEHOLDER pour l'Étape 1.
-- Logique finale (Étape 2) :
--   USING (id = (SELECT organisation_id FROM public.profiles WHERE id = auth.uid()))
-- Ici : tout utilisateur authentifié peut lire les organisations.
-- Sécurité acceptable : une seule organisation existera jusqu'à l'Étape 2,
-- et organisations ne contient aucune donnée sensible (pas d'IBAN, pas de clé).
CREATE POLICY "organisations_select" ON public.organisations
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── 4. Seed : insérer l'organisation existante ───────────────────
-- ON CONFLICT DO NOTHING rend ce script idempotent (réexécutable sans erreur).
INSERT INTO public.organisations (slug, nom, plan)
VALUES ('kaytek-inter', 'Kaytek Inter', 'pro')
ON CONFLICT (slug) DO NOTHING;
