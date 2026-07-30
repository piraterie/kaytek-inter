-- ================================================================
-- MIGRATION : Correction 3 bis — RLS-07 : contrôle admin manquant
--             sur get_partner_requests_preview()
-- Date       : 2026-07-24
-- ================================================================
-- Contexte (voir audit-kaytek-inter/corrections/correction-03b-rpc-
-- preview-partenaires.md pour l'analyse complète) :
--
-- get_partner_requests_preview(p_status text) est une RPC
-- SECURITY DEFINER, exécutable par authenticated, qui fournit à
-- l'organisation CIBLE un aperçu non-confidentiel (jamais adresse/
-- téléphone/nom client/photos/consignes/source_intervention_id) des
-- demandes partenaires pending/refused — nécessaire car pir_select
-- masque délibérément ces lignes tant qu'elles ne sont pas acceptées
-- (voir Correction 3 / RLS-01).
--
-- Contrairement à respond_to_partner_intervention_request() (même
-- famille de RPC, même besoin), cette fonction ne vérifiait jamais
-- is_admin_in_org() — un assistant ou un intervenant de l'organisation
-- cible pouvait donc appeler directement cette RPC (hors UI, la page
-- /partenaires étant déjà Guard adminOnly) et recevoir cet aperçu,
-- alors que le réseau partenaires est strictement réservé aux admins
-- (SEC-05, RLS-01).
--
-- Portée STRICTE de cette migration : uniquement get_partner_requests_
-- preview(). pir_select (Correction 3), pir_insert, pir_update,
-- respond_to_partner_intervention_request(), les triggers, les autres
-- tables partner_*, les helpers existants et toute donnée existante
-- restent intégralement inchangés.
--
-- Méthode : CREATE OR REPLACE FUNCTION (pas de DROP). La signature
-- (p_status text DEFAULT 'pending') et le type de retour (les 13
-- colonnes de RETURNS TABLE, mêmes noms, mêmes types, même ordre)
-- sont strictement inchangés — seul le corps change (ajout du garde
-- admin) et le LANGUAGE passe de sql à plpgsql (nécessaire : RAISE
-- EXCEPTION n'existe qu'en plpgsql, pas en SQL pur). PostgreSQL
-- autorise CREATE OR REPLACE FUNCTION à changer LANGUAGE et corps
-- sans DROP tant que les types de paramètres et le type de retour
-- (ici : la liste des colonnes OUT de RETURNS TABLE) restent
-- identiques — c'est le cas ici, donc DROP FUNCTION (et son risque
-- de fenêtre de disparition / CASCADE sur d'éventuelles dépendances)
-- n'est ni nécessaire ni utilisé.
--
-- Volontairement PAS dans cette migration :
--   · Aucun appel à current_organisation_has_app_access() — le
--     statut d'abonnement ne doit jamais bloquer cette lecture
--     (modèle Option B validé en Correction 2 : lecture toujours
--     autorisée). Un admin dont l'abonnement est inactif continue de
--     consulter cet aperçu normalement.
--   · Aucune vérification de organisations.actif — is_admin_in_org()
--     vérifie déjà profiles.actif ; l'absence de vérification de
--     l'organisation elle-même est une dette distincte, documentée
--     dans le rapport de correction, non traitée ici pour ne pas
--     élargir le périmètre de RLS-07.
--   · Aucun bypass service_role — la fonction continue de dériver
--     l'autorisation exclusivement de auth.uid() via les helpers
--     existants ; un appel service_role sans contexte JWT utilisateur
--     échoue au même titre qu'un appel authenticated non-admin
--     (current_org_id() renvoie NULL, is_admin_in_org(NULL) renvoie
--     false). GRANT à service_role accordé par hygiène (cohérent
--     avec Correction 2) mais ne crée aucun chemin de contournement.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id                      uuid,
  connection_id           uuid,
  source_organisation_id  uuid,
  type_intervention       text,
  urgence                 boolean,
  date_souhaitee          timestamptz,
  ville                   text,
  description_partagee    text,
  montant_partage         numeric,
  status                  text,
  note_refus              text,
  created_at              timestamptz,
  updated_at              timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Contrôle admin — première opération utile, avant toute lecture de
  -- partner_intervention_requests et avant tout RETURN QUERY. Dérivé
  -- exclusivement de auth.uid() via current_org_id()/is_admin_in_org()
  -- (helpers existants, non modifiés) — aucun organisation_id reçu en
  -- paramètre, aujourd'hui comme avant cette correction.
  IF NOT public.is_admin_in_org(public.current_org_id()) THEN
    RAISE EXCEPTION 'Seul un administrateur peut consulter cet aperçu de demande partenaire';
  END IF;

  -- Logique fonctionnelle strictement inchangée par rapport à la
  -- version précédente (20260715000011_pir_preview_add_updated_at.sql) :
  -- même filtre d'organisation cible, même filtre de statut, même
  -- masquage conditionnel description/montant, mêmes colonnes.
  RETURN QUERY
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
END;
$$;

ALTER FUNCTION public.get_partner_requests_preview(text) OWNER TO postgres;

REVOKE ALL
ON FUNCTION public.get_partner_requests_preview(text)
FROM PUBLIC;

