-- ================================================================
-- MIGRATION : Correctif clients_insert/clients_select — création
--             de client par un intervenant
-- Date       : 2026-07-14
-- Cause      : 20260714000001 étendait clients_insert à l'intervenant
--              (organisation_id = current_org_id() AND (can_manage_
--              operations(...) OR is_intervenant_in_org(...))) — cette
--              partie était correcte. Mais useCreateClient() fait un
--              INSERT ... RETURNING (via .select().single()), et
--              Postgres applique AUSSI la policy SELECT à la ligne
--              retournée par un RETURNING. clients_select ne
--              couvrait que can_manage_operations(...) OU une
--              intervention/devis déjà lié — un client tout juste
--              créé par un intervenant, sans lien existant, n'était
--              donc visible par PERSONNE d'autre que l'admin/
--              assistant, et Postgres rejetait l'INSERT entier avec
--              le même message générique "new row violates row-level
--              security policy" — un piège RLS classique du RETURNING
--              implicite, diagnostiqué via 20260714000003-6.
-- Correctif  :
--   1. Restaure clients_insert à sa forme complète (organisation_id
--      + admin/assistant OU intervenant).
--   2. Étend clients_select : le créateur (created_by = auth.uid())
--      voit désormais toujours son propre client, même sans
--      intervention/devis lié — symétrique du pattern déjà utilisé
--      pour devis/factures (created_by = auth.uid()).
--   3. Supprime la fonction de diagnostic temporaire.
-- ================================================================

DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR is_intervenant_in_org(current_org_id())
    )
  );

DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.client_id = clients.id
          AND i.intervenant_id = auth.uid()
          AND i.organisation_id = clients.organisation_id
      )
      OR EXISTS (
        SELECT 1 FROM public.devis d
        WHERE d.client_id = clients.id
          AND d.intervenant_id = auth.uid()
          AND d.organisation_id = clients.organisation_id
      )
    )
  );

DROP FUNCTION IF EXISTS public.diag_clients_insert_check();

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT policyname, cmd, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clients' AND policyname IN ('clients_insert', 'clients_select');
