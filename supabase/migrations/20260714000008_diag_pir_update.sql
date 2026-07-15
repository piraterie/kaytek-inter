DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'partner_intervention_requests'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % cmd=% permissive=% roles=% USING=% CHECK=%', r.policyname, r.cmd, r.permissive, r.roles, r.qual, r.with_check;
  END LOOP;
END $$;
