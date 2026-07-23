-- ================================================================
-- MIGRATION : Correction SEC2-02 — durcissement des privilèges
--             EXECUTE de 5 fonctions sensibles (migration additive)
-- Date       : 2026-07-27 (postérieure à toutes les migrations
--              existantes — ne modifie, ne renomme ni ne supprime
--              aucune migration existante)
-- ================================================================
--
-- CONTEXTE (voir audit-kaytek-inter/corrections/analyse-sec2-02-
-- function-privileges.md pour l'analyse complète) :
--
-- L'image Postgres locale de Supabase définit un privilège par défaut
-- (pg_default_acl), présent dès l'initialisation du conteneur, avant
-- toute migration de ce dépôt : toute nouvelle fonction créée par le
-- rôle `postgres` dans le schéma `public` reçoit automatiquement un
-- EXECUTE direct pour `anon`, `authenticated` et `service_role` — en
-- plus du GRANT implicite standard à PUBLIC que tout Postgres accorde
-- par défaut. Un simple `REVOKE ALL ... FROM PUBLIC` ne retire QUE
-- l'entrée PUBLIC ; il ne retire jamais un privilège accordé
-- directement à un rôle nommé par ce mécanisme (confirmé
-- empiriquement, deux entrées ACL indépendantes dans `pg_proc.proacl`).
--
-- Cette migration additive est nécessaire car les 4 migrations
-- historiques déjà corrigées dans cette même session
-- (20260722000001, 20260724000001, 20260725000001, 20260726000001)
-- sont très probablement déjà enregistrées comme appliquées sur toute
-- base ayant déjà tourné ces migrations (notamment la production) —
-- les modifier localement ne change rien à ce qui a déjà été exécuté
-- ailleurs. Cette migration réapplique donc, de façon strictement
-- IDEMPOTENTE (uniquement des REVOKE/GRANT, jamais une recréation de
-- fonction ni une modification de policy/donnée), l'état final attendu
-- des privilèges — sûre à rejouer sur n'importe quelle base, qu'elle
-- ait déjà le bon état ou non (REVOKE sur un privilège déjà absent ne
-- produit ni erreur ni effet de bord ; GRANT sur un privilège déjà
-- présent non plus).
--
-- N'effectue AUCUNE des actions suivantes :
--   · Aucune donnée modifiée.
--   · Aucune fonction recréée (aucun CREATE OR REPLACE FUNCTION ici —
--     uniquement REVOKE/GRANT sur les fonctions existantes).
--   · Aucune policy modifiée.
--   · Aucun privilège par défaut (ALTER DEFAULT PRIVILEGES) modifié —
--     la cause racine reste au niveau de la plateforme Supabase, hors
--     de portée d'une migration applicative ; cette migration corrige
--     uniquement les 5 fonctions déjà identifiées, une par une, avec
--     leur signature exacte.
--   · Aucun secret.
--
-- MODÈLE D'AUTORISATION FINAL (déterminé par analyse des appelants
-- réels — voir le rapport de correction pour le détail complet) :
--
--   · current_organisation_has_app_access() — référencée par 19
--     policies RLS de mutation + 4 policies Storage, et appelée en
--     interne par get_my_app_access_status(). Confirmé EMPIRIQUEMENT
--     (conteneur Postgres jetable, isolé) qu'une policy RLS référençant
--     une fonction exige que le rôle interrogeant dispose lui-même du
--     droit EXECUTE — authenticated DOIT conserver ce droit, sous
--     peine de casser toutes les mutations métier pour tout
--     utilisateur connecté. anon : aucun besoin, jamais appelée en RPC
--     directe. service_role : conservé par cohérence avec le design
--     d'origine (déjà accordé explicitement en Correction 2).
--   · get_my_app_access_status() — appelée par les Edge Functions
--     envoyer-email/inviter-intervenant/send-reminders, dans le
--     contexte du JWT de l'utilisateur appelant (rôle authenticated
--     effectif, jamais anon réel). authenticated et service_role
--     conservés, anon révoqué.
--   · get_partner_requests_preview(text) — appelée directement par le
--     frontend (src/lib/hooks/partners.ts, supabase.rpc(...)), garde
--     admin déjà vérifiée à l'intérieur de la fonction elle-même
--     (is_admin_in_org, Correction 3 bis). authenticated et
--     service_role conservés, anon révoqué.
--   · next_document_number(uuid, text) — confirmé EMPIRIQUEMENT
--     (conteneur jetable : chaîne trigger SECURITY DEFINER postgres →
--     SECURITY DEFINER postgres) qu'aucun rôle appelant original n'a
--     besoin d'un droit EXECUTE direct pour que les triggers de
--     numérotation continuent de fonctionner. Aucun appel direct
--     (frontend/Edge Function/migration) identifié nulle part dans le
--     dépôt. anon, authenticated ET service_role révoqués — aucun GRANT.
--   · calculate_commission_for_facture(uuid) — même raisonnement exact
--     que next_document_number() : appelée exclusivement par les
--     triggers de transition de statut de facture / modification de
--     matériel. anon, authenticated ET service_role révoqués — aucun
--     GRANT.
-- ================================================================


