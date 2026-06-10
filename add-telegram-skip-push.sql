-- ================================================================
-- Optimisation Telegram : skip push quand Telegram est envoyé
-- À exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- [1] Ajouter le flag skip_push à la table notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS skip_push boolean DEFAULT false;

-- [2] Mettre à jour le trigger : si skip_push = true → pas de push doublon
CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;
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

-- [3] Vérification
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'notifications' AND event_object_schema = 'public';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'notifications' AND column_name = 'skip_push';
