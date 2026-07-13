-- Diagnostic temporaire — fonction retirée par 20260714000007.
CREATE OR REPLACE FUNCTION public.diag_clients_insert_check()
RETURNS TABLE(my_uid uuid, my_org uuid, is_intervenant boolean, can_manage boolean)
LANGUAGE sql STABLE AS $$
  SELECT auth.uid(), public.current_org_id(),
         public.is_intervenant_in_org(public.current_org_id()),
         public.can_manage_operations(public.current_org_id())
$$;
GRANT EXECUTE ON FUNCTION public.diag_clients_insert_check() TO authenticated;
