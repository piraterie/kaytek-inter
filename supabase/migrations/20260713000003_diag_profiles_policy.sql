DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd, qual, with_check, permissive
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % (% / %) — USING: % — WITH CHECK: %', r.policyname, r.cmd, r.permissive, r.qual, r.with_check;
  END LOOP;
END $$;
