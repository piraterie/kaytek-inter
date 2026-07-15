-- Diagnostic (lecture seule) : dump de la policy notif_insert réellement
-- en vigueur en production, pour vérifier si elle correspond aux
-- migrations trackées localement (suspicion de drift non versionné).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % (%) — USING: % — WITH CHECK: %', r.policyname, r.cmd, r.qual, r.with_check;
  END LOOP;
END $$;