-- ================================================================
-- 1. current_organisation_has_app_access() — Correction 2
-- ================================================================
REVOKE ALL ON FUNCTION public.current_organisation_has_app_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_organisation_has_app_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO service_role;


-- ================================================================
-- 2. get_my_app_access_status() — Correction 2
-- ================================================================
REVOKE ALL ON FUNCTION public.get_my_app_access_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_app_access_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_access_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_app_access_status() TO service_role;


-- ================================================================
-- 3. get_partner_requests_preview(text) — Correction 3 bis
-- ================================================================
REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO service_role;


-- ================================================================
-- 4. next_document_number(uuid, text) — Correction 4
--    Aucun GRANT à qui que ce soit — appelée uniquement via triggers.
-- ================================================================
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM service_role;


-- ================================================================
-- 5. calculate_commission_for_facture(uuid) — Correction 5
--    Aucun GRANT à qui que ce soit — appelée uniquement via triggers.
-- ================================================================
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM service_role;


-- ================================================================
-- 6. ASSERTIONS — droits effectifs (has_function_privilege), pas
--    seulement la présence d'une entrée dans proacl.
-- ================================================================
DO $$
BEGIN
  -- current_organisation_has_app_access()
  IF has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : anon a encore EXECUTE sur current_organisation_has_app_access()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : authenticated n''a plus EXECUTE sur current_organisation_has_app_access() (requis par les policies RLS)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : service_role n''a plus EXECUTE sur current_organisation_has_app_access()';
  END IF;

  -- get_my_app_access_status()
  IF has_function_privilege('anon', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : anon a encore EXECUTE sur get_my_app_access_status()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : authenticated n''a plus EXECUTE sur get_my_app_access_status()';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : service_role n''a plus EXECUTE sur get_my_app_access_status()';
  END IF;

  -- get_partner_requests_preview(text)
  IF has_function_privilege('anon', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : anon a encore EXECUTE sur get_partner_requests_preview(text)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : authenticated n''a plus EXECUTE sur get_partner_requests_preview(text)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_partner_requests_preview(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : service_role n''a plus EXECUTE sur get_partner_requests_preview(text)';
  END IF;

  -- next_document_number(uuid, text) — aucun droit à personne
  IF has_function_privilege('anon', 'public.next_document_number(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.next_document_number(uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.next_document_number(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : next_document_number(uuid,text) reste exécutable par un rôle qui ne devrait avoir aucun accès direct';
  END IF;

  -- calculate_commission_for_facture(uuid) — aucun droit à personne
  IF has_function_privilege('anon', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC2-02 : calculate_commission_for_facture(uuid) reste exécutable par un rôle qui ne devrait avoir aucun accès direct';
  END IF;

  RAISE NOTICE 'SEC2-02 : toutes les assertions de privilèges EXECUTE ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT
  p.oid::regprocedure AS function_signature,
  p.prosecdef,
  p.proconfig,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'current_organisation_has_app_access',
    'get_my_app_access_status',
    'get_partner_requests_preview',
    'next_document_number',
    'calculate_commission_for_facture'
  )
ORDER BY p.proname;
