-- ================================================================
-- MIGRATION : Import d'une demande d'intervention partenaire
-- Date       : 2026-07-08
-- Objectif   : Permettre à l'organisation cible de lier une demande
--              d'intervention partenaire acceptée à une intervention
--              qu'elle vient de créer dans son propre tenant, via
--              resulting_intervention_id.
--
-- Contexte   : la Phase 3 (20260708000005) verrouillait ce champ comme
--              totalement immuable ("pas d'import automatique sauf
--              validation" — cf. audit Phase 3). Cette migration lève
--              ce verrou de façon strictement encadrée :
--                · uniquement NULL → une valeur (jamais l'inverse,
--                  jamais modifiable une fois posé — empêche tout
--                  doublon au niveau DB, pas seulement côté UI)
--                · uniquement par l'organisation CIBLE
--                · uniquement si la demande est accepted/in_progress
--                · uniquement vers une intervention qui appartient
--                  réellement à l'organisation cible (vérification
--                  same-org, effectuée par la session de l'acteur
--                  lui-même — pas de lecture cross-org)
--
-- Tables modifiées : aucune (uniquement les fonctions trigger déjà
-- créées en Phase 3 sur les tables satellites). Aucune table cœur
-- (clients, interventions, messages, profiles, organisations,
-- notifications) ni policy RLS existante n'est modifiée — seules de
-- nouvelles LIGNES sont insérées dans `notifications` par le trigger,
-- comme en Phase 3.
-- Idempotent : CREATE OR REPLACE.
-- ================================================================

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
  THEN
    RAISE EXCEPTION 'partner_intervention_requests: champ du snapshot immuable modifié';
  END IF;

  -- ── resulting_intervention_id : NULL → valeur, une seule fois ──
  IF NEW.resulting_intervention_id IS DISTINCT FROM OLD.resulting_intervention_id THEN
    IF OLD.resulting_intervention_id IS NOT NULL THEN
      RAISE EXCEPTION 'resulting_intervention_id est déjà renseigné et ne peut plus être modifié';
    END IF;
    IF NEW.resulting_intervention_id IS NULL THEN
      RAISE EXCEPTION 'resulting_intervention_id ne peut pas être effacé';
    END IF;
    IF actor_org <> OLD.target_organisation_id THEN
      RAISE EXCEPTION 'Seule l''organisation cible peut lier une intervention créée';
    END IF;
    IF OLD.status NOT IN ('accepted', 'in_progress') THEN
      RAISE EXCEPTION 'Une intervention ne peut être liée que sur une demande accepted ou in_progress';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.interventions i
      WHERE i.id = NEW.resulting_intervention_id
        AND i.organisation_id = OLD.target_organisation_id
    ) THEN
      RAISE EXCEPTION 'L''intervention indiquée n''appartient pas à votre organisation';
    END IF;
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

-- Trigger déjà créé en Phase 3 (20260708000005), pointe déjà vers cette
-- fonction — CREATE OR REPLACE ci-dessus suffit, pas besoin de le recréer.


-- ================================================================
-- Notification : intervention interne créée par le partenaire
-- ================================================================
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

  ELSIF TG_OP = 'UPDATE' AND NEW.resulting_intervention_id IS DISTINCT FROM OLD.resulting_intervention_id AND NEW.resulting_intervention_id IS NOT NULL THEN
    notify_org := NEW.source_organisation_id;
    SELECT nom_public INTO other_org_name FROM public.partner_profiles WHERE organisation_id = NEW.target_organisation_id;
    n_titre   := '📋 Intervention créée par le partenaire';
    n_contenu := COALESCE(other_org_name, 'Votre partenaire') || ' a créé une intervention interne pour votre demande.';
    n_lien    := '/partenaires?tab=interventions-envoyees';

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

-- Triggers déjà créés en Phase 3, pointent déjà vers cette fonction —
-- CREATE OR REPLACE ci-dessus suffit.


-- ================================================================
-- VÉRIFICATION — la fonction doit désormais mentionner
-- resulting_intervention_id dans un contexte de validation, pas
-- uniquement dans la liste d'immuabilité.
-- ================================================================
SELECT proname, prosrc ILIKE '%déjà renseigné et ne peut plus être modifié%' AS import_guard_present
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'partner_intervention_requests_before_update';
