-- Diagnostic temporaire (invoker rights, pas SECURITY DEFINER) pour
-- reproduire exactement le contexte RLS d'un INSERT sur notifications
-- et isoler quelle sous-condition de notif_insert échoue.
CREATE OR REPLACE FUNCTION public.diag_notif_check(p_target_user uuid, p_org uuid)
RETURNS TABLE(org_matches boolean, current_org uuid, exists_check boolean, my_uid uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (p_org = public.current_org_id()) AS org_matches,
    public.current_org_id() AS current_org,
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_target_user
        AND p.organisation_id = p_org
        AND p.actif = true
    ) AS exists_check,
    auth.uid() AS my_uid
$$;
GRANT EXECUTE ON FUNCTION public.diag_notif_check(uuid, uuid) TO authenticated;
