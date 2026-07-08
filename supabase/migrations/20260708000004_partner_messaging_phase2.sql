-- ================================================================
-- MIGRATION : Réseau partenaires — Phase 2 (messagerie partenaire)
-- Date       : 2026-07-08
-- Objectif   : Permettre à deux organisations connectées en statut
--              'accepted' de discuter via une messagerie dédiée,
--              séparée de la messagerie interne existante.
--
-- Table créée : partner_messages, liée à partner_connections.
-- Ne modifie AUCUNE table existante (ni `messages`, ni les tables
-- Phase 1 : partner_profiles, partner_connections,
-- partner_connection_events). Ne modifie AUCUNE policy RLS
-- existante, y compris celles de la messagerie interne.
-- N'ajoute aucune demande d'intervention partenaire (Phase 3).
-- Idempotent : CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- ================================================================


-- ================================================================
-- 1. TABLE : partner_messages
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_messages (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id            uuid NOT NULL REFERENCES public.partner_connections(id) ON DELETE CASCADE,
  sender_profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_organisation_id   uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  contenu                  text NOT NULL,
  -- Réservé Phase 3 (demande d'intervention partenaire) — colonne
  -- inerte, aucune FK (la table cible n'existe pas encore), non
  -- utilisée par le code de cette phase.
  intervention_request_id  uuid,
  lu_at                    timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_messages_contenu_not_empty CHECK (length(trim(contenu)) > 0)
);

CREATE INDEX IF NOT EXISTS partner_messages_connection_idx ON public.partner_messages (connection_id, created_at);

-- Note : le partage de photos (media_url/media_type) est volontairement
-- absent de cette phase — il implique une gestion de signed URLs
-- cross-organisation qui mérite sa propre revue de sécurité, hors
-- scope de la Phase 2 (messagerie texte uniquement).

-- ── Realtime : même configuration que `messages` (phase4) ────────
ALTER TABLE public.partner_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'partner_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_messages;
  END IF;
END $$;

-- ── Champs immuables (seul lu_at est modifiable après création) + updated_at ──
CREATE OR REPLACE FUNCTION public.partner_messages_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.connection_id <> OLD.connection_id
     OR NEW.sender_profile_id <> OLD.sender_profile_id
     OR NEW.sender_organisation_id <> OLD.sender_organisation_id
     OR NEW.contenu <> OLD.contenu
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'partner_messages: seul lu_at est modifiable après création';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_messages_before_update ON public.partner_messages;
CREATE TRIGGER trg_partner_messages_before_update
  BEFORE UPDATE ON public.partner_messages
  FOR EACH ROW EXECUTE FUNCTION public.partner_messages_before_update();


-- ================================================================
-- 2. HELPERS RLS
-- ================================================================

-- is_connection_member() : vrai si org_id est l'une des deux
-- organisations de la connexion conn_id, quel que soit son statut.
-- Utilisé pour la LECTURE : l'historique reste visible même après
-- blocage/archivage (requirement Phase 2 point 5).
CREATE OR REPLACE FUNCTION public.is_connection_member(conn_id uuid, org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections c
    WHERE c.id = conn_id
      AND org_id IN (c.requester_organisation_id, c.target_organisation_id)
  )
$$;

-- is_connection_accepted() : vrai si la connexion conn_id a le
-- statut 'accepted' EN CE MOMENT. Utilisé pour l'ÉCRITURE : revalidé
-- à chaque INSERT via la policy (pas de cache), donc si la connexion
-- passe à blocked/archived entre deux messages, le prochain INSERT
-- est refusé immédiatement.
CREATE OR REPLACE FUNCTION public.is_connection_accepted(conn_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections WHERE id = conn_id AND status = 'accepted'
  )
$$;


-- ================================================================
-- 3. RLS — partner_messages
-- ================================================================
ALTER TABLE public.partner_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_messages_select" ON public.partner_messages;
DROP POLICY IF EXISTS "partner_messages_insert" ON public.partner_messages;
DROP POLICY IF EXISTS "partner_messages_update" ON public.partner_messages;

-- SELECT : membre de la connexion (l'une ou l'autre organisation),
-- quel que soit le statut actuel — l'historique reste visible après
-- blocage/archivage. Aucun accès à une connexion non liée (donc
-- aucune 3e organisation ne peut jamais lire ces messages).
CREATE POLICY "partner_messages_select" ON public.partner_messages
  FOR SELECT
  USING (public.is_connection_member(connection_id, current_org_id()));

-- INSERT : admin, dans son organisation, membre de la connexion,
-- ET connexion 'accepted' au moment précis de l'écriture.
CREATE POLICY "partner_messages_insert" ON public.partner_messages
  FOR INSERT
  WITH CHECK (
    sender_organisation_id = current_org_id()
    AND sender_profile_id = auth.uid()
    AND is_admin_in_org(current_org_id())
    AND public.is_connection_member(connection_id, current_org_id())
    AND public.is_connection_accepted(connection_id)
  );

-- UPDATE : marquer lu (lu_at) — admin, membre de la connexion.
-- Le trigger ci-dessus verrouille tous les autres champs.
CREATE POLICY "partner_messages_update" ON public.partner_messages
  FOR UPDATE
  USING (
    is_admin_in_org(current_org_id())
    AND public.is_connection_member(connection_id, current_org_id())
  )
  WITH CHECK (
    is_admin_in_org(current_org_id())
    AND public.is_connection_member(connection_id, current_org_id())
  );

-- Pas de policy DELETE : pas de suppression en Phase 2.


-- ================================================================
-- VÉRIFICATION — résultat attendu : 3 policies (select, insert, update)
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partner_messages'
ORDER BY cmd;
