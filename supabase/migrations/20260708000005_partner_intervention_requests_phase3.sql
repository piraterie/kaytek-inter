-- ================================================================
-- MIGRATION : Réseau partenaires — Phase 3 v1 (demandes d'intervention)
-- Date       : 2026-07-08
-- Objectif   : Permettre à une organisation d'envoyer une demande
--              d'intervention à un partenaire accepté, via un
--              snapshot explicite — jamais d'accès direct aux tables
--              internes de l'organisation source.
--
-- Tables créées : partner_intervention_requests, partner_intervention_events.
-- Ne modifie AUCUNE table existante (clients, devis, factures,
-- interventions, messages, profiles, organisations, notifications —
-- notifications reçoit seulement de nouvelles LIGNES via un trigger
-- dédié, sa policy RLS n'est pas touchée).
-- Ne modifie AUCUNE policy RLS existante.
--
-- Phase 3 v1 — exclu volontairement :
--   · aperçu réel des photos partagées (Option A validée : seul un
--     compte est stocké/affiché, aucun accès Storage, aucune edge
--     function, aucune signed URL cross-org)
--   · import automatique en intervention interne chez le partenaire
--   · facturation / commission partenaire
--   · Telegram / push (in-app uniquement — skip_push = true partout)
-- Idempotent : CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- ================================================================


-- ================================================================
-- 1. TABLE : partner_intervention_requests
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_intervention_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id             uuid NOT NULL REFERENCES public.partner_connections(id) ON DELETE CASCADE,
  source_organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  source_profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  target_profile_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Référence interne côté émetteur uniquement — AUCUNE FK vers
  -- interventions (couplage volontairement lâche). La RLS de
  -- `interventions` bloque déjà toute lecture cross-org : ce champ
  -- ne doit simplement jamais être affiché côté partenaire (imposé
  -- au niveau frontend, voir hooks/UI).
  source_intervention_id    uuid,

  status                    text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','refused','in_progress','completed','cancelled')),

  -- ── Snapshot (verrouillé après création par trigger) ──────────
  type_intervention         text,
  urgence                   boolean NOT NULL DEFAULT false,
  date_souhaitee            timestamptz,
  ville                     text,
  adresse_partagee          text,
  telephone_client_partage  text,
  nom_client_partage        text,
  description_partagee      text,
  consignes_partagees       text,
  montant_partage           numeric,
  -- Métadonnées minimales uniquement (id + type) — jamais de
  -- storage_path : le compte est affichable sans donner la moindre
  -- information exploitable sur le stockage réel (Option A).
  photos_partagees          jsonb,

  share_adresse             boolean NOT NULL DEFAULT false,
  share_telephone           boolean NOT NULL DEFAULT false,
  share_nom_client          boolean NOT NULL DEFAULT false,
  share_description         boolean NOT NULL DEFAULT false,
  share_montant             boolean NOT NULL DEFAULT false,
  share_photos              boolean NOT NULL DEFAULT false,

  note_refus                text,
  compte_rendu              text,

  -- Inerte en Phase 3 — aucun code n'écrit cette colonne.
  resulting_intervention_id uuid,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pir_no_self CHECK (source_organisation_id <> target_organisation_id),
  -- Garde-fou DB : impossible de stocker un contenu partagé si le
  -- flag correspondant n'est pas coché, même en cas de bug frontend.
  CONSTRAINT pir_share_consistency CHECK (
    (share_adresse    OR adresse_partagee         IS NULL) AND
    (share_telephone  OR telephone_client_partage IS NULL) AND
    (share_nom_client OR nom_client_partage       IS NULL) AND
    (share_description OR description_partagee    IS NULL) AND
    (share_montant    OR montant_partage          IS NULL) AND
    (share_photos     OR photos_partagees         IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS pir_source_idx ON public.partner_intervention_requests (source_organisation_id, status);
CREATE INDEX IF NOT EXISTS pir_target_idx ON public.partner_intervention_requests (target_organisation_id, status);
CREATE INDEX IF NOT EXISTS pir_connection_idx ON public.partner_intervention_requests (connection_id);


-- ── Machine à états + verrouillage du snapshot ──────────────────
CREATE OR REPLACE FUNCTION public.partner_intervention_requests_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_org uuid := public.current_org_id();
BEGIN
  IF NEW.connection_id             <> OLD.connection_id
     OR NEW.source_organisation_id <> OLD.source_organisation_id
     OR NEW.source_profile_id      <> OLD.source_profile_id
     OR NEW.target_organisation_id <> OLD.target_organisation_id
     OR NEW.source_intervention_id      IS DISTINCT FROM OLD.source_intervention_id
     OR NEW.created_at                  <> OLD.created_at
     OR NEW.type_intervention           IS DISTINCT FROM OLD.type_intervention
     OR NEW.urgence                     <> OLD.urgence
     OR NEW.date_souhaitee              IS DISTINCT FROM OLD.date_souhaitee
     OR NEW.ville                       IS DISTINCT FROM OLD.ville
     OR NEW.adresse_partagee            IS DISTINCT FROM OLD.adresse_partagee
     OR NEW.telephone_client_partage    IS DISTINCT FROM OLD.telephone_client_partage
     OR NEW.nom_client_partage          IS DISTINCT FROM OLD.nom_client_partage
     OR NEW.description_partagee        IS DISTINCT FROM OLD.description_partagee
     OR NEW.consignes_partagees         IS DISTINCT FROM OLD.consignes_partagees
     OR NEW.montant_partage             IS DISTINCT FROM OLD.montant_partage
     OR NEW.photos_partagees            IS DISTINCT FROM OLD.photos_partagees
     OR NEW.share_adresse               <> OLD.share_adresse
     OR NEW.share_telephone             <> OLD.share_telephone
     OR NEW.share_nom_client            <> OLD.share_nom_client
     OR NEW.share_description           <> OLD.share_description
     OR NEW.share_montant               <> OLD.share_montant
     OR NEW.share_photos                <> OLD.share_photos
     OR NEW.resulting_intervention_id   IS DISTINCT FROM OLD.resulting_intervention_id
  THEN
    RAISE EXCEPTION 'partner_intervention_requests: champ du snapshot immuable modifié';
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut accepter cette demande';
    END IF;
    NEW.target_profile_id := auth.uid();

  ELSIF OLD.status = 'pending' AND NEW.status = 'refused' THEN
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut refuser cette demande';
    END IF;
    IF NEW.note_refus IS NULL OR length(trim(NEW.note_refus)) = 0 THEN
      RAISE EXCEPTION 'Un motif de refus est requis';
    END IF;
    NEW.target_profile_id := auth.uid();

  ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    IF actor_org <> OLD.source_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation émettrice peut annuler sa demande';
    END IF;

  ELSIF OLD.status = 'accepted' AND NEW.status = 'cancelled' THEN
    IF actor_org <> OLD.source_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation émettrice peut annuler sa demande';
    END IF;

  ELSIF OLD.status = 'accepted' AND NEW.status = 'in_progress' THEN
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut démarrer l''intervention';
    END IF;

  ELSIF OLD.status = 'in_progress' AND NEW.status = 'completed' THEN
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut terminer l''intervention';
    END IF;

  ELSE
    RAISE EXCEPTION 'Transition de statut invalide : % → %', OLD.status, NEW.status;
  END IF;

  IF NEW.note_refus IS DISTINCT FROM OLD.note_refus AND NOT (OLD.status = 'pending' AND NEW.status = 'refused') THEN
    RAISE EXCEPTION 'note_refus ne peut être renseigné que lors du refus';
  END IF;
  IF NEW.compte_rendu IS DISTINCT FROM OLD.compte_rendu AND NOT (OLD.status = 'in_progress' AND NEW.status = 'completed') THEN
    RAISE EXCEPTION 'compte_rendu ne peut être renseigné que lors de la clôture';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pir_before_update ON public.partner_intervention_requests;
CREATE TRIGGER trg_pir_before_update
  BEFORE UPDATE ON public.partner_intervention_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_intervention_requests_before_update();


-- ================================================================
-- 2. TABLE : partner_intervention_events
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_intervention_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id             uuid NOT NULL REFERENCES public.partner_intervention_requests(id) ON DELETE CASCADE,
  actor_profile_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_organisation_id  uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  action                 text NOT NULL,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pie_request_idx ON public.partner_intervention_events (request_id, created_at);

CREATE OR REPLACE FUNCTION public.log_partner_intervention_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.partner_intervention_events (request_id, actor_profile_id, actor_organisation_id, action)
    VALUES (NEW.id, NEW.source_profile_id, NEW.source_organisation_id, 'requested');
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    INSERT INTO public.partner_intervention_events (request_id, actor_profile_id, actor_organisation_id, action, note)
    VALUES (
      NEW.id, auth.uid(), public.current_org_id(), NEW.status,
      CASE WHEN NEW.status = 'refused' THEN NEW.note_refus
           WHEN NEW.status = 'completed' THEN NEW.compte_rendu
           ELSE NULL END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pir_after_insert_event ON public.partner_intervention_requests;
CREATE TRIGGER trg_pir_after_insert_event
  AFTER INSERT ON public.partner_intervention_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_partner_intervention_event();

DROP TRIGGER IF EXISTS trg_pir_after_update_event ON public.partner_intervention_requests;
CREATE TRIGGER trg_pir_after_update_event
  AFTER UPDATE ON public.partner_intervention_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_partner_intervention_event();


-- ================================================================
-- 3. NOTIFICATIONS IN-APP (trigger dédié — pas de réutilisation de
--    notifyAdmins()/notifyUser(), qui supposent l'organisation de
--    l'appelant et échoueraient/seraient rejetés par notif_insert
--    pour un destinataire d'une AUTRE organisation).
-- ================================================================
-- IMPORTANT : skip_push = true systématiquement — la table
-- `notifications` a un trigger existant (trigger_push_on_notification)
-- qui déclenche un push via pg_net sur tout INSERT sauf si
-- skip_push = true. Aucun Telegram/push dans cette phase.
CREATE OR REPLACE FUNCTION public.notify_on_partner_intervention_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notify_org      uuid;
  other_org_name  text;
  n_titre         text;
  n_contenu       text;
  n_lien          text;
  admin_id        uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    notify_org := NEW.target_organisation_id;
    SELECT nom_public INTO other_org_name FROM public.partner_profiles WHERE organisation_id = NEW.source_organisation_id;
    n_titre   := '🔧 Nouvelle demande d''intervention partenaire';
    n_contenu := COALESCE(other_org_name, 'Un partenaire') || ' vous a envoyé une demande d''intervention.';
    n_lien    := '/partenaires?tab=interventions-recues';

  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status AND NEW.status IN ('accepted','refused','completed') THEN
    notify_org := NEW.source_organisation_id;
    SELECT nom_public INTO other_org_name FROM public.partner_profiles WHERE organisation_id = NEW.target_organisation_id;
    n_titre := CASE NEW.status
      WHEN 'accepted'  THEN '✅ Demande d''intervention acceptée'
      WHEN 'refused'   THEN '❌ Demande d''intervention refusée'
      ELSE                  '🏁 Intervention partenaire terminée'
    END;
    n_contenu := COALESCE(other_org_name, 'Votre partenaire') || ' a ' ||
      CASE NEW.status WHEN 'accepted' THEN 'accepté' WHEN 'refused' THEN 'refusé' ELSE 'terminé' END ||
      ' la demande.';
    n_lien := '/partenaires?tab=interventions-envoyees';

  ELSE
    RETURN NEW;
  END IF;

  FOR admin_id IN
    SELECT id FROM public.profiles WHERE organisation_id = notify_org AND role = 'admin' AND actif = true
  LOOP
    INSERT INTO public.notifications (user_id, titre, contenu, type, lue, lien, skip_push, organisation_id)
    VALUES (admin_id, n_titre, n_contenu, 'info', false, n_lien, true, notify_org);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pir_after_insert_notify ON public.partner_intervention_requests;
CREATE TRIGGER trg_pir_after_insert_notify
  AFTER INSERT ON public.partner_intervention_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_partner_intervention_change();

DROP TRIGGER IF EXISTS trg_pir_after_update_notify ON public.partner_intervention_requests;
CREATE TRIGGER trg_pir_after_update_notify
  AFTER UPDATE ON public.partner_intervention_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_partner_intervention_change();


-- ================================================================
-- 4. RLS — partner_intervention_requests
-- ================================================================
ALTER TABLE public.partner_intervention_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;
DROP POLICY IF EXISTS "pir_insert" ON public.partner_intervention_requests;
DROP POLICY IF EXISTS "pir_update" ON public.partner_intervention_requests;

-- SELECT : uniquement les deux organisations de la demande.
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (current_org_id() IN (source_organisation_id, target_organisation_id));

-- INSERT : admin, org émettrice = soi-même, connexion accepted À CET
-- INSTANT (revalidée à chaque tentative — pas de cache), champs
-- initiaux cohérents, source_intervention_id (si fourni) appartient
-- bien à l'org émettrice, target_profile_id (si fourni) appartient
-- bien à l'org cible.
CREATE POLICY "pir_insert" ON public.partner_intervention_requests
  FOR INSERT
  WITH CHECK (
    source_organisation_id = current_org_id()
    AND source_profile_id = auth.uid()
    AND is_admin_in_org(current_org_id())
    AND status = 'pending'
    AND note_refus IS NULL
    AND compte_rendu IS NULL
    AND resulting_intervention_id IS NULL
    AND target_organisation_id <> current_org_id()
    AND public.is_connection_member(connection_id, source_organisation_id)
    AND public.is_connection_member(connection_id, target_organisation_id)
    AND public.is_connection_accepted(connection_id)
    AND (
      source_intervention_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.interventions i
        WHERE i.id = source_intervention_id AND i.organisation_id = current_org_id()
      )
    )
    AND (
      target_profile_id IS NULL
      OR public.profile_belongs_to_org(target_profile_id, target_organisation_id)
    )
  );

-- UPDATE : admin, membre de la demande — le détail des transitions
-- autorisées (qui peut faire quoi depuis quel statut) est appliqué
-- par le trigger trg_pir_before_update ci-dessus.
CREATE POLICY "pir_update" ON public.partner_intervention_requests
  FOR UPDATE
  USING (
    current_org_id() IN (source_organisation_id, target_organisation_id)
    AND is_admin_in_org(current_org_id())
  )
  WITH CHECK (
    current_org_id() IN (source_organisation_id, target_organisation_id)
    AND is_admin_in_org(current_org_id())
  );

-- Pas de policy DELETE : historique conservé.


-- ================================================================
-- 5. RLS — partner_intervention_events
-- ================================================================
ALTER TABLE public.partner_intervention_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pie_select" ON public.partner_intervention_events;

CREATE POLICY "pie_select" ON public.partner_intervention_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.partner_intervention_requests r
      WHERE r.id = request_id
        AND current_org_id() IN (r.source_organisation_id, r.target_organisation_id)
    )
  );

-- Pas de policy INSERT/UPDATE/DELETE : toutes les écritures passent
-- par le trigger SECURITY DEFINER log_partner_intervention_event().


-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('partner_intervention_requests', 'partner_intervention_events')
ORDER BY tablename, cmd;
