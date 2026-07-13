DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '=== RULES ===';
  FOR r IN SELECT rulename, definition FROM pg_rules WHERE tablename='partner_intervention_requests'
  LOOP RAISE NOTICE 'RULE % def=%', r.rulename, r.definition; END LOOP;

  RAISE NOTICE '=== ALL TABLES NAMED partner_intervention_requests (any schema) ===';
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE tablename='partner_intervention_requests'
  LOOP RAISE NOTICE 'schema=% table=%', r.schemaname, r.tablename; END LOOP;

  RAISE NOTICE '=== ALL POLICIES ON partner_intervention_requests (any schema, no filter) ===';
  FOR r IN SELECT schemaname, policyname, cmd, permissive FROM pg_policies WHERE tablename='partner_intervention_requests'
  LOOP RAISE NOTICE 'schema=% policy=% cmd=% permissive=%', r.schemaname, r.policyname, r.cmd, r.permissive; END LOOP;

  RAISE NOTICE '=== event triggers (DDL-level, could affect DML indirectly? unlikely but check) ===';
  FOR r IN SELECT evtname, evtevent, evtenabled FROM pg_event_trigger
  LOOP RAISE NOTICE 'evt=% event=% enabled=%', r.evtname, r.evtevent, r.evtenabled; END LOOP;
END $$;
