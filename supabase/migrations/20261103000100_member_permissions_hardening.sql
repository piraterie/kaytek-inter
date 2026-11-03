-- 20261103000100_member_permissions_hardening.sql
--
-- Audit des droits assistant / intervenant (2026-11-03), deux écarts serveur
-- corrigés — vérifiés empiriquement (JWT simulé, transaction annulée) :
--
-- 1. profiles_insert n'exigeait que « même organisation » : tout membre
--    (intervenant, assistant) pouvait créer un profil, y compris role='admin',
--    pour n'importe quel compte Auth sans profil — escalade de privilèges
--    (le trigger protect_profile_sensitive_fields ne couvre que l'UPDATE).
--    Aucun code client n'insère de profil : les invitations passent par
--    l'Edge Function inviter-intervenant (service role, non concernée par RLS).
--    → insertion réservée aux administrateurs de l'organisation.
--
-- 2. document_public_links : tout membre voyait (et pouvait supprimer) les
--    liens publics de TOUS les devis/factures de l'organisation — un assistant
--    pouvait donc ouvrir /d/:token et consulter devis et factures, contraire
--    au périmètre prévu (aucune donnée financière pour l'assistant).
--    → lecture/suppression : administrateur, ou auteur du lien ; création :
--    created_by doit être l'appelant (les conditions existantes — document
--    visible par l'appelant via RLS, accès abonnement — sont conservées).
--
-- get-public-document (consultation publique par jeton) utilise le service
-- role : non concerné.

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
  );

DROP POLICY IF EXISTS org_select ON public.document_public_links;
CREATE POLICY org_select ON public.document_public_links
  FOR SELECT
  USING (
    organisation_id = current_org_id()
    AND (is_admin_in_org(organisation_id) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS org_delete ON public.document_public_links;
CREATE POLICY org_delete ON public.document_public_links
  FOR DELETE
  USING (
    organisation_id = current_org_id()
    AND (is_admin_in_org(organisation_id) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS org_insert ON public.document_public_links;
CREATE POLICY org_insert ON public.document_public_links
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND created_by = auth.uid()
    AND (
      (document_type = 'devis' AND EXISTS (
        SELECT 1 FROM public.devis d
        WHERE d.id = document_public_links.document_id
          AND d.organisation_id = document_public_links.organisation_id))
      OR
      (document_type = 'facture' AND EXISTS (
        SELECT 1 FROM public.factures f
        WHERE f.id = document_public_links.document_id
          AND f.organisation_id = document_public_links.organisation_id))
    )
    AND current_organisation_has_app_access()
  );
