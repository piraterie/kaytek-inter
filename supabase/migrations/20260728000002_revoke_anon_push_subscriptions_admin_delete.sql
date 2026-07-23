-- DÉPLOIEMENT CONTRÔLÉ — trou résiduel découvert pendant la vérification
-- post-migration de 20260711000005_harden_notifications_and_reminders.sql.
--
-- Cette dernière fait `REVOKE ALL ON FUNCTION
-- public.admin_delete_user_push_subscriptions(uuid) FROM PUBLIC` puis
-- `GRANT EXECUTE ... TO authenticated` — mais REVOKE ... FROM PUBLIC ne
-- retire que les privilèges accordés au pseudo-rôle PUBLIC, jamais un
-- privilège EXECUTE accordé DIRECTEMENT à anon (comportement par défaut
-- de l'image Postgres locale/Supabase pour toute nouvelle fonction —
-- même mécanisme déjà documenté et corrigé pour 5 autres fonctions par
-- SEC2-02, migration 20260727000002). Cette 6e fonction n'avait pas été
-- incluse dans la liste SEC2-02 au moment de sa rédaction.
--
-- Constat en production (lecture seule, avant ce correctif) :
--   has_function_privilege('anon', 'admin_delete_user_push_subscriptions(uuid)', 'EXECUTE') = true
--
-- public.admin_delete_user_push_subscriptions(uuid) est SECURITY DEFINER
-- (prosecdef = true) — un appel anonyme réussi permettrait de supprimer
-- les abonnements push de n'importe quel utilisateur sans authentification.
REVOKE ALL ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_delete_user_push_subscriptions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_delete_user_push_subscriptions(uuid) : anon conserve EXECUTE après REVOKE explicite — audit manuel requis';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_delete_user_push_subscriptions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_delete_user_push_subscriptions(uuid) : authenticated a perdu EXECUTE — régression';
  END IF;
  RAISE NOTICE 'admin_delete_user_push_subscriptions(uuid) : anon refusé, authenticated/service_role conservés.';
END $$;
