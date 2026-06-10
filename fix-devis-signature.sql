-- ================================================================
-- SIGNATURE CLIENT SUR DEVIS
-- Exécuter dans Supabase → SQL Editor → Run
-- ================================================================

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS signature_client text,
  ADD COLUMN IF NOT EXISTS signature_date   timestamptz,
  ADD COLUMN IF NOT EXISTS signe_par        text;

-- Vérification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'devis'
  AND table_schema = 'public'
  AND column_name IN ('signature_client', 'signature_date', 'signe_par')
ORDER BY column_name;
