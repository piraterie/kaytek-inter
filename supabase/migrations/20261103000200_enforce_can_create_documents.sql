-- 20261103000200_enforce_can_create_documents.sql
--
-- can_create_documents n'était appliqué que par l'interface (Guard
-- requireCanCreateDocs, hooks useCreateDevis / useDuplicateDevis /
-- useCreateFacture, boutons) : un intervenant sans cette autorisation
-- pouvait créer devis et factures en appelant directement l'API.
--
-- Désormais, côté serveur, un intervenant ne peut INSÉRER un devis ou une
-- facture que si son profil a can_create_documents = true. Admin : inchangé.
-- Toutes les autres conditions existantes sont conservées à l'identique
-- (organisation, created_by = appelant, accès abonnement). UPDATE / DELETE /
-- SELECT inchangés (la modification des factures de l'admin par un
-- intervenant reste en l'état, en attente de décision).
--
-- Couvre aussi generate_facture_echeance() (SECURITY INVOKER : l'INSERT est
-- soumis à cette policy), cohérent avec l'interface qui ne propose la gestion
-- d'échéancier qu'avec can_create_documents.

CREATE OR REPLACE FUNCTION public.current_user_can_create_documents()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT can_create_documents FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    false
  )
$$;
ALTER FUNCTION public.current_user_can_create_documents() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_user_can_create_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_create_documents() TO authenticated;

DROP POLICY IF EXISTS devis_insert ON public.devis;
CREATE POLICY devis_insert ON public.devis
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND created_by = auth.uid()
        AND current_user_can_create_documents()
      )
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS factures_insert ON public.factures;
CREATE POLICY factures_insert ON public.factures
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND created_by = auth.uid()
        AND current_user_can_create_documents()
      )
    )
    AND current_organisation_has_app_access()
  );
