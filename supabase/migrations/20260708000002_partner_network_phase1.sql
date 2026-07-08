-- ================================================================
-- MIGRATION : Réseau partenaires — Phase 1 (fondations + connexions)
-- Date       : 2026-07-08
-- Objectif   : Permettre à deux organisations différentes de se
--              connecter comme partenaires professionnels, sans
--              jamais exposer leurs données privées respectives.
--
-- Tables créées (satellites, isolées du cœur métier) :
--   · partner_profiles         — vitrine publique par organisation
--   · partner_connections      — demandes/connexions entre 2 orgs
--   · partner_connection_events— historique des changements de statut
--
-- Ne modifie AUCUNE table existante (clients, devis, factures,
-- interventions, messages, notifications, profiles, organisations).
-- Ne modifie AUCUNE policy RLS existante.
-- N'ajoute aucune messagerie partenaire ni intervention partenaire
-- (Phases 2 et 3 — hors scope de cette migration).
-- Idempotent : CREATE OR REPLACE / DROP POLICY IF EXISTS — sûr à rejouer.
-- ================================================================


-- ================================================================
-- 1. TABLE : partner_profiles
-- ================================================================
-- Vitrine publique d'une organisation dans le réseau partenaire.
-- 1 ligne par organisation (relation portée par l'organisation,
-- pas par un profil individuel — un partenariat survit à un
-- changement d'admin). Ne contient JAMAIS d'email ni de données
-- privées : uniquement des champs destinés à être potentiellement
-- publics.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        uuid NOT NULL UNIQUE REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  code_partenaire        text NOT NULL UNIQUE,
  nom_public             text NOT NULL,
  metier                 text,
  ville                  text,
  bio                    text,
  visible_reseau         boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_profiles_visible_idx ON public.partner_profiles (visible_reseau) WHERE visible_reseau = true;

-- ── Génération du code partenaire ───────────────────────────────
-- Format lisible "KTK-XXXXXX" (alphabet sans caractères ambigus :
-- pas de 0/O ni 1/I). SECURITY DEFINER pour vérifier l'unicité sur
-- TOUTE la table (pas seulement les lignes visibles par RLS).
CREATE OR REPLACE FUNCTION public.generate_partner_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  already_taken boolean;
BEGIN
  LOOP
    candidate := 'KTK-' || (
      SELECT string_agg(substr(chars, (floor(random() * length(chars)) + 1)::int, 1), '')
      FROM generate_series(1, 6)
    );
    SELECT EXISTS (SELECT 1 FROM public.partner_profiles WHERE code_partenaire = candidate) INTO already_taken;
    EXIT WHEN NOT already_taken;
  END LOOP;
  RETURN candidate;
END;
$$;

ALTER TABLE public.partner_profiles ALTER COLUMN code_partenaire SET DEFAULT public.generate_partner_code();

-- ── Champs immuables + updated_at ───────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_profiles_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id <> OLD.organisation_id OR NEW.code_partenaire <> OLD.code_partenaire THEN
    RAISE EXCEPTION 'partner_profiles: organisation_id et code_partenaire sont immuables';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_profiles_before_update ON public.partner_profiles;
CREATE TRIGGER trg_partner_profiles_before_update
  BEFORE UPDATE ON public.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.partner_profiles_before_update();


-- ================================================================
-- 2. TABLE : partner_connections
-- ================================================================
-- Demande / connexion entre deux organisations. La relation est
-- organisation-à-organisation : requester_profile_id / target_profile_id
-- ne servent qu'à tracer QUI a agi, pas à porter la relation.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_connections (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_organisation_id   uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  requester_profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_organisation_id      uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  target_profile_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','refused','blocked','archived')),
  blocked_by_organisation_id  uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  message                     text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_connections_no_self CHECK (requester_organisation_id <> target_organisation_id)
);

CREATE INDEX IF NOT EXISTS partner_connections_target_idx    ON public.partner_connections (target_organisation_id, status);
CREATE INDEX IF NOT EXISTS partner_connections_requester_idx ON public.partner_connections (requester_organisation_id, status);

