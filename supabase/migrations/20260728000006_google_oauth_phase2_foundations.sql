-- Phase 2 (OAuth réel) — fondations complémentaires nécessaires à
-- l'implémentation réelle du flux OAuth Google (Edge Functions), en plus
-- des tables déjà créées en Phase 1 (20260728000004/000005). Aucune donnée
-- réelle, aucun secret, aucune valeur de test ici — schéma uniquement.
--
-- Deux ajustements ADDITIFS aux fondations Phase 1 (jamais de suppression
-- ni de restriction retirée) :
--   1. google_oauth_states : nécessaire pour stocker le "state" OAuth côté
--      serveur (anti-CSRF, anti-rejeu, expiration, liaison organisation/
--      provider/demandeur) — n'existait pas en Phase 1 car aucun flux
--      OAuth réel n'était encore implémenté.
--   2. google_account_email sur google_ads_connections / gbp_connections :
--      nécessaire pour afficher "connecté en tant que X@gmail.com" côté
--      frontend (déjà prévu par gbp_connections.account_name pour GBP,
--      mais rien d'équivalent n'existait pour l'identité Google elle-même
--      sur les deux tables) — obtenu via l'endpoint OpenID Connect
--      userinfo (scopes openid/userinfo.email déjà configurés), jamais un
--      appel Google Ads/Business Profile supplémentaire.

-- ────────────────────────────────────────────────────────────────────────
-- 1. google_oauth_states — state OAuth signé, expirant, à usage unique
-- ────────────────────────────────────────────────────────────────────────
-- Table privée (deny-all RLS, service_role uniquement) — le state lui-même
-- transite en dehors de toute session authentifiée Supabase (Google
-- redirige le navigateur vers google-oauth-callback SANS pouvoir y joindre
-- un header Authorization), donc cette table ne peut pas être protégée par
-- une policy basée sur auth.uid() côté callback. La sécurité réelle vient
-- de la combinaison : (a) nonce imprévisible (32 octets aléatoires), (b)
-- signature HMAC du state envoyé à Google (voir GOOGLE_OAUTH_STATE_SECRET,
-- Edge Functions), (c) expiration courte, (d) consumed_at = usage unique,
-- (e) organisation_id/provider/requested_by revérifiés par google-oauth-
-- callback contre le payload signé ET cette ligne (double contrôle).
CREATE TABLE IF NOT EXISTS public.google_oauth_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce            text NOT NULL UNIQUE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('google_ads', 'google_business')),
  requested_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_states_nonce ON public.google_oauth_states (nonce);
CREATE INDEX IF NOT EXISTS idx_google_oauth_states_expires ON public.google_oauth_states (expires_at);

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
-- Aucune policy pour anon/authenticated : deny-all par design (service_role uniquement).

-- ────────────────────────────────────────────────────────────────────────
-- 2. google_account_email — identité Google affichée (non sensible)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.google_ads_connections ADD COLUMN IF NOT EXISTS google_account_email text;
ALTER TABLE public.gbp_connections ADD COLUMN IF NOT EXISTS google_account_email text;

-- Vues de statut recréées pour inclure la nouvelle colonne (non sensible)
-- — même garde-fou qu'en Phase 1 (admin-only, org-scoped, write-through
-- neutralisé, revérifié ci-dessous).
-- google_account_email ajoutée en DERNIÈRE position du SELECT : un
-- CREATE OR REPLACE VIEW ne peut ajouter une colonne qu'à la fin de la
-- liste (Postgres interprète toute insertion en position intermédiaire
-- comme un renommage de colonne existante et refuse — constaté en local).
CREATE OR REPLACE VIEW public.google_ads_connection_status AS
SELECT
  id,
  organisation_id,
  google_customer_id,
  google_login_customer_id,
  status,
  connected_at,
  last_synced_at,
  last_error,
  updated_at,
  google_account_email
FROM public.google_ads_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

GRANT SELECT ON public.google_ads_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.google_ads_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.google_ads_connection_status FROM authenticated;

CREATE OR REPLACE VIEW public.gbp_connection_status AS
SELECT
  id,
  organisation_id,
  google_location_id,
  google_account_id,
  account_name,
  status,
  connected_at,
  last_synced_at,
  last_error,
  updated_at,
  google_account_email
FROM public.gbp_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

GRANT SELECT ON public.gbp_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM authenticated;

DO $$
DECLARE
  v_bad_grants text;
  v_leaky_cols text;
BEGIN
  SELECT string_agg(table_name || '.' || grantee || ':' || privilege_type, ', ')
    INTO v_bad_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad_grants IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — droit d''écriture résiduel sur une vue de statut (contournement RLS via write-through) : %', v_bad_grants;
  END IF;

  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_leaky_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('google_ads_connection_status', 'gbp_connection_status')
    AND column_name IN ('access_token_secret_id', 'refresh_token_secret_id', 'access_token', 'refresh_token');
  IF v_leaky_cols IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — colonne(s) liée(s) à un secret exposée(s) par une vue de statut : %', v_leaky_cols;
  END IF;

  RAISE NOTICE 'OK — vues de statut Google (Phase 2) : aucun droit d''écriture résiduel, aucune colonne de secret exposée.';
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Wrappers Vault en schéma public (service_role uniquement) — les
--    fonctions vault.* ne sont PAS exposées par PostgREST (schéma non
--    listé dans db-schemas, seul "public" l'est) : les Edge Functions
--    (client service_role via supabase-js → PostgREST) ne peuvent donc
--    appeler vault.create_secret()/update_secret() qu'au travers d'un
--    wrapper public.*, sur le modèle exact de get_internal_push_secret()
--    (20260708000008_security_phase1_critical_hardening.sql) : SECURITY
--    DEFINER, SET search_path, REVOKE ALL explicite (PUBLIC + anon +
--    authenticated), GRANT EXECUTE à service_role uniquement.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.google_oauth_vault_create(p_secret text, p_name text DEFAULT NULL, p_description text DEFAULT '')
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN vault.create_secret(p_secret, p_name, p_description);
END;
$$;

CREATE OR REPLACE FUNCTION public.google_oauth_vault_update(p_secret_id uuid, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  PERFORM vault.update_secret(p_secret_id, p_secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.google_oauth_vault_read(p_secret_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = p_secret_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.google_oauth_vault_delete(p_secret_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  DELETE FROM vault.secrets WHERE id = p_secret_id;
$$;

-- Hygiène des privilèges (SEC2-02 / phase7) — REVOKE explicite de PUBLIC
-- ET anon (le privilège EXECUTE par défaut de la plateforme n'est pas
-- retiré par un simple "REVOKE ... FROM PUBLIC", voir migration
-- 20260727000002_harden_sensitive_function_execute_privileges.sql).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.google_oauth_vault_create(text, text, text)',
    'public.google_oauth_vault_update(uuid, text)',
    'public.google_oauth_vault_read(uuid)',
    'public.google_oauth_vault_delete(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- Vérification bloquante : aucun droit EXECUTE résiduel pour anon/authenticated.
DO $$
DECLARE v_leak text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_leak
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('google_oauth_vault_create', 'google_oauth_vault_update', 'google_oauth_vault_read', 'google_oauth_vault_delete')
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — anon/authenticated conservent EXECUTE sur : %', v_leak;
  END IF;
  RAISE NOTICE 'OK — wrappers Vault OAuth : anon/authenticated sans EXECUTE, service_role uniquement.';
END $$;
