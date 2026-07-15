-- Diagnostic (lecture seule, aucun effet de schéma) : dump des policies
-- de public.clients pour investiguer un échec RLS inattendu côté
-- création de client par un intervenant.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clients'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % (%) — USING: % — WITH CHECK: %', r.policyname, r.cmd, r.qual, r.with_check;
  END LOOP;
END $$;
