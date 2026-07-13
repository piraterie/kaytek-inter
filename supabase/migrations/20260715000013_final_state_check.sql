DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename='partner_intervention_requests'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'POLICY % (%) USING=% CHECK=%', r.policyname, r.cmd, r.qual, r.with_check;
  END LOOP;
  RAISE NOTICE 'RPC respond_to_partner_intervention_request exists: %', EXISTS(SELECT 1 FROM pg_proc WHERE proname='respond_to_partner_intervention_request' AND pronamespace='public'::regnamespace);
  RAISE NOTICE 'RPC get_partner_requests_preview exists: %', EXISTS(SELECT 1 FROM pg_proc WHERE proname='get_partner_requests_preview' AND pronamespace='public'::regnamespace);
  RAISE NOTICE 'diag functions remaining (should be 0): %', (SELECT count(*) FROM pg_proc WHERE proname LIKE 'diag_%' AND pronamespace='public'::regnamespace);
  RAISE NOTICE 'test fixture rows remaining (should be 0): %', (SELECT count(*) FROM public.partner_intervention_requests WHERE description_partagee IN ('Serrure bloquee','Fuite eau') OR nom_client_partage IN ('CONFIDENTIEL Dupont','SECRET Martin','CACHE Durand'));
END $$;
