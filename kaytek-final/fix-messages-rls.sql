-- ================================================================
-- RLS MESSAGES — RESET COMPLET
-- Règle : un intervenant ne peut écrire qu'à l'admin
--         un intervenant ne lit que ses propres messages
--         un admin peut tout lire/écrire
-- ================================================================

-- [1] Voir les policies actuelles
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'messages' AND schemaname = 'public'
ORDER BY cmd;

-- [2] Supprimer TOUTES les policies existantes
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE tablename = 'messages' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.messages', pol.policyname);
    RAISE NOTICE 'Supprimé : %', pol.policyname;
  END LOOP;
END $$;

-- [3] SELECT : chacun ne voit que les messages dont il est expéditeur ou destinataire
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    auth.uid() = expediteur_id OR auth.uid() = destinataire_id
  );

-- [4] INSERT :
--   - l'admin peut envoyer à n'importe qui
--   - un non-admin ne peut envoyer QU'À un admin
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = expediteur_id
    AND (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      OR
      (SELECT role FROM public.profiles WHERE id = destinataire_id) = 'admin'
    )
  );

-- [5] UPDATE : seul le destinataire peut marquer ses messages comme lus
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (auth.uid() = destinataire_id)
  WITH CHECK (auth.uid() = destinataire_id);

-- [6] Vérification finale — doit afficher 3 lignes
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'messages' AND schemaname = 'public'
ORDER BY cmd;
