-- ================================================================
-- MIGRATION : interventions — colonnes rappels automatiques
-- Date       : 2026-06-30
-- Objectif   :
--   · Ajoute 3 colonnes timestamp qui mémorisent quand chaque
--     rappel a été envoyé (NULL = pas encore envoyé).
--   · Index sur date_prevue pour accélérer la requête cron.
--   · Optionnel : schedule pg_cron pour appeler send-reminders
--     toutes les 10 minutes (nécessite pg_cron + pg_net activés).
-- ================================================================

-- ── 1. Colonnes rappels ──────────────────────────────────────────
ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS rappel_24h_envoye_at   timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rappel_2h_envoye_at    timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rappel_30min_envoye_at timestamptz DEFAULT NULL;

-- ── 2. Index sur date_prevue (performance requête cron) ──────────
CREATE INDEX IF NOT EXISTS idx_interventions_date_prevue
  ON public.interventions(date_prevue)
  WHERE date_prevue IS NOT NULL;

-- ── 3. pg_cron (optionnel — ignoré si pg_cron non activé) ───────
-- Pour activer les rappels automatiques toutes les 10 minutes :
--
--  1. Activer pg_cron dans Supabase Dashboard → Extensions
--  2. Activer pg_net dans Supabase Dashboard → Extensions
--  3. Exécuter le bloc ci-dessous dans le SQL Editor Supabase :
--
-- SELECT cron.schedule(
--   'kaytek-send-reminders',
--   '*/10 * * * *',
--   $$
--     SELECT net.http_post(
--       url       := (SELECT value FROM vault.secrets WHERE name = 'supabase_functions_url')
--                    || '/send-reminders',
--       body      := '{}'::jsonb,
--       headers   := jsonb_build_object(
--         'Content-Type',      'application/json',
--         'x-internal-secret', (SELECT value FROM vault.secrets WHERE name = 'internal_push_secret')
--       )
--     );
--   $$
-- );
--
-- Sinon, les rappels se déclenchent via le bouton admin
-- sur la page Planning (déclenchement manuel + à l'ouverture).

DO $$
BEGIN
  RAISE NOTICE 'Migration rappels OK. pg_cron : configurer manuellement si souhaité.';
END $$;
