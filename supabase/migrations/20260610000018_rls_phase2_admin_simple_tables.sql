-- ================================================================
-- MIGRATION : RLS multi-tenant strict — Phase 2
-- Tables    : notifications, journal, commission_receipts
-- Date      : 2026-06-10
-- Prérequis : Phase 0 (helpers) et Phase 1 (push_subscriptions,
--             devices) appliquées et validées.
-- Objectif  : Durcir les policies RLS des tables admin-simples.
--             commission_receipts : création depuis zéro (aucune
--             policy existante trouvée dans le projet).
--             is_admin() non modifié.
--             Aucune autre table modifiée.
-- ================================================================


-- ================================================================
-- TABLE : notifications
-- ================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les variantes connues :
-- · fix-notif-rls-definitif.sql  → notif_*
-- · fix-native-functions-rls.sql → notifications_*
-- · fix-rls-kaytek.sql           → notifications_*
DROP POLICY IF EXISTS "notif_select"          ON public.notifications;
DROP POLICY IF EXISTS "notif_insert"          ON public.notifications;
DROP POLICY IF EXISTS "notif_update"          ON public.notifications;
DROP POLICY IF EXISTS "notif_delete"          ON public.notifications;
DROP POLICY IF EXISTS "notifications_select"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_update"  ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete"  ON public.notifications;

-- SELECT : chacun voit uniquement ses propres notifications dans son org
CREATE POLICY "notif_select" ON public.notifications
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  );

-- INSERT : tout user authentifié peut créer une notif pour un user
--          de SON organisation (nécessaire pour notifyAdmins() et
--          notifyUser() appelés côté frontend par les intervenants)
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
  );

-- UPDATE : chacun peut uniquement marquer ses propres notifs (lu/non-lu)
CREATE POLICY "notif_update" ON public.notifications
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  );

-- DELETE : chacun supprime uniquement ses propres notifs
CREATE POLICY "notif_delete" ON public.notifications
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND is_same_org(organisation_id)
  );


-- ================================================================
-- TABLE : journal
-- ================================================================

ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;

-- Supprimer les variantes connues :
-- · fix-native-functions-rls.sql / database-schema.sql → journal_*
DROP POLICY IF EXISTS "journal_select" ON public.journal;
DROP POLICY IF EXISTS "journal_insert" ON public.journal;
DROP POLICY IF EXISTS "journal_update" ON public.journal;
DROP POLICY IF EXISTS "journal_delete" ON public.journal;

-- SELECT : admin de l'org uniquement
CREATE POLICY "journal_select" ON public.journal
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );

-- INSERT : tout user authentifié de l'org (nécessaire pour les
--          triggers SQL qui insèrent via le contexte de session,
--          et pour les insertions directes futures une fois les
--          triggers corrigés)
CREATE POLICY "journal_insert" ON public.journal
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
  );

-- Pas d'UPDATE ni DELETE sur journal : log immuable par conception.


-- ================================================================
-- TABLE : commission_receipts
-- ================================================================
-- Aucune policy trouvée dans le projet (ni migrations, ni scripts
-- ad-hoc). RLS activé + policies créées depuis zéro.
-- useMarkCommissionReceived() upsert :
--   { facture_id, intervention_id, intervenant_id: uid(), recue: true,
--     recue_le, organisation_id: org_id }
--   onConflict: 'facture_id,intervenant_id'
-- L'intervenant est toujours l'auteur (intervenant_id = auth.uid()).
-- ================================================================

ALTER TABLE public.commission_receipts ENABLE ROW LEVEL SECURITY;

-- Anciennes policies connues en production
DROP POLICY IF EXISTS "select_own_or_admin" ON public.commission_receipts;
DROP POLICY IF EXISTS "insert_own"          ON public.commission_receipts;
DROP POLICY IF EXISTS "update_own"          ON public.commission_receipts;
-- Nouvelles policies (idempotence si migration rejouée)
DROP POLICY IF EXISTS "cr_select"           ON public.commission_receipts;
DROP POLICY IF EXISTS "cr_insert"           ON public.commission_receipts;
DROP POLICY IF EXISTS "cr_update"           ON public.commission_receipts;
DROP POLICY IF EXISTS "cr_delete"           ON public.commission_receipts;

-- SELECT : admin de l'org voit tout ; intervenant voit ses propres reçus
CREATE POLICY "cr_select" ON public.commission_receipts
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR intervenant_id = auth.uid()
    )
  );

-- INSERT : admin OU intervenant sur ses propres reçus, dans son org
--          (upsert useMarkCommissionReceived → intervenant_id = auth.uid())
CREATE POLICY "cr_insert" ON public.commission_receipts
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR intervenant_id = auth.uid()
    )
  );

-- UPDATE : admin OU intervenant sur ses propres reçus, dans son org
--          (upsert déclenche UPDATE si le couple facture_id+intervenant_id
--          existe déjà → même condition que INSERT)
CREATE POLICY "cr_update" ON public.commission_receipts
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
CREATE POLICY "cr_delete" ON public.commission_receipts
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- VÉRIFICATION — résultats attendus :
--   notifications      : 4 lignes (notif_select/insert/update/delete)
--   journal            : 2 lignes (journal_select/insert)
--   commission_receipts: 4 lignes (cr_select/insert/update/delete)
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'journal', 'commission_receipts')
ORDER BY tablename, cmd;
