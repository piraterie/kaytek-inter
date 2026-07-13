-- Diagnostic : réduit pir_update à la condition la plus simple possible
-- (identique à la branche qui fonctionne déjà dans pir_select) pour
-- isoler si le problème vient de is_admin_in_org, du OR multi-branche,
-- ou d'autre chose de spécifique à la commande UPDATE.
DROP POLICY IF EXISTS "pir_update" ON public.partner_intervention_requests;
CREATE POLICY "pir_update" ON public.partner_intervention_requests
  FOR UPDATE
  USING (current_org_id() = target_organisation_id);