-- Correction SEC2-02 (analyse : audit-kaytek-inter/corrections/
-- analyse-sec2-02-function-privileges.md) : l'image Postgres locale de
-- Supabase accorde un EXECUTE direct par défaut à anon/authenticated/
-- service_role sur toute nouvelle fonction créée par postgres — un
-- "REVOKE ALL FROM PUBLIC" seul ne le retire jamais pour anon (deux
-- entrées ACL indépendantes, confirmé empiriquement). Cette fonction a
-- été recréée (DROP+CREATE) en 20260715000011 sans REVOKE explicite
-- pour anon à ce moment-là ; le CREATE OR REPLACE de cette migration ne
-- réinitialise pas les privilèges d'un objet déjà existant, donc le
-- droit anon hérité de cette recréation antérieure persistait encore
-- sans ce REVOKE explicite.
REVOKE ALL
ON FUNCTION public.get_partner_requests_preview(text)
FROM anon;

GRANT EXECUTE
ON FUNCTION public.get_partner_requests_preview(text)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_partner_requests_preview(text)
TO service_role;

-- Aucun GRANT à anon.


-- ================================================================
-- ASSERTIONS STATIQUES (schéma uniquement — aucune dépendance à un
-- utilisateur, une organisation ou une demande réelle)
-- ================================================================
DO $$
DECLARE
  v_oid          oid;
  v_prosecdef    boolean;
  v_provolatile  char;
  v_lang         text;
  v_proconfig    text[];
  v_prosrc       text;
  v_args         text;
  v_result       text;
BEGIN
  SELECT p.oid, p.prosecdef, p.provolatile, l.lanname, p.proconfig, p.prosrc
  INTO v_oid, v_prosecdef, v_provolatile, v_lang, v_proconfig, v_prosrc
  FROM pg_proc p
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'get_partner_requests_preview';

  -- 1. La fonction existe.
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview introuvable après la migration';
  END IF;

  -- 2. SECURITY DEFINER conservé.
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview n''est plus SECURITY DEFINER';
  END IF;

  -- 3. STABLE conservé (provolatile = 's').
  IF v_provolatile <> 's' THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview n''est plus STABLE (provolatile=%)', v_provolatile;
  END IF;

  -- 4. Langage plpgsql (conversion attendue depuis sql).
  IF v_lang <> 'plpgsql' THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview n''est pas en plpgsql (lang=%)', v_lang;
  END IF;

  -- 5. search_path=public toujours fixé (même pattern que les
  -- migrations précédentes : 20260610000026, 20260722000001).
  IF v_proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_proconfig) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'Assertion échouée : search_path absent sur get_partner_requests_preview';
  END IF;

  -- 6. Le corps contient bien le garde admin.
  IF v_prosrc NOT LIKE '%is_admin_in_org%' THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview ne référence pas is_admin_in_org';
  END IF;

  -- 7. Aucun bypass service_role introduit dans le corps (garde-fou
  -- explicitement demandé — le corps ne doit jamais tester current_user
  -- ni un rôle pour contourner le contrôle admin).
  IF v_prosrc LIKE '%current_user%' OR v_prosrc ILIKE '%service_role%' THEN
    RAISE EXCEPTION 'Assertion échouée : get_partner_requests_preview semble contenir un contournement basé sur le rôle appelant';
  END IF;

  -- 8. Privilèges : anon sans EXECUTE, authenticated et service_role avec EXECUTE.
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : anon a EXECUTE sur get_partner_requests_preview';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : authenticated n''a pas EXECUTE sur get_partner_requests_preview';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : service_role n''a pas EXECUTE sur get_partner_requests_preview';
  END IF;

  -- 9. Signature inchangée : un seul paramètre p_status text DEFAULT 'pending'.
  v_args := pg_get_function_arguments(v_oid);
  IF v_args NOT LIKE '%p_status text%' OR v_args NOT LIKE '%pending%' THEN
    RAISE EXCEPTION 'Assertion échouée : signature inattendue pour get_partner_requests_preview (%)', v_args;
  END IF;

  -- 10. Colonnes de résultat : présence de toutes les colonnes attendues,
  -- absence de toute colonne sensible interdite.
  v_result := pg_get_function_result(v_oid);
  IF v_result NOT LIKE '%id uuid%'
     OR v_result NOT LIKE '%connection_id uuid%'
     OR v_result NOT LIKE '%source_organisation_id uuid%'
     OR v_result NOT LIKE '%type_intervention text%'
     OR v_result NOT LIKE '%urgence boolean%'
     OR v_result NOT LIKE '%date_souhaitee timestamp with time zone%'
     OR v_result NOT LIKE '%ville text%'
     OR v_result NOT LIKE '%description_partagee text%'
     OR v_result NOT LIKE '%montant_partage numeric%'
     OR v_result NOT LIKE '%status text%'
     OR v_result NOT LIKE '%note_refus text%'
     OR v_result NOT LIKE '%created_at timestamp with time zone%'
     OR v_result NOT LIKE '%updated_at timestamp with time zone%'
  THEN
    RAISE EXCEPTION 'Assertion échouée : colonnes de retour inattendues pour get_partner_requests_preview (%)', v_result;
  END IF;

  IF v_result ILIKE '%adresse_partagee%'
     OR v_result ILIKE '%telephone_client_partage%'
     OR v_result ILIKE '%nom_client_partage%'
     OR v_result ILIKE '%photos_partagees%'
     OR v_result ILIKE '%consignes_partagees%'
     OR v_result ILIKE '%source_intervention_id%'
  THEN
    RAISE EXCEPTION 'Assertion échouée : une colonne sensible interdite est présente dans le résultat de get_partner_requests_preview (%)', v_result;
  END IF;

  RAISE NOTICE 'Correction 3 bis (RLS-07) : toutes les assertions statiques ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT
  p.proname,
  p.prosecdef                                   AS security_definer,
  p.provolatile                                 AS volatility,
  l.lanname                                      AS language,
  pg_get_function_arguments(p.oid)               AS arguments,
  pg_get_function_result(p.oid)                  AS result
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'get_partner_requests_preview';
