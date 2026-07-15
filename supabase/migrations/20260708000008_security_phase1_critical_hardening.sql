-- ================================================================
-- MIGRATION : Phase 1 sécurité critique — SEC-01, SEC-02, SEC-03,
--             SEC-04, SEC-05, SEC-06 (audit du 2026-07-08)
-- Date       : 2026-07-08
-- ================================================================
-- Portée stricte : uniquement les 6 failles critiques/élevées validées
-- pour cette phase. Aucun changement Stripe, Capacitor Android, UX,
-- nouvelle fonctionnalité. DELETE reste admin-only partout (non touché).
-- ================================================================


-- ================================================================
-- SEC-01 — RLS devis / factures / commissions / commission_receipts
--          ne vérifient pas le rôle de l'appelant (uniquement
--          organisation_id + created_by/intervenant_id = auth.uid()).
--          Un assistant peut créer/lire ses propres documents
--          financiers via appel API direct. Correction : nouveau
--          helper is_intervenant_in_org(), ajouté aux branches
--          non-admin de ces 4 tables. Un utilisateur qui n'est ni
--          admin ni intervenant actif de l'organisation (donc un
--          assistant) échoue désormais ces conditions.
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_intervenant_in_org(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT role = 'intervenant' AND actif = true
      FROM public.profiles
      WHERE id = auth.uid() AND organisation_id = org_id
      LIMIT 1
    ),
    false
  )
$$;

-- ── devis ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devis_select" ON public.devis;
DROP POLICY IF EXISTS "devis_insert" ON public.devis;
DROP POLICY IF EXISTS "devis_update" ON public.devis;

CREATE POLICY "devis_select" ON public.devis
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
        AND (created_by = auth.uid() OR intervenant_id = auth.uid())
      )
    )
  );

CREATE POLICY "devis_insert" ON public.devis
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
  );

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
  );
-- devis_delete : NON MODIFIÉE — reste is_admin_in_org.

-- ── factures ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "factures_select" ON public.factures;
DROP POLICY IF EXISTS "factures_insert" ON public.factures;
DROP POLICY IF EXISTS "factures_update" ON public.factures;

CREATE POLICY "factures_select" ON public.factures
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (
        is_intervenant_in_org(organisation_id)
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
  );

CREATE POLICY "factures_insert" ON public.factures
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND created_by = auth.uid())
    )
  );

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
  );
-- factures_delete : NON MODIFIÉE — reste is_admin_in_org.

-- ── commissions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "commissions_select" ON public.commissions;
DROP POLICY IF EXISTS "commissions_insert" ON public.commissions;

CREATE POLICY "commissions_select" ON public.commissions
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_id = auth.uid())
    )
  );

CREATE POLICY "commissions_insert" ON public.commissions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
  );
-- commissions_update / commissions_delete : NON MODIFIÉES — restent is_admin_in_org uniquement.

-- ── commission_receipts ──────────────────────────────────────────
DROP POLICY IF EXISTS "cr_select" ON public.commission_receipts;
DROP POLICY IF EXISTS "cr_insert" ON public.commission_receipts;
DROP POLICY IF EXISTS "cr_update" ON public.commission_receipts;

CREATE POLICY "cr_select" ON public.commission_receipts
  FOR SELECT
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_id = auth.uid())
    )
  );

CREATE POLICY "cr_insert" ON public.commission_receipts
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
  );

CREATE POLICY "cr_update" ON public.commission_receipts
  FOR UPDATE
  USING (
    is_same_org(organisation_id)
    AND (
      is_admin_in_org(organisation_id)
      OR (is_intervenant_in_org(organisation_id) AND intervenant_id = auth.uid())
    )
  )
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
  );
-- cr_delete : NON MODIFIÉE — reste is_admin_in_org.


