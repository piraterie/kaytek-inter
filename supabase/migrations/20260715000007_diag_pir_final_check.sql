DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'relforcerowsecurity: %', (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.partner_intervention_requests'::regclass);
  RAISE NOTICE 'relrowsecurity: %', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.partner_intervention_requests'::regclass);
  FOR r IN
    SELECT policyname, cmd, permissive, roles::text, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename='partner_intervention_requests' AND cmd='UPDATE'
  LOOP
    RAISE NOTICE 'policy=% roles=% USING=% CHECK=%', r.policyname, r.roles, r.qual, r.with_check;
  END LOOP;
  -- Test direct : simuler l'update en tant que postgres pour compter les lignes visibles par USING seul
  RAISE NOTICE 'row count visible (no RLS, postgres bypass): %', (SELECT count(*) FROM public.partner_intervention_requests WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
END $$;
