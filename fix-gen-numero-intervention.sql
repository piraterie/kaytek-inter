-- ================================================================
-- Fix gen_numero_intervention : génère TOUJOURS le numéro
-- Supprime le guard "IF NEW.numero IS NULL" → le DB est seul maître
-- À exécuter dans Supabase → SQL Editor → Run
-- ================================================================

CREATE OR REPLACE FUNCTION public.gen_numero_intervention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $gen_int$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'INT-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('int_numero_lock'));
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
    0
  )
  INTO maxn
  FROM public.interventions
  WHERE numero ~ ('^' || prefix || '[0-9]+$');
  NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  RETURN NEW;
END;
$gen_int$;

-- Vérification : doit afficher la définition mise à jour
SELECT prosrc
FROM pg_proc
WHERE proname = 'gen_numero_intervention'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