-- ================================================================
-- SEC-02 — Policies prestations_admin_* orphelines (créées par
--          20260606000002, jamais supprimées par leur nom exact).
--          Vérification en base réelle (2026-07-08) : ces policies
--          N'EXISTENT PLUS sur l'environnement de production actuel
--          (seules prestations_select/insert/update/delete, toutes
--          correctement scopées par organisation, sont présentes) —
--          probablement nettoyées hors migration à un moment donné.
--          DROP défensif conservé ici pour que ce nettoyage soit
--          capturé dans l'historique de migrations et pour protéger
--          tout futur environnement provisionné depuis zéro à partir
--          de ces mêmes fichiers (où 20260606000002 recréerait ces
--          policies non scopées si elle était rejouée telle quelle).
-- ================================================================
DROP POLICY IF EXISTS "prestations_admin_insert" ON public.prestations;
DROP POLICY IF EXISTS "prestations_admin_update" ON public.prestations;


-- ================================================================
-- SEC-03 — document_public_links : la policy INSERT ne vérifiait
--          que organisation_id du lien, jamais que document_id
--          appartient réellement à cette organisation (IDOR
--          cross-org). Correction : EXISTS ciblé sur devis/factures
--          scopé par organisation, en plus du filtre déjà existant.
--          (La vérification symétrique côté edge function
--          get-public-document a été ajoutée séparément.)
-- ================================================================
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
  );
-- org_select / org_delete : NON MODIFIÉES — déjà scopées à l'organisation du lien.


-- ================================================================
-- SEC-04 — handle_new_user() faisait confiance à raw_user_meta_data
--          ->>'role' sans whitelist. Le flux applicatif protégé
--          (inviter-intervenant, whitelist ['intervenant','assistant'])
--          reste inchangé et correct ; ce trigger réagit lui à TOUT
--          INSERT sur auth.users, donc doit whitelister indépendamment.
--          'admin' (ou toute valeur hors liste) retombe sur
--          'intervenant', jamais créé silencieusement.
--          Important : vérifier également côté Dashboard Supabase
--          (Authentication → Providers) que l'auto-inscription
--          publique est désactivée — cette migration ne peut pas
--          le garantir, voir rapport final.
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  requested_role text;
  safe_role text;
BEGIN
  requested_role := NEW.raw_user_meta_data->>'role';
  IF requested_role IN ('intervenant', 'assistant') THEN
    safe_role := requested_role;
  ELSE
    safe_role := 'intervenant';
  END IF;

  INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom',    ''),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    safe_role,
    COALESCE(
      -- Org passée dans les metadata (NULL si l'appelant ne la passe pas)
      (SELECT id FROM public.organisations
       WHERE id = (NEW.raw_user_meta_data->>'organisation_id')::uuid
       LIMIT 1),
      -- Fallback : organisation kaytek-inter (comportement historique conservé)
      (SELECT id FROM public.organisations
       WHERE slug = 'kaytek-inter'
       LIMIT 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;


-- ================================================================
-- SEC-05 — Le réseau partenaires doit rester strictement réservé à
--          l'admin. Les policies SELECT de partner_profiles /
--          partner_connections / partner_messages /
--          partner_intervention_requests (+ tables d'événements liées)
--          ne vérifiaient que l'appartenance à l'organisation, jamais
--          le rôle — un assistant/intervenant qui ouvre la messagerie
--          d'équipe déclenchait un fetch réel de données réseau
--          partenaires (correctif frontend appliqué séparément dans
--          src/lib/hooks/partners.ts). Ajout de is_admin_in_org() en
--          plus du filtre d'organisation existant, sans changer le
--          fonctionnement admin.
-- ================================================================
DROP POLICY IF EXISTS "partner_profiles_select" ON public.partner_profiles;
CREATE POLICY "partner_profiles_select" ON public.partner_profiles
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND (
      organisation_id = current_org_id()
      OR visible_reseau = true
      OR has_partner_relation(organisation_id, current_org_id())
    )
  );

DROP POLICY IF EXISTS "partner_connections_select" ON public.partner_connections;
CREATE POLICY "partner_connections_select" ON public.partner_connections
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND (current_org_id() = requester_organisation_id OR current_org_id() = target_organisation_id)
  );

DROP POLICY IF EXISTS "partner_connection_events_select" ON public.partner_connection_events;
CREATE POLICY "partner_connection_events_select" ON public.partner_connection_events
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.partner_connections c
      WHERE c.id = partner_connection_events.connection_id
        AND (current_org_id() = c.requester_organisation_id OR current_org_id() = c.target_organisation_id)
    )
  );

