-- Migration : ajout des champs Telegram dans profiles
-- À exécuter dans Supabase → SQL Editor

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_notifications_enabled boolean DEFAULT true;

-- Vérification
SELECT id, nom, prenom, telegram_chat_id, telegram_notifications_enabled
FROM public.profiles
ORDER BY nom;