-- ── Clé de paire non-ordonnée (org A, org B) == (org B, org A) ─────
-- Fonction wrapper IMMUTABLE explicite : LEAST/GREATEST ne sont pas
-- garantis IMMUTABLE par Postgres pour tous les types, donc pas
-- utilisables directement dans une expression d'index.
CREATE OR REPLACE FUNCTION public.uuid_pair_key(a uuid, b uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN a < b THEN a::text || '_' || b::text ELSE b::text || '_' || a::text END
$$;

-- Une seule connexion "active" (pending/accepted/blocked) autorisée
-- entre deux organisations, quel que soit le sens de la demande.
-- Une connexion refusée ou archivée n'empêche pas une nouvelle demande.
CREATE UNIQUE INDEX IF NOT EXISTS partner_connections_unique_active_pair_idx
  ON public.partner_connections (public.uuid_pair_key(requester_organisation_id, target_organisation_id))
  WHERE status IN ('pending', 'accepted', 'blocked');

-- ── Machine à états + verrouillage des champs immuables ─────────
-- Toute transition de statut passe par ce trigger : c'est la seule
-- source de vérité sur qui a le droit de faire quoi.
CREATE OR REPLACE FUNCTION public.partner_connections_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_org uuid := public.current_org_id();
BEGIN
  IF NEW.requester_organisation_id <> OLD.requester_organisation_id
     OR NEW.target_organisation_id <> OLD.target_organisation_id
     OR NEW.requester_profile_id   <> OLD.requester_profile_id
     OR NEW.created_at             <> OLD.created_at THEN
    RAISE EXCEPTION 'partner_connections: champs immuables modifiés';
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'refused') THEN
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut accepter ou refuser cette demande';
    END IF;
    NEW.target_profile_id := auth.uid();

  ELSIF OLD.status = 'pending' AND NEW.status = 'archived' THEN
    IF actor_org <> OLD.requester_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation émettrice peut annuler sa propre demande';
    END IF;

  ELSIF OLD.status = 'accepted' AND NEW.status = 'blocked' THEN
    NEW.blocked_by_organisation_id := actor_org;

  ELSIF OLD.status = 'blocked' AND NEW.status = 'accepted' THEN
    IF actor_org <> OLD.blocked_by_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation ayant bloqué la connexion peut la débloquer';
    END IF;
    NEW.blocked_by_organisation_id := NULL;

  ELSIF NEW.status = 'archived' AND OLD.status IN ('accepted', 'refused', 'blocked') THEN
    NULL; -- l'une ou l'autre organisation peut archiver une connexion non-pending

  ELSE
    RAISE EXCEPTION 'Transition de statut invalide : % → %', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_connections_before_update ON public.partner_connections;
CREATE TRIGGER trg_partner_connections_before_update
  BEFORE UPDATE ON public.partner_connections
  FOR EACH ROW EXECUTE FUNCTION public.partner_connections_before_update();


-- ================================================================
-- 3. TABLE : partner_connection_events
-- ================================================================
-- Historique en lecture seule pour les utilisateurs — seul le
-- trigger SECURITY DEFINER ci-dessous peut y écrire.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.partner_connection_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id          uuid NOT NULL REFERENCES public.partner_connections(id) ON DELETE CASCADE,
  actor_profile_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_organisation_id  uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  action                 text NOT NULL,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_connection_events_connection_idx ON public.partner_connection_events (connection_id, created_at);

CREATE OR REPLACE FUNCTION public.log_partner_connection_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.partner_connection_events (connection_id, actor_profile_id, actor_organisation_id, action, note)
    VALUES (NEW.id, NEW.requester_profile_id, NEW.requester_organisation_id, 'requested', NEW.message);
  ELSIF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    INSERT INTO public.partner_connection_events (connection_id, actor_profile_id, actor_organisation_id, action)
    VALUES (NEW.id, auth.uid(), public.current_org_id(), NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_connections_after_insert ON public.partner_connections;
CREATE TRIGGER trg_partner_connections_after_insert
  AFTER INSERT ON public.partner_connections
  FOR EACH ROW EXECUTE FUNCTION public.log_partner_connection_event();

DROP TRIGGER IF EXISTS trg_partner_connections_after_update ON public.partner_connections;
CREATE TRIGGER trg_partner_connections_after_update
  AFTER UPDATE ON public.partner_connections
  FOR EACH ROW EXECUTE FUNCTION public.log_partner_connection_event();


-- ================================================================
-- 4. HELPERS RLS
-- ================================================================

-- is_partner_org() : vrai UNIQUEMENT si une connexion ACCEPTED existe.
-- Réservé aux futures Phases 2/3 (messagerie / interventions
-- partenaires) qui devront vérifier une relation active établie.
CREATE OR REPLACE FUNCTION public.is_partner_org(org_a uuid, org_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections c
    WHERE c.status = 'accepted'
      AND (
        (c.requester_organisation_id = org_a AND c.target_organisation_id = org_b)
        OR (c.requester_organisation_id = org_b AND c.target_organisation_id = org_a)
      )
  )
$$;

-- has_partner_relation() : vrai si N'IMPORTE QUELLE connexion existe
-- (pending/accepted/blocked/refused/archived) entre les deux orgs.
-- Usage restreint : uniquement pour permettre à deux organisations
-- déjà en contact (même en attente) de voir la vitrine publique
-- (partner_profiles) l'une de l'autre, sans attendre l'acceptation
-- et sans dépendre du switch "visible_reseau". N'expose jamais rien
-- de plus que nom_public / metier / ville / bio / code_partenaire —
-- partner_profiles ne contient aucune donnée privée.
CREATE OR REPLACE FUNCTION public.has_partner_relation(org_a uuid, org_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections c
    WHERE (c.requester_organisation_id = org_a AND c.target_organisation_id = org_b)
       OR (c.requester_organisation_id = org_b AND c.target_organisation_id = org_a)
  )
$$;


-- ================================================================
-- 5. RLS — partner_profiles
-- ================================================================
ALTER TABLE public.partner_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_profiles_select" ON public.partner_profiles;
DROP POLICY IF EXISTS "partner_profiles_insert" ON public.partner_profiles;
DROP POLICY IF EXISTS "partner_profiles_update" ON public.partner_profiles;

-- SELECT : son propre profil OU un profil opt-in public OU le profil
-- d'une organisation avec qui une relation (même en attente) existe.
CREATE POLICY "partner_profiles_select" ON public.partner_profiles
  FOR SELECT
  USING (
    organisation_id = current_org_id()
    OR visible_reseau = true
    OR public.has_partner_relation(organisation_id, current_org_id())
  );

-- INSERT : admin uniquement, pour sa propre organisation.
CREATE POLICY "partner_profiles_insert" ON public.partner_profiles
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND is_admin_in_org(current_org_id())
  );

