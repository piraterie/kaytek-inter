-- ================================================================
-- TESTS LOCAUX — Correction 12 (Google Ads : données horaires, appareils,
-- démographie, géographie, zones ciblées, campagnes, état de sync) —
-- RLS multi-tenant, écritures interdites, contraintes, idempotence, purge,
-- référentiel géographique partagé.
-- ================================================================
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE SUPABASE LOCALE OU DE TEST DÉDIÉE.
-- NE JAMAIS EXÉCUTER CONTRE LA PRODUCTION.
-- Ce fichier N'EST PAS une migration. Fixtures FICTIVES sous des UUID dédiés,
-- transaction annulée (ROLLBACK final) : rien ne persiste. Aucun secret réel.
-- Prérequis : migrations 20260921120000 (tables) et 20260921120100 (cron).
-- Simulation de auth.uid() : `SET LOCAL role authenticated` +
-- set_config('request.jwt.claim.sub', ...) (comme correction-06).
-- ================================================================

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'itest-admin-a@test.local'),
  ('20000000-0000-0000-0000-00000000a002', 'itest-assistant-a@test.local'),
  ('20000000-0000-0000-0000-00000000a003', 'itest-intervenant-a@test.local'),
  ('20000000-0000-0000-0000-00000000b001', 'itest-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organisations (id, slug, nom, plan, actif) VALUES
  ('20000000-0000-0000-0000-0000000000a1', 'itest-org-a', 'ITest Org A', 'pro', true),
  ('20000000-0000-0000-0000-0000000000b1', 'itest-org-b', 'ITest Org B', 'pro', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif, can_create_documents, can_bypass_validation) VALUES
  ('20000000-0000-0000-0000-00000000a001', 'itest-admin-a@test.local',       'ITest', 'AdminA',       'admin',       '20000000-0000-0000-0000-0000000000a1', true, true,  true),
  ('20000000-0000-0000-0000-00000000a002', 'itest-assistant-a@test.local',   'ITest', 'AssistantA',   'assistant',   '20000000-0000-0000-0000-0000000000a1', true, false, false),
  ('20000000-0000-0000-0000-00000000a003', 'itest-intervenant-a@test.local', 'ITest', 'IntervenantA', 'intervenant', '20000000-0000-0000-0000-0000000000a1', true, false, false),
  ('20000000-0000-0000-0000-00000000b001', 'itest-admin-b@test.local',       'ITest', 'AdminB',       'admin',       '20000000-0000-0000-0000-0000000000b1', true, true,  true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN RAISE NOTICE '=== Fixtures : 2 organisations, données Google Ads fictives par table ==='; END $$;

-- Données org A (2 lignes par table quand pertinent) et org B (1 ligne).
INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, campaign_name, local_date, hour, impressions, clicks, cost_micros) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', current_date, 8,  10, 1, 1000000),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', current_date, 9,  20, 2, 2000000),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', 'c9', 'Camp B', current_date, 8,  99, 9, 9000000);
INSERT INTO public.google_ads_devices_daily (organisation_id, customer_id, local_date, device, impressions) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'MOBILE', 10),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'DESKTOP', 5),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', current_date, 'MOBILE', 50);
INSERT INTO public.google_ads_demographics_daily (organisation_id, customer_id, local_date, dimension, value, impressions) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'age_range', 'AGE_RANGE_25_34', 10),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'gender', 'UNDETERMINED', 7),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', current_date, 'gender', 'FEMALE', 50);
INSERT INTO public.google_ads_geo_daily (organisation_id, customer_id, local_date, geo_level, presence_type, geo_target_id, impressions) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'city', 'LOCATION_OF_PRESENCE', 1001, 10),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', current_date, 'postal_code', 'LOCATION_OF_PRESENCE', 1005, 4),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', current_date, 'city', 'LOCATION_OF_PRESENCE', 1002, 50);
INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, campaign_name, campaign_status, criterion_id, zone_type, latitude, longitude, radius, radius_unit, geo_target_id, label) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', 'ENABLED', 501, 'PROXIMITY', 43.579286, 1.439845, 20, 'KILOMETERS', NULL, NULL),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', 'ENABLED', 502, 'LOCATION', NULL, NULL, NULL, NULL, 1003, 'Labege'),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', 'c9', 'Camp B', 'ENABLED', 601, 'LOCATION', NULL, NULL, NULL, NULL, 1002, 'Autre ville');
INSERT INTO public.google_ads_campaigns (organisation_id, customer_id, campaign_id, name, status) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', 'ENABLED'),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c2', 'Camp A2', 'PAUSED'),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', 'c9', 'Camp B', 'ENABLED');
INSERT INTO public.google_ads_sync_state (organisation_id, customer_id, dataset, synced_at) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'hourly', now()),
  ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'geo', now()),
  ('20000000-0000-0000-0000-0000000000b1', '9998887777', 'hourly', now());
