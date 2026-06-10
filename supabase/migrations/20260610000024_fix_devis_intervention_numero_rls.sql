-- ================================================================
-- MIGRATION : Correctif gen_numero_intervention() + generate_devis_numero()
-- Date      : 2026-06-10
-- Contexte  : Après Phase 5 RLS, les fonctions de numérotation
--             peuvent voir un MAX filtré par les policies RLS,
--             générant un numéro déjà existant → UNIQUE VIOLATION.
--             Même cause que gen_numero_facture() corrigé en 00023.
-- Causes identifiées :
--   · gen_numero_intervention() — SECURITY DEFINER, pas SET search_path
--   · generate_devis_numero()   — SECURITY DEFINER, pas SET search_path
--     + historiquement réécrite 3x, parfois avec nextval() sans
--       reset annuel → numéros cross-année.
-- Fix       : Recréer les deux fonctions :
--             SECURITY DEFINER + SET search_path = public
--             MAX+1 par année + advisory lock (pas de séquence)
--             OWNER TO postgres → bypass RLS garanti
--             Un seul trigger BEFORE INSERT par table.
-- Tables    : public.devis, public.interventions (triggers uniquement)
-- RLS       : non modifiées
-- Frontend  : non modifié
-- Format    : DEV-YYYY-NNN et INT-YYYY-NNN conservés
-- ================================================================


-- ================================================================
-- PARTIE 1 — DEVIS
-- ================================================================

-- ── Supprimer tous les triggers connus ──────────────────────────
-- Noms vus dans : fix-all-numeros.sql / fix-devis-numero.sql /
--                 fix-devis-triggers-cleanup.sql
DROP TRIGGER IF EXISTS set_devis_numero  ON public.devis;
DROP TRIGGER IF EXISTS trg_devis_numero  ON public.devis;

-- ── Recréer la fonction avec SECURITY DEFINER ───────────────────
-- Retour à MAX+1 par préfixe annuel : remet le compteur à zéro
-- chaque nouvelle année (DEV-2026-NNN → DEV-2027-001 en jan 2027)
-- Remplace la version basée sur nextval('devis_numero_seq') qui
-- ne réinitialisait pas d'une année sur l'autre.
CREATE OR REPLACE FUNCTION public.generate_devis_numero()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $func_dev$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'DEV-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('dev_numero_lock'));

    SELECT COALESCE(
      MAX(
        CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)
      ),
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

ALTER FUNCTION public.generate_devis_numero() OWNER TO postgres;

-- ── Recréer un seul trigger ──────────────────────────────────────
CREATE TRIGGER set_devis_numero
  BEFORE INSERT ON public.devis
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_devis_numero();


-- ================================================================
-- PARTIE 2 — INTERVENTIONS
-- ================================================================

-- ── Supprimer tous les triggers connus ──────────────────────────
-- Noms vus dans : fix-all-numeros.sql / fix-intervention-numero.sql /
--                 fix-gen-numero-intervention.sql / fix-triggers-manquants.sql
DROP TRIGGER IF EXISTS set_intervention_numero ON public.interventions;

-- ── Supprimer les deux variantes de fonction connues ────────────
-- generate_intervention_numero() — fix-all-numeros.sql / fix-intervention-numero.sql
-- gen_numero_intervention()      — fix-gen-numero-intervention.sql (version actuelle)
-- Les deux font la même chose ; on n'en garde qu'une.
DROP FUNCTION IF EXISTS public.generate_intervention_numero();

-- ── Recréer la fonction avec SECURITY DEFINER ───────────────────
-- Nom conservé : gen_numero_intervention() (nom actuel en production
-- d'après fix-triggers-manquants.sql)
-- Null guard ajouté : cohérent avec gen_numero_facture (migration 00023)
-- et évite de regénérer le numéro si déjà défini.
CREATE OR REPLACE FUNCTION public.gen_numero_intervention()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $func_int$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'INT-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('int_numero_lock'));

    SELECT COALESCE(
      MAX(
        CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)
      ),
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

ALTER FUNCTION public.gen_numero_intervention() OWNER TO postgres;

-- ── Recréer un seul trigger ──────────────────────────────────────
CREATE TRIGGER set_intervention_numero
  BEFORE INSERT ON public.interventions
  FOR EACH ROW
  EXECUTE FUNCTION public.gen_numero_intervention();


-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

-- 1. Fonctions : SECURITY DEFINER = true, owner = postgres
SELECT
  proname           AS fonction,
  prosecdef         AS security_definer,
  proowner::regrole AS owner
FROM pg_proc
WHERE proname IN ('generate_devis_numero', 'gen_numero_intervention',
                  'generate_intervention_numero')
  AND pronamespace = 'public'::regnamespace;
-- Attendu :
--   generate_devis_numero      | true | postgres
--   gen_numero_intervention    | true | postgres
--   generate_intervention_numero → NE DOIT PLUS APPARAÎTRE (supprimée)

-- 2. Un seul trigger de numérotation par table
SELECT
  trigger_name,
  event_object_table  AS "table",
  event_manipulation  AS "event",
  action_timing       AS "timing",
  action_statement    AS "fonction"
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  IN ('devis', 'interventions')
  AND trigger_name IN ('set_devis_numero', 'trg_devis_numero',
                       'set_intervention_numero')
ORDER BY event_object_table, trigger_name;
-- Attendu : 1 ligne devis (set_devis_numero) + 1 ligne interventions (set_intervention_numero)

-- 3. Aucun doublon de numéro
SELECT 'devis' AS "table", numero, COUNT(*) AS occurrences
  FROM public.devis GROUP BY numero HAVING COUNT(*) > 1
UNION ALL
SELECT 'interventions', numero, COUNT(*)
  FROM public.interventions GROUP BY numero HAVING COUNT(*) > 1;
-- Attendu : 0 lignes