-- UPDATE : admin uniquement, sur le profil de sa propre organisation.
CREATE POLICY "partner_profiles_update" ON public.partner_profiles
  FOR UPDATE
  USING (organisation_id = current_org_id() AND is_admin_in_org(current_org_id()))
  WITH CHECK (organisation_id = current_org_id() AND is_admin_in_org(current_org_id()));

-- Pas de policy DELETE : pas de suppression en Phase 1 (désactiver
-- la visibilité via visible_reseau = false suffit).


-- ================================================================
-- 6. RLS — partner_connections
-- ================================================================
ALTER TABLE public.partner_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_connections_select" ON public.partner_connections;
DROP POLICY IF EXISTS "partner_connections_insert" ON public.partner_connections;
DROP POLICY IF EXISTS "partner_connections_update" ON public.partner_connections;

-- SELECT : visible uniquement par les deux organisations concernées.
CREATE POLICY "partner_connections_select" ON public.partner_connections
  FOR SELECT
  USING (current_org_id() IN (requester_organisation_id, target_organisation_id));

-- INSERT : admin uniquement, org émettrice = son organisation,
-- profil émetteur = lui-même, organisation cible doit avoir un
-- partner_profiles existant, target_profile_id (si fourni) doit
-- appartenir à l'organisation cible, statut forcé à 'pending'.
CREATE POLICY "partner_connections_insert" ON public.partner_connections
  FOR INSERT
  WITH CHECK (
    requester_organisation_id = current_org_id()
    AND requester_profile_id = auth.uid()
    AND is_admin_in_org(current_org_id())
    AND status = 'pending'
    AND target_organisation_id <> current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.partner_profiles pp
      WHERE pp.organisation_id = target_organisation_id
    )
    AND (
      target_profile_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = target_profile_id AND p.organisation_id = target_organisation_id
      )
    )
  );

-- UPDATE : admin de l'une des deux organisations concernées.
-- Le détail de qui peut faire quelle transition est appliqué par
-- le trigger partner_connections_before_update (au-dessus).
CREATE POLICY "partner_connections_update" ON public.partner_connections
  FOR UPDATE
  USING (
    current_org_id() IN (requester_organisation_id, target_organisation_id)
    AND is_admin_in_org(current_org_id())
  )
  WITH CHECK (
    current_org_id() IN (requester_organisation_id, target_organisation_id)
    AND is_admin_in_org(current_org_id())
  );

-- Pas de policy DELETE : historique conservé, on archive au lieu
-- de supprimer.


-- ================================================================
-- 7. RLS — partner_connection_events
-- ================================================================
ALTER TABLE public.partner_connection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_connection_events_select" ON public.partner_connection_events;

-- SELECT : visible uniquement par les deux organisations de la
-- connexion liée.
CREATE POLICY "partner_connection_events_select" ON public.partner_connection_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.partner_connections c
      WHERE c.id = connection_id
        AND current_org_id() IN (c.requester_organisation_id, c.target_organisation_id)
    )
  );

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated : toutes
-- les écritures passent par le trigger SECURITY DEFINER
-- log_partner_connection_event(), qui contourne RLS par conception
-- (propriétaire de la table). Aucun accès direct en écriture.


