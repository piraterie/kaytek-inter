-- ================================================================
-- MIGRATION : planification pg_cron des synchronisations Google
-- Date      : 2026-08-04
-- ================================================================
-- Programme 3 tâches quotidiennes/périodiques via pg_cron + pg_net :
--   1. Distribution des demandes d'avis programmées (toutes les 15 min —
--      granularité fine nécessaire pour respecter les délais courts
--      comme "1h" configurés par un admin).
--   2. Synchronisation quotidienne des statistiques GBP Performance API.
--   3. Synchronisation quotidienne des métriques Google Ads (GAQL).
--
-- Non bloquant : si pg_cron/pg_net sont indisponibles sur ce projet
-- (add-on non activé), cette migration se termine avec un simple
-- avertissement — jamais une erreur fatale qui romprait la chaîne de
-- migrations.
--
-- L'URL de base des Edge Functions est stockée dans Supabase Vault
-- (secret 'google_functions_base_url') plutôt que codée en dur ici, pour
-- que la même migration fonctionne en local ET en production sans
-- modification. Valeur par défaut posée ici = local
-- (http://127.0.0.1:54321/functions/v1) ; ACTION MANUELLE REQUISE en
-- production après déploiement des fonctions (voir rapport) :
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'google_functions_base_url'),
--     'https://<project-ref>.supabase.co/functions/v1'
--   );
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_functions_base_url') THEN
    PERFORM vault.create_secret(
      'http://127.0.0.1:54321/functions/v1',
      'google_functions_base_url',
      'Base URL des Edge Functions Google (sync avis/perf/ads) — À METTRE À JOUR en production après déploiement.'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Impossible de préparer le secret google_functions_base_url (%) — schéma vault probablement indisponible.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_google_sync_job(p_function_name text)
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
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_google_sync_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_google_sync_job(text) FROM anon, authenticated;
-- Exécutée par pg_cron sous le rôle postgres — pas besoin de GRANT à
-- service_role (le job cron s'exécute avec les droits du rôle propriétaire
-- de la fonction, SECURITY DEFINER).

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('google-send-review-requests');
  EXCEPTION WHEN OTHERS THEN NULL; -- job pas encore existant, normal au premier déploiement
  END;
  PERFORM cron.schedule('google-send-review-requests', '*/15 * * * *',
    $cron$SELECT public.trigger_google_sync_job('google-send-review-requests')$cron$);

  BEGIN
    PERFORM cron.unschedule('google-gbp-sync-performance');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('google-gbp-sync-performance', '0 4 * * *', -- 04h00 UTC quotidien
    $cron$SELECT public.trigger_google_sync_job('google-gbp-sync-performance')$cron$);

  BEGIN
    PERFORM cron.unschedule('google-ads-sync-metrics');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('google-ads-sync-metrics', '0 5 * * *', -- 05h00 UTC quotidien
    $cron$SELECT public.trigger_google_sync_job('google-ads-sync-metrics')$cron$);

  RAISE NOTICE 'OK — 3 tâches pg_cron programmées (google-send-review-requests, google-gbp-sync-performance, google-ads-sync-metrics).';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron indisponible — tâches non programmées (%). Activez pg_cron (Dashboard > Database > Extensions) puis rejouez cette section manuellement.', SQLERRM;
END $$;
