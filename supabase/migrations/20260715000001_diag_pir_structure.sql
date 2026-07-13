DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '=== COLUMNS ===';
  FOR r IN
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='partner_intervention_requests'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE 'COL % type=% nullable=%', r.column_name, r.data_type, r.is_nullable;
  END LOOP;

  RAISE NOTICE '=== GRANTS ===';
  FOR r IN
    SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='partner_intervention_requests'
    ORDER BY grantee, privilege_type
  LOOP
    RAISE NOTICE 'GRANT % TO %', r.privilege_type, r.grantee;
  END LOOP;

  RAISE NOTICE '=== TABLE OWNER ===';
  RAISE NOTICE 'owner=%', (SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='partner_intervention_requests');
END $$;
