-- Fix : ajouter 'audio' aux types autorisés dans la table messages
-- À exécuter dans Supabase → SQL Editor

-- 1. Supprimer l'ancienne contrainte
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;

-- 2. Recréer avec 'audio' inclus
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('texte', 'intervention', 'photo', 'audio', 'system'));
