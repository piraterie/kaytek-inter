-- ================================================================
-- MIGRATION : planification pg_cron — synchronisations Google Ads
--             horaire et ventilations + purge des données horaires
-- Date      : 2026-09-21
-- ================================================================
-- À APPLIQUER SEULEMENT après le test réel des Edge Functions
-- (google-ads-sync-intraday) : contrairement à la migration des tables, celle-ci
-- ACTIVE des tâches récurrentes qui consomment le quota de l'API Google Ads.
--
-- Deux tâches horaires (UTC) qui appellent la MÊME Edge Function avec un
-- corps différent. Le filtrage par FUSEAU du compte est fait côté fonction,
-- pour chaque organisation :
--   * google-ads-sync-hourly     : toutes les heures à hh:05 — la fonction n'appelle
--     l'API Google que si l'heure LOCALE du compte est entre 07h et 22h (16 passages
--     par jour et par organisation) ;
--   * google-ads-sync-breakdowns : toutes les heures à hh:15 — la fonction n'appelle
--     l'API que si l'heure LOCALE du compte est 07h, 11h, 15h ou 19h (4 passages
--     par jour : appareils, âge, sexe, ville, code postal).
-- Les organisations sans connexion Google Ads active + compte sélectionné ne
-- déclenchent AUCUN appel à l'API Google.
--
-- Réutilise le mécanisme existant (Vault : google_functions_base_url +
-- internal_push_secret) — voir 20260804000001_google_cron_scheduling.sql.
-- ================================================================

-- Surcharge de trigger_google_sync_job avec un corps JSON (l'ancienne
-- signature à 1 argument, utilisée par les tâches existantes, est inchangée).
CREATE OR REPLACE FUNCTION public.trigger_google_sync_job(p_function_name text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_base_url text;
  v_secret   text;
BEGIN
  SELECT decrypted_secret INTO v_base_url FROM vault.decrypted_secrets WHERE name = 'google_functions_base_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'internal_push_secret' LIMIT 1;

  IF v_base_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[trigger_google_sync_job] secret(s) manquant(s) — tâche % non exécutée', p_function_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_base_url || '/' || p_function_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := COALESCE(p_body, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_google_sync_job(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_google_sync_job(text, jsonb) FROM anon, authenticated;

-- Purge des données horaires au-delà de 60 jours (uniquement la table
-- google_ads_metrics_hourly, créée pour cet usage — aucune donnée historique
-- existante n'est concernée). local_date est la date locale du compte : la marge
-- d'un jour liée au fuseau est sans importance pour une rétention de 60 jours.
CREATE OR REPLACE FUNCTION public.purge_google_ads_hourly()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.google_ads_metrics_hourly
  WHERE local_date < ((now() AT TIME ZONE 'UTC')::date - 60);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_google_ads_hourly() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_google_ads_hourly() FROM anon, authenticated;

DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('google-ads-sync-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('google-ads-sync-hourly', '5 * * * *',
    $cron$SELECT public.trigger_google_sync_job('google-ads-sync-intraday', '{"job":"hourly"}'::jsonb)$cron$);

  BEGIN PERFORM cron.unschedule('google-ads-sync-breakdowns'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('google-ads-sync-breakdowns', '15 * * * *',
    $cron$SELECT public.trigger_google_sync_job('google-ads-sync-intraday', '{"job":"breakdowns"}'::jsonb)$cron$);

  BEGIN PERFORM cron.unschedule('google-ads-purge-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM cron.schedule('google-ads-purge-hourly', '30 3 * * *', -- 03h30 UTC quotidien
    $cron$SELECT public.purge_google_ads_hourly()$cron$);

  RAISE NOTICE 'OK — 3 tâches pg_cron programmées (google-ads-sync-hourly, google-ads-sync-breakdowns, google-ads-purge-hourly).';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron indisponible — tâches non programmées (%). Activez pg_cron puis rejouez cette section.', SQLERRM;
END $$;
