-- ================================================================
-- CORRECTIFS NOTIFICATIONS + MESSAGES VOCAUX — V2
-- Exécuter dans Supabase → SQL Editor → Run
-- ================================================================

-- ── 1. Colonnes manquantes ───────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS lu_le timestamptz;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS lu_le timestamptz;

-- ── 2. Contrainte messages.type (ajouter 'audio' et 'vocal') ────
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('texte', 'photo', 'audio', 'vocal', 'devis', 'facture', 'intervention'));

-- ── 3. RLS sur notifications ─────────────────────────────────────
-- Permettre à tout utilisateur authentifié d'insérer des notifications pour n'importe qui
-- (nécessaire pour que les intervenants puissent notifier les admins)
DO $$
BEGIN
  DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
  DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
  DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
  DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
  -- Fallback : supprimer les anciennes politiques avec d'autres noms
  DROP POLICY IF EXISTS "notifs_insert" ON public.notifications;
  DROP POLICY IF EXISTS "notifs_select" ON public.notifications;
  DROP POLICY IF EXISTS "notifs_update" ON public.notifications;
  DROP POLICY IF EXISTS "notifs_delete" ON public.notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- SELECT : chacun voit ses propres notifications
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT : tout utilisateur authentifié peut créer des notifications pour n'importe qui
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE : chacun peut modifier ses propres notifications (marquer comme lu)
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- DELETE : chacun peut supprimer ses propres notifications
CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

-- ── 4. Vérification ──────────────────────────────────────────────
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY cmd;