-- Référentiel : 1001 (ville org A), 1002 (ville org B seule), 1003 (zone org A),
-- 1004 (référencée par personne), 1005 (code postal org A).
INSERT INTO public.google_geo_targets (geo_target_id, name, canonical_name, target_type, country_code, region_name) VALUES
  (1001, 'Toulouse', 'Toulouse,Occitanie,France', 'City', 'FR', 'Occitanie'),
  (1002, 'Bordeaux', 'Bordeaux,Nouvelle-Aquitaine,France', 'City', 'FR', 'Nouvelle-Aquitaine'),
  (1003, 'Labege', 'Labege,Occitanie,France', 'City', 'FR', 'Occitanie'),
  (1004, 'Lyon', 'Lyon,Auvergne-Rhone-Alpes,France', 'City', 'FR', 'Auvergne-Rhone-Alpes'),
  (1005, '31000', '31000,Occitanie,France', 'Postal Code', 'FR', 'Occitanie');

-- ── Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert_visible_count(p_label text, p_uid uuid, p_sql text, p_expected bigint)
RETURNS void AS $$
DECLARE v_actual bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  EXECUTE p_sql INTO v_actual;
  RESET role;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ÉCHEC [%] — attendu %, obtenu %', p_label, p_expected, v_actual;
  END IF;
  RAISE NOTICE 'OK [%] — %', p_label, v_actual;
END;
$$ LANGUAGE plpgsql;

-- Une écriture par un rôle applicatif doit être refusée (erreur de droits ou de RLS).
CREATE OR REPLACE FUNCTION pg_temp.assert_write_denied(p_label text, p_uid uuid, p_sql text)
RETURNS void AS $$
DECLARE v_denied boolean := false; v_rows bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  SET LOCAL role = 'authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_denied := true; END IF;   -- RLS filtre silencieusement les UPDATE/DELETE
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  RESET role;
  IF NOT v_denied THEN RAISE EXCEPTION 'ÉCHEC [%] — l''écriture a réussi alors qu''elle devait être refusée', p_label; END IF;
  RAISE NOTICE 'OK [%] — écriture refusée', p_label;
END;
$$ LANGUAGE plpgsql;

-- Une instruction (exécutée par postgres) doit violer une contrainte.
CREATE OR REPLACE FUNCTION pg_temp.assert_constraint(p_label text, p_sql text)
RETURNS void AS $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation OR unique_violation OR not_null_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ÉCHEC [%] — la contrainte n''a pas bloqué l''instruction', p_label; END IF;
  RAISE NOTICE 'OK [%] — contrainte respectée', p_label;
END;
$$ LANGUAGE plpgsql;

-- ── 1. Isolation multi-tenant : un admin ne voit que son organisation ─────
DO $$
DECLARE
  A constant uuid := '20000000-0000-0000-0000-00000000a001';
  B constant uuid := '20000000-0000-0000-0000-00000000b001';
  t text; expected_a bigint; expected_b bigint;
