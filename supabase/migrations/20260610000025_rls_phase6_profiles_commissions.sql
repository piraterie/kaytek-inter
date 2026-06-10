-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 6 (FINALE)
-- Tables    : profiles, commissions
-- Date      : 2026-06-10
-- Prérequis : Phases 0–5 appliquées et validées.
-- Objectif  :
--   · profiles   — SELECT cross-org (auth.uid() IS NOT NULL)
--                  → restreindre à is_same_org(organisation_id)
--                  + trigger BEFORE UPDATE protect_profile_sensitive_fields()
--                  → empêche un non-admin de modifier role, actif,
--                    organisation_id, commission_pct, permissions
--   · commissions — policies is_admin() sans filtre org
--                  → réécrire avec is_same_org + is_admin_in_org
-- Opérations préservées :
--   · handle_new_user()  → SECURITY DEFINER postgres → bypass RLS ✅
--   · inviter-intervenant → service_role → auth.uid()=NULL → trigger autorise ✅
--   · supprimer-utilisateur → service_role → bypass RLS ✅
--   · auto_commission()  → SECURITY DEFINER postgres → bypass RLS ✅
--   · useProfiles / useIntervenants / messagerie / dashboard
--   · joins commissions→profiles dans useCommissions
-- is_admin() non modifié.
-- handle_new_user() non modifié.
-- Aucune autre table modifiée.
-- ================================================================


-- ================================================================
-- PARTIE 1 — TRIGGER PROTECTION CHAMPS SENSIBLES profiles
-- (créé avant les policies pour être en place dès l'application)
-- ================================================================

-- Fonction BEFORE UPDATE :
--   auth.uid() IS NULL → service_role ou postgres → autoriser tout
--   is_admin_in_org()  → admin de l'org → autoriser tout
--   id = auth.uid() ET non-admin → bloquer modification champs sensibles
--   autre cas (ne devrait pas arriver grâce au RLS) → bloquer
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  current_uid uuid;
BEGIN
  -- auth.uid() retourne l'UID JWT même en contexte SECURITY DEFINER.
  -- Si NULL → appel service_role (Edge Functions) ou trigger postgres
  -- (SECURITY DEFINER) → aucune restriction.
  current_uid := auth.uid();

  IF current_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin de l'org concernée → peut modifier tous les champs.
  IF is_admin_in_org(OLD.organisation_id) THEN
    RETURN NEW;
  END IF;

  -- Utilisateur non-admin modifiant son propre profil.
  IF current_uid = OLD.id THEN

    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Champ protégé : "role" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.actif IS DISTINCT FROM OLD.actif THEN
      RAISE EXCEPTION 'Champ protégé : "actif" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION 'Champ protégé : "organisation_id" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
      RAISE EXCEPTION 'Champ protégé : "commission_pct" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.can_create_documents IS DISTINCT FROM OLD.can_create_documents THEN
      RAISE EXCEPTION 'Champ protégé : "can_create_documents" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.can_bypass_validation IS DISTINCT FROM OLD.can_bypass_validation THEN
      RAISE EXCEPTION 'Champ protégé : "can_bypass_validation" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.type_intervenant IS DISTINCT FROM OLD.type_intervenant THEN
      RAISE EXCEPTION 'Champ protégé : "type_intervenant" ne peut être modifié que par un administrateur';
    END IF;

    RETURN NEW;
  END IF;

  -- Cas résiduel : non-admin tentant de modifier le profil d'autrui.
  -- En théorie bloqué par RLS USING, mais défense en profondeur.
  RAISE EXCEPTION 'Modification de profil non autorisée';
END;
$$;

-- Trigger BEFORE UPDATE — s'applique à toutes les mises à jour,
-- y compris via SDK authentifié. Service_role et SECURITY DEFINER
-- postgres passent par le chemin current_uid IS NULL → autorisé.
DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_fields();


-- ================================================================
-- PARTIE 2 — RLS TABLE profiles
-- ================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql        → profiles_select/update
-- · fix-native-functions-rls  → profiles_select/insert/update
-- · database-schema.sql       → profiles_select/update/delete
-- · (idempotence)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;

-- SELECT : tout membre de l'org voit les profils de son org
--   Nécessaire pour :
--   · liste intervenants / UsersPage
--   · assignation intervenant dans InterventionsPage
--   · affichage nom dans devis/factures/commissions (joins)
--   · messagerie — useConversations contacts
--   · notifyAdmins() → .eq('role','admin') restreint à l'org
--   · Realtime — résoudre le nom de l'expéditeur (senderId)
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT
  USING (is_same_org(organisation_id));

-- INSERT : profil doit appartenir à l'org de l'appelant
--   handle_new_user (postgres) et inviter-intervenant (service_role)
--   bypassent RLS → cette policy protège les inserts directs.
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT
  WITH CHECK (organisation_id = current_org_id());

-- UPDATE :
--   USING     : même org ET (profil propre OU admin de l'org)
--   WITH CHECK: org inchangée ET (profil propre OU admin de l'org)
--   La protection des champs sensibles est assurée par le trigger
--   trg_protect_profile_fields ci-dessus.
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      id = auth.uid()
      OR is_admin_in_org(current_org_id())
    )
  );

-- DELETE : admin de l'org uniquement
--   supprimer-utilisateur Edge Function → service_role → bypass RLS
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- PARTIE 3 — RLS TABLE commissions
-- ================================================================

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · 20260605000004_rls_role_policies.sql → commissions_*
-- · fix-rls-kaytek.sql                  → commissions_*
-- · fix-native-functions-rls.sql        → commissions_*
-- · (idempotence)
DROP POLICY IF EXISTS "commissions_select" ON public.commissions;
DROP POLICY IF EXISTS "commissions_insert" ON public.commissions;
DROP POLICY IF EXISTS "commissions_update" ON public.commissions;
DROP POLICY IF EXISTS "commissions_delete" ON public.commissions;

-- SELECT : même org ET (admin OU intervenant concerné)
--   · useCommissions admin → toutes les commissions de l'org
--   · useCommissions intervenant → .eq('intervenant_id', uid)
--   · dashboard admin / intervenant
--   · join commissions→profiles → même org ✅
CREATE POLICY "commissions_select" ON public.commissions
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR intervenant_id = auth.uid()
    )
  );

-- INSERT : admin OU intervenant sur ses propres commissions, dans son org
--   auto_commission() est SECURITY DEFINER (postgres) → bypass RLS ✅
CREATE POLICY "commissions_insert" ON public.commissions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR intervenant_id = auth.uid()
    )
  );

-- UPDATE : admin de l'org uniquement
--   useUpdateCommission → marquer commission payée
CREATE POLICY "commissions_update" ON public.commissions
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "commissions_delete" ON public.commissions
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

-- 1. Trigger en place
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'profiles'
  AND trigger_name        = 'trg_protect_profile_fields';
-- Attendu : 1 ligne UPDATE BEFORE

-- 2. Fonction : SECURITY DEFINER = true
SELECT proname, prosecdef, proowner::regrole AS owner
FROM pg_proc
WHERE proname      = 'protect_profile_sensitive_fields'
  AND pronamespace = 'public'::regnamespace;
-- Attendu : security_definer = true

-- 3. Policies profiles et commissions
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'commissions')
ORDER BY tablename, cmd;
-- Attendu : 4 lignes profiles + 4 lignes commissions = 8 lignes
