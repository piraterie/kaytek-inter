-- ================================================================
-- MIGRATION : Correction 2 — SEC2-01 : blocage des abonnements
--             appliqué côté serveur (RLS + Storage + RPC dédiée)
-- Date       : 2026-07-22
-- ================================================================
-- Contexte (voir audit-kaytek-inter/phase-02-securite-frontend.md,
-- phase-03-supabase-rls.md et audit-kaytek-inter/corrections/
-- correction-02-abonnement-serveur.md pour l'analyse complète) :
-- le blocage d'un abonnement expiré/annulé/impayé n'existait
-- jusqu'ici QUE côté frontend (Guard/SubscriptionBlockedScreen,
-- src/App.tsx). Aucune policy RLS ne vérifiait le statut
-- d'abonnement — un JWT valide suffisait à contourner entièrement
-- ce blocage via un appel API direct.
--
-- Décision retenue (Option B, validée) : lecture toujours autorisée
-- (aucun SELECT n'est modifié par cette migration) ; seules les
-- mutations qui créent de la nouvelle valeur métier sont bloquées
-- pour une organisation dont l'abonnement n'est plus valide.
--
-- Portée stricte de cette migration :
--   1. Fonction centrale public.current_organisation_has_app_access()
--   2. RPC public.get_my_app_access_status() (réutilisée par les
--      Edge Functions envoyer-email / inviter-intervenant /
--      send-reminders — modifiées séparément, hors SQL)
--   3. GRANT/REVOKE explicites sur les deux fonctions ci-dessus
--   4. Ajout de "AND current_organisation_has_app_access()" aux
--      policies de MUTATION (INSERT/UPDATE) des tables :
--      clients, interventions, devis, factures (P0),
--      messages (INSERT uniquement), photos (INSERT uniquement),
--      document_public_links (INSERT uniquement),
--      commissions, commission_receipts (P1)
--   5. Idem pour les policies Storage INSERT/UPDATE des buckets
--      intervention-photos, signatures, chat-media
--
-- N'est PAS dans le périmètre de cette migration (voir rapport de
-- correction pour la justification détaillée de chaque exclusion) :
--   · Aucune policy SELECT n'est modifiée, sur aucune table/bucket.
--   · Aucune policy DELETE n'est modifiée, sur aucune table.
--   · profiles, organisations, subscriptions, stripe_webhook_events,
--     founder_seats, prestations, parametres_entreprise,
--     notifications, devices, push_subscriptions, guide_progress,
--     journal : policies non modifiées.
--   · messages_update (marquer lu) : non modifiée — reste possible
--     même abonnement bloqué (limite documentée dans le rapport).
--   · Buckets logos, guide-videos, pdf-documents : non modifiés.
--
-- Chaque policy modifiée ci-dessous reproduit EXACTEMENT sa
-- définition finale actuelle (reconstruite par lecture exhaustive
-- des migrations existantes, jamais réécrite depuis zéro) et
-- n'ajoute la nouvelle condition QUE par "AND" — aucun contrôle
-- d'organisation, de rôle, de créateur ou de statut existant n'est
-- retiré ni affaibli.
-- ================================================================


-- ================================================================
-- 1. FONCTION CENTRALE : current_organisation_has_app_access()
-- ================================================================
-- Dérive TOUJOURS l'organisation depuis auth.uid() (jamais un
-- paramètre client). Déterministe par construction : profiles.id
-- est la clé primaire (au plus une ligne (p, o) possible), et la
-- présence d'un abonnement valide est testée par EXISTS/NOT EXISTS
-- (jamais par ORDER BY/LIMIT 1, qui serait non déterministe si
-- plusieurs lignes subscriptions existent pour la même organisation
-- — voir DB-06 dans le rapport de correction).
--
-- Logique :
--   · profil introuvable / auth.uid() NULL / profil inactif /
--     organisation inactive → false (échec fermé)
--   · organisation SANS AUCUNE ligne subscriptions liée → true
--     (fail-open historique, nécessaire pour kaytek-inter et toute
--     organisation pré-Stripe — NE JAMAIS transformer ce cas en
--     fail-closed, cf. rapport de correction)
--   · organisation avec au moins une ligne subscriptions → true
--     seulement s'il existe au moins une ligne 'active', ou
--     'trialing' avec trial_ends_at NULL ou futur — reproduit
--     exactement isSubscriptionAccessAllowed() (src/lib/subscription.ts)
--   · organisations.actif = false → false (SEC2-04, extension
--     validée : cette colonne n'était vérifiée nulle part avant
--     cette migration)
CREATE OR REPLACE FUNCTION public.current_organisation_has_app_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        NOT EXISTS (
          SELECT 1 FROM public.subscriptions s WHERE s.organisation_id = o.id
        )
        OR EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.organisation_id = o.id
            AND (
              s.subscription_status = 'active'
              OR (
                s.subscription_status = 'trialing'
                AND (s.trial_ends_at IS NULL OR s.trial_ends_at > now())
              )
            )
        )
      FROM public.profiles p
      JOIN public.organisations o ON o.id = p.organisation_id
      WHERE p.id = auth.uid()
        AND p.actif = true
        AND o.actif = true
    ),
    false
  )
