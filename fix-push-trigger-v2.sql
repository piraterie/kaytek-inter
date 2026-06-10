-- ================================================================
-- CORRECTION TRIGGER PUSH — schéma net.http_post (pas pg_net)
-- Exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- ── [1] Recréer la fonction avec le bon schéma ───────────────────
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

-- ── [2] Recréer le trigger (au cas où il pointe encore l'ancienne fonction)
DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;

CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_push_on_notification();

-- ── [3] Vérification : trigger en place ──────────────────────────
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'notifications'
  AND event_object_schema = 'public'
ORDER BY trigger_name;

-- ── [4] Test direct : insertion d'une notification ───────────────
-- Insère une vraie notification pour l'intervenant le plus récent.
-- Si le pipeline fonctionne → tu verras l'appel dans net._http_response
-- et les logs Edge Function send-push se déclencheront dans les 5 secondes.
INSERT INTO public.notifications (user_id, titre, contenu, type, lue, lien)
VALUES (
  (SELECT id FROM public.profiles WHERE role = 'intervenant' ORDER BY created_at DESC LIMIT 1),
  '🔔 Test pipeline push',
  'Si vous recevez cette notification sur votre téléphone, le pipeline est fonctionnel.',
  'info',
  false,
  '/dashboard'
);

-- ── [5] Vérifier l'appel HTTP dans net._http_response ────────────
-- Attendre 2-3 secondes puis exécuter cette requête séparément si besoin.
-- Elle montre la réponse de l'Edge Function send-push.
SELECT
  id,
  method,
  left(url, 80)               AS url_court,
  status_code,
  left(response_body::text, 300) AS reponse,
  created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
