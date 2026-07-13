-- Diagnostic : USING avec valeur littérale codée en dur (pas de
-- fonction, pas de current_org_id()) pour vérifier si même un accès
-- trivial fonctionne en contexte UPDATE sur cette table.
DROP POLICY IF EXISTS "pir_update" ON public.partner_intervention_requests;
CREATE POLICY "pir_update" ON public.partner_intervention_requests
  FOR UPDATE
  USING (true);
