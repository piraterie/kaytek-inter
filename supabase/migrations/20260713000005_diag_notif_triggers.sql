DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgname, tgtype, tgenabled, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal
  LOOP
    RAISE NOTICE 'TRIGGER % enabled=% def=%', r.tgname, r.tgenabled, r.def;
  END LOOP;
  RAISE NOTICE 'RLS forced: %', (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass);
END $$;
