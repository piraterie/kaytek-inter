-- ================================================================
-- MIGRATION : journal — policies UPDATE et DELETE pour admin
-- Date      : 2026-06-11
-- ----------------------------------------------------------------
-- Contexte  : Migration 20260610000018 (Phase 2) a délibérément
--             exclu UPDATE et DELETE sur journal avec le commentaire
--             "log immuable par conception".
--
--             Cependant, JournalPage expose deux fonctionnalités
--             validées par le product owner :
--               · ✏ Annoter une entrée  → useUpdateJournalEntry
--                   .update({ description }).eq('id', id)
--               · 🗑 Supprimer une entrée ou vider le journal
--                   → useDeleteJournalEntry / useDeleteAllJournal
--
--             Sans ces policies, Supabase RLS bloque silencieusement
--             (retourne { error: null, data: [] }) — aucune erreur
--             SQL, mais 0 lignes affectées. Le hook détecte ce cas
--             depuis la session de correction (data.length === 0).
--
-- Objectif  : Autoriser les admins de l'org à :
--               · UPDATE le champ description d'une entrée journal
--               · DELETE les entrées de leur org
--
-- Sécurité  :
--   · UPDATE et DELETE limités à is_admin_in_org + is_same_org
--   · Un admin ne peut pas toucher au journal d'une autre org
--   · Un intervenant ne peut ni modifier ni supprimer
--   · La colonne organisation_id ne peut pas être changée (WITH CHECK)
--   · Les policies SELECT et INSERT (Phase 2) ne sont pas modifiées
-- ================================================================


-- ── UPDATE : admin peut annoter une entrée (ajouter une note) ───
-- RLS ne peut pas restreindre par colonne ; la restriction au seul
-- champ 'description' est assurée par le code frontend :
--   useUpdateJournalEntry → .update({ description }).eq('id', id)
-- Un trigger BEFORE UPDATE peut renforcer cela si nécessaire.
DROP POLICY IF EXISTS "journal_update" ON public.journal;

CREATE POLICY "journal_update" ON public.journal
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
  );


-- ── DELETE : admin peut supprimer des entrées de son org ────────
DROP POLICY IF EXISTS "journal_delete" ON public.journal;

CREATE POLICY "journal_delete" ON public.journal
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
  );


-- ================================================================
-- VÉRIFICATION — résultat attendu : 4 lignes
--   journal_delete | DELETE
--   journal_insert | INSERT
--   journal_select | SELECT
--   journal_update | UPDATE
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'journal'
ORDER BY cmd;