BEGIN
  RAISE NOTICE '=== 1. Isolation entre organisations ===';
  FOR t, expected_a, expected_b IN VALUES
    ('google_ads_metrics_hourly', 2, 1), ('google_ads_devices_daily', 2, 1), ('google_ads_demographics_daily', 2, 1),
    ('google_ads_geo_daily', 2, 1), ('google_ads_targeted_zones', 2, 1), ('google_ads_campaigns', 2, 1),
    ('google_ads_sync_state', 2, 1)
  LOOP
    PERFORM pg_temp.assert_visible_count('admin A voit ses lignes de '||t, A, format('SELECT count(*) FROM public.%I', t), expected_a);
    PERFORM pg_temp.assert_visible_count('admin A ne voit AUCUNE ligne de l''org B dans '||t, A,
      format('SELECT count(*) FROM public.%I WHERE organisation_id = ''20000000-0000-0000-0000-0000000000b1''', t), 0);
    PERFORM pg_temp.assert_visible_count('admin B voit ses lignes de '||t, B, format('SELECT count(*) FROM public.%I', t), expected_b);
    PERFORM pg_temp.assert_visible_count('admin B ne voit AUCUNE ligne de l''org A dans '||t, B,
      format('SELECT count(*) FROM public.%I WHERE organisation_id = ''20000000-0000-0000-0000-0000000000a1''', t), 0);
  END LOOP;
END $$;

-- ── 2. Même logique que google_ads_metrics_daily : admin uniquement ────────
DO $$
DECLARE
  ASSISTANT constant uuid := '20000000-0000-0000-0000-00000000a002';
  INTERV constant uuid := '20000000-0000-0000-0000-00000000a003';
  t text;
BEGIN
  RAISE NOTICE '=== 2. Assistant et intervenant : aucune lecture (comme google_ads_metrics_daily) ===';
  FOREACH t IN ARRAY ARRAY['google_ads_metrics_hourly','google_ads_devices_daily','google_ads_demographics_daily','google_ads_geo_daily','google_ads_targeted_zones','google_ads_campaigns','google_ads_sync_state','google_geo_targets'] LOOP
    PERFORM pg_temp.assert_visible_count('assistant A ne lit pas '||t, ASSISTANT, format('SELECT count(*) FROM public.%I', t), 0);
    PERFORM pg_temp.assert_visible_count('intervenant A ne lit pas '||t, INTERV, format('SELECT count(*) FROM public.%I', t), 0);
  END LOOP;
END $$;

-- ── 3. anon : aucun accès ─────────────────────────────────────────────────
DO $$
DECLARE t text; n bigint; denied boolean;
BEGIN
  RAISE NOTICE '=== 3. Rôle anon : aucun accès ===';
  FOREACH t IN ARRAY ARRAY['google_ads_metrics_hourly','google_ads_devices_daily','google_ads_demographics_daily','google_ads_geo_daily','google_ads_targeted_zones','google_ads_campaigns','google_ads_sync_state','google_geo_targets'] LOOP
    denied := false; n := NULL;
    SET LOCAL role = 'anon';
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n = 0 THEN denied := true; END IF;
    EXCEPTION WHEN OTHERS THEN denied := true;
    END;
    RESET role;
    IF NOT denied THEN RAISE EXCEPTION 'ÉCHEC [anon lit %] — % ligne(s) visibles', t, n; END IF;
    RAISE NOTICE 'OK [anon refusé sur %]', t;
  END LOOP;
END $$;

-- ── 4. Écritures interdites pour authenticated (même admin de sa propre org) ─
DO $$
DECLARE
  A constant uuid := '20000000-0000-0000-0000-00000000a001';
  o constant text := '20000000-0000-0000-0000-0000000000a1';
