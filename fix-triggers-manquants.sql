-- ================================================================
-- Création des triggers manquants (fonctions déjà en place)
-- À exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- [1] Trigger intervention
DROP TRIGGER IF EXISTS set_intervention_numero ON public.interventions;
CREATE TRIGGER set_intervention_numero
  BEFORE INSERT ON public.interventions
  FOR EACH ROW
  EXECUTE FUNCTION public.gen_numero_intervention();

-- [2] Trigger facture
DROP TRIGGER IF EXISTS set_facture_numero ON public.factures;
CREATE TRIGGER set_facture_numero
  BEFORE INSERT ON public.factures
  FOR EACH ROW
  EXECUTE FUNCTION public.gen_numero_facture();

-- ================================================================
-- [3] Vérification : doit retourner 3 lignes
-- ================================================================
SELECT
  t.trigger_name,
  t.event_object_table AS "table",
  t.action_statement   AS "fonction"
FROM information_schema.triggers t
WHERE t.event_object_schema = 'public'
  AND t.trigger_name IN (
    'set_intervention_numero',
    'set_devis_numero',
    'set_facture_numero'
  )
ORDER BY t.event_object_table;
