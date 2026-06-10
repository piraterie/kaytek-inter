-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 4
-- Tables    : photos, messages
-- Date      : 2026-06-10
-- Prérequis : Phases 0-3 appliquées et validées.
-- Objectif  :
--   · photos   — Ajouter filtre organisation_id sur toutes les
--                ops. INSERT vérifie que l'intervention liée
--                appartient à la même org (sous-requête).
--   · messages — Ajouter filtre organisation_id. INSERT vérifie
--                que le destinataire est dans la même org.
--                SELECT conserve l'accès uid-scopé pour Realtime.
-- Attention  : messages utilise REPLICA IDENTITY FULL + Realtime.
--              La policy SELECT doit rester compatible avec les
--              subscriptions Realtime (filtre uid-scopé conservé).
--              is_admin() non modifié. Aucune autre table modifiée.
-- ================================================================


-- ================================================================
-- TABLE : photos
-- ================================================================

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql        → photos_select/insert/delete
-- · fix-native-functions-rls  → photos_select/insert/delete
-- · (idempotence)
DROP POLICY IF EXISTS "photos_select" ON public.photos;
DROP POLICY IF EXISTS "photos_insert" ON public.photos;
DROP POLICY IF EXISTS "photos_update" ON public.photos;
DROP POLICY IF EXISTS "photos_delete" ON public.photos;

-- SELECT : même org ET (admin OU intervenant assigné à l'intervention)
CREATE POLICY "photos_select" ON public.photos
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.id       = photos.intervention_id
          AND i.organisation_id = photos.organisation_id
          AND i.intervenant_id  = auth.uid()
      )
    )
  );

-- INSERT : dans l'org du user ET intervention liée dans la même org
--          auth.uid() IS NOT NULL implicitement requis par current_org_id()
CREATE POLICY "photos_insert" ON public.photos
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.interventions i
      WHERE i.id            = intervention_id
        AND i.organisation_id = current_org_id()
    )
  );

-- DELETE : même org ET (admin OU auteur de l'upload)
CREATE POLICY "photos_delete" ON public.photos
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR uploaded_by = auth.uid()
    )
  );


-- ================================================================
-- TABLE : messages
-- ================================================================
-- Note Realtime : la table a REPLICA IDENTITY FULL + publication
-- supabase_realtime. Les subscriptions Realtime respectent la
-- policy SELECT — le filtre uid-scopé (expediteur/destinataire)
-- garantit que chaque user ne reçoit que ses propres messages.
-- ================================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues
-- · fix-rls-kaytek.sql        → messages_select/insert/update
-- · fix-native-functions-rls  → messages_select/insert/update
-- · (idempotence)
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_update" ON public.messages;
DROP POLICY IF EXISTS "messages_delete" ON public.messages;

-- SELECT : même org ET (expéditeur OU destinataire OU admin)
--          Compatible Realtime : chaque user voit ses échanges.
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      expediteur_id = auth.uid()
      OR destinataire_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );

-- INSERT : l'expéditeur est le user connecté, dans son org,
--          et le destinataire appartient à la même org
--          (empêche les messages cross-org)
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT
  WITH CHECK (
    expediteur_id   = auth.uid()
    AND organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id            = destinataire_id
        AND p.organisation_id = current_org_id()
    )
  );

-- UPDATE : même org ET (destinataire — marquer lu — OU admin)
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      destinataire_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );


-- ================================================================
-- VÉRIFICATION — résultats attendus :
--   photos   : 3 lignes (select, insert, delete)
--   messages : 3 lignes (select, insert, update)
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('photos', 'messages')
ORDER BY tablename, cmd;
