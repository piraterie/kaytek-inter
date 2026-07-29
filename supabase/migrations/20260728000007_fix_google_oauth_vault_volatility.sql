-- Correctif : google_oauth_vault_create était déclarée STABLE alors qu'elle
-- effectue un INSERT via vault.create_secret(). PostgREST ouvre une
-- transaction en lecture seule pour les appels RPC vers une fonction
-- STABLE/IMMUTABLE, ce qui provoquait systématiquement l'échec
-- "cannot execute INSERT in a read-only transaction" (SQLSTATE 25006)
-- observé dans google_oauth_events.detail lors des tentatives OAuth
-- réelles. google_oauth_vault_update/_delete sont déjà VOLATILE et
-- google_oauth_vault_read est déjà STABLE (vérifié par introspection
-- avant cette migration) — ALTER FUNCTION appliqué aux 4 par exhaustivité
-- et idempotence, sans autre changement (signatures, paramètres, type de
-- retour, SECURITY DEFINER, search_path, ACL, logique interne inchangés).

ALTER FUNCTION public.google_oauth_vault_create(p_secret text, p_name text, p_description text) VOLATILE;
ALTER FUNCTION public.google_oauth_vault_update(p_secret_id uuid, p_secret text) VOLATILE;
ALTER FUNCTION public.google_oauth_vault_delete(p_secret_id uuid) VOLATILE;
ALTER FUNCTION public.google_oauth_vault_read(p_secret_id uuid) STABLE;

DO $$
DECLARE
  v_create_vol "char";
  v_update_vol "char";
  v_delete_vol "char";
  v_read_vol "char";
BEGIN
  SELECT provolatile INTO v_create_vol FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'google_oauth_vault_create';
  SELECT provolatile INTO v_update_vol FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'google_oauth_vault_update';
  SELECT provolatile INTO v_delete_vol FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'google_oauth_vault_delete';
  SELECT provolatile INTO v_read_vol FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'google_oauth_vault_read';

  IF v_create_vol <> 'v' THEN
    RAISE EXCEPTION 'ECHEC : google_oauth_vault_create n''est pas VOLATILE (%).', v_create_vol;
  END IF;
  IF v_update_vol <> 'v' THEN
    RAISE EXCEPTION 'ECHEC : google_oauth_vault_update n''est pas VOLATILE (%).', v_update_vol;
  END IF;
  IF v_delete_vol <> 'v' THEN
    RAISE EXCEPTION 'ECHEC : google_oauth_vault_delete n''est pas VOLATILE (%).', v_delete_vol;
  END IF;
  IF v_read_vol <> 's' THEN
    RAISE EXCEPTION 'ECHEC : google_oauth_vault_read n''est pas STABLE (%).', v_read_vol;
  END IF;

  RAISE NOTICE '=== VOLATILITE CORRIGEE : create/update/delete=VOLATILE, read=STABLE ===';
END $$;
