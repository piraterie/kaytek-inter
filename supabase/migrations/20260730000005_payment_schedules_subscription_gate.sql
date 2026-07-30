-- ================================================================
-- MIGRATION : Échéanciers de paiement — verrou d'abonnement (parité SEC2-01)
-- Date       : 2026-07-30
-- ================================================================
-- Contexte : la migration SEC2-01 (subscription_access_enforcement, déjà
-- appliquée en production le 2026-07-22 mais absente de l'historique git
-- de ce dépôt suite à une réécriture d'historique antérieure — dérive de
-- schéma constatée lors de ce déploiement) a ajouté
-- "AND current_organisation_has_app_access()" aux policies RLS
-- d'INSERT/UPDATE de clients, devis, factures, commissions —
-- empêchant une organisation à l'abonnement expiré/impayé de continuer
-- à créer de la valeur métier via un appel API direct, même avec un JWT
-- valide.
--
-- Les tables echeanciers/echeances/paiements introduites par
-- 20260730000001-3 n'existaient pas encore lors de SEC2-01 et n'ont donc
-- pas hérité de ce verrou. Cette migration l'ajoute, par symétrie
-- stricte avec devis/factures : même portée (INSERT + UPDATE
-- uniquement, jamais SELECT/DELETE), même condition, ajoutée par "AND"
-- sans retirer aucun contrôle existant.
--
-- Hors périmètre (choix identique à SEC2-01 qui exclut explicitement le
-- journal d'audit et les actions de type "marquer lu") :
--   · journal_echeancier : journal d'audit append-only, doit continuer
--     à enregistrer même si l'abonnement est bloqué (intégrité de
--     l'historique).
--   · relances_paiement : action de recouvrement sur une créance déjà
--     existante, pas de création de nouvelle valeur métier — bloquer
--     l'envoi de relances pénaliserait le recouvrement de sommes déjà
--     dues, à l'inverse de l'objectif de SEC2-01.
-- ================================================================

-- ── echeanciers ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "echeanciers_insert" ON public.echeanciers;
CREATE POLICY "echeanciers_insert" ON public.echeanciers
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_owns_devis(devis_id))
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "echeanciers_update" ON public.echeanciers;
CREATE POLICY "echeanciers_update" ON public.echeanciers
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND intervenant_owns_devis(devis_id)
        AND statut NOT IN ('paye', 'annule')
      )
    )
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND intervenant_owns_devis(devis_id)
        AND statut NOT IN ('paye', 'annule')
      )
    )
    AND current_organisation_has_app_access()
  );

-- ── echeances ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "echeances_insert" ON public.echeances;
CREATE POLICY "echeances_insert" ON public.echeances
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_owns_devis(devis_id))
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "echeances_update" ON public.echeances;
CREATE POLICY "echeances_update" ON public.echeances
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND intervenant_owns_devis(devis_id)
        AND statut NOT IN ('paye', 'annule')
      )
    )
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND intervenant_owns_devis(devis_id)
        AND statut NOT IN ('paye', 'annule')
      )
    )
    AND current_organisation_has_app_access()
  );

-- ── paiements ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "paiements_insert" ON public.paiements;
CREATE POLICY "paiements_insert" ON public.paiements
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND created_by = auth.uid()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND (devis_id IS NULL OR intervenant_owns_devis(devis_id))
      )
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "paiements_update" ON public.paiements;
CREATE POLICY "paiements_update" ON public.paiements
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND created_by = auth.uid()
        AND deleted_at IS NULL
        AND (devis_id IS NULL OR intervenant_owns_devis(devis_id))
      )
    )
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        is_intervenant_in_org(current_org_id())
        AND created_by = auth.uid()
        AND (devis_id IS NULL OR intervenant_owns_devis(devis_id))
      )
    )
    AND current_organisation_has_app_access()
  );

-- ================================================================
-- VÉRIFICATION
-- ================================================================
-- SELECT tablename, policyname, cmd, with_check ILIKE '%current_organisation_has_app_access%' AS gated
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('echeanciers','echeances','paiements')
--   AND cmd IN ('INSERT','UPDATE')
-- ORDER BY tablename, cmd;
