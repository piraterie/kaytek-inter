-- Diagnostic (lecture seule, aucun effet de schéma persistant hormis
-- les NOTICE) : a permis d'identifier que le blocage RLS sur la
-- création de client par un intervenant venait de clients_select
-- (RETURNING implicite de l'INSERT), pas de clients_insert.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'relforcerowsecurity: %', (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.clients'::regclass);
  RAISE NOTICE 'relrowsecurity: %', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clients'::regclass);
  FOR r IN
    SELECT policyname, cmd, permissive, roles, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clients'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % cmd=% permissive=% roles=% check=%', r.policyname, r.cmd, r.permissive, r.roles, r.with_check;
  END LOOP;
  FOR r IN
    SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
    FROM pg_trigger
    WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal
  LOOP
    RAISE NOTICE 'TRIGGER % enabled=% def=%', r.tgname, r.tgenabled, r.def;
  END LOOP;
END $$;