$$;

ALTER FUNCTION public.current_organisation_has_app_access() OWNER TO postgres;

-- Vérifier les privilèges par défaut avant d'accorder EXECUTE :
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut sur toute nouvelle
-- fonction — on le retire explicitement avant de ne le redonner
-- qu'aux deux rôles nécessaires.
--
-- Correction SEC2-02 (analyse : audit-kaytek-inter/corrections/
-- analyse-sec2-02-function-privileges.md) : l'image Postgres locale de
-- Supabase accorde AUSSI, par un privilège par défaut de plateforme
-- (pg_default_acl, hors de tout contrôle de ce dépôt), un EXECUTE
-- DIRECT à anon/authenticated/service_role sur toute nouvelle fonction
-- créée par le rôle postgres — un simple "REVOKE ALL ... FROM PUBLIC"
-- ne retire JAMAIS ce droit direct (confirmé empiriquement : ce sont
-- deux entrées ACL indépendantes). Le "REVOKE ALL FROM anon" explicite
-- ci-dessous est donc nécessaire, même si aucun GRANT à anon n'a
-- jamais été écrit. authenticated CONSERVE son EXECUTE : confirmé
-- empiriquement que l'évaluation d'une policy RLS référençant cette
-- fonction exige que le rôle interrogeant (authenticated, pour tout
-- utilisateur connecté) dispose lui-même du droit EXECUTE — le révoquer
-- casserait les 19 policies de mutation qui en dépendent.
REVOKE ALL ON FUNCTION public.current_organisation_has_app_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_organisation_has_app_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO service_role;
-- Aucun GRANT à anon (aucune table métier concernée n'est accessible à anon aujourd'hui).


