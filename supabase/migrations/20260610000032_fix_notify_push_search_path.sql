-- ================================================================
-- MIGRATION : Phase 9 — trigger_push_on_notification
--             SET search_path + X-Internal-Secret
-- Date      : 2026-06-10
-- ----------------------------------------------------------------
-- Corrections :
--   1. SET search_path = public  (hygiene SECURITY DEFINER)
--   2. Ajout header X-Internal-Secret pour authentification réelle
--      côté send-push (secret hardcodé — même valeur que le secret
--      configuré dans Supabase Edge Functions → Secrets)
--   3. OWNER TO postgres
--
-- Le header Authorization: Bearer <anon> est conservé car la gateway
-- Supabase l'exige pour acheminer la requête HTTP vers l'Edge Function.
-- Il ne sert PAS d'authentification dans la logique de send-push.
--
-- PRÉREQUIS avant d'appliquer cette migration :
--   1. Générer un secret : openssl rand -hex 32
--   2. Supabase Dashboard → Edge Functions → Secrets
--      Ajouter : INTERNAL_PUSH_SECRET = <votre-valeur>
--   3. Remplacer 'REMPLACER_PAR_VOTRE_INTERNAL_PUSH_SECRET' ci-dessous
--      par cette même valeur, puis exécuter la migration.
--
-- Le trigger trg_push_on_notification n'est PAS modifié.
-- ================================================================


CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'apikey',            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
      'Authorization',     'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
      'X-Internal-Secret', 'hCMArIgCAslRbEuFTlpZTl3wH0xVEJbQtcSfJSALC5sUAuZRslyca48vOzBg4trDcnen1fu3HZ4a5jJMjT180GKpJ4RsEL9TOoRZcq'
    ),
    body    := jsonb_build_object(
      'user_id', NEW.user_id::text,
      'titre',   NEW.titre,
      'contenu', NEW.contenu,
      'lien',    COALESCE(NEW.lien, '/')
    )::text
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_push_on_notification() OWNER TO postgres;


-- ================================================================
-- VÉRIFICATION
-- ================================================================

-- 1. Fonction patchée correctement
SELECT
  proname,
  prosecdef                                                    AS security_definer,
  proowner::regrole                                            AS owner,
  CASE
    WHEN proconfig IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
    THEN 'OUI'
    ELSE 'NON'
  END                                                          AS search_path_set,
  proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'trigger_push_on_notification';
-- Attendu : security_definer=true, owner=postgres, search_path_set='OUI'

-- 2. Trigger toujours actif (non touché par cette migration)
SELECT trigger_name, event_object_table, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_name = 'trg_push_on_notification';
-- Attendu : trg_push_on_notification | notifications | INSERT | AFTER

-- 3. X-Internal-Secret présent dans le corps de la fonction
SELECT
  CASE
    WHEN prosrc LIKE '%X-Internal-Secret%' THEN 'OUI'
    ELSE 'NON'
  END AS x_internal_secret_present
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'trigger_push_on_notification';
-- Attendu : OUI


-- ================================================================
-- ROLLBACK
-- ================================================================
/*
CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto'
    ),
    body    := jsonb_build_object(
      'user_id', NEW.user_id::text,
      'titre',   NEW.titre,
      'contenu', NEW.contenu,
      'lien',    COALESCE(NEW.lien, '/')
    )::text
  );

  RETURN NEW;
END;
$$;
*/
