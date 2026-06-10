-- ================================================================
-- MIGRATION : Fix email devis/factures — clients_select + devis_update
-- Date      : 2026-06-10
-- ----------------------------------------------------------------
-- CAUSE 1 — clients_select trop restrictive (bug email bouton caché)
--   clients_select (Phase 5) autorise les intervenants uniquement
--   via une intervention existante (interventions.client_id).
--   Mais un devis peut avoir un client_id sans qu'il y ait d'intervention
--   pour ce client → join client:clients(...) retourne null
--   → d.client?.email = undefined → bouton email masqué/grisé.
--   Fix : ajouter une branche OR EXISTS sur devis (intervenant_id).
-- ----------------------------------------------------------------
-- CAUSE 2 — devis_update bloque le statut 'envoye' pour intervenant_id
--   Après envoi email, onSent appelle :
--     upd.mutateAsync({ statut: 'envoye', envoye_le: now() })
--   devis_update USING (migration 00022) exige created_by = auth.uid().
--   Si admin a créé le devis et l'a assigné à l'intervenant
--   (created_by = admin_id, intervenant_id = uid) → USING échoue
--   → 0 lignes mises à jour → devis reste en brouillon sans erreur.
--   Fix : étendre USING et WITH CHECK à
--     (created_by = auth.uid() OR intervenant_id = auth.uid())
-- ----------------------------------------------------------------
-- Edge Function envoyer-email : OK (service_role, vérif canSend) ✅
-- canSendEmail frontend         : OK (lit profil depuis store)     ✅
-- factures_select (00027)       : OK                               ✅
-- factures_update (00028)       : OK                               ✅
-- ================================================================


-- ================================================================
-- PARTIE 1 — clients_select
-- ================================================================
-- Ajout : OR EXISTS (devis WHERE client_id = clients.id
--           AND intervenant_id = auth.uid()
--           AND organisation_id = clients.organisation_id)
-- Préserve : branche interventions existante + admin + org check
-- Minimal : aucune autre branche ajoutée

DROP POLICY IF EXISTS "clients_select" ON public.clients;

CREATE POLICY "clients_select" ON public.clients
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      -- Accès via intervention (Phase 5, conservé)
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.client_id      = clients.id
          AND i.intervenant_id = auth.uid()
          AND i.organisation_id = clients.organisation_id
      )
      -- Accès via devis assigné (nouveau : couvre email devis sans intervention)
      OR EXISTS (
        SELECT 1 FROM public.devis d
        WHERE d.client_id      = clients.id
          AND d.intervenant_id = auth.uid()
          AND d.organisation_id = clients.organisation_id
      )
    )
  );


-- ================================================================
-- PARTIE 2 — devis_update
-- ================================================================
-- Étend la branche non-admin de USING et WITH CHECK :
--   (created_by = auth.uid() OR intervenant_id = auth.uid())
-- Conserve :
--   · restriction statut IN ('en_attente_validation','brouillon','envoye')
--   · branche signature (statut='accepte' + signature_client IS NOT NULL)
--   · admin reste sans restriction
-- Remplace migration 00022 (DROP POLICY idempotent).

DROP POLICY IF EXISTS "devis_update" ON public.devis;

CREATE POLICY "devis_update" ON public.devis
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        (created_by = auth.uid() OR intervenant_id = auth.uid())
        AND statut IN ('en_attente_validation', 'brouillon', 'envoye')
      )
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (
        (created_by = auth.uid() OR intervenant_id = auth.uid())
        AND (
          statut IN ('en_attente_validation', 'brouillon', 'envoye')
          OR (
            statut             = 'accepte'
            AND signature_client IS NOT NULL
            AND signature_date   IS NOT NULL
          )
        )
      )
    )
  );


-- ================================================================
-- VÉRIFICATIONS
-- ================================================================

-- 1. clients_select : 3 branches pour l'intervenant
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clients' AND policyname = 'clients_select';
-- Attendu : qual contient deux EXISTS (interventions + devis)

-- 2. devis_update : intervenant_id dans USING et WITH CHECK
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'devis' AND policyname = 'devis_update';
-- Attendu : qual et with_check contiennent intervenant_id

-- 3. Toutes les policies clients et devis présentes
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('clients', 'devis')
ORDER BY tablename, cmd;
-- Attendu :
--   clients : clients_delete | clients_insert | clients_select | clients_update
--   devis   : devis_delete   | devis_insert   | devis_select   | devis_update