-- ================================================================
-- 8. RPC — search_partner_profiles(query text)
-- ================================================================
-- Recherche contrôlée plutôt qu'un SELECT ouvert :
--  · code partenaire exact (KTK-XXXXXX)      → contourne visible_reseau
--    (équivalent à un secret partagé, comme un lien d'invitation)
--  · email exact, rôle admin uniquement       → contourne visible_reseau,
--    l'email en lui-même n'est JAMAIS retourné dans le résultat
--  · nom public / métier / ville (préfixe)    → uniquement les profils
--    visible_reseau = true
-- Ne retourne jamais : email, organisations.slug/plan/actif,
-- profiles.telephone, ou toute autre donnée privée.
CREATE OR REPLACE FUNCTION public.search_partner_profiles(query text)
RETURNS TABLE (
  organisation_id    uuid,
  code_partenaire    text,
  nom_public         text,
  metier             text,
  ville              text,
  bio                text,
  contact_profile_id uuid,
  connection_status  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q text := trim(coalesce(query, ''));
  my_org uuid := current_org_id();
  found_org uuid;
BEGIN
  IF my_org IS NULL OR length(q) < 2 THEN
    RETURN;
  END IF;

  -- ── Recherche exacte par email (admin uniquement) ──────────────
  IF q ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    SELECT p.organisation_id INTO found_org
    FROM public.profiles p
    WHERE lower(p.email) = lower(q) AND p.role = 'admin' AND p.actif = true
    LIMIT 1;

    IF found_org IS NULL OR found_org = my_org THEN RETURN; END IF;

    RETURN QUERY
    SELECT pp.organisation_id, pp.code_partenaire, pp.nom_public, pp.metier, pp.ville, pp.bio,
           pp.created_by_profile_id,
           COALESCE(pc.status, 'none')
    FROM public.partner_profiles pp
    LEFT JOIN public.partner_connections pc
      ON public.uuid_pair_key(pc.requester_organisation_id, pc.target_organisation_id) = public.uuid_pair_key(my_org, pp.organisation_id)
      AND pc.status IN ('pending','accepted','blocked')
    WHERE pp.organisation_id = found_org
    LIMIT 1;
    RETURN;
  END IF;

  -- ── Recherche exacte par code partenaire ────────────────────────
  IF q ~* '^KTK-[A-Z0-9]{6}$' THEN
    RETURN QUERY
    SELECT pp.organisation_id, pp.code_partenaire, pp.nom_public, pp.metier, pp.ville, pp.bio,
           pp.created_by_profile_id,
           COALESCE(pc.status, 'none')
    FROM public.partner_profiles pp
    LEFT JOIN public.partner_connections pc
      ON public.uuid_pair_key(pc.requester_organisation_id, pc.target_organisation_id) = public.uuid_pair_key(my_org, pp.organisation_id)
      AND pc.status IN ('pending','accepted','blocked')
    WHERE upper(pp.code_partenaire) = upper(q) AND pp.organisation_id <> my_org
    LIMIT 1;
    RETURN;
  END IF;

  -- ── Recherche floue : nom public / métier / ville ──────────────
  -- Uniquement les profils opt-in (visible_reseau = true).
  RETURN QUERY
  SELECT pp.organisation_id, pp.code_partenaire, pp.nom_public, pp.metier, pp.ville, pp.bio,
         pp.created_by_profile_id,
         COALESCE(pc.status, 'none')
  FROM public.partner_profiles pp
  LEFT JOIN public.partner_connections pc
    ON public.uuid_pair_key(pc.requester_organisation_id, pc.target_organisation_id) = public.uuid_pair_key(my_org, pp.organisation_id)
    AND pc.status IN ('pending','accepted','blocked')
  WHERE pp.visible_reseau = true
    AND pp.organisation_id <> my_org
    AND (pp.nom_public ILIKE '%' || q || '%' OR pp.metier ILIKE '%' || q || '%' OR pp.ville ILIKE '%' || q || '%')
  ORDER BY pp.nom_public
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.search_partner_profiles(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_partner_profiles(text) TO authenticated;


-- ================================================================
-- VÉRIFICATION — résultats attendus :
--   partner_profiles          : 3 policies (select, insert, update)
--   partner_connections       : 3 policies (select, insert, update)
--   partner_connection_events : 1 policy  (select)
-- ================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('partner_profiles', 'partner_connections', 'partner_connection_events')
ORDER BY tablename, cmd;
