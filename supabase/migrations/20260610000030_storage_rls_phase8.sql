-- ================================================================
-- MIGRATION : Phase 8 — Storage RLS multi-tenant
-- Date      : 2026-06-10
-- ================================================================
-- Buckets couverts :
--   1. intervention-photos  (PRIVÉ — signed URLs 300s)
--   2. signatures           (PRIVÉ — signed URLs 300s, chemin migré)
--   3. logos                (PUBLIC — getPublicUrl, chemin migré)
--   4. chat-media           (PRIVÉ — signed URLs 7j)
--   5. pdf-documents        (PRIVÉ — dead code, policies préventives)
-- ================================================================
-- CHEMINS SÉCURISÉS (nouveau) :
--   intervention-photos : {interventionId}/{type}-{ts}.jpg  (inchangé, isolation via DB join)
--   signatures          : {orgId}/{docType}-{docId}.png     (NOUVEAU — préfixe orgId)
--   logos               : {orgId}/logo.{ext}                (NOUVEAU — préfixe orgId)
--   chat-media          : {userId}/{type}-{ts}.{ext}        (inchangé, isolation via DB join + owner)
--   pdf-documents       : {orgId}/{ts}-{filename}.pdf       (NOUVEAU — si fonction activée)
-- ================================================================
-- PRÉREQUIS FRONTEND (à appliquer séparément après validation) :
--   storage.ts : uploadSignature(blob, docId, docType, orgId) → path = `${orgId}/${docType}-${docId}.png`
--   storage.ts : uploadLogo(file, orgId)                      → path = `${orgId}/logo.${ext}`
--   storage.ts : uploadPdf(pdfBlob, fileName, orgId)          → path = `${orgId}/${ts}-${fileName}`
--   ParamsPage.tsx : passer user.organisation_id à uploadLogo
--   DevisFormPage.tsx : passer user.organisation_id à uploadSignature
-- ================================================================
-- NOTE FICHIERS EXISTANTS :
--   intervention-photos : couverts par DB join (photos.storage_path) — aucune migration de fichiers
--   signatures          : anciens chemins sans orgId → signed URLs déjà expirées (300s) → pas d'impact
--   logos               : bucket PUBLIC → ancien logo.{ext} reste accessible via URL publique
--                         Prochaine sauvegarde admin → nouveau chemin {orgId}/logo.{ext}
--   chat-media          : couverts par DB join (messages.media_url) ou owner — aucune migration
--   pdf-documents       : dead code — aucun fichier existant à migrer
-- ================================================================
-- ROLLBACK :
--   Exécuter la section ROLLBACK en bas de ce fichier.
--   Aucun fichier Storage n'est supprimé par cette migration.
-- ================================================================


-- ================================================================
-- ÉTAPE 0 — Supprimer toutes les policies actuelles sur storage.objects
-- (état actuel inconnu — set via dashboard Supabase sans migration SQL)
-- ================================================================
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;


-- ================================================================
-- BUCKET 1 : intervention-photos (PRIVÉ)
-- Chemin    : {interventionId}/{type}-{ts}.jpg  ← inchangé
-- Stratégie : DB join sur public.photos.storage_path (organisation_id)
--             + owner check pour signed URL juste après upload
--             (DB insert vient APRÈS createSignedUrl dans uploadPhoto)
-- ================================================================

-- SELECT : owner de l'objet OU photo enregistrée dans la même org
CREATE POLICY "intervention_photos_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'intervention-photos'
    AND (
      -- L'uploadeur peut régénérer une signed URL immédiatement après upload
      -- (avant que le record photos soit inséré en DB)
      owner = auth.uid()
      OR
      -- Admin ou intervenant assigné via la table photos
      EXISTS (
        SELECT 1 FROM public.photos p
        WHERE p.storage_path    = name
          AND p.organisation_id = public.current_org_id()
      )
    )
  );

-- INSERT : intervention dans l'org du user (split_part récupère l'interventionId)
CREATE POLICY "intervention_photos_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'intervention-photos'
    AND auth.uid() IS NOT NULL
    AND public.current_org_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.interventions i
      WHERE i.id::text          = split_part(name, '/', 1)
        AND i.organisation_id   = public.current_org_id()
    )
  );

-- DELETE : auteur upload OU admin de l'org
CREATE POLICY "intervention_photos_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'intervention-photos'
    AND (
      owner = auth.uid()
      OR public.is_admin_in_org(public.current_org_id())
    )
  );


-- ================================================================
-- BUCKET 2 : signatures (PRIVÉ)
-- Chemin    : {orgId}/{docType}-{docId}.png  ← NOUVEAU (préfixe orgId)
-- Stratégie : split_part(name,'/',1) = current_org_id()::text
-- NOTE      : anciens fichiers sans préfixe orgId (devis-{uuid}.png)
--             ne seront plus accessibles — mais leurs signed URLs
--             300s sont déjà expirées depuis la signature.
-- ================================================================

-- SELECT : même org que le préfixe du chemin
CREATE POLICY "signatures_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
  );

