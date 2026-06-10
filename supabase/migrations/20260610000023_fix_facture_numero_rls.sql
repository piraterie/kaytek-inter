-- ================================================================
-- MIGRATION : Correctif gen_numero_facture() — SECURITY DEFINER
-- Date      : 2026-06-10
-- Diagnostic: gen_numero_facture() avait security_definer = false
--             → query MAX(numero) filtrée par RLS Phase 5
--             → MAX calculé sur sous-ensemble → numéro déjà existant
--             → UNIQUE VIOLATION 23505
-- Fix       : Recréer la fonction en SECURITY DEFINER + SET search_path
--             Propriétaire postgres (superuser) → bypass RLS garanti
--             Supprimer les deux triggers redondants, n'en garder qu'un.
-- Tables    : public.factures (trigger uniquement)
-- RLS       : non modifiées
-- Frontend  : non modifié
-- ================================================================

-- ── Supprimer les deux triggers existants ───────────────────────
DROP TRIGGER IF EXISTS set_facture_numero ON public.factures;
DROP TRIGGER IF EXISTS trg_facture_numero ON public.factures;

-- ── Recréer la fonction avec SECURITY DEFINER ───────────────────
-- SECURITY DEFINER + owner = postgres → bypass RLS complet
-- SET search_path = public → résolution des tables garantie
-- pg_advisory_xact_lock → sérialisation des INSERT concurrents
-- Format conservé : FAC-YYYY-NNN (ex. FAC-2026-007)
CREATE OR REPLACE FUNCTION public.gen_numero_facture()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $func_fac$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'FAC-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    -- Verrou transactionnel : empêche deux INSERT concurrents
    -- de lire le même MAX et générer le même numéro.
    -- Libéré automatiquement à la fin de la transaction.
    PERFORM pg_advisory_xact_lock(hashtext('factures_numero_lock'));

    -- SECURITY DEFINER + postgres owner → voit TOUTES les factures
    -- indépendamment des policies RLS du user appelant.
    SELECT COALESCE(
      MAX(
        CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)
      ),
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

-- Propriété explicite : postgres est superuser dans Supabase
-- → SECURITY DEFINER garantit un bypass RLS complet
ALTER FUNCTION public.gen_numero_facture() OWNER TO postgres;

-- ── Recréer un seul trigger ──────────────────────────────────────
CREATE TRIGGER set_facture_numero
  BEFORE INSERT ON public.factures
  FOR EACH ROW
  EXECUTE FUNCTION public.gen_numero_facture();

-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

-- 1. Fonction : SECURITY DEFINER = true, owner = postgres
SELECT
  proname           AS fonction,
  prosecdef         AS security_definer,
  proowner::regrole AS owner
FROM pg_proc
WHERE proname      = 'gen_numero_facture'
  AND pronamespace = 'public'::regnamespace;
-- Attendu : security_definer = true | owner = postgres

-- 2. Un seul trigger de numérotation sur factures
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'factures'
  AND trigger_name        IN ('set_facture_numero', 'trg_facture_numero')
ORDER BY trigger_name;
-- Attendu : 1 seule ligne — set_facture_numero | INSERT | BEFORE

-- 3. Aucun doublon de numéro
SELECT numero, COUNT(*) AS occurrences
FROM public.factures
GROUP BY numero
HAVING COUNT(*) > 1;
-- Attendu : 0 lignes