DROP POLICY IF EXISTS "partner_messages_select" ON public.partner_messages;
CREATE POLICY "partner_messages_select" ON public.partner_messages
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND is_connection_member(connection_id, current_org_id())
  );

DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND (current_org_id() = source_organisation_id OR current_org_id() = target_organisation_id)
  );

DROP POLICY IF EXISTS "pie_select" ON public.partner_intervention_events;
CREATE POLICY "pie_select" ON public.partner_intervention_events
  FOR SELECT
  USING (
    is_admin_in_org(current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.partner_intervention_requests r
      WHERE r.id = partner_intervention_events.request_id
        AND (current_org_id() = r.source_organisation_id OR current_org_id() = r.target_organisation_id)
    )
  );
-- INSERT/UPDATE/DELETE de ces tables : NON MODIFIÉES (hors périmètre SEC-05,
-- déjà correctement contrôlées par is_connection_accepted()/machine à états).


-- ================================================================
-- SEC-06 — Secret interne X-Internal-Secret codé en clair dans 3
--          migrations SQL commitées (trigger_push_on_notification →
--          send-push). Rotation : le secret est désormais généré
--          aléatoirement côté serveur (gen_random_bytes), stocké dans
--          Supabase Vault, et n'apparaît JAMAIS en clair dans ce
--          fichier ni dans aucun fichier commité. Le trigger et
--          l'edge function send-push lisent tous deux la même valeur
--          depuis Vault via la fonction get_internal_push_secret()
--          (accès restreint à service_role uniquement).
--          Note : l'ancien secret hardcodé dans les migrations
--          20260610000032/20260708000001 reste visible dans
--          l'historique git (déjà commité) mais est désormais
--          invalidé par cette rotation — il ne correspond plus à
--          rien côté Vault.
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'internal_push_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'internal_push_secret',
      'Secret partagé trigger_push_on_notification() <-> edge function send-push. Rotation 2026-07-08 (SEC-06) : ancien secret hardcodé dans les migrations invalidé.'
    );
  ELSE
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = 'internal_push_secret'),
      encode(extensions.gen_random_bytes(32), 'hex')
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_internal_push_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_push_secret' LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_internal_push_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_internal_push_secret() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_internal_push_secret() TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      -- Clé anon publique — intentionnellement non secrète (déjà expédiée
      -- dans le bundle frontend, VITE_SUPABASE_ANON_KEY). La protection
      -- réelle de cet appel interne est X-Internal-Secret ci-dessous.
      'apikey',            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
      'Authorization',     'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpbXJ1a2t4ZWhjd3plbXNsd2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjc0NzEsImV4cCI6MjA5NDcwMzQ3MX0.jYRlpSwGJAP3Zp0PuyGluoBuWzD1UraRQxt5bf-Boto',
      'X-Internal-Secret', public.get_internal_push_secret()
    ),
    body    := jsonb_build_object(
      'user_id', NEW.user_id::text,
      'titre',   NEW.titre,
      'contenu', NEW.contenu,
      'lien',    COALESCE(NEW.lien, '/')
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_push_on_notification() OWNER TO postgres;


-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'devis', 'factures', 'commissions', 'commission_receipts',
    'prestations', 'document_public_links',
    'partner_profiles', 'partner_connections', 'partner_connection_events',
    'partner_messages', 'partner_intervention_requests', 'partner_intervention_events'
  )
ORDER BY tablename, cmd;
