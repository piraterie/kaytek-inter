CREATE OR REPLACE FUNCTION public.diag_pir_update_check(p_source uuid, p_target uuid)
RETURNS TABLE(my_org uuid, is_admin boolean, matches_using boolean)
LANGUAGE sql STABLE AS $$
  SELECT public.current_org_id(),
         public.is_admin_in_org(public.current_org_id()),
         ((public.current_org_id() = p_source) OR (public.current_org_id() = p_target)) AND public.is_admin_in_org(public.current_org_id())
$$;
GRANT EXECUTE ON FUNCTION public.diag_pir_update_check(uuid, uuid) TO authenticated;
