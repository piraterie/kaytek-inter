-- Migration : ajout du métier Chauffagiste
-- 2026-06-23

-- ── 1. Mise à jour de la contrainte categorie prestations ──────────────
DO $$
DECLARE
  conname text;
BEGIN
  SELECT tc.constraint_name INTO conname
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
  WHERE tc.table_name = 'prestations'
    AND cc.check_clause ILIKE '%categorie%'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.prestations DROP CONSTRAINT IF EXISTS ' || quote_ident(conname);
  END IF;
END $$;

ALTER TABLE public.prestations
  ADD CONSTRAINT prestations_categorie_check
  CHECK (categorie IN ('serrurerie', 'vitrerie', 'plomberie', 'electricite', 'chauffagiste'));

-- ── 2. Note : les prestations Chauffagiste par défaut sont insérées
--           via la migration 20260630000001_default_prestations_function.sql
--           qui gère correctement organisation_id pour toutes les orgs.