-- ================================================================
-- 2. RPC : get_my_app_access_status()
-- ================================================================
-- Point d'entrée unique pour les Edge Functions (envoyer-email,
-- inviter-intervenant, send-reminders) — évite toute duplication de
-- la logique ci-dessus en TypeScript. Réutilise exclusivement
-- current_organisation_has_app_access(), qui dérive elle-même
-- l'organisation depuis auth.uid() : cette RPC ne reçoit et n'a
-- besoin d'aucun organisation_id en paramètre.
-- Ne révèle aucune donnée Stripe sensible (pas de stripe_customer_id,
-- pas d'email, pas de plan) — uniquement un booléen d'autorisation
-- et un booléen indiquant si une ligne subscriptions existe.
CREATE OR REPLACE FUNCTION public.get_my_app_access_status()
RETURNS TABLE(allowed boolean, has_subscription boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.current_organisation_has_app_access() AS allowed,
    EXISTS (
      SELECT 1
      FROM public.subscriptions s
      JOIN public.profiles p ON p.organisation_id = s.organisation_id
      WHERE p.id = auth.uid()
    ) AS has_subscription
$$;

ALTER FUNCTION public.get_my_app_access_status() OWNER TO postgres;

-- Correction SEC2-02 : même raison que ci-dessus (privilège par défaut
-- de plateforme) — REVOKE FROM anon explicite nécessaire. authenticated
-- conservé : appelée en tant qu'utilisateur authentifié par les Edge
-- Functions envoyer-email/inviter-intervenant/send-reminders (JWT
-- utilisateur transmis, jamais un appel anon réel).
REVOKE ALL ON FUNCTION public.get_my_app_access_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_app_access_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_app_access_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_app_access_status() TO service_role;
-- Aucun GRANT à anon.


-- ================================================================
-- 3. TABLE : clients (P0 — INSERT/UPDATE uniquement)
-- ================================================================
-- Référence actuelle : 20260714000007_fix_clients_select_for_creator.sql
-- (clients_insert) et 20260708000007_assistant_role_foundations.sql
-- (clients_update). clients_select et clients_delete : NON touchées.
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR is_intervenant_in_org(current_org_id())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND can_manage_operations(organisation_id)
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    can_manage_operations(current_org_id())
    AND organisation_id = current_org_id()
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 4. TABLE : interventions (P0 — INSERT/UPDATE uniquement)
-- ================================================================
-- Référence actuelle : 20260714000001_intervenant_document_permissions.sql
-- (interventions_insert) et 20260708000007_assistant_role_foundations.sql
-- (interventions_update). interventions_select/delete : NON touchées.
DROP POLICY IF EXISTS "interventions_insert" ON public.interventions;
CREATE POLICY "interventions_insert" ON public.interventions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "interventions_update" ON public.interventions;
CREATE POLICY "interventions_update" ON public.interventions
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      can_manage_operations(organisation_id)
      OR intervenant_id = auth.uid()
    )
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      can_manage_operations(current_org_id())
      OR intervenant_id = auth.uid()
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 5. TABLE : devis (P0 — INSERT/UPDATE uniquement)
-- ================================================================
-- Référence actuelle : 20260708000008_security_phase1_critical_hardening.sql
-- (SEC-01). devis_select/delete : NON touchées.
DROP POLICY IF EXISTS "devis_insert" ON public.devis;
CREATE POLICY "devis_insert" ON public.devis
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "devis_update" ON public.devis;
CREATE POLICY "devis_update" ON public.devis
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND created_by = auth.uid()
        AND statut IN ('en_attente_validation', 'brouillon', 'envoye')
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
        AND (
          statut IN ('en_attente_validation', 'brouillon', 'envoye')
          OR (statut = 'accepte' AND signature_client IS NOT NULL AND signature_date IS NOT NULL)
        )
      )
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 6. TABLE : factures (P0 — INSERT/UPDATE uniquement)
-- ================================================================
-- Référence actuelle : 20260708000008_security_phase1_critical_hardening.sql
-- (SEC-01). factures_select/delete : NON touchées.
DROP POLICY IF EXISTS "factures_insert" ON public.factures;
CREATE POLICY "factures_insert" ON public.factures
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "factures_update" ON public.factures;
CREATE POLICY "factures_update" ON public.factures
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND statut_paiement NOT IN ('payee', 'annulee')
        AND (
          created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.interventions i
            WHERE i.id = factures.intervention_id
              AND i.organisation_id = factures.organisation_id
              AND i.intervenant_id = auth.uid()
          )
        )
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
        AND (
          created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.interventions i
            WHERE i.id = factures.intervention_id
              AND i.organisation_id = factures.organisation_id
              AND i.intervenant_id = auth.uid()
          )
        )
      )
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 7. TABLE : messages (P1 — INSERT uniquement)
-- ================================================================
-- Référence actuelle : 20260610000020_rls_phase4_photos_messages.sql.
-- messages_select/delete : NON touchées. messages_update (marquer
-- lu) : NON touchée non plus, par décision explicite — distinguer
-- proprement "marquer lu" d'une autre mutation dans cette policy
-- aurait exigé une condition sur les colonnes modifiées, jugée trop
-- complexe pour cette correction (limite documentée dans le rapport).
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
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
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 8. TABLE : photos (P1 — INSERT uniquement)
-- ================================================================
-- Référence actuelle : 20260610000020_rls_phase4_photos_messages.sql.
-- photos_select/delete : NON touchées (pas de policy UPDATE existante).
DROP POLICY IF EXISTS "photos_insert" ON public.photos;
CREATE POLICY "photos_insert" ON public.photos
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.interventions i
      WHERE i.id            = intervention_id
        AND i.organisation_id = current_org_id()
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 9. TABLE : document_public_links (P1 — INSERT uniquement)
-- ================================================================
-- Référence actuelle : org_insert tel que réécrit par SEC-03
-- (20260708000008_security_phase1_critical_hardening.sql).
-- org_select/org_delete : NON touchées.
DROP POLICY IF EXISTS "org_insert" ON public.document_public_links;
CREATE POLICY "org_insert" ON public.document_public_links
  FOR INSERT
  WITH CHECK (
    organisation_id = (SELECT p.organisation_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      (document_type = 'devis' AND EXISTS (
        SELECT 1 FROM public.devis d
        WHERE d.id = document_id AND d.organisation_id = document_public_links.organisation_id
      ))
      OR (document_type = 'facture' AND EXISTS (
        SELECT 1 FROM public.factures f
        WHERE f.id = document_id AND f.organisation_id = document_public_links.organisation_id
      ))
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 10. TABLE : commissions (P1 — INSERT et UPDATE)
-- ================================================================
-- Référence actuelle : commissions_insert par SEC-01
-- (20260708000008), commissions_update inchangée depuis
-- 20260610000025_rls_phase6_profiles_commissions.sql.
-- commissions_select/delete : NON touchées.
DROP POLICY IF EXISTS "commissions_insert" ON public.commissions;
CREATE POLICY "commissions_insert" ON public.commissions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "commissions_update" ON public.commissions;
CREATE POLICY "commissions_update" ON public.commissions
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND is_admin_in_org(organisation_id)
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 11. TABLE : commission_receipts (P1 — INSERT et UPDATE)
-- ================================================================
-- Référence actuelle : cr_insert/cr_update par SEC-01 (20260708000008).
-- cr_select/cr_delete : NON touchées.
DROP POLICY IF EXISTS "cr_insert" ON public.commission_receipts;
CREATE POLICY "cr_insert" ON public.commission_receipts
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "cr_update" ON public.commission_receipts;
CREATE POLICY "cr_update" ON public.commission_receipts
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_id = auth.uid())
    )
    AND current_organisation_has_app_access()
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
    AND current_organisation_has_app_access()
  );


