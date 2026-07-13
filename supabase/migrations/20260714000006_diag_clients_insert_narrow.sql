-- Diagnostic : réduction temporaire de clients_insert à la seule
-- vérification d'organisation, pour isoler si le blocage RLS venait
-- de la clause admin/intervenant ou d'ailleurs. A confirmé que même
-- ce check minimal échouait — le vrai coupable était clients_select
-- (RETURNING implicite), corrigé par 20260714000007 qui restaure la
-- policy complète et étend clients_select.
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (organisation_id = current_org_id());