BEGIN
  RAISE NOTICE '=== 4. Écritures interdites pour un admin authentifié ===';
  PERFORM pg_temp.assert_write_denied('INSERT hourly', A, format('INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour) VALUES (%L, ''1112223333'', ''cx'', current_date, 1)', o));
  PERFORM pg_temp.assert_write_denied('UPDATE hourly', A, 'UPDATE public.google_ads_metrics_hourly SET impressions = 99999');
  PERFORM pg_temp.assert_write_denied('DELETE hourly', A, 'DELETE FROM public.google_ads_metrics_hourly');
  PERFORM pg_temp.assert_write_denied('INSERT devices', A, format('INSERT INTO public.google_ads_devices_daily (organisation_id, customer_id, local_date, device) VALUES (%L, ''1112223333'', current_date, ''TABLET'')', o));
  PERFORM pg_temp.assert_write_denied('UPDATE demographics', A, 'UPDATE public.google_ads_demographics_daily SET impressions = 1');
  PERFORM pg_temp.assert_write_denied('DELETE geo', A, 'DELETE FROM public.google_ads_geo_daily');
  PERFORM pg_temp.assert_write_denied('UPDATE zones', A, 'UPDATE public.google_ads_targeted_zones SET radius = 1');
  PERFORM pg_temp.assert_write_denied('UPDATE campaigns (statut)', A, 'UPDATE public.google_ads_campaigns SET status = ''ENABLED''');
  PERFORM pg_temp.assert_write_denied('UPDATE sync_state', A, 'UPDATE public.google_ads_sync_state SET synced_at = now()');
  PERFORM pg_temp.assert_write_denied('INSERT geo_targets', A, 'INSERT INTO public.google_geo_targets (geo_target_id, name) VALUES (9999, ''X'')');
  PERFORM pg_temp.assert_write_denied('UPDATE geo_targets', A, 'UPDATE public.google_geo_targets SET name = ''X''');
  PERFORM pg_temp.assert_write_denied('DELETE geo_targets', A, 'DELETE FROM public.google_geo_targets');
  -- Les données n'ont pas bougé
  PERFORM pg_temp.assert_visible_count('hourly inchangée après les tentatives', A, 'SELECT sum(impressions) FROM public.google_ads_metrics_hourly', 30);
END $$;

-- ── 5. Référentiel géographique : jamais de fuite entre organisations ─────
DO $$
DECLARE
  A constant uuid := '20000000-0000-0000-0000-00000000a001';
  B constant uuid := '20000000-0000-0000-0000-00000000b001';
BEGIN
  RAISE NOTICE '=== 5. google_geo_targets : lisible uniquement pour les zones référencées par SA propre organisation ===';
  PERFORM pg_temp.assert_visible_count('admin A voit 1001 (ville), 1003 (zone) et 1005 (code postal)', A, 'SELECT count(*) FROM public.google_geo_targets WHERE geo_target_id IN (1001, 1003, 1005)', 3);
  PERFORM pg_temp.assert_visible_count('admin A ne voit PAS 1002 (org B seule)', A, 'SELECT count(*) FROM public.google_geo_targets WHERE geo_target_id = 1002', 0);
  PERFORM pg_temp.assert_visible_count('admin A ne voit PAS 1004 (non référencée)', A, 'SELECT count(*) FROM public.google_geo_targets WHERE geo_target_id = 1004', 0);
  PERFORM pg_temp.assert_visible_count('admin A voit exactement 3 zones', A, 'SELECT count(*) FROM public.google_geo_targets', 3);
  PERFORM pg_temp.assert_visible_count('admin B voit uniquement 1002', B, 'SELECT count(*) FROM public.google_geo_targets', 1);
  PERFORM pg_temp.assert_visible_count('admin B ne voit pas 1001/1003/1005', B, 'SELECT count(*) FROM public.google_geo_targets WHERE geo_target_id IN (1001, 1003, 1005)', 0);
END $$;

