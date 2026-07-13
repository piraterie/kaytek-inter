-- Diagnostic : élargir temporairement pir_select à USING(true) EN PLUS
-- de pir_update déjà à USING(true), pour tester l'hypothèse que
-- Postgres RLS exige aussi la policy SELECT pour qu'une ligne soit
-- matchable par UPDATE (même quand une policy UPDATE dédiée existe).
DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (true);
