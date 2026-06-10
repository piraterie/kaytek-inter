-- ================================================================
-- MIGRATION : Phase 7 — SECURITY DEFINER hygiene
-- Date      : 2026-06-10
-- Objectif  : Ajouter SET search_path = public aux fonctions
--             SECURITY DEFINER qui ne l'ont pas.
--             Supprimer les fonctions orphelines (plus de trigger).
-- ----------------------------------------------------------------
-- Fonctions patchées :
--   · handle_new_user()          — ADD SET search_path = public
--                                   + COALESCE org_id depuis metadata
--                                   + fallback kaytek-inter conservé
--   · auto_commission()          — ADD SET search_path = public
--                                   logique métier identique
-- ----------------------------------------------------------------
-- Fonctions supprimées :
--   · generate_facture_numero()       — orpheline (remplacée par
--                                       gen_numero_facture() en 00023)
--   · generate_intervention_numero()  — normalement droppée par 00024
--                                       DROP IF EXISTS défensif
-- ----------------------------------------------------------------
-- Fonctions validées OK — non modifiées :
--   · current_org_id()                SET search_path ✅ (00016)
--   · is_same_org(uuid)               SET search_path ✅ (00016)
--   · is_admin_in_org(uuid)           SET search_path ✅ (00016)
--   · is_admin()                      SET search_path ✅ (schema) — intouchable
--   · gen_numero_facture()            SET search_path ✅ (00023)
--   · generate_devis_numero()         SET search_path ✅ (00024)
--   · gen_numero_intervention()       SET search_path ✅ (00024)
--   · protect_profile_sensitive_fields() SET search_path ✅ (00025)
-- ----------------------------------------------------------------
-- Tables    : aucune modification
-- RLS       : aucune modification
-- Triggers  : aucun trigger créé ni supprimé
-- Frontend  : non modifié
-- Edge Functions : non modifiées
-- ================================================================


-- ================================================================
-- PARTIE 1 — NETTOYAGE fonctions orphelines
-- ================================================================

-- generate_facture_numero() : version originale sans search_path.
-- Remplacée par gen_numero_facture() (migration 00023).
-- Aucun trigger ne la référence plus après 00023.
-- Sans search_path restant actif = risque d'injection de schéma.
DROP FUNCTION IF EXISTS public.generate_facture_numero();

-- generate_intervention_numero() : normalement supprimée par 00024.
-- DROP IF EXISTS = idempotent, pas d'erreur si déjà absente.
DROP FUNCTION IF EXISTS public.generate_intervention_numero();


-- ================================================================
-- PARTIE 2 — handle_new_user()
-- ================================================================
-- Correctif    : SET search_path = public
-- Amélioration : organisation_id lu depuis raw_user_meta_data si
--                présent (COALESCE), fallback kaytek-inter conservé.
--   Comportement actuel (inviter-intervenant ne passe pas org_id
--   dans les metadata) : raw_user_meta_data->>'organisation_id'
--   = NULL → cast NULL → sous-SELECT retourne 0 lignes → COALESCE
--   utilise kaytek-inter → comportement identique à l'original.
--   Futur multi-tenant : passer organisation_id dans les metadata
--   de l'invitation → profil créé directement dans la bonne org.
-- Trigger on_auth_user_created : INCHANGÉ (AFTER INSERT auth.users).

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom',    ''),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'role',   'intervenant'),
    COALESCE(
      -- Org passée dans les metadata (NULL si inviter-intervenant ne la passe pas)
      (SELECT id FROM public.organisations
       WHERE id = (NEW.raw_user_meta_data->>'organisation_id')::uuid
       LIMIT 1),
      -- Fallback : organisation kaytek-inter (comportement actuel conservé)
      (SELECT id FROM public.organisations
       WHERE slug = 'kaytek-inter'
       LIMIT 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;


-- ================================================================
-- PARTIE 3 — auto_commission()
-- ================================================================
-- Correctif : SET search_path = public
-- Logique métier strictement identique à l'original :
--   · AFTER UPDATE interventions, statut → 'termine'
--   · lit commission_pct dans profiles
--   · INSERT dans commissions avec WHERE NOT EXISTS (anti-doublon)
--   · utilise NEW.organisation_id pour l'isolation multi-tenant
-- Trigger trg_auto_commission : INCHANGÉ (AFTER UPDATE interventions).

CREATE OR REPLACE FUNCTION public.auto_commission()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_pct  NUMERIC;
  v_part NUMERIC;
  v_comm NUMERIC;
BEGIN
  IF NEW.statut      = 'termine'
     AND OLD.statut <> 'termine'
     AND NEW.montant_ttc    IS NOT NULL
     AND NEW.intervenant_id IS NOT NULL
  THEN
    SELECT commission_pct INTO v_pct
    FROM public.profiles
    WHERE id = NEW.intervenant_id;

    v_pct  := COALESCE(v_pct, 30);
    v_comm := ROUND(NEW.montant_ttc * v_pct / 100, 2);
    v_part := NEW.montant_ttc - v_comm;

    INSERT INTO public.commissions (
      intervention_id,
      intervenant_id,
      montant_total_client,
      commission_pct,
      part_intervenant,
      commission_admin,
      statut,
      organisation_id
    )
    SELECT
      NEW.id,
      NEW.intervenant_id,
      NEW.montant_ttc,
      v_pct,
      v_part,
      v_comm,
      'a_payer',
      NEW.organisation_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commissions WHERE intervention_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.auto_commission() OWNER TO postgres;


-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

-- 1. Toutes les fonctions SECURITY DEFINER ont SET search_path
--    Attendu : toutes les fonctions du schema public marquées
--              prosecdef = true ont un proconfig contenant search_path
SELECT
  proname                                                     AS fonction,
  prosecdef                                                   AS sec_definer,
  proowner::regrole                                           AS owner,
  CASE
    WHEN proconfig IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'
     )
    THEN 'OUI ✅'
    ELSE 'NON ❌'
  END                                                         AS search_path_set,
  proconfig                                                   AS config_raw
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef    = true
ORDER BY proname;
-- Attendu : 0 ligne avec search_path_set = 'NON ❌'


-- 2. Fonctions orphelines absentes
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('generate_facture_numero', 'generate_intervention_numero');
-- Attendu : 0 lignes


-- 3. handle_new_user et auto_commission patchées
SELECT
  proname,
  prosecdef,
  proowner::regrole AS owner,
  proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('handle_new_user', 'auto_commission');
-- Attendu :
--   handle_new_user  | true | postgres | {search_path=public}
--   auto_commission  | true | postgres | {search_path=public}


-- 4. Triggers clés toujours en place
SELECT
  trigger_name,
  event_object_schema,
  event_object_table,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE trigger_name IN (
  'on_auth_user_created',
  'trg_auto_commission',
  'set_devis_numero',
  'set_facture_numero',
  'set_intervention_numero',
  'trg_protect_profile_fields'
)
ORDER BY event_object_table, trigger_name;
-- Attendu :
--   on_auth_user_created     | auth   | users         | INSERT | AFTER
--   trg_auto_commission      | public | interventions | UPDATE | AFTER
--   set_intervention_numero  | public | interventions | INSERT | BEFORE
--   set_devis_numero         | public | devis         | INSERT | BEFORE
--   set_facture_numero       | public | factures      | INSERT | BEFORE
--   trg_protect_profile_fields | public | profiles    | UPDATE | BEFORE