-- ── 6. Contraintes ────────────────────────────────────────────────────────
DO $$
DECLARE o constant text := '20000000-0000-0000-0000-0000000000a1';
BEGIN
  RAISE NOTICE '=== 6. Contraintes de données ===';
  PERFORM pg_temp.assert_constraint('heure 24 refusée', format('INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour) VALUES (%L, ''1112223333'', ''c1'', current_date, 24)', o));
  PERFORM pg_temp.assert_constraint('heure -1 refusée', format('INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour) VALUES (%L, ''1112223333'', ''c1'', current_date, -1)', o));
  PERFORM pg_temp.assert_constraint('doublon horaire (même org+compte+date+heure+campagne) refusé', format('INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour) VALUES (%L, ''1112223333'', ''c1'', current_date, 8)', o));
  PERFORM pg_temp.assert_constraint('impressions négatives refusées', format('INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour, impressions) VALUES (%L, ''1112223333'', ''c1'', current_date, 10, -1)', o));
  PERFORM pg_temp.assert_constraint('démographie : dimension inconnue refusée', format('INSERT INTO public.google_ads_demographics_daily (organisation_id, customer_id, local_date, dimension, value) VALUES (%L, ''1112223333'', current_date, ''age_x_gender'', ''X'')', o));
  PERFORM pg_temp.assert_constraint('démographie : doublon refusé', format('INSERT INTO public.google_ads_demographics_daily (organisation_id, customer_id, local_date, dimension, value) VALUES (%L, ''1112223333'', current_date, ''gender'', ''UNDETERMINED'')', o));
  PERFORM pg_temp.assert_constraint('géo : niveau inconnu refusé', format('INSERT INTO public.google_ads_geo_daily (organisation_id, customer_id, local_date, geo_level, presence_type, geo_target_id) VALUES (%L, ''1112223333'', current_date, ''region'', ''LOCATION_OF_PRESENCE'', 1)', o));
  PERFORM pg_temp.assert_constraint('géo : doublon refusé', format('INSERT INTO public.google_ads_geo_daily (organisation_id, customer_id, local_date, geo_level, presence_type, geo_target_id) VALUES (%L, ''1112223333'', current_date, ''city'', ''LOCATION_OF_PRESENCE'', 1001)', o));
  PERFORM pg_temp.assert_constraint('zone : rayon sans latitude refusé (aucune coordonnée inventée)', format('INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, criterion_id, zone_type, longitude, radius, radius_unit) VALUES (%L, ''1112223333'', ''c1'', 700, ''PROXIMITY'', 1.4, 20, ''KILOMETERS'')', o));
  PERFORM pg_temp.assert_constraint('zone : rayon sans unité refusé', format('INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, criterion_id, zone_type, latitude, longitude, radius) VALUES (%L, ''1112223333'', ''c1'', 701, ''PROXIMITY'', 43.5, 1.4, 20)', o));
  PERFORM pg_temp.assert_constraint('zone nommée avec coordonnées refusée', format('INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, criterion_id, zone_type, latitude, longitude, geo_target_id) VALUES (%L, ''1112223333'', ''c1'', 702, ''LOCATION'', 43.5, 1.4, 1003)', o));
  PERFORM pg_temp.assert_constraint('zone : latitude hors limites refusée', format('INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, criterion_id, zone_type, latitude, longitude, radius, radius_unit) VALUES (%L, ''1112223333'', ''c1'', 703, ''PROXIMITY'', 143.5, 1.4, 20, ''KILOMETERS'')', o));
  PERFORM pg_temp.assert_constraint('zone : type inconnu refusé', format('INSERT INTO public.google_ads_targeted_zones (organisation_id, customer_id, campaign_id, criterion_id, zone_type) VALUES (%L, ''1112223333'', ''c1'', 704, ''CIRCLE'')', o));
  PERFORM pg_temp.assert_constraint('sync_state : jeu de données inconnu refusé', format('INSERT INTO public.google_ads_sync_state (organisation_id, customer_id, dataset) VALUES (%L, ''1112223333'', ''nimporte_quoi'')', o));
  PERFORM pg_temp.assert_constraint('campagne : statut obligatoire (jamais déduit)', format('INSERT INTO public.google_ads_campaigns (organisation_id, customer_id, campaign_id) VALUES (%L, ''1112223333'', ''c3'')', o));
END $$;

