-- ================================================================
-- MIGRATION : Échéanciers de paiement — RLS multi-tenant
-- Date       : 2026-07-30
-- Objectif   : Sécuriser echeanciers/echeances/paiements/relances_paiement/
--              journal_echeancier avec le même modèle que devis/factures
--              (is_same_org / is_admin_in_org / is_intervenant_in_org,
--              cf. 20260708000008_security_phase1_critical_hardening.sql).
--              Un assistant (ni admin ni intervenant actif) échoue toutes
--              les branches non-admin, comme pour devis/factures (SEC-01).
-- Portée     : RLS uniquement, aucune donnée modifiée.
-- ================================================================

ALTER TABLE public.echeanciers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.echeances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paiements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relances_paiement  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_echeancier ENABLE ROW LEVEL SECURITY;

-- ── Helper : l'intervenant courant est-il propriétaire du devis ? ──
CREATE OR REPLACE FUNCTION public.intervenant_owns_devis(p_devis_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.devis d
    WHERE d.id = p_devis_id
      AND (d.created_by = auth.uid() OR d.intervenant_id = auth.uid())
  )
$$;

-- ── echeanciers ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "echeanciers_select" ON public.echeanciers;
DROP POLICY IF EXISTS "echeanciers_insert" ON public.echeanciers;
DROP POLICY IF EXISTS "echeanciers_update" ON public.echeanciers;
DROP POLICY IF EXISTS "echeanciers_delete" ON public.echeanciers;

CREATE POLICY "echeanciers_select" ON public.echeanciers
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_owns_devis(devis_id))
    )
  );

CREATE POLICY "echeanciers_insert" ON public.echeanciers
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_owns_devis(devis_id))
    )
  );

-- Modification autorisée tant que l'échéancier n'est ni payé ni annulé
-- (cf. règle métier section 14 : pas de modif incohérente une fois soldé).
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
  );

-- Suppression réservée à l'admin, et uniquement défensive : le workflow
-- normal utilise l'annulation logique (annule_le), jamais de DELETE réel
-- une fois qu'une facture ou un paiement est lié (imposé côté application).
CREATE POLICY "echeanciers_delete" ON public.echeanciers
  FOR DELETE
  USING (is_admin_in_org(organisation_id));

-- ── echeances ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "echeances_select" ON public.echeances;
DROP POLICY IF EXISTS "echeances_insert" ON public.echeances;
DROP POLICY IF EXISTS "echeances_update" ON public.echeances;
DROP POLICY IF EXISTS "echeances_delete" ON public.echeances;

CREATE POLICY "echeances_select" ON public.echeances
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_owns_devis(devis_id))
    )
  );

CREATE POLICY "echeances_insert" ON public.echeances
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_owns_devis(devis_id))
    )
  );

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
  );

-- Suppression réservée à l'admin, uniquement pour une échéance encore brouillon
-- (sécurité : jamais de DELETE une fois facturée/payée, cf. section 14).
CREATE POLICY "echeances_delete" ON public.echeances
  FOR DELETE
  USING (is_admin_in_org(organisation_id) AND statut = 'brouillon');

-- ── paiements ───────────────────────────────────────────────────
-- Données financières sensibles : même restriction que factures (SEC-01),
-- un assistant n'entre dans aucune branche. Pas de policy DELETE : la
-- suppression est toujours logique (colonne deleted_at via UPDATE), afin
-- de conserver la traçabilité complète exigée section 6.
DROP POLICY IF EXISTS "paiements_select" ON public.paiements;
DROP POLICY IF EXISTS "paiements_insert" ON public.paiements;
DROP POLICY IF EXISTS "paiements_update" ON public.paiements;

CREATE POLICY "paiements_select" ON public.paiements
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND (devis_id IS NULL OR intervenant_owns_devis(devis_id))
      )
    )
  );

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
  );

-- Correction d'un paiement : admin toujours ; intervenant seulement sur
-- sa propre saisie et tant qu'elle n'est pas déjà marquée supprimée.
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
  );

-- ── relances_paiement ───────────────────────────────────────────
-- Lecture ouverte à l'intervenant concerné (suivi de ses propres devis) ;
-- écriture réservée à l'admin (déclenchement manuel) et au service_role
-- (edge function planifiée, qui bypass RLS via la clé service).
DROP POLICY IF EXISTS "relances_paiement_select" ON public.relances_paiement;
DROP POLICY IF EXISTS "relances_paiement_insert" ON public.relances_paiement;
DROP POLICY IF EXISTS "relances_paiement_update" ON public.relances_paiement;

CREATE POLICY "relances_paiement_select" ON public.relances_paiement
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_owns_devis(
        (SELECT devis_id FROM public.echeanciers e WHERE e.id = relances_paiement.echeancier_id)
      ))
    )
  );

CREATE POLICY "relances_paiement_insert" ON public.relances_paiement
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
  );

CREATE POLICY "relances_paiement_update" ON public.relances_paiement
  FOR UPDATE
  USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id))
  WITH CHECK (organisation_id = current_org_id() AND is_admin_in_org(current_org_id()));

-- ── journal_echeancier ──────────────────────────────────────────
-- Journal d'audit append-only : SELECT + INSERT seulement, jamais
-- d'UPDATE/DELETE pour personne (intégrité de l'historique).
DROP POLICY IF EXISTS "journal_echeancier_select" ON public.journal_echeancier;
DROP POLICY IF EXISTS "journal_echeancier_insert" ON public.journal_echeancier;

CREATE POLICY "journal_echeancier_select" ON public.journal_echeancier
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_owns_devis(
        (SELECT devis_id FROM public.echeanciers e WHERE e.id = journal_echeancier.echeancier_id)
      ))
    )
  );

CREATE POLICY "journal_echeancier_insert" ON public.journal_echeancier
  FOR INSERT
  WITH CHECK (organisation_id = current_org_id());

-- ================================================================
-- VÉRIFICATION
-- ================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('echeanciers','echeances','paiements','relances_paiement','journal_echeancier')
-- ORDER BY tablename, cmd;
