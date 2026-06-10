-- ================================================================
-- NETTOYAGE DÉFINITIF — TRIGGERS DEVIS
-- Exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- ── Étape 1 : Supprimer LES DEUX triggers de numéro ─────────────
DROP TRIGGER IF EXISTS set_devis_numero ON public.devis;
DROP TRIGGER IF EXISTS trg_devis_numero ON public.devis;

-- ── Étape 2 : Calage précis de la séquence ───────────────────────
-- Crée la séquence si absente, puis la cale sur le max actuel
CREATE SEQUENCE IF NOT EXISTS devis_numero_seq START 1;

SELECT setval(
  'devis_numero_seq',
  COALESCE(
    (SELECT MAX(
        CAST(REGEXP_REPLACE(numero, '^DEV-\d{4}-0*', '') AS INTEGER)
      )
      FROM public.devis
      WHERE numero ~ '^DEV-\d{4}-\d+$'
    ), 0
  ) + 1,
  false
);

-- ── Étape 3 : Unique fonction de génération (séquence atomique) ──
CREATE OR REPLACE FUNCTION public.generate_devis_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'DEV-'
      || EXTRACT(YEAR FROM NOW())::TEXT
      || '-'
      || LPAD(nextval('devis_numero_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ── Étape 4 : UN SEUL trigger propre ─────────────────────────────
CREATE TRIGGER set_devis_numero
  BEFORE INSERT ON public.devis
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_devis_numero();

-- ── Étape 5 : Vérification finale ────────────────────────────────
-- Doit afficher : set_devis_numero (INSERT) + trg_devis_updated_at + trg_journal_devis x3
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'devis'
  AND event_object_schema = 'public'
ORDER BY trigger_name, event_manipulation;
