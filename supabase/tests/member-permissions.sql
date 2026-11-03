-- supabase/tests/member-permissions.sql
-- Test de non-régression des droits serveur (RLS + triggers) des rôles
-- assistant et intervenant, indépendamment des menus de l'interface.
--
-- Pile LOCALE uniquement (npm run test:permissions) : crée des données
-- jetables dans l'organisation de admin-a@kaytek.test, simule le JWT de
-- intervenant-a@kaytek.test (puis le même compte passé assistant), et
-- annule tout (ROLLBACK). Échoue (RAISE EXCEPTION) au premier écart.
--
-- Périmètre attendu (voir mémoire projet « assistant role ») :
--  - assistant : clients / interventions / photos / planning / messagerie ;
--    AUCUNE donnée financière (devis, factures, commissions, paramètres,
--    liens publics de documents) ; aucune suppression.
--  - intervenant : uniquement ses interventions (et leurs clients), ses
--    devis/factures, ses commissions ; aucune suppression.
--  - aucun membre ne peut s'attribuer ni attribuer un rôle / une
--    organisation / une commission, ni créer de profil.
BEGIN;

DO $$
DECLARE
  uid uuid := (SELECT id FROM public.profiles WHERE email = 'intervenant-a@kaytek.test');
  adm uuid := (SELECT id FROM public.profiles WHERE email = 'admin-a@kaytek.test');
  org uuid;
  orphan uuid := gen_random_uuid();
  c1 uuid; c2 uuid; i1 uuid; i2 uuid; d1 uuid; d2 uuid; f1 uuid; f2 uuid; l1 uuid; l2 uuid;
  persona text; n bigint; ok boolean;
  fails text := '';
