-- ================================================================
-- MIGRATION : Nettoyage en cascade des notifications orphelines
-- Date      : 2026-07-13
-- Contexte  : Quand une intervention ou un devis est supprimé, les
--             notifications qui y font référence (via `lien`) restent
--             en base indéfiniment. Comme la policy RLS "notif_delete"
--             restreint la suppression à `user_id = auth.uid()`, le
--             client ne peut pas nettoyer les notifications des AUTRES
--             utilisateurs de l'org (ex : les autres admins notifiés
--             d'un même devis). Un trigger SECURITY DEFINER est donc
--             nécessaire pour supprimer ces lignes quel que soit leur
--             propriétaire, immédiatement et de façon fiable (y compris
--             sur suppression en cascade via FK).
-- Impact    :
--   · REPLICA IDENTITY FULL sur notifications (requis pour que les
--     events Realtime DELETE/UPDATE filtrés par user_id fonctionnent
--     côté client — cf. useMyNotifications)
--   · Ajout de notifications à la publication supabase_realtime si absente
--   · 2 fonctions trigger SECURITY DEFINER + 2 triggers AFTER DELETE
--     (interventions, devis)
--   · Nettoyage rétroactif ponctuel des notifications déjà orphelines
--   · Aucune policy RLS modifiée, aucune permission de rôle modifiée
-- ================================================================


-- ── 1. Realtime : garantir que les events DELETE/UPDATE sont livrables ──
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;


-- ── 2. Trigger : suppression d'une intervention → notifications liées ──
--    lien exact "/interventions/{id}" (cf. notifyUser/notifyAdmins dans
--    useCreateIntervention / useUpdateIntervention)
CREATE OR REPLACE FUNCTION public.cleanup_notifications_on_intervention_delete()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE organisation_id = OLD.organisation_id
    AND lien = '/interventions/' || OLD.id::text;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.cleanup_notifications_on_intervention_delete() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_cleanup_notif_intervention_delete ON public.interventions;
CREATE TRIGGER trg_cleanup_notif_intervention_delete
AFTER DELETE ON public.interventions
FOR EACH ROW EXECUTE FUNCTION public.cleanup_notifications_on_intervention_delete();


-- ── 3. Trigger : suppression d'un devis → notifications liées ──────────
--    lien préfixé "/devis/{id}" (cf. notifyUser dans DevisPage /
--    DevisApercuPage — validation, refus, signature)
CREATE OR REPLACE FUNCTION public.cleanup_notifications_on_devis_delete()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE organisation_id = OLD.organisation_id
    AND lien LIKE '/devis/' || OLD.id::text || '%';
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.cleanup_notifications_on_devis_delete() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_cleanup_notif_devis_delete ON public.devis;
CREATE TRIGGER trg_cleanup_notif_devis_delete
AFTER DELETE ON public.devis
FOR EACH ROW EXECUTE FUNCTION public.cleanup_notifications_on_devis_delete();


-- ── 4. Nettoyage rétroactif : notifications déjà orphelines aujourd'hui ──
--    (résout immédiatement le cas signalé : compteur figé sur des devis
--    déjà supprimés avant cette migration)
DELETE FROM public.notifications n
WHERE n.lien ~ '^/interventions/[0-9a-fA-F-]{36}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.interventions i
    WHERE '/interventions/' || i.id::text = n.lien
  );

DELETE FROM public.notifications n
WHERE n.lien ~ '^/devis/[0-9a-fA-F-]{36}'
  AND NOT EXISTS (
    SELECT 1 FROM public.devis d
    WHERE n.lien LIKE '/devis/' || d.id::text || '%'
  );


-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT trigger_name, event_object_table, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_name IN ('trg_cleanup_notif_intervention_delete', 'trg_cleanup_notif_devis_delete');
-- Attendu : 2 lignes, AFTER DELETE, sur interventions et devis

SELECT relreplident FROM pg_class WHERE oid = 'public.notifications'::regclass;
-- Attendu : 'f' (FULL)
