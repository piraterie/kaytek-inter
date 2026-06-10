-- Supprime le trigger pg_net (remplacé par appel direct depuis le frontend)
DROP TRIGGER IF EXISTS on_new_message_push ON messages;
DROP FUNCTION IF EXISTS notify_push_on_new_message();