-- ── 7. Idempotence : rejouer une synchronisation ne duplique rien ─────────
DO $$
DECLARE n bigint; v numeric;
BEGIN
  RAISE NOTICE '=== 7. Idempotence des upserts ===';
  FOR i IN 1..3 LOOP
    INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, campaign_name, local_date, hour, impressions, clicks, cost_micros, synced_at)
    VALUES ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'c1', 'Camp A', current_date, 8, 10 + i, 1, 1000000, now())
    ON CONFLICT (organisation_id, customer_id, local_date, hour, campaign_id)
    DO UPDATE SET impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, cost_micros = EXCLUDED.cost_micros, synced_at = EXCLUDED.synced_at;
  END LOOP;
  SELECT count(*), max(impressions) INTO n, v FROM public.google_ads_metrics_hourly
   WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1' AND hour = 8;
  IF n <> 1 OR v <> 13 THEN RAISE EXCEPTION 'ÉCHEC [idempotence horaire] — % ligne(s), impressions=%', n, v; END IF;
  RAISE NOTICE 'OK [idempotence horaire] — 3 upserts = 1 ligne, dernière valeur (13)';

  -- Un autre compte Google Ads sélectionné = données séparées, jamais mélangées
  INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour, impressions)
  VALUES ('20000000-0000-0000-0000-0000000000a1', '5554443333', 'c1', current_date, 8, 1);
  SELECT count(*) INTO n FROM public.google_ads_metrics_hourly WHERE organisation_id = '20000000-0000-0000-0000-0000000000a1' AND hour = 8;
  IF n <> 2 THEN RAISE EXCEPTION 'ÉCHEC [compte différent] — % ligne(s) au lieu de 2', n; END IF;
  RAISE NOTICE 'OK [customer_id fait partie de la clé] — 2 comptes, 2 lignes';
END $$;

-- ── 8. Purge horaire à 60 jours ───────────────────────────────────────────
DO $$
DECLARE deleted integer; remaining bigint;
BEGIN
  RAISE NOTICE '=== 8. Purge des données horaires > 60 jours ===';
  INSERT INTO public.google_ads_metrics_hourly (organisation_id, customer_id, campaign_id, local_date, hour, impressions) VALUES
    ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'old', current_date - 90, 3, 1),
    ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'old', current_date - 61, 3, 1),
    ('20000000-0000-0000-0000-0000000000a1', '1112223333', 'old', current_date - 59, 3, 1);
  SELECT public.purge_google_ads_hourly() INTO deleted;
  SELECT count(*) INTO remaining FROM public.google_ads_metrics_hourly WHERE campaign_id = 'old';
  IF deleted < 2 OR remaining <> 1 THEN RAISE EXCEPTION 'ÉCHEC [purge] — supprimées=%, restantes=%', deleted, remaining; END IF;
  RAISE NOTICE 'OK [purge] — % supprimée(s), la ligne de J-59 conservée', deleted;
END $$;

-- ── 9. Fonctions internes non exécutables par les rôles applicatifs ───────
DO $$
DECLARE r text; denied boolean;
BEGIN
  RAISE NOTICE '=== 9. Fonctions de cron : réservées à postgres / service ===';
  FOREACH r IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    denied := false;
    EXECUTE format('SET LOCAL role = %L', r);
    BEGIN PERFORM public.purge_google_ads_hourly(); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    RESET role;
    IF NOT denied THEN RAISE EXCEPTION 'ÉCHEC [% peut purger]', r; END IF;
    denied := false;
    EXECUTE format('SET LOCAL role = %L', r);
    BEGIN PERFORM public.trigger_google_sync_job('google-ads-sync-intraday', '{"job":"hourly"}'::jsonb); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    RESET role;
    IF NOT denied THEN RAISE EXCEPTION 'ÉCHEC [% peut déclencher un job]', r; END IF;
    RAISE NOTICE 'OK [% : purge et trigger refusés]', r;
  END LOOP;
END $$;

-- ── 10. Colonne dédiée metrics_synced_at ──────────────────────────────────
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'google_ads_connections' AND column_name = 'metrics_synced_at' AND is_nullable = 'YES' AND data_type = 'timestamp with time zone';
  IF n <> 1 THEN RAISE EXCEPTION 'ÉCHEC [metrics_synced_at] — colonne absente ou de mauvais type'; END IF;
  RAISE NOTICE 'OK [metrics_synced_at] — colonne timestamptz nullable présente';
END $$;

DO $$ BEGIN RAISE NOTICE '=== Tous les scénarios de la Correction 12 ont réussi ==='; END $$;

-- Annulation systématique — aucune donnée de test ne doit persister.
ROLLBACK;