-- INSERT : chemin préfixé par l'org courante
CREATE POLICY "signatures_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'signatures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = public.current_org_id()::text
  );

-- UPDATE : uploadSignature utilise upsert:true → UPDATE nécessaire
CREATE POLICY "signatures_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
  );

-- DELETE : auteur upload OU admin de l'org
CREATE POLICY "signatures_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND (
      owner = auth.uid()
      OR public.is_admin_in_org(public.current_org_id())
    )
  );


-- ================================================================
-- BUCKET 3 : logos (PUBLIC — getPublicUrl, pas de signed URL)
-- Chemin    : {orgId}/logo.{ext}  ← NOUVEAU (préfixe orgId)
-- Stratégie : bucket public → pas de policy SELECT (lecture libre)
--             INSERT/UPDATE/DELETE : admin + org dans le chemin
-- NOTE      : ancien logo.{ext} sans orgId reste accessible (bucket public)
--             jusqu'à ce que l'admin re-téléverse un nouveau logo.
-- ================================================================

-- INSERT : admin seulement + chemin préfixé par l'org
CREATE POLICY "logos_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND public.current_org_id() IS NOT NULL
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.is_admin_in_org(public.current_org_id())
  );

-- UPDATE : uploadLogo utilise upsert:true → UPDATE nécessaire
CREATE POLICY "logos_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.is_admin_in_org(public.current_org_id())
  )
  WITH CHECK (
    bucket_id = 'logos'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.is_admin_in_org(public.current_org_id())
  );

-- DELETE : admin de l'org seulement
CREATE POLICY "logos_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'logos'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.is_admin_in_org(public.current_org_id())
  );


-- ================================================================
-- BUCKET 4 : chat-media (PRIVÉ — signed URLs 7j)
-- Chemin    : {userId}/{type}-{ts}.{ext}  ← inchangé
-- Stratégie : INSERT vérifié par userId dans le chemin (split_part)
--             SELECT : owner OU participant au message (DB join)
--             Le userId dans le chemin est déjà un bon isolant par user.
--             La DB join sur messages ajoute l'isolant org implicitement
--             (messages ont une policy RLS org-scopée en amont).
-- ================================================================

-- SELECT : uploader (owner) OU participant au message contenant ce média
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND (
      -- L'expéditeur peut régénérer la signed URL juste après upload
      owner = auth.uid()
      OR
      -- Expéditeur, destinataire ou admin du message lié
      EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.media_url         = name
          AND (
            m.expediteur_id       = auth.uid()
            OR m.destinataire_id  = auth.uid()
            OR public.is_admin_in_org(m.organisation_id)
          )
      )
    )
  );

-- INSERT : user upload dans son propre répertoire (préfixe = son uid)
CREATE POLICY "chat_media_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- DELETE : owner ou admin
CREATE POLICY "chat_media_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND (
      owner = auth.uid()
      OR public.is_admin_in_org(public.current_org_id())
    )
  );


-- ================================================================
-- BUCKET 5 : pdf-documents (PRIVÉ — dead code)
-- Chemin    : {orgId}/{ts}-{filename}.pdf  ← NOUVEAU si activé
-- Stratégie : policies préventives pour quand uploadPdf sera utilisé.
--             uploadPdf() est exporté dans storage.ts mais jamais appelé.
--             PDFs envoyés par email en base64 (pas de stockage actuel).
-- ================================================================

-- SELECT : owner ou admin de l'org
CREATE POLICY "pdf_documents_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'pdf-documents'
    AND (
      owner = auth.uid()
      OR (
        public.current_org_id() IS NOT NULL
        AND split_part(name, '/', 1) = public.current_org_id()::text
        AND public.is_admin_in_org(public.current_org_id())
      )
    )
  );

-- INSERT : user authentifié dans son org
CREATE POLICY "pdf_documents_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'pdf-documents'
    AND auth.uid() IS NOT NULL
    AND public.current_org_id() IS NOT NULL
    AND split_part(name, '/', 1) = public.current_org_id()::text
  );

-- DELETE : owner ou admin
CREATE POLICY "pdf_documents_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'pdf-documents'
    AND (
      owner = auth.uid()
      OR public.is_admin_in_org(public.current_org_id())
    )
  );


-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- Attendu (14 policies) :
--   chat_media_delete         | DELETE
--   chat_media_insert         | INSERT
--   chat_media_select         | SELECT
--   intervention_photos_delete| DELETE
--   intervention_photos_insert| INSERT
--   intervention_photos_select| SELECT
--   logos_delete              | DELETE
--   logos_insert              | INSERT
--   logos_update              | UPDATE
--   pdf_documents_delete      | DELETE
--   pdf_documents_insert      | INSERT
--   pdf_documents_select      | SELECT
--   signatures_delete         | DELETE
--   signatures_insert         | INSERT
--   signatures_select         | SELECT
--   signatures_update         | UPDATE
-- TOTAL : 16 policies


-- ================================================================
-- ROLLBACK (à exécuter EN CAS DE PROBLÈME — remet le storage en état
-- sans policy custom — seul le comportement de Supabase par défaut s'applique)
-- ================================================================
/*
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;
*/
