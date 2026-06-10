-- ================================================================
-- Ajout colonnes matériel confirmé sur interventions
-- À exécuter dans Supabase → SQL Editor → Run
-- ================================================================

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS cout_pieces          numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materiel_payeur      text CHECK (materiel_payeur IN ('admin', 'intervenant')),
  ADD COLUMN IF NOT EXISTS materiel_confirme    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS materiel_confirme_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS materiel_confirme_at  timestamptz;

-- Vérification
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'interventions'
  AND column_name  IN ('cout_pieces','materiel_payeur','materiel_confirme','materiel_confirme_par','materiel_confirme_at')
ORDER BY ordinal_position;