-- ================================================================
-- 12. STORAGE : intervention-photos, signatures, chat-media
--     (INSERT/UPDATE uniquement — SELECT jamais touché)
-- ================================================================
-- Référence actuelle : 20260610000030_storage_rls_phase8.sql,
-- confirmé non retouché depuis par recherche exhaustive (le DROP de
-- 20260711000002_drop_orphaned_storage_admin_policies.sql ne visait
-- que des policies orphelines de noms différents :
-- logos_*_admin, pdfs_*_admin, photos_delete_admin, photos_insert_own,
-- photos_select_own, signatures_delete_admin, signatures_select_admin,
-- media_read, media_upload — aucune ne recoupe les noms ci-dessous).

DROP POLICY IF EXISTS "intervention_photos_insert" ON storage.objects;
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
    AND public.current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "signatures_insert" ON storage.objects;
CREATE POLICY "signatures_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'signatures'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.current_organisation_has_app_access()
  );

-- UPDATE nécessaire : uploadSignature() utilise upsert:true.
DROP POLICY IF EXISTS "signatures_update" ON storage.objects;
CREATE POLICY "signatures_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.current_organisation_has_app_access()
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND split_part(name, '/', 1) = public.current_org_id()::text
    AND public.current_organisation_has_app_access()
  );

DROP POLICY IF EXISTS "chat_media_insert" ON storage.objects;
CREATE POLICY "chat_media_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) = auth.uid()::text
    AND public.current_organisation_has_app_access()
  );


-- ================================================================
-- 13. ASSERTIONS STATIQUES (schéma uniquement — aucune dépendance
--     à des données réelles/de production, conformément à la règle
--     de cette correction)
-- ================================================================

DO $$
DECLARE
  v_count int;
