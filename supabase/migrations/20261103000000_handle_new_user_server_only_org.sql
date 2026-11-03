-- 20261103000000_handle_new_user_server_only_org.sql
--
-- Faille corrigée : l'inscription publique (POST /auth/v1/signup, ouverte
-- car disable_signup = false — conservée pour le site Netlify) laisse
-- l'appelant fournir librement raw_user_meta_data. handle_new_user() y lisait
-- organisation_id : toute personne connaissant l'UUID d'une entreprise
-- pouvait s'y rattacher comme intervenant/assistant, sans invitation.
--
-- Le trigger ne crée donc plus AUCUN profil membre. Le rattachement d'un
-- membre à une organisation est toujours explicite et côté serveur :
--  - invitation : Edge Function inviter-intervenant (vérifie l'admin et son
--    organisation, puis écrit le profil en service role) ;
--  - client self-service : provision_subscriber_organisation() (trigger sur
--    subscriptions, crée l'organisation + le profil admin), inchangé.
-- raw_app_meta_data n'est pas une alternative : GoTrue l'écrit après
-- l'INSERT dans auth.users, ce trigger AFTER INSERT ne le verrait jamais.
--
-- Fonction et trigger conservés (no-op) pour ne casser aucune dépendance.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
