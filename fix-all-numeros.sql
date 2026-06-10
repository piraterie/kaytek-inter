-- ================================================================
-- Fix définitif : génération numéros sans doublon
-- INT-YYYY-NNN  ·  DEV-YYYY-NNN  ·  FAC-YYYY-NNN
--
-- Méthode : SUBSTRING + MAX+1 avec pg_advisory_xact_lock
-- Chaque fonction utilise un délimiteur unique ($func_int$, etc.)
-- pour éviter toute ambiguïté de parsing dans le SQL Editor.
-- Script idempotent : réexécutable sans erreur.
--
-- À exécuter dans Supabase → SQL Editor → Run
-- ================================================================


-- ================================================================
-- [1] INTERVENTIONS
-- ================================================================

DROP TRIGGER IF EXISTS set_intervention_numero ON public.interventions;
DROP FUNCTION IF EXISTS public.generate_intervention_numero();

CREATE OR REPLACE FUNCTION public.generate_intervention_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_int$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'INT-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('int_numero_lock'));
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
      0
    )
    INTO maxn
    FROM public.interventions
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_int$;

CREATE TRIGGER set_intervention_numero
  BEFORE INSERT ON public.interventions
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_intervention_numero();


-- ================================================================
-- [2] DEVIS
-- ================================================================

DROP TRIGGER IF EXISTS set_devis_numero ON public.devis;
DROP TRIGGER IF EXISTS trg_devis_numero ON public.devis;
DROP FUNCTION IF EXISTS public.generate_devis_numero();

CREATE OR REPLACE FUNCTION public.generate_devis_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_dev$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'DEV-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('dev_numero_lock'));
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
      0
    )
    INTO maxn
    FROM public.devis
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_dev$;

CREATE TRIGGER set_devis_numero
  BEFORE INSERT ON public.devis
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_devis_numero();


-- ================================================================
-- [3] FACTURES
-- ================================================================

DROP TRIGGER IF EXISTS set_facture_numero ON public.factures;
DROP FUNCTION IF EXISTS public.generate_facture_numero();

CREATE OR REPLACE FUNCTION public.generate_facture_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_fac$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'FAC-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('fac_numero_lock'));
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
      0
    )
    INTO maxn
    FROM public.factures
    WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_fac$;

CREATE TRIGGER set_facture_numero
  BEFORE INSERT ON public.factures
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_facture_numero();


-- ================================================================
-- [4] VÉRIFICATION — doit retourner 3 lignes
-- ================================================================

SELECT
  t.trigger_name,
  t.event_object_table  AS "table",
  t.event_manipulation  AS "event",
  t.action_timing       AS "timing"
FROM information_schema.triggers t
WHERE t.event_object_schema = 'public'
  AND t.trigger_name IN (
    'set_intervention_numero',
    'set_devis_numero',
    'set_facture_numero'
  )
ORDER BY t.event_object_table;

-- ================================================================
-- [5] VÉRIFICATION FONCTIONS — doit retourner 3 lignes
-- ================================================================

SELECT
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'generate_intervention_numero',
    'generate_devis_numero',
    'generate_facture_numero'
  )
ORDER BY routine_name;
