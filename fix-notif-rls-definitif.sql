-- ================================================================
-- RLS NOTIFICATIONS — RESET COMPLET
-- Supprime TOUTES les policies existantes (peu importe leur nom)
-- puis recrée 4 policies propres
-- ================================================================

-- [1] Voir ce qui existe actuellement
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications' AND schemaname = 'public'
ORDER BY cmd;

-- [2] Supprimer TOUTES les policies dynamiquement
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'notifications' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', pol.policyname);
    RAISE NOTICE 'Supprimé : %', pol.policyname;
  END LOOP;
END $$;

-- [3] Recréer 4 policies propres
-- SELECT : chacun voit uniquement ses propres notifications
CREATE POLICY "notif_select" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT : tout utilisateur authentifié peut créer une notification pour n'importe qui
-- (nécessaire pour trigger + intervenant→admin)
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE : chacun peut modifier uniquement ses propres notifications (marquer lu)
-- Pas de WITH CHECK pour éviter les conflits si user_id ne change pas
CREATE POLICY "notif_update" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- DELETE : chacun peut supprimer uniquement ses propres notifications
CREATE POLICY "notif_delete" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

-- [4] Vérification finale — doit afficher exactement 4 lignes
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'notifications' AND schemaname = 'public'
ORDER BY cmd;

-- [5] Test UPDATE direct (remplace l'UUID par ton vrai user_id)
-- Sert à confirmer que la policy UPDATE fonctionne
-- SELECT id, lue FROM public.notifications WHERE user_id = auth.uid() LIMIT 3;