BEGIN
  -- 13.1 — Les deux fonctions existent, sont STABLE et SECURITY DEFINER.
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('current_organisation_has_app_access', 'get_my_app_access_status')
    AND provolatile = 's'          -- STABLE
    AND prosecdef = true;          -- SECURITY DEFINER
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Assertion échouée : les 2 fonctions attendues ne sont pas toutes STABLE + SECURITY DEFINER (trouvé %)', v_count;
  END IF;

  -- 13.2 — search_path fixé pour les deux fonctions (même pattern de
  -- vérification que 20260610000026_phase7_security_definer_hygiene.sql).
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('current_organisation_has_app_access', 'get_my_app_access_status')
    AND proconfig IS NOT NULL
    AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Assertion échouée : search_path absent sur une des 2 fonctions (trouvé %)', v_count;
  END IF;

  -- 13.3 — EXECUTE accordé à authenticated et service_role uniquement,
  -- jamais à anon ou PUBLIC.
  IF has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : anon a EXECUTE sur current_organisation_has_app_access()';
  END IF;
  IF has_function_privilege('anon', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : anon a EXECUTE sur get_my_app_access_status()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : authenticated n''a pas EXECUTE sur current_organisation_has_app_access()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : authenticated n''a pas EXECUTE sur get_my_app_access_status()';
  END IF;
  -- Correction SEC2-02 — service_role vérifié explicitement (jamais supposé) :
  -- conservé par cohérence avec le design d'origine de cette migration,
  -- aucun chemin de contournement identifié (service_role bypass RLS de
  -- toute façon, cette vérification garantit juste que le GRANT explicite
  -- ci-dessus a bien pris effet, sans jamais le tenir pour acquis).
  IF NOT has_function_privilege('service_role', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : service_role n''a pas EXECUTE sur current_organisation_has_app_access()';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_my_app_access_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : service_role n''a pas EXECUTE sur get_my_app_access_status()';
  END IF;

  -- 13.4 — Chaque policy de mutation attendue existe bien et référence
  -- la nouvelle fonction dans sa définition (with_check ou qual).
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'clients' AND policyname IN ('clients_insert', 'clients_update')) OR
      (tablename = 'interventions' AND policyname IN ('interventions_insert', 'interventions_update')) OR
      (tablename = 'devis' AND policyname IN ('devis_insert', 'devis_update')) OR
      (tablename = 'factures' AND policyname IN ('factures_insert', 'factures_update')) OR
      (tablename = 'messages' AND policyname = 'messages_insert') OR
      (tablename = 'photos' AND policyname = 'photos_insert') OR
      (tablename = 'document_public_links' AND policyname = 'org_insert') OR
      (tablename = 'commissions' AND policyname IN ('commissions_insert', 'commissions_update')) OR
      (tablename = 'commission_receipts' AND policyname IN ('cr_insert', 'cr_update'))
    )
    AND (
      COALESCE(qual, '') LIKE '%current_organisation_has_app_access%'
      OR COALESCE(with_check, '') LIKE '%current_organisation_has_app_access%'
    );
  IF v_count <> 15 THEN
    RAISE EXCEPTION 'Assertion échouée : 15 policies de mutation attendues avec current_organisation_has_app_access(), trouvé %', v_count;
  END IF;

  -- 13.5 — Idem pour les 4 policies Storage.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('intervention_photos_insert', 'signatures_insert', 'signatures_update', 'chat_media_insert')
    AND (
      COALESCE(qual, '') LIKE '%current_organisation_has_app_access%'
      OR COALESCE(with_check, '') LIKE '%current_organisation_has_app_access%'
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Assertion échouée : 4 policies Storage attendues avec current_organisation_has_app_access(), trouvé %', v_count;
  END IF;

  RAISE NOTICE 'Correction 2 (SEC2-01) : toutes les assertions statiques ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative — liste les policies modifiées)
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('clients', 'interventions', 'devis', 'factures', 'messages', 'photos', 'document_public_links', 'commissions', 'commission_receipts')
  AND policyname IN (
    'clients_insert', 'clients_update', 'interventions_insert', 'interventions_update',
    'devis_insert', 'devis_update', 'factures_insert', 'factures_update',
    'messages_insert', 'photos_insert', 'org_insert',
    'commissions_insert', 'commissions_update', 'cr_insert', 'cr_update'
  )
ORDER BY tablename, policyname;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname IN ('intervention_photos_insert', 'signatures_insert', 'signatures_update', 'chat_media_insert')
ORDER BY policyname;
