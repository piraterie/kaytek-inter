-- Phase 1 (fondations) — vues de statut pour les connexions Google, sur le
-- modèle exact de public.parametres_entreprise_public (migration
-- 20260711000003) : la vue réimplémente elle-même le cloisonnement par
-- organisation (WHERE organisation_id = current_org_id()) et restreint en
-- plus à is_admin_in_org(), car connecter/déconnecter un compte Google est
-- une action admin-only (comme /parametres, /partenaires). Elle n'expose
-- JAMAIS les colonnes de secrets Vault (access_token_secret_id /
-- refresh_token_secret_id) — uniquement des métadonnées non sensibles
-- (identifiants de compte publics, statut, horodatages) ; même si elle
-- les exposait, ce ne serait qu'un id opaque vers vault.secrets, jamais
-- la valeur déchiffrée (vault.decrypted_secrets n'est accordée qu'à
-- service_role — voir migration précédente).
--
-- ── Note sur les droits du propriétaire de la vue (contournement RLS) ──
-- Une vue Postgres s'exécute par défaut avec les droits de son
-- PROPRIÉTAIRE (ici le rôle exécutant la migration, ex. postgres/
-- supabase_admin — qui a rolbypassrls=true), pas ceux de l'appelant. Ce
-- n'est PAS un accident : c'est le mécanisme même qui permet à un
-- `authenticated` sans AUCUN droit sur la table de base (RLS deny-all) de
-- lire malgré tout un sous-ensemble non sensible via cette vue. La
-- frontière de sécurité n'est donc PAS la RLS de la table de base ici :
-- c'est (a) l'ensemble de colonnes explicitement listé dans le SELECT
-- (jamais les secrets), et (b) le WHERE de la vue elle-même
-- (organisation_id = current_org_id() AND is_admin_in_org(...)).
-- PostgreSQL 15+ permettrait d'inverser ce comportement avec
-- `security_invoker = true` — mais ce serait CONTRE-PRODUCTIF ici : la
-- vue échouerait alors systématiquement pour authenticated (0 droit sur
-- la table de base), cassant le pattern entier. security_invoker reste
-- donc à sa valeur par défaut (false), de façon délibérée — exactement
-- comme parametres_entreprise_public, jamais modifiée depuis sa création.
--
-- Le risque réel avec les vues "propriétaire" n'est pas la lecture (whitelist
-- de colonnes + WHERE) mais l'ÉCRITURE : une vue simple mono-table est par
-- défaut auto-updatable par Postgres — un INSERT/UPDATE/DELETE à travers la
-- vue serait réécrit vers la table de base et exécuté avec les droits du
-- PROPRIÉTAIRE (donc en bypass RLS), pas ceux de l'appelant. C'est
-- exactement le trou qu'avait dû corriger après coup la migration
-- 20260711000004 pour parametres_entreprise_public. Ici, il est neutralisé
-- IMMÉDIATEMENT (REVOKE ci-dessous, dans la même migration que la
-- création), pas dans un correctif séparé après coup — et vérifié
-- explicitement en fin de fichier (échec bloquant si un droit d'écriture
-- subsiste).

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
  updated_at
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
  updated_at
FROM public.gbp_connections
WHERE organisation_id = current_org_id() AND is_admin_in_org(current_org_id());

GRANT SELECT ON public.gbp_connection_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gbp_connection_status FROM authenticated;

-- ── Vérification bloquante : aucun droit d'écriture résiduel, aucune
-- colonne de secret exposée, sur les deux vues ──────────────────────────
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

  RAISE NOTICE 'OK — vues de statut Google : aucun droit d''écriture résiduel, aucune colonne de secret exposée.';
END $$;