BEGIN
  IF uid IS NULL OR adm IS NULL THEN
    RAISE EXCEPTION 'Comptes de test absents — lancer scripts/seed-local-test-accounts.mjs';
  END IF;
  org := (SELECT organisation_id FROM public.profiles WHERE id = adm);

  -- Données jetables (créées en tant que postgres)
  INSERT INTO auth.users(instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
    VALUES ('00000000-0000-0000-0000-000000000000', orphan, 'authenticated', 'authenticated', 'perm-orphan@example.invalid', '{"provider":"email"}', '{}', now(), now(), now());
  INSERT INTO public.clients(nom, organisation_id, created_by) VALUES ('perm C1', org, adm) RETURNING id INTO c1;
  INSERT INTO public.clients(nom, organisation_id, created_by) VALUES ('perm C2', org, adm) RETURNING id INTO c2;
  INSERT INTO public.interventions(organisation_id, client_id, intervenant_id, created_by) VALUES (org, c2, uid, adm) RETURNING id INTO i1;
  INSERT INTO public.interventions(organisation_id, client_id, intervenant_id, created_by) VALUES (org, c1, NULL, adm) RETURNING id INTO i2;
  INSERT INTO public.devis(organisation_id, client_id, created_by) VALUES (org, c1, adm) RETURNING id INTO d1;
  INSERT INTO public.devis(organisation_id, client_id, created_by) VALUES (org, c2, uid) RETURNING id INTO d2;
  INSERT INTO public.factures(organisation_id, client_id, created_by, intervention_id) VALUES (org, c1, adm, i2) RETURNING id INTO f1;
  INSERT INTO public.factures(organisation_id, client_id, created_by, intervention_id) VALUES (org, c2, adm, i1) RETURNING id INTO f2;
  INSERT INTO public.commissions(organisation_id, intervention_id, intervenant_id, montant_total_client, commission_pct, part_intervenant, commission_admin)
    VALUES (org, i1, uid, 100, 30, 30, 70), (org, i2, adm, 100, 30, 30, 70);
  INSERT INTO public.document_public_links(organisation_id, document_type, document_id, created_by) VALUES (org, 'devis', d1, adm) RETURNING id INTO l1;
  INSERT INTO public.document_public_links(organisation_id, document_type, document_id, created_by) VALUES (org, 'facture', f2, adm) RETURNING id INTO l2;

  FOREACH persona IN ARRAY ARRAY['intervenant', 'assistant'] LOOP
    -- (re)passer en postgres, sans JWT, pour fixer le rôle du compte de test
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    UPDATE public.profiles SET role = persona, actif = true WHERE id = uid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', uid::text, true);
    SET LOCAL ROLE authenticated;

    -- Lecture
    SELECT count(*) INTO n FROM public.clients WHERE id IN (c1, c2);
    IF n <> (CASE WHEN persona = 'assistant' THEN 2 ELSE 1 END) THEN fails := fails || format(E'%s voit %s/2 clients\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.interventions WHERE id IN (i1, i2);
    IF n <> (CASE WHEN persona = 'assistant' THEN 2 ELSE 1 END) THEN fails := fails || format(E'%s voit %s/2 interventions\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.devis WHERE id IN (d1, d2);
    IF n <> (CASE WHEN persona = 'assistant' THEN 0 ELSE 1 END) THEN fails := fails || format(E'%s voit %s/2 devis\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.factures WHERE id IN (f1, f2);
    IF n <> (CASE WHEN persona = 'assistant' THEN 0 ELSE 1 END) THEN fails := fails || format(E'%s voit %s/2 factures\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.commissions WHERE intervention_id IN (i1, i2);
    IF n <> (CASE WHEN persona = 'assistant' THEN 0 ELSE 1 END) THEN fails := fails || format(E'%s voit %s/2 commissions\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.document_public_links WHERE id IN (l1, l2);
    IF n <> 0 THEN fails := fails || format(E'%s voit %s/2 liens publics de documents\n', persona, n); END IF;
    SELECT count(*) INTO n FROM public.parametres_entreprise;
    IF n <> 0 THEN fails := fails || format(E'%s voit parametres_entreprise (IBAN…)\n', persona); END IF;
    SELECT count(*) INTO n FROM public.journal;
    IF n <> 0 THEN fails := fails || format(E'%s voit le journal\n', persona); END IF;

    -- Escalade de privilèges
    BEGIN
      UPDATE public.profiles SET role = 'admin' WHERE id = uid;
      fails := fails || format(E'%s peut se passer admin\n', persona);
      RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      UPDATE public.profiles SET commission_pct = 99 WHERE id = uid;
      fails := fails || format(E'%s peut modifier sa commission\n', persona);
      RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      INSERT INTO public.profiles(id, email, nom, prenom, role, organisation_id) VALUES (orphan, 'perm-orphan@example.invalid', 'x', 'x', 'admin', org);
      fails := fails || format(E'%s peut créer un profil admin\n', persona);
      RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      INSERT INTO public.organisations(nom) VALUES ('perm');
      fails := fails || format(E'%s peut créer une organisation\n', persona);
      RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION WHEN others THEN NULL; END;

    -- Suppressions : aucune
    BEGIN DELETE FROM public.clients WHERE id IN (c1, c2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
    IF n > 0 THEN fails := fails || format(E'%s supprime des clients\n', persona); END IF;
    BEGIN DELETE FROM public.interventions WHERE id IN (i1, i2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
    IF n > 0 THEN fails := fails || format(E'%s supprime des interventions\n', persona); END IF;
    BEGIN DELETE FROM public.devis WHERE id IN (d1, d2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
    IF n > 0 THEN fails := fails || format(E'%s supprime des devis\n', persona); END IF;
    BEGIN DELETE FROM public.factures WHERE id IN (f1, f2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
    IF n > 0 THEN fails := fails || format(E'%s supprime des factures\n', persona); END IF;
    BEGIN DELETE FROM public.document_public_links WHERE id IN (l1, l2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
    IF n > 0 THEN fails := fails || format(E'%s supprime des liens publics\n', persona); END IF;

    -- Écritures financières (assistant : aucune)
    IF persona = 'assistant' THEN
      BEGIN
        INSERT INTO public.devis(organisation_id, client_id, created_by) VALUES (org, c1, uid);
        fails := fails || E'assistant peut créer un devis\n';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        INSERT INTO public.factures(organisation_id, client_id, created_by) VALUES (org, c1, uid);
        fails := fails || E'assistant peut créer une facture\n';
        RAISE EXCEPTION USING ERRCODE = 'P0099';
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE public.factures SET notes = notes WHERE id IN (f1, f2); GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE = 'P0099'; EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; END;
      IF n > 0 THEN fails := fails || E'assistant peut modifier des factures\n'; END IF;
      -- Opérationnel : autorisé
      ok := true;
      BEGIN INSERT INTO public.clients(organisation_id, nom, created_by) VALUES (org, 'perm C3', uid); EXCEPTION WHEN others THEN ok := false; END;
      IF NOT ok THEN fails := fails || E'assistant ne peut pas créer de client\n'; END IF;
    END IF;

    RESET ROLE;
  END LOOP;

  IF fails <> '' THEN
    RAISE EXCEPTION E'Droits non conformes :\n%', fails;
  END IF;
  RAISE NOTICE 'member-permissions : OK (intervenant + assistant)';
END $$;

ROLLBACK;
