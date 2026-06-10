-- ================================================================
-- TRIGGER PUSH VIA PG_NET — notifications → send-push automatique
-- Exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- Note : l'extension est pg_net mais ses fonctions vivent dans le schéma "net"
-- Utiliser net.http_post() et non pg_net.http_post()

-- Fonction déclenchée après chaque INSERT dans public.notifications
CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push',
    body    := jsonb_build_object(
                 'user_id', NEW.user_id::text,
                 'titre',   NEW.titre,
                 'contenu', NEW.contenu,
                 'lien',    COALESCE(NEW.lien, '/')
               ),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
                 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto'
               )
  );
  RETURN NEW;
END;
$$;

-- Supprimer l'ancien trigger s'il existe
DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;

-- Créer le trigger AFTER INSERT
CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_push_on_notification();

-- Vérification
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'notifications'
  AND event_object_schema = 'public'
ORDER BY trigger_name;
