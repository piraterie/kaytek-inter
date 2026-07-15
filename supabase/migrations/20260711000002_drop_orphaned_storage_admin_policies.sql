-- ================================================================
-- MIGRATION : Phase 1 audit sécurité — RLS-01
-- Date      : 2026-07-11
-- ================================================================
-- Contexte :
--   L'audit pré-commercialisation du 10/07/2026 a trouvé, sur storage.objects,
--   11 policies orphelines coexistant avec les policies correctement
--   cloisonnées par organisation (introduites en Phase 8,
--   20260610000030_storage_rls_phase8.sql). Postgres combine les policies
--   PERMISSIVE par OR : ces anciennes policies, qui ne vérifient que
--   profiles.role='admin' (voire rien du tout pour media_read/media_upload)
--   sans jamais comparer l'organisation, suffisaient à elles seules à
--   autoriser un accès cross-organisation aux PDF, signatures et photos.
--
--   Ces policies n'existent dans AUCUN fichier de migration du dépôt —
--   dérive de configuration créée directement dans le Dashboard Supabase,
--   jamais capturée en version control (même schéma que le bug SEC-02
--   sur prestations_admin_*, corrigé le 08/07/2026).
--
-- Action :
--   DROP pur des 11 policies orphelines. Aucune nouvelle policy n'est créée :
--   les policies correctement scopées par organisation existent déjà
--   (intervention_photos_*, signatures_*, logos_*, pdf_documents_*,
--   chat_media_*, media_read/media_upload étant la seule paire sans
--   équivalent scopé légitime — intervention-photos reste couvert par
--   intervention_photos_select/insert/delete) et prennent seules le relais.
-- ================================================================

DROP POLICY IF EXISTS "logos_delete_admin"     ON storage.objects;
DROP POLICY IF EXISTS "logos_insert_admin"     ON storage.objects;
DROP POLICY IF EXISTS "logos_update_admin"     ON storage.objects;
DROP POLICY IF EXISTS "pdfs_delete_admin"      ON storage.objects;
DROP POLICY IF EXISTS "pdfs_insert_admin"      ON storage.objects;
DROP POLICY IF EXISTS "pdfs_select_admin"      ON storage.objects;
DROP POLICY IF EXISTS "photos_delete_admin"    ON storage.objects;
DROP POLICY IF EXISTS "photos_insert_own"      ON storage.objects;
DROP POLICY IF EXISTS "photos_select_own"      ON storage.objects;
DROP POLICY IF EXISTS "signatures_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "signatures_select_admin" ON storage.objects;

-- media_read / media_upload : policies rôle "authenticated" sur bucket
-- intervention-photos sans AUCUNE condition d'organisation ou de
-- propriétaire — la faille la plus large des 11. Les policies légitimes
-- déjà en place (intervention_photos_select/insert/delete) couvrent le
-- même bucket avec l'isolation correcte (jointure sur interventions/photos).
DROP POLICY IF EXISTS "media_read"   ON storage.objects;
DROP POLICY IF EXISTS "media_upload" ON storage.objects;
