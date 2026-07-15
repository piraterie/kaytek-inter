-- ================================================================
-- MIGRATION : Phase 3 audit notifications — NOTIF-01, NOTIF-03, NOTIF-05
-- Date      : 2026-07-11
-- ================================================================

-- ----------------------------------------------------------------
-- NOTIF-01 : la policy INSERT de notifications ne vérifiait jamais
-- que le destinataire (user_id) appartient réellement à l'organisation
-- de la ligne — n'importe quel utilisateur authentifié pouvait
-- fabriquer une notification (et donc un vrai push via
-- trg_push_on_notification) vers n'importe quel autre membre de son
-- organisation, y compris l'admin.
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "notif_insert" ON public.notifications;
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = notifications.user_id
        AND p.organisation_id = notifications.organisation_id
        AND p.actif = true
    )
  );

-- ----------------------------------------------------------------
-- NOTIF-03 : reprogrammer une intervention (date_prevue) ne remettait
-- jamais à NULL les marqueurs anti-doublon des rappels — un rappel déjà
-- envoyé pour l'ancien horaire ne repartait jamais pour le nouveau.
-- Trigger BEFORE UPDATE : fonctionne quelle que soit l'origine de la
-- modification (frontend, API directe, future Edge Function).
-- ----------------------------------------------------------------

-- Documente les 3 colonnes (dérive de configuration préexistante,
-- jamais versionnée dans aucune migration — purement documentaire,
-- confirmées déjà présentes en base avant cette migration).
ALTER TABLE public.interventions ADD COLUMN IF NOT EXISTS rappel_24h_envoye_at   timestamptz;
ALTER TABLE public.interventions ADD COLUMN IF NOT EXISTS rappel_2h_envoye_at    timestamptz;
ALTER TABLE public.interventions ADD COLUMN IF NOT EXISTS rappel_30min_envoye_at timestamptz;

CREATE OR REPLACE FUNCTION public.reset_rappels_on_date_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.date_prevue IS DISTINCT FROM OLD.date_prevue THEN
    NEW.rappel_24h_envoye_at   := NULL;
    NEW.rappel_2h_envoye_at    := NULL;
    NEW.rappel_30min_envoye_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reset_rappels_on_date_change ON public.interventions;
CREATE TRIGGER trg_reset_rappels_on_date_change
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_rappels_on_date_change();

-- ----------------------------------------------------------------
-- NOTIF-05 : resetUserDevices (déclenché par un admin sur le compte d'un
-- autre utilisateur de son organisation) doit pouvoir supprimer les
-- push_subscriptions de CE user. push_sub_delete reste volontairement
-- self-only (inchangé) : une anomalie RLS reproductible et non résolue a
-- été constatée en testant en direct un ajout "OR is_admin_in_org(...)"
-- sur cette policy précise — identique en tout point au pattern
-- devices_delete (qui, lui, fonctionne correctement, vérifié en HTTP réel)
-- mais qui ne laissait mystérieusement jamais un admin supprimer la ligne
-- d'un autre utilisateur ici, malgré is_admin_in_org() renvoyant bien
-- `true` en conditions réelles (vérifié via RPC). Plutôt que de laisser
-- une policy dont le comportement réel diverge de l'intention affichée,
-- la révocation admin passe par une RPC SECURITY DEFINER dédiée, qui fait
-- sa propre vérification et contourne entièrement la question.
-- push_sub_delete revient explicitement à sa forme self-only d'origine
-- (retire la clause is_admin_in_org ajoutée puis constatée inopérante).
DROP POLICY IF EXISTS "push_sub_delete" ON public.push_subscriptions;
CREATE POLICY "push_sub_delete" ON public.push_subscriptions
  FOR DELETE USING (is_same_org(organisation_id) AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.admin_delete_user_push_subscriptions(target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller_org uuid;
  target_org uuid;
  deleted_count integer;
BEGIN
  SELECT organisation_id INTO caller_org FROM public.profiles WHERE id = auth.uid();
  IF caller_org IS NULL OR NOT public.is_admin_in_org(caller_org) THEN
    RAISE EXCEPTION 'Accès refusé : rôle admin requis';
  END IF;

  SELECT organisation_id INTO target_org FROM public.profiles WHERE id = target_user_id;
  IF target_org IS NULL OR target_org <> caller_org THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable dans votre organisation';
  END IF;

  DELETE FROM public.push_subscriptions WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_push_subscriptions(uuid) TO authenticated;
