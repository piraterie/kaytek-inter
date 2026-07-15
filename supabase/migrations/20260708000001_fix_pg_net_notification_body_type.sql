-- ================================================================
-- MIGRATION : fix trigger_push_on_notification (body jsonb, pas text)
-- Date       : 2026-07-08
-- Origine    : fonction créée/patchée par
--              20260610000032_fix_notify_push_search_path.sql
-- Problème   : net.http_post(..., body := jsonb_build_object(...)::text)
--              caste le body en text, mais la signature installée de
--              pg_net (0.20.0) attend body jsonb :
--                net.http_post(url text, body jsonb DEFAULT '{}',
--                  params jsonb DEFAULT '{}', headers jsonb DEFAULT ...,
--                  timeout_milliseconds integer DEFAULT 5000)
--              → ERREUR "function net.http_post(... body => text) does
--              not exist", non interceptée dans le trigger AFTER INSERT,
--              ce qui annule silencieusement TOUT insert dans
--              public.notifications dès que skip_push != true.
-- Correction : retire le cast ::text — jsonb_build_object(...) renvoie
--              déjà du jsonb, type attendu par net.http_post.
-- Portée     : uniquement cette fonction. Rien d'autre modifié — même
--              logique, mêmes headers, même URL, même trigger.
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
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_push_on_notification() OWNER TO postgres;

-- ================================================================
-- VÉRIFICATION — résultat attendu : body_is_jsonb_cast = false
--                (aucune trace de "::text" après le jsonb_build_object body)
-- ================================================================
SELECT
  proname,
  prosrc NOT LIKE '%jsonb_build_object(%''user_id''%)::text%' AS body_cast_removed
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'trigger_push_on_notification';
