-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 5 (FINALE)
-- Tables    : clients, interventions, devis, factures
-- Date      : 2026-06-10
-- Prérequis : Phases 0-4 appliquées et validées.
-- Objectif  : Durcir les 4 tables core du métier.
--             Chaque org est totalement isolée.
--             Admin voit/modifie uniquement son org.
--             Intervenant scopé uid + org.
-- Opérations préservées :
--   · création client / intervention
--   · assignation et changement de statut intervention
--   · création et modification devis par intervenant
--   · transformation devis → facture
--   · journal automatique via triggers
--   · envoi email (Edge Functions : service role, bypass RLS)
-- is_admin() non modifié. Aucune autre table modifiée.
-- ================================================================


-- ================================================================
-- TABLE : clients
-- ================================================================

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql / fix-native-functions-rls → clients_*
-- · 20260605000004 / 20260605000005               → clients_*
-- · (idempotence)
DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;
DROP POLICY IF EXISTS "clients_delete" ON public.clients;

-- SELECT : même org ET admin OU intervenant lié via une intervention
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.client_id      = clients.id
          AND i.intervenant_id = auth.uid()
          AND i.organisation_id = clients.organisation_id
      )
    )
  );

-- INSERT : admin de l'org uniquement
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : admin de l'org uniquement, reste dans l'org
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "clients_delete" ON public.clients
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- TABLE : interventions
-- ================================================================

ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql / fix-native-functions-rls → interventions_*
-- · 20260605000004 / 20260605000005               → interventions_*
-- · (idempotence)
DROP POLICY IF EXISTS "interventions_select" ON public.interventions;
DROP POLICY IF EXISTS "interventions_insert" ON public.interventions;
DROP POLICY IF EXISTS "interventions_update" ON public.interventions;
DROP POLICY IF EXISTS "interventions_delete" ON public.interventions;

-- SELECT : même org ET admin OU intervenant assigné
CREATE POLICY "interventions_select" ON public.interventions
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR intervenant_id = auth.uid()
    )
  );

-- INSERT : admin de l'org uniquement
CREATE POLICY "interventions_insert" ON public.interventions
  FOR INSERT
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- UPDATE : même org ET admin OU intervenant assigné (changement statut)
--   WITH CHECK : organisation_id ne peut pas être changé hors org ;
--                admin peut réassigner (intervenant_id ≠ auth.uid() OK via is_admin)
CREATE POLICY "interventions_update" ON public.interventions
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR intervenant_id = auth.uid()
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR intervenant_id = auth.uid()
    )
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "interventions_delete" ON public.interventions
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- TABLE : devis
-- ================================================================

ALTER TABLE public.devis ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek / fix-native / fix-devis-rls-definitif → devis_*
-- · 20260605000004 / 20260605000005                       → devis_*
-- · (idempotence)
DROP POLICY IF EXISTS "devis_select" ON public.devis;
DROP POLICY IF EXISTS "devis_insert" ON public.devis;
DROP POLICY IF EXISTS "devis_update" ON public.devis;
DROP POLICY IF EXISTS "devis_delete" ON public.devis;

-- SELECT : même org ET admin OU créateur OU intervenant assigné
CREATE POLICY "devis_select" ON public.devis
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR created_by     = auth.uid()
      OR intervenant_id = auth.uid()
    )
  );

-- INSERT : dans l'org du user ET admin OU créateur = user connecté
--          (intervenant crée son propre devis : created_by = auth.uid())
CREATE POLICY "devis_insert" ON public.devis
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR created_by = auth.uid()
    )
  );

-- UPDATE : même org ET admin OU créateur sur statuts actifs/envoyé
--   USING   : statut courant doit être en_attente_validation, brouillon ou envoye
--             pour l'intervenant (empêche modification des devis accepté/refusé/expiré)
--   WITH CHECK : statut résultant dans le même ensemble + org inchangée
--   envoye inclus dans les deux clauses pour permettre la mise à jour
--   envoye_le lors d'un re-envoi email par un intervenant canSendEmail
CREATE POLICY "devis_update" ON public.devis
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        created_by = auth.uid()
        AND statut IN ('en_attente_validation', 'brouillon', 'envoye')
      )
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        created_by = auth.uid()
        AND statut IN ('en_attente_validation', 'brouillon', 'envoye')
      )
    )
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "devis_delete" ON public.devis
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- TABLE : factures
-- ================================================================

ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek / fix-native / 20260605000004/5 → factures_*
-- · fix-devis-rls-definitif                        → factures_*
-- · (idempotence)
DROP POLICY IF EXISTS "factures_select" ON public.factures;
DROP POLICY IF EXISTS "factures_insert" ON public.factures;
DROP POLICY IF EXISTS "factures_update" ON public.factures;
DROP POLICY IF EXISTS "factures_delete" ON public.factures;

-- SELECT : même org ET admin OU créateur de la facture
CREATE POLICY "factures_select" ON public.factures
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR created_by = auth.uid()
    )
  );

-- INSERT : dans l'org du user ET admin OU créateur = user connecté
--          (couvre useDevisToFacture et useCreateFacture)
CREATE POLICY "factures_insert" ON public.factures
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR created_by = auth.uid()
    )
  );

-- UPDATE : admin de l'org uniquement
--          (changement statut_paiement, validation, etc.)
CREATE POLICY "factures_update" ON public.factures
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND organisation_id = current_org_id()
  );

-- DELETE : admin de l'org uniquement
CREATE POLICY "factures_delete" ON public.factures
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- VÉRIFICATION — résultats attendus :
--   clients       : 4 lignes
--   interventions : 4 lignes
--   devis         : 4 lignes
--   factures      : 4 lignes
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('clients', 'interventions', 'devis', 'factures')
ORDER BY tablename, cmd;
