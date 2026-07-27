


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "storage";


ALTER SCHEMA "storage" OWNER TO "supabase_admin";


CREATE TYPE "storage"."buckettype" AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE "storage"."buckettype" OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_commission"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pct  NUMERIC;
  v_part NUMERIC;
  v_comm NUMERIC;
BEGIN
  IF NEW.statut      = 'termine'
     AND OLD.statut <> 'termine'
     AND NEW.montant_ttc    IS NOT NULL
     AND NEW.intervenant_id IS NOT NULL
  THEN
    SELECT commission_pct INTO v_pct
    FROM public.profiles
    WHERE id = NEW.intervenant_id;

    v_pct  := COALESCE(v_pct, 30);
    v_comm := ROUND(NEW.montant_ttc * v_pct / 100, 2);
    v_part := NEW.montant_ttc - v_comm;

    INSERT INTO public.commissions (
      intervention_id,
      intervenant_id,
      montant_total_client,
      commission_pct,
      part_intervenant,
      commission_admin,
      statut,
      organisation_id
    )
    SELECT
      NEW.id,
      NEW.intervenant_id,
      NEW.montant_ttc,
      v_pct,
      v_part,
      v_comm,
      'a_payer',
      NEW.organisation_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commissions WHERE intervention_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_commission"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_operations"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.is_admin_in_org(org_id) OR public.is_assistant_in_org(org_id)
$$;


ALTER FUNCTION "public"."can_manage_operations"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_founder_seat"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  claimed boolean := false;
begin
  update public.founder_seats
    set taken = taken + 1
    where id = true and taken < max
    returning true into claimed;
  return coalesce(claimed, false);
end;
$$;


ALTER FUNCTION "public"."claim_founder_seat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_notifications_on_devis_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE organisation_id = OLD.organisation_id
    AND lien LIKE '/devis/' || OLD.id::text || '%';
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_notifications_on_devis_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_notifications_on_intervention_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE organisation_id = OLD.organisation_id
    AND lien = '/interventions/' || OLD.id::text;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_notifications_on_intervention_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT organisation_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;


ALTER FUNCTION "public"."current_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_numero_devis"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_annee TEXT;
  v_seq   INTEGER;
BEGIN
  v_annee := TO_CHAR(NOW(), 'YYYY');
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.devis
  WHERE TO_CHAR(created_at, 'YYYY') = v_annee;
  NEW.numero := 'DEV-' || v_annee || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."gen_numero_devis"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_numero_facture"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'FAC-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('factures_numero_lock'));

    SELECT COALESCE(
      MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
      0
    )
    INTO maxn
    FROM public.factures
    WHERE numero ~ ('^' || prefix || '[0-9]+$');

    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."gen_numero_facture"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_numero_intervention"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  yr     TEXT    := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT    := 'INT-' || yr || '-';
  maxn   INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('int_numero_lock'));

  SELECT COALESCE(
    MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)),
    0
  )
  INTO maxn
  FROM public.interventions
  WHERE numero ~ ('^' || prefix || '[0-9]+$');

  NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."gen_numero_intervention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_devis_numero"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'DEV-' || EXTRACT(YEAR FROM NOW())::TEXT || '-'
               || LPAD(nextval('devis_numero_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_devis_numero"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_partner_code"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."generate_partner_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_internal_push_secret"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_push_secret' LIMIT 1
$$;


ALTER FUNCTION "public"."get_internal_push_secret"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_organisation_subscription_status"() RETURNS TABLE("subscription_status" "text", "trial_ends_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT s.subscription_status, s.trial_ends_at
  FROM public.subscriptions s
  JOIN public.profiles p ON p.organisation_id = s.organisation_id
  WHERE p.id = auth.uid()
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_my_organisation_subscription_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_partner_requests_preview"("p_status" "text" DEFAULT 'pending'::"text") RETURNS TABLE("id" "uuid", "connection_id" "uuid", "source_organisation_id" "uuid", "type_intervention" "text", "urgence" boolean, "date_souhaitee" timestamp with time zone, "ville" "text", "description_partagee" "text", "montant_partage" numeric, "status" "text", "note_refus" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
$$;


ALTER FUNCTION "public"."get_partner_requests_preview"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), 'anonymous');
$$;


ALTER FUNCTION "public"."get_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guide_news_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guide_news_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guide_videos_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guide_videos_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  requested_role text;
  safe_role text;
  requested_org_text text;
  target_org_id uuid;
BEGIN
  requested_role := NEW.raw_user_meta_data->>'role';
  IF requested_role IN ('intervenant', 'assistant') THEN
    safe_role := requested_role;
  ELSE
    safe_role := 'intervenant';
  END IF;

  requested_org_text := NEW.raw_user_meta_data->>'organisation_id';
  target_org_id := NULL;

  IF requested_org_text IS NOT NULL THEN
    BEGIN
      target_org_id := requested_org_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      target_org_id := NULL;
    END;
  END IF;

  IF target_org_id IS NOT NULL THEN
    SELECT id INTO target_org_id
    FROM public.organisations
    WHERE id = target_org_id
    LIMIT 1;
  END IF;

  -- No valid organisation_id in metadata: do not create a profile at all,
  -- and never fall back to any default organisation (e.g. kaytek-inter).
  IF target_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom',    ''),
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    safe_role,
    target_org_id
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_partner_relation"("org_a" "uuid", "org_b" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections c
    WHERE (c.requester_organisation_id = org_a AND c.target_organisation_id = org_b)
       OR (c.requester_organisation_id = org_b AND c.target_organisation_id = org_a)
  )
$$;


ALTER FUNCTION "public"."has_partner_relation"("org_a" "uuid", "org_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' AND actif = true FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    false
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_in_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT role = 'admin' AND actif = true
      FROM public.profiles
      WHERE id              = auth.uid()
        AND organisation_id = org_id
      LIMIT 1
    ),
    false
  )
$$;


ALTER FUNCTION "public"."is_admin_in_org"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assistant_in_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT role = 'assistant' AND actif = true
      FROM public.profiles
      WHERE id = auth.uid() AND organisation_id = org_id
      LIMIT 1
    ),
    false
  )
$$;


ALTER FUNCTION "public"."is_assistant_in_org"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_connection_accepted"("conn_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections WHERE id = conn_id AND status = 'accepted'
  )
$$;


ALTER FUNCTION "public"."is_connection_accepted"("conn_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_connection_member"("conn_id" "uuid", "org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_connections c
    WHERE c.id = conn_id
      AND org_id IN (c.requester_organisation_id, c.target_organisation_id)
  )
$$;


ALTER FUNCTION "public"."is_connection_member"("conn_id" "uuid", "org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_intervenant_in_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."is_intervenant_in_org"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_partner_org"("org_a" "uuid", "org_b" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."is_partner_org"("org_a" "uuid", "org_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_same_org"("row_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id              = auth.uid()
      AND organisation_id = row_org_id
  )
$$;


ALTER FUNCTION "public"."is_same_org"("row_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_activite"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid UUID;
  v_nom TEXT;
  v_act TEXT;
  v_org UUID;
BEGIN
  v_uid := auth.uid();

  SELECT TRIM(COALESCE(prenom,'') || ' ' || COALESCE(nom,''))
  INTO v_nom
  FROM public.profiles
  WHERE id = v_uid;

  IF TG_OP = 'INSERT' THEN
    v_act := 'creation';
    v_org := NEW.organisation_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_act := 'modification';
    v_org := COALESCE(NEW.organisation_id, OLD.organisation_id);
  ELSIF TG_OP = 'DELETE' THEN
    v_act := 'suppression';
    v_org := OLD.organisation_id;
  END IF;

  IF v_org IS NULL THEN
    v_org := (
      SELECT id FROM public.organisations WHERE slug = 'kaytek-inter'
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.journal(user_id,user_nom,action,table_name,record_id,old_value,organisation_id)
    VALUES (v_uid,v_nom,v_act,TG_TABLE_NAME,OLD.id,to_jsonb(OLD),v_org);
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.journal(user_id,user_nom,action,table_name,record_id,new_value,organisation_id)
    VALUES (v_uid,v_nom,v_act,TG_TABLE_NAME,NEW.id,to_jsonb(NEW),v_org);
  ELSE
    INSERT INTO public.journal(user_id,user_nom,action,table_name,record_id,old_value,new_value,organisation_id)
    VALUES (v_uid,v_nom,v_act,TG_TABLE_NAME,NEW.id,to_jsonb(OLD),to_jsonb(NEW),v_org);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."log_activite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_partner_connection_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."log_partner_connection_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_partner_intervention_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."log_partner_intervention_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_on_partner_intervention_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."notify_on_partner_intervention_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."partner_connections_before_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."partner_connections_before_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."partner_intervention_requests_before_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."partner_intervention_requests_before_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."partner_messages_before_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."partner_messages_before_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."partner_profile_exists"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_profiles WHERE organisation_id = org_id)
$$;


ALTER FUNCTION "public"."partner_profile_exists"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."partner_profiles_before_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.organisation_id <> OLD.organisation_id OR NEW.code_partenaire <> OLD.code_partenaire THEN
    RAISE EXCEPTION 'partner_profiles: organisation_id et code_partenaire sont immuables';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."partner_profiles_before_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_belongs_to_org"("profile_id" "uuid", "org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = profile_id AND organisation_id = org_id)
$$;


ALTER FUNCTION "public"."profile_belongs_to_org"("profile_id" "uuid", "org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_profile_sensitive_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_uid uuid;
BEGIN
  -- auth.uid() retourne l'UID JWT même en contexte SECURITY DEFINER.
  -- Si NULL → appel service_role (Edge Functions) ou trigger postgres
  -- (SECURITY DEFINER) → aucune restriction.
  current_uid := auth.uid();

  IF current_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin de l'org concernée → peut modifier tous les champs.
  IF is_admin_in_org(OLD.organisation_id) THEN
    RETURN NEW;
  END IF;

  -- Utilisateur non-admin modifiant son propre profil.
  IF current_uid = OLD.id THEN

    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Champ protégé : "role" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.actif IS DISTINCT FROM OLD.actif THEN
      RAISE EXCEPTION 'Champ protégé : "actif" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION 'Champ protégé : "organisation_id" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
      RAISE EXCEPTION 'Champ protégé : "commission_pct" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.can_create_documents IS DISTINCT FROM OLD.can_create_documents THEN
      RAISE EXCEPTION 'Champ protégé : "can_create_documents" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.can_bypass_validation IS DISTINCT FROM OLD.can_bypass_validation THEN
      RAISE EXCEPTION 'Champ protégé : "can_bypass_validation" ne peut être modifié que par un administrateur';
    END IF;

    IF NEW.type_intervenant IS DISTINCT FROM OLD.type_intervenant THEN
      RAISE EXCEPTION 'Champ protégé : "type_intervenant" ne peut être modifié que par un administrateur';
    END IF;

    RETURN NEW;
  END IF;

  -- Cas résiduel : non-admin tentant de modifier le profil d'autrui.
  -- En théorie bloqué par RLS USING, mais défense en profondeur.
  RAISE EXCEPTION 'Modification de profil non autorisée';
END;
$$;


ALTER FUNCTION "public"."protect_profile_sensitive_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_subscriber_organisation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email        text;
  v_entreprise   text;
  v_nom          text;
  v_prenom       text;
  v_org_plan     text;
  v_slug         text;
  v_org_id       uuid;
BEGIN
  -- Déjà provisionné (rejeu webhook, 2e event) — court-circuit immédiat, aucun doublon possible
  IF NEW.organisation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- On ne provisionne que sur un statut payant/essai valide
  IF NEW.subscription_status NOT IN ('trialing', 'active') THEN
    RETURN NEW;
  END IF;

  -- Un profil existe déjà pour cet utilisateur (compte legacy déjà rattaché
  -- manuellement, ou tout autre cas) — on ne touche jamais à un profil existant
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT
      COALESCE(NEW.email, u.email),
      u.raw_user_meta_data->>'entreprise',
      COALESCE(u.raw_user_meta_data->>'nom', ''),
      COALESCE(u.raw_user_meta_data->>'prenom', '')
    INTO v_email, v_entreprise, v_nom, v_prenom
    FROM auth.users u WHERE u.id = NEW.user_id;

    IF v_email IS NULL THEN
      RAISE WARNING 'provision_subscriber_organisation: email introuvable pour user_id %, provisioning ignoré', NEW.user_id;
      RETURN NEW;
    END IF;

    v_org_plan := CASE WHEN NEW.plan IN ('starter','pro','enterprise') THEN NEW.plan ELSE 'pro' END;
    v_slug := 'client-' || replace(NEW.user_id::text, '-', '');

    INSERT INTO public.organisations (slug, nom, plan, actif)
    VALUES (v_slug, COALESCE(NULLIF(trim(v_entreprise), ''), 'Compte de ' || split_part(v_email, '@', 1)), v_org_plan, true)
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO v_org_id FROM public.organisations WHERE slug = v_slug;

    INSERT INTO public.profiles (id, email, nom, prenom, role, organisation_id, actif)
    VALUES (NEW.user_id, v_email, v_nom, v_prenom, 'admin', v_org_id, true)
    ON CONFLICT (id) DO NOTHING;

    NEW.organisation_id := v_org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'provision_subscriber_organisation: échec pour user_id % (%), provisioning ignoré', NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."provision_subscriber_organisation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_rappels_on_date_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.date_prevue IS DISTINCT FROM OLD.date_prevue THEN
    NEW.rappel_24h_envoye_at   := NULL;
    NEW.rappel_2h_envoye_at    := NULL;
    NEW.rappel_30min_envoye_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."reset_rappels_on_date_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "connection_id" "uuid", "source_organisation_id" "uuid", "target_organisation_id" "uuid", "status" "text", "type_intervention" "text", "urgence" boolean, "date_souhaitee" timestamp with time zone, "ville" "text", "adresse_partagee" "text", "telephone_client_partage" "text", "nom_client_partage" "text", "description_partagee" "text", "consignes_partagees" "text", "montant_partage" numeric, "photos_partagees" "jsonb", "note_refus" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row      public.partner_intervention_requests;
  v_caller_org uuid;
BEGIN
  IF p_response NOT IN ('accepted', 'refused') THEN
    RAISE EXCEPTION 'Réponse invalide : % (attendu accepted ou refused)', p_response;
  END IF;

  v_caller_org := public.current_org_id();
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Organisation introuvable pour l''utilisateur courant';
  END IF;

  IF NOT public.is_admin_in_org(v_caller_org) THEN
    RAISE EXCEPTION 'Seul un administrateur peut répondre à une demande partenaire';
  END IF;

  SELECT * INTO v_row FROM public.partner_intervention_requests r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF v_row.target_organisation_id <> v_caller_org THEN
    RAISE EXCEPTION 'Seule l''organisation destinataire peut répondre à cette demande';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Cette demande n''est plus en attente (statut actuel : %)', v_row.status;
  END IF;

  IF p_response = 'refused' AND (p_note_refus IS NULL OR length(trim(p_note_refus)) = 0) THEN
    RAISE EXCEPTION 'Un motif de refus est requis';
  END IF;

  UPDATE public.partner_intervention_requests r
  SET status = p_response,
      note_refus = CASE WHEN p_response = 'refused' THEN p_note_refus ELSE NULL END
  WHERE r.id = p_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT
    v_row.id, v_row.connection_id, v_row.source_organisation_id, v_row.target_organisation_id,
    v_row.status, v_row.type_intervention, v_row.urgence, v_row.date_souhaitee, v_row.ville,
    CASE WHEN v_row.status = 'accepted' THEN v_row.adresse_partagee ELSE NULL END,
    CASE WHEN v_row.status = 'accepted' THEN v_row.telephone_client_partage ELSE NULL END,
    CASE WHEN v_row.status = 'accepted' THEN v_row.nom_client_partage ELSE NULL END,
    v_row.description_partagee,
    CASE WHEN v_row.status = 'accepted' THEN v_row.consignes_partagees ELSE NULL END,
    v_row.montant_partage,
    CASE WHEN v_row.status = 'accepted' THEN v_row.photos_partagees ELSE NULL END,
    v_row.note_refus, v_row.created_at, v_row.updated_at;
END;
$$;


ALTER FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_partner_profiles"("query" "text") RETURNS TABLE("organisation_id" "uuid", "code_partenaire" "text", "nom_public" "text", "metier" "text", "ville" "text", "bio" "text", "contact_profile_id" "uuid", "connection_status" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."search_partner_profiles"("query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_default_prestations"("p_org_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF NOT public.is_admin_in_org(p_org_id) THEN
    RAISE EXCEPTION 'Accès refusé : rôle admin requis';
  END IF;

  INSERT INTO public.prestations (nom, categorie, prix_conseille, tva_pct, actif, ordre, organisation_id)
  SELECT
    d.nom,
    d.categorie,
    d.prix_conseille::numeric,
    d.tva_pct::integer,
    true,
    d.ordre::integer,
    p_org_id
  FROM (VALUES
    -- ── Serrurerie ────────────────────────────────────────────────
    ('Ouverture porte claquée',           'serrurerie',  '150', '10', '1'),
    ('Ouverture porte verrouillée',       'serrurerie',  '200', '10', '2'),
    ('Changement de cylindre',            'serrurerie',  '120', '10', '3'),
    ('Blindage porte',                    'serrurerie',  '800', '10', '4'),
    ('Réparation gâche électrique',       'serrurerie',  '180', '10', '5'),
    ('Remplacement serrure 3 points',     'serrurerie',  '350', '10', '6'),
    -- ── Plomberie ─────────────────────────────────────────────────
    ('Recherche de fuite',                'plomberie',   '150', '10', '1'),
    ('Débouchage canalisation',           'plomberie',   '200', '10', '2'),
    ('Remplacement robinet',              'plomberie',   '180', '10', '3'),
    ('Remplacement siphon',               'plomberie',   '100', '10', '4'),
    ('Réparation chasse d''eau',          'plomberie',   '120', '10', '5'),
    ('Remplacement chauffe-eau',          'plomberie',   '900', '10', '6'),
    -- ── Électricité ───────────────────────────────────────────────
    ('Recherche de panne électrique',     'electricite', '150', '10', '1'),
    ('Remplacement disjoncteur',          'electricite', '180', '10', '2'),
    ('Remplacement prise',                'electricite',  '80', '10', '3'),
    ('Remplacement interrupteur',         'electricite',  '80', '10', '4'),
    ('Mise en sécurité tableau',          'electricite', '300', '10', '5'),
    ('Installation luminaire',            'electricite', '150', '10', '6'),
    -- ── Vitrerie ──────────────────────────────────────────────────
    ('Remplacement vitre simple',         'vitrerie',    '200', '10', '1'),
    ('Remplacement double vitrage',       'vitrerie',    '450', '10', '2'),
    ('Mise en sécurité vitrine',          'vitrerie',    '300', '10', '3'),
    ('Pose panneau provisoire',           'vitrerie',    '120', '10', '4'),
    ('Remplacement miroir',               'vitrerie',    '250', '10', '5'),
    ('Réparation fermeture baie vitrée',  'vitrerie',    '350', '10', '6'),
    -- ── Chauffagiste ──────────────────────────────────────────────
    ('Dépannage chaudière',               'chauffagiste','120', '10', '1'),
    ('Entretien chaudière',               'chauffagiste','100', '10', '2'),
    ('Remplacement thermostat',           'chauffagiste','140', '10', '3'),
    ('Purge radiateur',                   'chauffagiste', '80', '10', '4'),
    ('Réparation radiateur',              'chauffagiste','130', '10', '5'),
    ('Recherche panne chauffage',         'chauffagiste','120', '10', '6'),
    ('Remplacement circulateur',          'chauffagiste','220', '10', '7'),
    ('Désembouage circuit chauffage',     'chauffagiste','350', '10', '8'),
    ('Remplacement robinet thermostatique','chauffagiste', '90', '10', '9'),
    ('Mise en service chauffage',         'chauffagiste','150', '10', '10')
  ) AS d(nom, categorie, prix_conseille, tva_pct, ordre)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prestations p
    WHERE p.nom             = d.nom
      AND p.categorie       = d.categorie
      AND p.organisation_id = p_org_id
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;


ALTER FUNCTION "public"."seed_default_prestations"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_default_prestations_on_org_create"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.seed_default_prestations(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_default_prestations_on_org_create: seeding ignoré pour org % (%)', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."seed_default_prestations_on_org_create"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_push_on_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trigger_push_on_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uuid_pair_key"("a" "uuid", "b" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE WHEN a < b THEN a::text || '_' || b::text ELSE b::text || '_' || a::text END
$$;


ALTER FUNCTION "public"."uuid_pair_key"("a" "uuid", "b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."allow_only_operation"("expected_operation" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION "storage"."allow_only_operation"("expected_operation" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."enforce_bucket_name_length"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION "storage"."enforce_bucket_name_length"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."extension"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION "storage"."extension"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."filename"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


ALTER FUNCTION "storage"."filename"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."foldername"("name" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION "storage"."foldername"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_size_by_bucket"() RETURNS TABLE("size" bigint, "bucket_id" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION "storage"."get_size_by_bucket"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "next_key_token" "text" DEFAULT ''::"text", "next_upload_token" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "id" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "next_key_token" "text", "next_upload_token" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "start_after" "text" DEFAULT ''::"text", "next_token" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "metadata" "jsonb", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "start_after" "text", "next_token" "text", "sort_order" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."operation"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION "storage"."operation"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."protect_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "storage"."protect_delete"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "offsets" integer DEFAULT 0, "search" "text" DEFAULT ''::"text", "sortcolumn" "text" DEFAULT 'name'::"text", "sortorder" "text" DEFAULT 'asc'::"text") RETURNS TABLE("name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer, "levels" integer, "offsets" integer, "search" "text", "sortcolumn" "text", "sortorder" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "start_after" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text", "sort_column" "text" DEFAULT 'name'::"text", "sort_column_after" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb")
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer, "levels" integer, "start_after" "text", "sort_order" "text", "sort_column" "text", "sort_column_after" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION "storage"."update_updated_at_column"() OWNER TO "supabase_storage_admin";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" DEFAULT 'particulier'::"text",
    "nom" "text" NOT NULL,
    "prenom" "text",
    "raison_sociale" "text",
    "telephone" "text",
    "telephone_2" "text",
    "email" "text",
    "adresse_intervention" "text",
    "cp_intervention" "text",
    "ville_intervention" "text",
    "adresse_facturation" "text",
    "cp_facturation" "text",
    "ville_facturation" "text",
    "notes_internes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive" boolean DEFAULT false NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "clients_type_check" CHECK (("type" = ANY (ARRAY['particulier'::"text", 'professionnel'::"text", 'syndic'::"text", 'autre'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "facture_id" "uuid" NOT NULL,
    "intervention_id" "uuid" NOT NULL,
    "intervenant_id" "uuid" NOT NULL,
    "recue" boolean DEFAULT false NOT NULL,
    "recue_le" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL
);


ALTER TABLE "public"."commission_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "intervention_id" "uuid" NOT NULL,
    "facture_id" "uuid",
    "intervenant_id" "uuid" NOT NULL,
    "montant_total_client" numeric(10,2) NOT NULL,
    "commission_pct" numeric(5,2) NOT NULL,
    "part_intervenant" numeric(10,2) NOT NULL,
    "commission_admin" numeric(10,2) NOT NULL,
    "statut" "text" DEFAULT 'a_payer'::"text" NOT NULL,
    "paye_le" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "commissions_statut_check" CHECK (("statut" = ANY (ARRAY['a_payer'::"text", 'paye'::"text"])))
);


ALTER TABLE "public"."commissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "nom_appareil" "text",
    "navigateur" "text",
    "systeme_exploitation" "text",
    "adresse_ip" "text",
    "date_premiere_connexion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "date_derniere_connexion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actif" boolean DEFAULT true NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "device_fingerprint" "text"
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devis" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "numero" "text",
    "client_id" "uuid",
    "intervenant_id" "uuid",
    "intervention_id" "uuid",
    "activite" "text",
    "statut" "text" DEFAULT 'brouillon'::"text" NOT NULL,
    "lignes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "remise_pct" numeric(5,2) DEFAULT 0,
    "remise_montant" numeric(10,2) DEFAULT 0,
    "total_ht" numeric(10,2) DEFAULT 0,
    "tva_montant" numeric(10,2) DEFAULT 0,
    "total_ttc" numeric(10,2) DEFAULT 0,
    "modele_id" integer DEFAULT 0,
    "signature_url" "text",
    "signe_le" timestamp with time zone,
    "signe_par" "text",
    "valide_jusqu_au" "date",
    "envoye_le" timestamp with time zone,
    "notes" "text",
    "pdf_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signature_client" "text",
    "signature_date" timestamp with time zone,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "devis_activite_check" CHECK (("activite" = ANY (ARRAY['serrurerie'::"text", 'vitrerie'::"text", 'plomberie'::"text", 'electricite'::"text", 'chauffagiste'::"text"]))),
    CONSTRAINT "devis_statut_check" CHECK (("statut" = ANY (ARRAY['en_attente_validation'::"text", 'brouillon'::"text", 'envoye'::"text", 'accepte'::"text", 'refuse'::"text", 'expire'::"text"])))
);


ALTER TABLE "public"."devis" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."devis_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."devis_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_public_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "document_type" "text" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_public_links_document_type_check" CHECK (("document_type" = ANY (ARRAY['devis'::"text", 'facture'::"text"])))
);


ALTER TABLE "public"."document_public_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."factures" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "numero" "text",
    "devis_id" "uuid",
    "intervention_id" "uuid",
    "client_id" "uuid",
    "statut_paiement" "text" DEFAULT 'impayee'::"text" NOT NULL,
    "mode_paiement" "text",
    "montant_ht" numeric(10,2) DEFAULT 0,
    "tva_montant" numeric(10,2) DEFAULT 0,
    "montant_ttc" numeric(10,2) DEFAULT 0,
    "acompte_recu" numeric(10,2) DEFAULT 0,
    "date_emission" "date" DEFAULT CURRENT_DATE NOT NULL,
    "date_echeance" "date",
    "date_paiement" timestamp with time zone,
    "relance_1_le" timestamp with time zone,
    "relance_2_le" timestamp with time zone,
    "notes" "text",
    "pdf_url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "factures_mode_paiement_check" CHECK (("mode_paiement" = ANY (ARRAY['cb'::"text", 'especes'::"text", 'virement'::"text", 'cheque'::"text"]))),
    CONSTRAINT "factures_statut_paiement_check" CHECK (("statut_paiement" = ANY (ARRAY['en_attente_validation'::"text", 'impayee'::"text", 'payee'::"text", 'acompte'::"text", 'partiel'::"text", 'annulee'::"text"])))
);


ALTER TABLE "public"."factures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."founder_seats" (
    "id" boolean DEFAULT true NOT NULL,
    "taken" integer DEFAULT 0 NOT NULL,
    "max" integer DEFAULT 50 NOT NULL,
    CONSTRAINT "founder_seats_singleton" CHECK ("id")
);


ALTER TABLE "public"."founder_seats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guide_news" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "titre" "text" NOT NULL,
    "description" "text" NOT NULL,
    "date_publication" "date" DEFAULT CURRENT_DATE NOT NULL,
    "visible_admin" boolean DEFAULT true NOT NULL,
    "visible_intervenant" boolean DEFAULT true NOT NULL,
    "actif" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."guide_news" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guide_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "section_slug" "text" NOT NULL,
    "role" "text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guide_progress_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'intervenant'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."guide_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guide_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "role" "text" NOT NULL,
    "section_slug" "text" NOT NULL,
    "titre" "text" NOT NULL,
    "description" "text",
    "duree_secondes" integer,
    "storage_path" "text" NOT NULL,
    "ordre" integer DEFAULT 0 NOT NULL,
    "actif" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "guide_videos_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'intervenant'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."guide_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interventions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "numero" "text",
    "client_id" "uuid",
    "intervenant_id" "uuid",
    "type" "text",
    "statut" "text" DEFAULT 'en_attente'::"text" NOT NULL,
    "urgence" boolean DEFAULT false,
    "adresse" "text",
    "code_postal" "text",
    "ville" "text",
    "etage" "text",
    "code_acces" "text",
    "date_prevue" timestamp with time zone,
    "date_debut" timestamp with time zone,
    "date_fin" timestamp with time zone,
    "description" "text",
    "travail_realise" "text",
    "materiel_utilise" "text",
    "temps_passe_min" integer,
    "montant_ht" numeric(10,2),
    "tva_pct" numeric(5,2) DEFAULT 10.00,
    "montant_ttc" numeric(10,2),
    "notes_admin" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive" boolean DEFAULT false NOT NULL,
    "cout_pieces" numeric DEFAULT 0,
    "materiel_payeur" "text",
    "materiel_confirme" boolean DEFAULT false,
    "materiel_confirme_par" "uuid",
    "materiel_confirme_at" timestamp with time zone,
    "organisation_id" "uuid" NOT NULL,
    "rappel_24h_envoye_at" timestamp with time zone,
    "rappel_2h_envoye_at" timestamp with time zone,
    "rappel_30min_envoye_at" timestamp with time zone,
    CONSTRAINT "interventions_materiel_payeur_check" CHECK (("materiel_payeur" = ANY (ARRAY['admin'::"text", 'intervenant'::"text"]))),
    CONSTRAINT "interventions_statut_check" CHECK (("statut" = ANY (ARRAY['en_attente'::"text", 'accepte'::"text", 'refuse'::"text", 'en_cours'::"text", 'termine'::"text", 'annule'::"text", 'facture'::"text"]))),
    CONSTRAINT "interventions_type_check" CHECK (("type" = ANY (ARRAY['serrurerie'::"text", 'vitrerie'::"text", 'plomberie'::"text", 'electricite'::"text", 'chauffagiste'::"text"])))
);

ALTER TABLE ONLY "public"."interventions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."interventions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journal" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "user_nom" "text",
    "action" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid",
    "description" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL
);


ALTER TABLE "public"."journal" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "expediteur_id" "uuid" NOT NULL,
    "destinataire_id" "uuid" NOT NULL,
    "intervention_id" "uuid",
    "contenu" "text" NOT NULL,
    "type" "text" DEFAULT 'texte'::"text",
    "metadata" "jsonb",
    "lu" boolean DEFAULT false,
    "lu_le" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "media_url" "text",
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "messages_type_check" CHECK (("type" = ANY (ARRAY['texte'::"text", 'photo'::"text", 'audio'::"text", 'vocal'::"text", 'devis'::"text", 'facture'::"text", 'intervention'::"text"])))
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "titre" "text" NOT NULL,
    "contenu" "text",
    "type" "text" DEFAULT 'info'::"text",
    "lue" boolean DEFAULT false,
    "lue_le" timestamp with time zone,
    "lien" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lu_le" timestamp with time zone,
    "skip_push" boolean DEFAULT false,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['info'::"text", 'succes'::"text", 'alerte'::"text", 'erreur'::"text"])))
);

ALTER TABLE ONLY "public"."notifications" REPLICA IDENTITY FULL;


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organisations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "nom" "text" NOT NULL,
    "plan" "text" DEFAULT 'pro'::"text" NOT NULL,
    "actif" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organisations_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."organisations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parametres_entreprise" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "raison_sociale" "text" DEFAULT 'Kaytek Serrurerie'::"text" NOT NULL,
    "logo_url" "text",
    "telephone" "text",
    "email" "text",
    "site_web" "text",
    "adresse" "text",
    "code_postal" "text",
    "ville" "text",
    "siret" "text",
    "numero_tva" "text",
    "iban" "text",
    "bic" "text",
    "rc_pro" "text",
    "assurance_decennale" "text",
    "tva_defaut" numeric(5,2) DEFAULT 10.00,
    "couleur_principale" "text" DEFAULT '#2563eb'::"text",
    "couleur_secondaire" "text" DEFAULT '#1e40af'::"text",
    "cgv" "text",
    "mentions_legales" "text",
    "signature_dirigeant_url" "text",
    "modele_pdf_defaut" integer DEFAULT 0,
    "email_envoi_devis" boolean DEFAULT true,
    "email_relance_facture" boolean DEFAULT true,
    "email_paiement_recu" boolean DEFAULT true,
    "email_new_intervention" boolean DEFAULT true,
    "email_commission" boolean DEFAULT false,
    "delai_relance_1" integer DEFAULT 15,
    "delai_relance_2" integer DEFAULT 30,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL
);


ALTER TABLE "public"."parametres_entreprise" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."parametres_entreprise_public" AS
 SELECT "id",
    "organisation_id",
    "raison_sociale",
    "logo_url",
    "telephone",
    "email",
    "site_web",
    "adresse",
    "code_postal",
    "ville",
    "siret",
    "numero_tva",
    "rc_pro",
    "assurance_decennale",
    "tva_defaut",
    "couleur_principale",
    "couleur_secondaire",
    "cgv",
    "mentions_legales",
    "signature_dirigeant_url",
    "modele_pdf_defaut",
    "email_envoi_devis",
    "email_relance_facture",
    "email_paiement_recu",
    "email_new_intervention",
    "email_commission",
    "delai_relance_1",
    "delai_relance_2",
    "updated_at"
   FROM "public"."parametres_entreprise"
  WHERE ("organisation_id" = "public"."current_org_id"());


ALTER VIEW "public"."parametres_entreprise_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_connection_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "actor_profile_id" "uuid",
    "actor_organisation_id" "uuid",
    "action" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."partner_connection_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_organisation_id" "uuid" NOT NULL,
    "requester_profile_id" "uuid" NOT NULL,
    "target_organisation_id" "uuid" NOT NULL,
    "target_profile_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "blocked_by_organisation_id" "uuid",
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "partner_connections_no_self" CHECK (("requester_organisation_id" <> "target_organisation_id")),
    CONSTRAINT "partner_connections_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'refused'::"text", 'blocked'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."partner_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_intervention_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "actor_profile_id" "uuid",
    "actor_organisation_id" "uuid",
    "action" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."partner_intervention_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_intervention_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "source_organisation_id" "uuid" NOT NULL,
    "source_profile_id" "uuid" NOT NULL,
    "target_organisation_id" "uuid" NOT NULL,
    "target_profile_id" "uuid",
    "source_intervention_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "type_intervention" "text",
    "urgence" boolean DEFAULT false NOT NULL,
    "date_souhaitee" timestamp with time zone,
    "ville" "text",
    "adresse_partagee" "text",
    "telephone_client_partage" "text",
    "nom_client_partage" "text",
    "description_partagee" "text",
    "consignes_partagees" "text",
    "montant_partage" numeric,
    "photos_partagees" "jsonb",
    "share_adresse" boolean DEFAULT false NOT NULL,
    "share_telephone" boolean DEFAULT false NOT NULL,
    "share_nom_client" boolean DEFAULT false NOT NULL,
    "share_description" boolean DEFAULT false NOT NULL,
    "share_montant" boolean DEFAULT false NOT NULL,
    "share_photos" boolean DEFAULT false NOT NULL,
    "note_refus" "text",
    "compte_rendu" "text",
    "resulting_intervention_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "partner_intervention_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'refused'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "pir_no_self" CHECK (("source_organisation_id" <> "target_organisation_id")),
    CONSTRAINT "pir_share_consistency" CHECK ((("share_adresse" OR ("adresse_partagee" IS NULL)) AND ("share_telephone" OR ("telephone_client_partage" IS NULL)) AND ("share_nom_client" OR ("nom_client_partage" IS NULL)) AND ("share_description" OR ("description_partagee" IS NULL)) AND ("share_montant" OR ("montant_partage" IS NULL)) AND ("share_photos" OR ("photos_partagees" IS NULL))))
);


ALTER TABLE "public"."partner_intervention_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "sender_profile_id" "uuid" NOT NULL,
    "sender_organisation_id" "uuid" NOT NULL,
    "contenu" "text" NOT NULL,
    "intervention_request_id" "uuid",
    "lu_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "partner_messages_contenu_not_empty" CHECK (("length"(TRIM(BOTH FROM "contenu")) > 0))
);

ALTER TABLE ONLY "public"."partner_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."partner_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partner_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "created_by_profile_id" "uuid",
    "code_partenaire" "text" DEFAULT "public"."generate_partner_code"() NOT NULL,
    "nom_public" "text" NOT NULL,
    "metier" "text",
    "ville" "text",
    "bio" "text",
    "visible_reseau" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."partner_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "intervention_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "type" "text",
    "taille_octets" bigint,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "photos_type_check" CHECK (("type" = ANY (ARRAY['avant'::"text", 'apres'::"text", 'autre'::"text"])))
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prestations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "nom" "text" NOT NULL,
    "categorie" "text" NOT NULL,
    "sous_categorie" "text",
    "description" "text",
    "prix_min" numeric(10,2),
    "prix_conseille" numeric(10,2),
    "prix_urgence" numeric(10,2),
    "tva_pct" numeric(5,2) DEFAULT 10.00,
    "unite" "text" DEFAULT 'forfait'::"text",
    "actif" boolean DEFAULT true,
    "ordre" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    CONSTRAINT "prestations_categorie_check" CHECK (("categorie" = ANY (ARRAY['serrurerie'::"text", 'vitrerie'::"text", 'plomberie'::"text", 'electricite'::"text", 'chauffagiste'::"text"])))
);


ALTER TABLE "public"."prestations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'intervenant'::"text" NOT NULL,
    "nom" "text" DEFAULT ''::"text" NOT NULL,
    "prenom" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "telephone" "text",
    "commission_pct" numeric(5,2) DEFAULT 30.00 NOT NULL,
    "actif" boolean DEFAULT true NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type_intervenant" "text",
    "can_create_documents" boolean DEFAULT false,
    "can_bypass_validation" boolean DEFAULT false NOT NULL,
    "telegram_chat_id" "text",
    "telegram_notifications_enabled" boolean DEFAULT true NOT NULL,
    "organisation_id" "uuid" NOT NULL,
    "welcome_dismissed" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'intervenant'::"text", 'assistant'::"text"]))),
    CONSTRAINT "profiles_type_intervenant_check" CHECK ((("type_intervenant" IS NULL) OR ("type_intervenant" = ANY (ARRAY['entrepreneur'::"text", 'salarie'::"text"]))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organisation_id" "uuid" NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "plan" "text",
    "subscription_status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "is_founder" boolean DEFAULT false NOT NULL,
    "extra_users" integer DEFAULT 0 NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organisation_id" "uuid",
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'pro'::"text", 'founder'::"text"]))),
    CONSTRAINT "subscriptions_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "storage"."buckets" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "public" boolean DEFAULT false,
    "avif_autodetection" boolean DEFAULT false,
    "file_size_limit" bigint,
    "allowed_mime_types" "text"[],
    "owner_id" "text",
    "type" "storage"."buckettype" DEFAULT 'STANDARD'::"storage"."buckettype" NOT NULL
);


ALTER TABLE "storage"."buckets" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."buckets"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."buckets_analytics" (
    "name" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'ANALYTICS'::"storage"."buckettype" NOT NULL,
    "format" "text" DEFAULT 'ICEBERG'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "storage"."buckets_analytics" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."buckets_vectors" (
    "id" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'VECTOR'::"storage"."buckettype" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."buckets_vectors" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."migrations" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "hash" character varying(40) NOT NULL,
    "executed_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "storage"."migrations" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text",
    "name" "text",
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_accessed_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "path_tokens" "text"[] GENERATED ALWAYS AS ("string_to_array"("name", '/'::"text")) STORED,
    "version" "text",
    "owner_id" "text",
    "user_metadata" "jsonb"
);


ALTER TABLE "storage"."objects" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."objects"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads" (
    "id" "text" NOT NULL,
    "in_progress_size" bigint DEFAULT 0 NOT NULL,
    "upload_signature" "text" NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "version" "text" NOT NULL,
    "owner_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_metadata" "jsonb",
    "metadata" "jsonb"
);


ALTER TABLE "storage"."s3_multipart_uploads" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "part_number" integer NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "etag" "text" NOT NULL,
    "owner_id" "text",
    "version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."s3_multipart_uploads_parts" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."vector_indexes" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "bucket_id" "text" NOT NULL,
    "data_type" "text" NOT NULL,
    "dimension" integer NOT NULL,
    "distance_metric" "text" NOT NULL,
    "metadata_configuration" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."vector_indexes" OWNER TO "supabase_storage_admin";


ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_facture_id_intervenant_id_key" UNIQUE ("facture_id", "intervenant_id");



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_user_id_device_id_key" UNIQUE ("user_id", "device_id");



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_public_links"
    ADD CONSTRAINT "document_public_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_public_links"
    ADD CONSTRAINT "document_public_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."founder_seats"
    ADD CONSTRAINT "founder_seats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guide_news"
    ADD CONSTRAINT "guide_news_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guide_progress"
    ADD CONSTRAINT "guide_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guide_progress"
    ADD CONSTRAINT "guide_progress_user_id_section_slug_key" UNIQUE ("user_id", "section_slug");



ALTER TABLE ONLY "public"."guide_videos"
    ADD CONSTRAINT "guide_videos_organisation_id_slug_key" UNIQUE ("organisation_id", "slug");



ALTER TABLE ONLY "public"."guide_videos"
    ADD CONSTRAINT "guide_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal"
    ADD CONSTRAINT "journal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."parametres_entreprise"
    ADD CONSTRAINT "parametres_entreprise_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_connection_events"
    ADD CONSTRAINT "partner_connection_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_intervention_events"
    ADD CONSTRAINT "partner_intervention_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_messages"
    ADD CONSTRAINT "partner_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_profiles"
    ADD CONSTRAINT "partner_profiles_code_partenaire_key" UNIQUE ("code_partenaire");



ALTER TABLE ONLY "public"."partner_profiles"
    ADD CONSTRAINT "partner_profiles_organisation_id_key" UNIQUE ("organisation_id");



ALTER TABLE ONLY "public"."partner_profiles"
    ADD CONSTRAINT "partner_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prestations"
    ADD CONSTRAINT "prestations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "storage"."buckets_analytics"
    ADD CONSTRAINT "buckets_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets"
    ADD CONSTRAINT "buckets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets_vectors"
    ADD CONSTRAINT "buckets_vectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_pkey" PRIMARY KEY ("id");



CREATE INDEX "document_public_links_token_idx" ON "public"."document_public_links" USING "btree" ("token");



CREATE INDEX "idx_clients_email" ON "public"."clients" USING "btree" ("email");



CREATE INDEX "idx_clients_nom" ON "public"."clients" USING "btree" ("nom");



CREATE INDEX "idx_clients_organisation_id" ON "public"."clients" USING "btree" ("organisation_id");



CREATE INDEX "idx_commission_receipts_organisation_id" ON "public"."commission_receipts" USING "btree" ("organisation_id");



CREATE INDEX "idx_commissions_intervenant" ON "public"."commissions" USING "btree" ("intervenant_id");



CREATE INDEX "idx_commissions_organisation_id" ON "public"."commissions" USING "btree" ("organisation_id");



CREATE INDEX "idx_commissions_statut" ON "public"."commissions" USING "btree" ("statut");



CREATE INDEX "idx_devices_organisation_id" ON "public"."devices" USING "btree" ("organisation_id");



CREATE INDEX "idx_devices_user_actif" ON "public"."devices" USING "btree" ("user_id", "actif");



CREATE INDEX "idx_devices_user_fingerprint" ON "public"."devices" USING "btree" ("user_id", "device_fingerprint") WHERE ("device_fingerprint" IS NOT NULL);



CREATE INDEX "idx_devis_client" ON "public"."devis" USING "btree" ("client_id");



CREATE INDEX "idx_devis_created" ON "public"."devis" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_devis_organisation_id" ON "public"."devis" USING "btree" ("organisation_id");



CREATE INDEX "idx_devis_statut" ON "public"."devis" USING "btree" ("statut");



CREATE INDEX "idx_factures_client" ON "public"."factures" USING "btree" ("client_id");



CREATE INDEX "idx_factures_created" ON "public"."factures" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_factures_echeance" ON "public"."factures" USING "btree" ("date_echeance");



CREATE INDEX "idx_factures_organisation_id" ON "public"."factures" USING "btree" ("organisation_id");



CREATE INDEX "idx_factures_statut" ON "public"."factures" USING "btree" ("statut_paiement");



CREATE INDEX "idx_guide_news_date" ON "public"."guide_news" USING "btree" ("organisation_id", "date_publication" DESC);



CREATE INDEX "idx_guide_news_org" ON "public"."guide_news" USING "btree" ("organisation_id");



CREATE INDEX "idx_guide_progress_org" ON "public"."guide_progress" USING "btree" ("organisation_id");



CREATE INDEX "idx_guide_progress_user" ON "public"."guide_progress" USING "btree" ("user_id");



CREATE INDEX "idx_guide_videos_org" ON "public"."guide_videos" USING "btree" ("organisation_id");



CREATE INDEX "idx_guide_videos_role" ON "public"."guide_videos" USING "btree" ("organisation_id", "role");



CREATE INDEX "idx_interventions_client" ON "public"."interventions" USING "btree" ("client_id");



CREATE INDEX "idx_interventions_created" ON "public"."interventions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_interventions_date" ON "public"."interventions" USING "btree" ("date_prevue" DESC);



CREATE INDEX "idx_interventions_date_prevue" ON "public"."interventions" USING "btree" ("date_prevue") WHERE ("date_prevue" IS NOT NULL);



CREATE INDEX "idx_interventions_intervenant" ON "public"."interventions" USING "btree" ("intervenant_id");



CREATE INDEX "idx_interventions_organisation_id" ON "public"."interventions" USING "btree" ("organisation_id");



CREATE INDEX "idx_interventions_statut" ON "public"."interventions" USING "btree" ("statut");



CREATE INDEX "idx_interventions_urgence" ON "public"."interventions" USING "btree" ("urgence") WHERE ("urgence" = true);



CREATE INDEX "idx_journal_created" ON "public"."journal" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_journal_organisation_id" ON "public"."journal" USING "btree" ("organisation_id");



CREATE INDEX "idx_journal_table" ON "public"."journal" USING "btree" ("table_name");



CREATE INDEX "idx_journal_user" ON "public"."journal" USING "btree" ("user_id");



CREATE INDEX "idx_messages_destinataire" ON "public"."messages" USING "btree" ("destinataire_id");



CREATE INDEX "idx_messages_expediteur" ON "public"."messages" USING "btree" ("expediteur_id");



CREATE INDEX "idx_messages_intervention" ON "public"."messages" USING "btree" ("intervention_id");



CREATE INDEX "idx_messages_non_lus" ON "public"."messages" USING "btree" ("destinataire_id", "lu") WHERE ("lu" = false);



CREATE INDEX "idx_messages_organisation_id" ON "public"."messages" USING "btree" ("organisation_id");



CREATE INDEX "idx_notifications_non_lues" ON "public"."notifications" USING "btree" ("user_id", "lue") WHERE ("lue" = false);



CREATE INDEX "idx_notifications_organisation_id" ON "public"."notifications" USING "btree" ("organisation_id");



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_parametres_entreprise_organisation_id" ON "public"."parametres_entreprise" USING "btree" ("organisation_id");



CREATE INDEX "idx_photos_intervention" ON "public"."photos" USING "btree" ("intervention_id");



CREATE INDEX "idx_photos_organisation_id" ON "public"."photos" USING "btree" ("organisation_id");



CREATE INDEX "idx_prestations_organisation_id" ON "public"."prestations" USING "btree" ("organisation_id");



CREATE INDEX "idx_profiles_organisation_id" ON "public"."profiles" USING "btree" ("organisation_id");



CREATE INDEX "idx_push_subscriptions_organisation_id" ON "public"."push_subscriptions" USING "btree" ("organisation_id");



CREATE INDEX "partner_connection_events_connection_idx" ON "public"."partner_connection_events" USING "btree" ("connection_id", "created_at");



CREATE INDEX "partner_connections_requester_idx" ON "public"."partner_connections" USING "btree" ("requester_organisation_id", "status");



CREATE INDEX "partner_connections_target_idx" ON "public"."partner_connections" USING "btree" ("target_organisation_id", "status");



CREATE UNIQUE INDEX "partner_connections_unique_active_pair_idx" ON "public"."partner_connections" USING "btree" ("public"."uuid_pair_key"("requester_organisation_id", "target_organisation_id")) WHERE ("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'blocked'::"text"]));



CREATE INDEX "partner_messages_connection_idx" ON "public"."partner_messages" USING "btree" ("connection_id", "created_at");



CREATE INDEX "partner_profiles_visible_idx" ON "public"."partner_profiles" USING "btree" ("visible_reseau") WHERE ("visible_reseau" = true);



CREATE INDEX "pie_request_idx" ON "public"."partner_intervention_events" USING "btree" ("request_id", "created_at");



CREATE INDEX "pir_connection_idx" ON "public"."partner_intervention_requests" USING "btree" ("connection_id");



CREATE INDEX "pir_source_idx" ON "public"."partner_intervention_requests" USING "btree" ("source_organisation_id", "status");



CREATE INDEX "pir_target_idx" ON "public"."partner_intervention_requests" USING "btree" ("target_organisation_id", "status");



CREATE INDEX "subscriptions_organisation_id_idx" ON "public"."subscriptions" USING "btree" ("organisation_id");



CREATE INDEX "subscriptions_stripe_customer_id_idx" ON "public"."subscriptions" USING "btree" ("stripe_customer_id");



CREATE UNIQUE INDEX "bname" ON "storage"."buckets" USING "btree" ("name");



CREATE UNIQUE INDEX "bucketid_objname" ON "storage"."objects" USING "btree" ("bucket_id", "name");



CREATE UNIQUE INDEX "buckets_analytics_unique_name_idx" ON "storage"."buckets_analytics" USING "btree" ("name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_multipart_uploads_list" ON "storage"."s3_multipart_uploads" USING "btree" ("bucket_id", "key", "created_at");



CREATE INDEX "idx_objects_bucket_id_name" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C");



CREATE INDEX "idx_objects_bucket_id_name_lower" ON "storage"."objects" USING "btree" ("bucket_id", "lower"("name") COLLATE "C");



CREATE INDEX "name_prefix_search" ON "storage"."objects" USING "btree" ("name" "text_pattern_ops");



CREATE UNIQUE INDEX "vector_indexes_name_bucket_id_idx" ON "storage"."vector_indexes" USING "btree" ("name", "bucket_id");



CREATE OR REPLACE TRIGGER "guide_news_updated_at" BEFORE UPDATE ON "public"."guide_news" FOR EACH ROW EXECUTE FUNCTION "public"."guide_news_set_updated_at"();



CREATE OR REPLACE TRIGGER "guide_videos_updated_at" BEFORE UPDATE ON "public"."guide_videos" FOR EACH ROW EXECUTE FUNCTION "public"."guide_videos_set_updated_at"();



CREATE OR REPLACE TRIGGER "on_subscription_provision_organisation" BEFORE INSERT OR UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."provision_subscriber_organisation"();



CREATE OR REPLACE TRIGGER "set_devis_numero" BEFORE INSERT ON "public"."devis" FOR EACH ROW EXECUTE FUNCTION "public"."generate_devis_numero"();



CREATE OR REPLACE TRIGGER "set_facture_numero" BEFORE INSERT ON "public"."factures" FOR EACH ROW EXECUTE FUNCTION "public"."gen_numero_facture"();



CREATE OR REPLACE TRIGGER "set_intervention_numero" BEFORE INSERT ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."gen_numero_intervention"();



CREATE OR REPLACE TRIGGER "subscriptions_set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_auto_commission" AFTER UPDATE ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."auto_commission"();



CREATE OR REPLACE TRIGGER "trg_cleanup_notif_devis_delete" AFTER DELETE ON "public"."devis" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_notifications_on_devis_delete"();



CREATE OR REPLACE TRIGGER "trg_cleanup_notif_intervention_delete" AFTER DELETE ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_notifications_on_intervention_delete"();



CREATE OR REPLACE TRIGGER "trg_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_commissions_updated_at" BEFORE UPDATE ON "public"."commissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_devis_updated_at" BEFORE UPDATE ON "public"."devis" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_factures_updated_at" BEFORE UPDATE ON "public"."factures" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_intervention_numero" BEFORE INSERT ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."gen_numero_intervention"();



CREATE OR REPLACE TRIGGER "trg_interventions_updated_at" BEFORE UPDATE ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_journal_commissions" AFTER INSERT OR DELETE OR UPDATE ON "public"."commissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_activite"();



CREATE OR REPLACE TRIGGER "trg_journal_devis" AFTER INSERT OR DELETE OR UPDATE ON "public"."devis" FOR EACH ROW EXECUTE FUNCTION "public"."log_activite"();



CREATE OR REPLACE TRIGGER "trg_journal_factures" AFTER INSERT OR DELETE OR UPDATE ON "public"."factures" FOR EACH ROW EXECUTE FUNCTION "public"."log_activite"();



CREATE OR REPLACE TRIGGER "trg_journal_interventions" AFTER INSERT OR DELETE OR UPDATE ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."log_activite"();



CREATE OR REPLACE TRIGGER "trg_partner_connections_after_insert" AFTER INSERT ON "public"."partner_connections" FOR EACH ROW EXECUTE FUNCTION "public"."log_partner_connection_event"();



CREATE OR REPLACE TRIGGER "trg_partner_connections_after_update" AFTER UPDATE ON "public"."partner_connections" FOR EACH ROW EXECUTE FUNCTION "public"."log_partner_connection_event"();



CREATE OR REPLACE TRIGGER "trg_partner_connections_before_update" BEFORE UPDATE ON "public"."partner_connections" FOR EACH ROW EXECUTE FUNCTION "public"."partner_connections_before_update"();



CREATE OR REPLACE TRIGGER "trg_partner_messages_before_update" BEFORE UPDATE ON "public"."partner_messages" FOR EACH ROW EXECUTE FUNCTION "public"."partner_messages_before_update"();



CREATE OR REPLACE TRIGGER "trg_partner_profiles_before_update" BEFORE UPDATE ON "public"."partner_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."partner_profiles_before_update"();



CREATE OR REPLACE TRIGGER "trg_pir_after_insert_event" AFTER INSERT ON "public"."partner_intervention_requests" FOR EACH ROW EXECUTE FUNCTION "public"."log_partner_intervention_event"();



CREATE OR REPLACE TRIGGER "trg_pir_after_insert_notify" AFTER INSERT ON "public"."partner_intervention_requests" FOR EACH ROW EXECUTE FUNCTION "public"."notify_on_partner_intervention_change"();



CREATE OR REPLACE TRIGGER "trg_pir_after_update_event" AFTER UPDATE ON "public"."partner_intervention_requests" FOR EACH ROW EXECUTE FUNCTION "public"."log_partner_intervention_event"();



CREATE OR REPLACE TRIGGER "trg_pir_after_update_notify" AFTER UPDATE ON "public"."partner_intervention_requests" FOR EACH ROW EXECUTE FUNCTION "public"."notify_on_partner_intervention_change"();



CREATE OR REPLACE TRIGGER "trg_pir_before_update" BEFORE UPDATE ON "public"."partner_intervention_requests" FOR EACH ROW EXECUTE FUNCTION "public"."partner_intervention_requests_before_update"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_protect_profile_fields" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_profile_sensitive_fields"();



CREATE OR REPLACE TRIGGER "trg_push_on_notification" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_push_on_notification"();



CREATE OR REPLACE TRIGGER "trg_reset_rappels_on_date_change" BEFORE UPDATE ON "public"."interventions" FOR EACH ROW EXECUTE FUNCTION "public"."reset_rappels_on_date_change"();



CREATE OR REPLACE TRIGGER "trg_seed_prestations_on_org_create" AFTER INSERT ON "public"."organisations" FOR EACH ROW EXECUTE FUNCTION "public"."seed_default_prestations_on_org_create"();



CREATE OR REPLACE TRIGGER "enforce_bucket_name_length_trigger" BEFORE INSERT OR UPDATE OF "name" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_name_length"();



CREATE OR REPLACE TRIGGER "protect_buckets_delete" BEFORE DELETE ON "storage"."buckets" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "protect_objects_delete" BEFORE DELETE ON "storage"."objects" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "update_objects_updated_at" BEFORE UPDATE ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "storage"."update_updated_at_column"();



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "public"."factures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_intervenant_id_fkey" FOREIGN KEY ("intervenant_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_receipts"
    ADD CONSTRAINT "commission_receipts_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "public"."factures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_intervenant_id_fkey" FOREIGN KEY ("intervenant_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_intervenant_id_fkey" FOREIGN KEY ("intervenant_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devis"
    ADD CONSTRAINT "devis_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_public_links"
    ADD CONSTRAINT "document_public_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_public_links"
    ADD CONSTRAINT "document_public_links_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_devis_id_fkey" FOREIGN KEY ("devis_id") REFERENCES "public"."devis"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."factures"
    ADD CONSTRAINT "factures_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."guide_news"
    ADD CONSTRAINT "guide_news_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guide_progress"
    ADD CONSTRAINT "guide_progress_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guide_progress"
    ADD CONSTRAINT "guide_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guide_videos"
    ADD CONSTRAINT "guide_videos_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_intervenant_id_fkey" FOREIGN KEY ("intervenant_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_materiel_confirme_par_fkey" FOREIGN KEY ("materiel_confirme_par") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interventions"
    ADD CONSTRAINT "interventions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journal"
    ADD CONSTRAINT "journal_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."journal"
    ADD CONSTRAINT "journal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_destinataire_id_fkey" FOREIGN KEY ("destinataire_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_expediteur_id_fkey" FOREIGN KEY ("expediteur_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parametres_entreprise"
    ADD CONSTRAINT "parametres_entreprise_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."partner_connection_events"
    ADD CONSTRAINT "partner_connection_events_actor_organisation_id_fkey" FOREIGN KEY ("actor_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_connection_events"
    ADD CONSTRAINT "partner_connection_events_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_connection_events"
    ADD CONSTRAINT "partner_connection_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_blocked_by_organisation_id_fkey" FOREIGN KEY ("blocked_by_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_requester_organisation_id_fkey" FOREIGN KEY ("requester_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_requester_profile_id_fkey" FOREIGN KEY ("requester_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_target_organisation_id_fkey" FOREIGN KEY ("target_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_connections"
    ADD CONSTRAINT "partner_connections_target_profile_id_fkey" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_intervention_events"
    ADD CONSTRAINT "partner_intervention_events_actor_organisation_id_fkey" FOREIGN KEY ("actor_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_intervention_events"
    ADD CONSTRAINT "partner_intervention_events_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_intervention_events"
    ADD CONSTRAINT "partner_intervention_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."partner_intervention_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_source_organisation_id_fkey" FOREIGN KEY ("source_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_source_profile_id_fkey" FOREIGN KEY ("source_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_target_organisation_id_fkey" FOREIGN KEY ("target_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_intervention_requests"
    ADD CONSTRAINT "partner_intervention_requests_target_profile_id_fkey" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_messages"
    ADD CONSTRAINT "partner_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_messages"
    ADD CONSTRAINT "partner_messages_sender_organisation_id_fkey" FOREIGN KEY ("sender_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partner_messages"
    ADD CONSTRAINT "partner_messages_sender_profile_id_fkey" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_profiles"
    ADD CONSTRAINT "partner_profiles_created_by_profile_id_fkey" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partner_profiles"
    ADD CONSTRAINT "partner_profiles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prestations"
    ADD CONSTRAINT "prestations_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "storage"."s3_multipart_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets_vectors"("id");



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete" ON "public"."clients" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "clients_insert" ON "public"."clients" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."can_manage_operations"("public"."current_org_id"()) OR "public"."is_intervenant_in_org"("public"."current_org_id"()))));



CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."can_manage_operations"("organisation_id") OR ("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."client_id" = "clients"."id") AND ("i"."intervenant_id" = "auth"."uid"()) AND ("i"."organisation_id" = "clients"."organisation_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."devis" "d"
  WHERE (("d"."client_id" = "clients"."id") AND ("d"."intervenant_id" = "auth"."uid"()) AND ("d"."organisation_id" = "clients"."organisation_id")))))));



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."can_manage_operations"("organisation_id"))) WITH CHECK (("public"."can_manage_operations"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."commission_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "commissions_delete" ON "public"."commissions" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "commissions_insert" ON "public"."commissions" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("intervenant_id" = "auth"."uid"())))));



CREATE POLICY "commissions_select" ON "public"."commissions" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND ("intervenant_id" = "auth"."uid"())))));



CREATE POLICY "commissions_update" ON "public"."commissions" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND "public"."is_admin_in_org"("public"."current_org_id"())));



CREATE POLICY "cr_delete" ON "public"."commission_receipts" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "cr_insert" ON "public"."commission_receipts" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("intervenant_id" = "auth"."uid"())))));



CREATE POLICY "cr_select" ON "public"."commission_receipts" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND ("intervenant_id" = "auth"."uid"())))));



CREATE POLICY "cr_update" ON "public"."commission_receipts" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND ("intervenant_id" = "auth"."uid"()))))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("intervenant_id" = "auth"."uid"())))));



ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_delete" ON "public"."devices" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND (("user_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



CREATE POLICY "devices_insert" ON "public"."devices" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "devices_select" ON "public"."devices" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND (("user_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



CREATE POLICY "devices_update" ON "public"."devices" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND (("user_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id")))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND (("user_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



ALTER TABLE "public"."devis" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devis_delete" ON "public"."devis" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "devis_insert" ON "public"."devis" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("created_by" = "auth"."uid"())))));



CREATE POLICY "devis_select" ON "public"."devis" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND (("created_by" = "auth"."uid"()) OR ("intervenant_id" = "auth"."uid"()))))));



CREATE POLICY "devis_update" ON "public"."devis" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND ("created_by" = "auth"."uid"()) AND ("statut" = ANY (ARRAY['en_attente_validation'::"text", 'brouillon'::"text", 'envoye'::"text"])))))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("created_by" = "auth"."uid"()) AND (("statut" = ANY (ARRAY['en_attente_validation'::"text", 'brouillon'::"text", 'envoye'::"text"])) OR (("statut" = 'accepte'::"text") AND ("signature_client" IS NOT NULL) AND ("signature_date" IS NOT NULL)))))));



ALTER TABLE "public"."document_public_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."factures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "factures_delete" ON "public"."factures" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "factures_insert" ON "public"."factures" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("created_by" = "auth"."uid"())))));



CREATE POLICY "factures_select" ON "public"."factures" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND (("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "factures"."intervention_id") AND ("i"."organisation_id" = "factures"."organisation_id") AND ("i"."intervenant_id" = "auth"."uid"())))))))));



CREATE POLICY "factures_update" ON "public"."factures" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("public"."is_intervenant_in_org"("organisation_id") AND ("statut_paiement" <> ALL (ARRAY['payee'::"text", 'annulee'::"text"])) AND (("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "factures"."intervention_id") AND ("i"."organisation_id" = "factures"."organisation_id") AND ("i"."intervenant_id" = "auth"."uid"()))))))))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."is_admin_in_org"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND (("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "factures"."intervention_id") AND ("i"."organisation_id" = "factures"."organisation_id") AND ("i"."intervenant_id" = "auth"."uid"())))))))));



ALTER TABLE "public"."founder_seats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "founder_seats_select_public" ON "public"."founder_seats" FOR SELECT USING (true);



ALTER TABLE "public"."guide_news" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guide_news_delete" ON "public"."guide_news" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "guide_news_insert" ON "public"."guide_news" FOR INSERT WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "guide_news_select" ON "public"."guide_news" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("actif" = true)));



CREATE POLICY "guide_news_update" ON "public"."guide_news" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."guide_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guide_progress_delete" ON "public"."guide_progress" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



CREATE POLICY "guide_progress_insert" ON "public"."guide_progress" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "guide_progress_select" ON "public"."guide_progress" FOR SELECT USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



CREATE POLICY "guide_progress_update" ON "public"."guide_progress" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."guide_videos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guide_videos_delete" ON "public"."guide_videos" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "guide_videos_insert" ON "public"."guide_videos" FOR INSERT WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "guide_videos_select" ON "public"."guide_videos" FOR SELECT USING ("public"."is_same_org"("organisation_id"));



CREATE POLICY "guide_videos_update" ON "public"."guide_videos" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."interventions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "interventions_delete" ON "public"."interventions" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "interventions_insert" ON "public"."interventions" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."can_manage_operations"("public"."current_org_id"()) OR ("public"."is_intervenant_in_org"("public"."current_org_id"()) AND ("created_by" = "auth"."uid"())))));



CREATE POLICY "interventions_select" ON "public"."interventions" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."can_manage_operations"("organisation_id") OR ("intervenant_id" = "auth"."uid"()))));



CREATE POLICY "interventions_update" ON "public"."interventions" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND ("public"."can_manage_operations"("organisation_id") OR ("intervenant_id" = "auth"."uid"())))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND ("public"."can_manage_operations"("public"."current_org_id"()) OR ("intervenant_id" = "auth"."uid"()))));



ALTER TABLE "public"."journal" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "journal_delete" ON "public"."journal" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "journal_insert" ON "public"."journal" FOR INSERT WITH CHECK (("organisation_id" = "public"."current_org_id"()));



CREATE POLICY "journal_select" ON "public"."journal" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "journal_update" ON "public"."journal" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND "public"."is_admin_in_org"("public"."current_org_id"())));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_delete" ON "public"."messages" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND (("expediteur_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



CREATE POLICY "messages_insert" ON "public"."messages" FOR INSERT WITH CHECK ((("expediteur_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "messages"."destinataire_id") AND ("p"."organisation_id" = "public"."current_org_id"()))))));



CREATE POLICY "messages_select" ON "public"."messages" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND (("expediteur_id" = "auth"."uid"()) OR ("destinataire_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



CREATE POLICY "messages_update" ON "public"."messages" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND (("destinataire_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id"))));



CREATE POLICY "notif_delete" ON "public"."notifications" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



CREATE POLICY "notif_insert" ON "public"."notifications" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "notifications"."user_id") AND ("p"."organisation_id" = "notifications"."organisation_id") AND ("p"."actif" = true))))));



CREATE POLICY "notif_select" ON "public"."notifications" FOR SELECT USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



CREATE POLICY "notif_update" ON "public"."notifications" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_delete" ON "public"."document_public_links" FOR DELETE USING (("organisation_id" = ( SELECT "profiles"."organisation_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_insert" ON "public"."document_public_links" FOR INSERT WITH CHECK ((("organisation_id" = ( SELECT "p"."organisation_id"
   FROM "public"."profiles" "p"
  WHERE ("p"."id" = "auth"."uid"()))) AND ((("document_type" = 'devis'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."devis" "d"
  WHERE (("d"."id" = "document_public_links"."document_id") AND ("d"."organisation_id" = "document_public_links"."organisation_id"))))) OR (("document_type" = 'facture'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."factures" "f"
  WHERE (("f"."id" = "document_public_links"."document_id") AND ("f"."organisation_id" = "document_public_links"."organisation_id"))))))));



CREATE POLICY "org_select" ON "public"."document_public_links" FOR SELECT USING (("organisation_id" = ( SELECT "profiles"."organisation_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



ALTER TABLE "public"."organisations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organisations_select" ON "public"."organisations" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "profiles"."organisation_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



ALTER TABLE "public"."parametres_entreprise" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "params_delete" ON "public"."parametres_entreprise" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "params_insert" ON "public"."parametres_entreprise" FOR INSERT WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "params_select_admin" ON "public"."parametres_entreprise" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "params_update" ON "public"."parametres_entreprise" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."partner_connection_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_connection_events_select" ON "public"."partner_connection_events" FOR SELECT USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."partner_connections" "c"
  WHERE (("c"."id" = "partner_connection_events"."connection_id") AND (("public"."current_org_id"() = "c"."requester_organisation_id") OR ("public"."current_org_id"() = "c"."target_organisation_id")))))));



ALTER TABLE "public"."partner_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_connections_insert" ON "public"."partner_connections" FOR INSERT WITH CHECK ((("requester_organisation_id" = "public"."current_org_id"()) AND ("requester_profile_id" = "auth"."uid"()) AND "public"."is_admin_in_org"("public"."current_org_id"()) AND ("status" = 'pending'::"text") AND ("target_organisation_id" <> "public"."current_org_id"()) AND "public"."partner_profile_exists"("target_organisation_id") AND (("target_profile_id" IS NULL) OR "public"."profile_belongs_to_org"("target_profile_id", "target_organisation_id"))));



CREATE POLICY "partner_connections_select" ON "public"."partner_connections" FOR SELECT USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND (("public"."current_org_id"() = "requester_organisation_id") OR ("public"."current_org_id"() = "target_organisation_id"))));



CREATE POLICY "partner_connections_update" ON "public"."partner_connections" FOR UPDATE USING (((("public"."current_org_id"() = "requester_organisation_id") OR ("public"."current_org_id"() = "target_organisation_id")) AND "public"."is_admin_in_org"("public"."current_org_id"()))) WITH CHECK (((("public"."current_org_id"() = "requester_organisation_id") OR ("public"."current_org_id"() = "target_organisation_id")) AND "public"."is_admin_in_org"("public"."current_org_id"())));



ALTER TABLE "public"."partner_intervention_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partner_intervention_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partner_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_messages_insert" ON "public"."partner_messages" FOR INSERT WITH CHECK ((("sender_organisation_id" = "public"."current_org_id"()) AND ("sender_profile_id" = "auth"."uid"()) AND "public"."is_admin_in_org"("public"."current_org_id"()) AND "public"."is_connection_member"("connection_id", "public"."current_org_id"()) AND "public"."is_connection_accepted"("connection_id")));



CREATE POLICY "partner_messages_select" ON "public"."partner_messages" FOR SELECT USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND "public"."is_connection_member"("connection_id", "public"."current_org_id"())));



CREATE POLICY "partner_messages_update" ON "public"."partner_messages" FOR UPDATE USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND "public"."is_connection_member"("connection_id", "public"."current_org_id"()))) WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND "public"."is_connection_member"("connection_id", "public"."current_org_id"())));



ALTER TABLE "public"."partner_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partner_profiles_insert" ON "public"."partner_profiles" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND "public"."is_admin_in_org"("public"."current_org_id"())));



CREATE POLICY "partner_profiles_select" ON "public"."partner_profiles" FOR SELECT USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND (("organisation_id" = "public"."current_org_id"()) OR ("visible_reseau" = true) OR "public"."has_partner_relation"("organisation_id", "public"."current_org_id"()))));



CREATE POLICY "partner_profiles_update" ON "public"."partner_profiles" FOR UPDATE USING ((("organisation_id" = "public"."current_org_id"()) AND "public"."is_admin_in_org"("public"."current_org_id"()))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND "public"."is_admin_in_org"("public"."current_org_id"())));



ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photos_delete" ON "public"."photos" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND ("public"."is_admin_in_org"("organisation_id") OR ("uploaded_by" = "auth"."uid"()))));



CREATE POLICY "photos_insert" ON "public"."photos" FOR INSERT WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "photos"."intervention_id") AND ("i"."organisation_id" = "public"."current_org_id"()))))));



CREATE POLICY "photos_select" ON "public"."photos" FOR SELECT USING (("public"."is_same_org"("organisation_id") AND ("public"."can_manage_operations"("organisation_id") OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "photos"."intervention_id") AND ("i"."organisation_id" = "photos"."organisation_id") AND ("i"."intervenant_id" = "auth"."uid"())))))));



CREATE POLICY "pie_select" ON "public"."partner_intervention_events" FOR SELECT USING (("public"."is_admin_in_org"("public"."current_org_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."partner_intervention_requests" "r"
  WHERE (("r"."id" = "partner_intervention_events"."request_id") AND (("public"."current_org_id"() = "r"."source_organisation_id") OR ("public"."current_org_id"() = "r"."target_organisation_id")))))));



CREATE POLICY "pir_insert" ON "public"."partner_intervention_requests" FOR INSERT WITH CHECK ((("source_organisation_id" = "public"."current_org_id"()) AND ("source_profile_id" = "auth"."uid"()) AND "public"."is_admin_in_org"("public"."current_org_id"()) AND ("status" = 'pending'::"text") AND ("note_refus" IS NULL) AND ("compte_rendu" IS NULL) AND ("resulting_intervention_id" IS NULL) AND ("target_organisation_id" <> "public"."current_org_id"()) AND "public"."is_connection_member"("connection_id", "source_organisation_id") AND "public"."is_connection_member"("connection_id", "target_organisation_id") AND "public"."is_connection_accepted"("connection_id") AND (("source_intervention_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE (("i"."id" = "partner_intervention_requests"."source_intervention_id") AND ("i"."organisation_id" = "public"."current_org_id"()))))) AND (("target_profile_id" IS NULL) OR "public"."profile_belongs_to_org"("target_profile_id", "target_organisation_id"))));



CREATE POLICY "pir_select" ON "public"."partner_intervention_requests" FOR SELECT USING ((("public"."current_org_id"() = "source_organisation_id") OR (("public"."current_org_id"() = "target_organisation_id") AND ("status" = ANY (ARRAY['accepted'::"text", 'in_progress'::"text", 'completed'::"text"])))));



CREATE POLICY "pir_update" ON "public"."partner_intervention_requests" FOR UPDATE USING (((("public"."current_org_id"() = "source_organisation_id") OR ("public"."current_org_id"() = "target_organisation_id")) AND "public"."is_admin_in_org"("public"."current_org_id"()))) WITH CHECK (((("public"."current_org_id"() = "source_organisation_id") OR ("public"."current_org_id"() = "target_organisation_id")) AND "public"."is_admin_in_org"("public"."current_org_id"())));



ALTER TABLE "public"."prestations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prestations_delete" ON "public"."prestations" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "prestations_insert" ON "public"."prestations" FOR INSERT WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "prestations_select" ON "public"."prestations" FOR SELECT USING ("public"."is_same_org"("organisation_id"));



CREATE POLICY "prestations_update" ON "public"."prestations" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id"))) WITH CHECK (("public"."is_admin_in_org"("public"."current_org_id"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete" ON "public"."profiles" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("organisation_id" = "public"."current_org_id"()));



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING ("public"."is_same_org"("organisation_id"));



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING (("public"."is_same_org"("organisation_id") AND (("id" = "auth"."uid"()) OR "public"."is_admin_in_org"("organisation_id")))) WITH CHECK ((("organisation_id" = "public"."current_org_id"()) AND (("id" = "auth"."uid"()) OR "public"."is_admin_in_org"("public"."current_org_id"()))));



CREATE POLICY "push_sub_delete" ON "public"."push_subscriptions" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND ("user_id" = "auth"."uid"())));



CREATE POLICY "push_sub_delete_admin" ON "public"."push_subscriptions" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND "public"."is_admin_in_org"("organisation_id")));



CREATE POLICY "push_sub_delete_self" ON "public"."push_subscriptions" FOR DELETE USING (("public"."is_same_org"("organisation_id") AND ("user_id" = "auth"."uid"())));



CREATE POLICY "push_sub_insert" ON "public"."push_subscriptions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"())));



CREATE POLICY "push_sub_select" ON "public"."push_subscriptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id")));



CREATE POLICY "push_sub_update" ON "public"."push_subscriptions" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND "public"."is_same_org"("organisation_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organisation_id" = "public"."current_org_id"())));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_select_own" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "storage"."buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_vectors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_media_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'chat-media'::"text") AND (("owner" = "auth"."uid"()) OR "public"."is_admin_in_org"("public"."current_org_id"()))));



CREATE POLICY "chat_media_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'chat-media'::"text") AND ("auth"."uid"() IS NOT NULL) AND ("split_part"("name", '/'::"text", 1) = ("auth"."uid"())::"text")));



CREATE POLICY "chat_media_select" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'chat-media'::"text") AND (("owner" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE (("m"."media_url" = "objects"."name") AND (("m"."expediteur_id" = "auth"."uid"()) OR ("m"."destinataire_id" = "auth"."uid"()) OR "public"."is_admin_in_org"("m"."organisation_id"))))))));



CREATE POLICY "guide_videos_storage_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'guide-videos'::"text") AND ("auth"."role"() = 'authenticated'::"text") AND "public"."is_admin_in_org"("public"."current_org_id"()) AND (("storage"."foldername"("name"))[1] = ("public"."current_org_id"())::"text")));



CREATE POLICY "guide_videos_storage_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'guide-videos'::"text") AND ("auth"."role"() = 'authenticated'::"text") AND "public"."is_admin_in_org"("public"."current_org_id"()) AND (("storage"."foldername"("name"))[1] = ("public"."current_org_id"())::"text")));



CREATE POLICY "guide_videos_storage_select" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'guide-videos'::"text") AND ("auth"."role"() = 'authenticated'::"text") AND (("storage"."foldername"("name"))[1] = ("public"."current_org_id"())::"text")));



CREATE POLICY "guide_videos_storage_update" ON "storage"."objects" FOR UPDATE USING ((("bucket_id" = 'guide-videos'::"text") AND ("auth"."role"() = 'authenticated'::"text") AND "public"."is_admin_in_org"("public"."current_org_id"()) AND (("storage"."foldername"("name"))[1] = ("public"."current_org_id"())::"text")));



CREATE POLICY "intervention_photos_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'intervention-photos'::"text") AND (("owner" = "auth"."uid"()) OR "public"."is_admin_in_org"("public"."current_org_id"()))));



CREATE POLICY "intervention_photos_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'intervention-photos'::"text") AND ("auth"."uid"() IS NOT NULL) AND ("public"."current_org_id"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."interventions" "i"
  WHERE ((("i"."id")::"text" = "split_part"("objects"."name", '/'::"text", 1)) AND ("i"."organisation_id" = "public"."current_org_id"()))))));



CREATE POLICY "intervention_photos_select" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'intervention-photos'::"text") AND (("owner" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."photos" "p"
  WHERE (("p"."storage_path" = "objects"."name") AND ("p"."organisation_id" = "public"."current_org_id"())))))));



CREATE POLICY "logos_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'logos'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND "public"."is_admin_in_org"("public"."current_org_id"())));



CREATE POLICY "logos_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'logos'::"text") AND ("public"."current_org_id"() IS NOT NULL) AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND "public"."is_admin_in_org"("public"."current_org_id"())));



CREATE POLICY "logos_select_public" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'logos'::"text"));



CREATE POLICY "logos_update" ON "storage"."objects" FOR UPDATE USING ((("bucket_id" = 'logos'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND "public"."is_admin_in_org"("public"."current_org_id"()))) WITH CHECK ((("bucket_id" = 'logos'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND "public"."is_admin_in_org"("public"."current_org_id"())));



ALTER TABLE "storage"."migrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."objects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pdf_documents_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'pdf-documents'::"text") AND (("owner" = "auth"."uid"()) OR "public"."is_admin_in_org"("public"."current_org_id"()))));



CREATE POLICY "pdf_documents_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'pdf-documents'::"text") AND ("auth"."uid"() IS NOT NULL) AND ("public"."current_org_id"() IS NOT NULL) AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text")));



CREATE POLICY "pdf_documents_select" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'pdf-documents'::"text") AND (("owner" = "auth"."uid"()) OR (("public"."current_org_id"() IS NOT NULL) AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND "public"."is_admin_in_org"("public"."current_org_id"())))));



ALTER TABLE "storage"."s3_multipart_uploads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."s3_multipart_uploads_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signatures_delete" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'signatures'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text") AND (("owner" = "auth"."uid"()) OR "public"."is_admin_in_org"("public"."current_org_id"()))));



CREATE POLICY "signatures_insert" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'signatures'::"text") AND ("auth"."uid"() IS NOT NULL) AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text")));



CREATE POLICY "signatures_select" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'signatures'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text")));



CREATE POLICY "signatures_update" ON "storage"."objects" FOR UPDATE USING ((("bucket_id" = 'signatures'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text"))) WITH CHECK ((("bucket_id" = 'signatures'::"text") AND ("split_part"("name", '/'::"text", 1) = ("public"."current_org_id"())::"text")));



ALTER TABLE "storage"."vector_indexes" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "storage" TO "postgres" WITH GRANT OPTION;
GRANT USAGE ON SCHEMA "storage" TO "anon";
GRANT USAGE ON SCHEMA "storage" TO "authenticated";
GRANT USAGE ON SCHEMA "storage" TO "service_role";
GRANT ALL ON SCHEMA "storage" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON SCHEMA "storage" TO "dashboard_user";



REVOKE ALL ON FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_user_push_subscriptions"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_commission"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_commission"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_commission"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_operations"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_operations"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_operations"("org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_founder_seat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_founder_seat"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_devis_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_devis_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_devis_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_intervention_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_intervention_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_on_intervention_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_numero_devis"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_numero_devis"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_numero_devis"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_numero_facture"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_numero_facture"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_numero_facture"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_numero_intervention"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_numero_intervention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_numero_intervention"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_devis_numero"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_devis_numero"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_devis_numero"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_partner_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_partner_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_partner_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_internal_push_secret"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_internal_push_secret"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_organisation_subscription_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_organisation_subscription_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_organisation_subscription_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_partner_requests_preview"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_partner_requests_preview"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_partner_requests_preview"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_partner_requests_preview"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guide_news_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."guide_news_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guide_news_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guide_videos_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."guide_videos_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guide_videos_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_partner_relation"("org_a" "uuid", "org_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_partner_relation"("org_a" "uuid", "org_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_partner_relation"("org_a" "uuid", "org_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_in_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_in_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_in_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_assistant_in_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_assistant_in_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assistant_in_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_connection_accepted"("conn_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_connection_accepted"("conn_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_connection_accepted"("conn_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_connection_member"("conn_id" "uuid", "org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_connection_member"("conn_id" "uuid", "org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_connection_member"("conn_id" "uuid", "org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_intervenant_in_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_intervenant_in_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_intervenant_in_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partner_org"("org_a" "uuid", "org_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partner_org"("org_a" "uuid", "org_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partner_org"("org_a" "uuid", "org_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_same_org"("row_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_same_org"("row_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_same_org"("row_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_activite"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_activite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_activite"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_partner_connection_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_partner_connection_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_partner_connection_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_partner_intervention_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_partner_intervention_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_partner_intervention_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_on_partner_intervention_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_on_partner_intervention_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_on_partner_intervention_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."partner_connections_before_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."partner_connections_before_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."partner_connections_before_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."partner_intervention_requests_before_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."partner_intervention_requests_before_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."partner_intervention_requests_before_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."partner_messages_before_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."partner_messages_before_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."partner_messages_before_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."partner_profile_exists"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."partner_profile_exists"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."partner_profile_exists"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."partner_profiles_before_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."partner_profiles_before_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."partner_profiles_before_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."profile_belongs_to_org"("profile_id" "uuid", "org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."profile_belongs_to_org"("profile_id" "uuid", "org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."profile_belongs_to_org"("profile_id" "uuid", "org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_profile_sensitive_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_profile_sensitive_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_profile_sensitive_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."provision_subscriber_organisation"() TO "anon";
GRANT ALL ON FUNCTION "public"."provision_subscriber_organisation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_subscriber_organisation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_rappels_on_date_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."reset_rappels_on_date_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_rappels_on_date_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_to_partner_intervention_request"("p_id" "uuid", "p_response" "text", "p_note_refus" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_partner_profiles"("query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_partner_profiles"("query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_partner_profiles"("query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_partner_profiles"("query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_default_prestations"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_default_prestations"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_default_prestations"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_default_prestations_on_org_create"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_default_prestations_on_org_create"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_default_prestations_on_org_create"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_push_on_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_push_on_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_push_on_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uuid_pair_key"("a" "uuid", "b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."uuid_pair_key"("a" "uuid", "b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uuid_pair_key"("a" "uuid", "b" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."commission_receipts" TO "anon";
GRANT ALL ON TABLE "public"."commission_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."commissions" TO "anon";
GRANT ALL ON TABLE "public"."commissions" TO "authenticated";
GRANT ALL ON TABLE "public"."commissions" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."devis" TO "anon";
GRANT ALL ON TABLE "public"."devis" TO "authenticated";
GRANT ALL ON TABLE "public"."devis" TO "service_role";



GRANT ALL ON SEQUENCE "public"."devis_numero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."devis_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."devis_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_public_links" TO "anon";
GRANT ALL ON TABLE "public"."document_public_links" TO "authenticated";
GRANT ALL ON TABLE "public"."document_public_links" TO "service_role";



GRANT ALL ON TABLE "public"."factures" TO "anon";
GRANT ALL ON TABLE "public"."factures" TO "authenticated";
GRANT ALL ON TABLE "public"."factures" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."founder_seats" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."founder_seats" TO "authenticated";
GRANT ALL ON TABLE "public"."founder_seats" TO "service_role";



GRANT ALL ON TABLE "public"."guide_news" TO "anon";
GRANT ALL ON TABLE "public"."guide_news" TO "authenticated";
GRANT ALL ON TABLE "public"."guide_news" TO "service_role";



GRANT ALL ON TABLE "public"."guide_progress" TO "anon";
GRANT ALL ON TABLE "public"."guide_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."guide_progress" TO "service_role";



GRANT ALL ON TABLE "public"."guide_videos" TO "anon";
GRANT ALL ON TABLE "public"."guide_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."guide_videos" TO "service_role";



GRANT ALL ON TABLE "public"."interventions" TO "anon";
GRANT ALL ON TABLE "public"."interventions" TO "authenticated";
GRANT ALL ON TABLE "public"."interventions" TO "service_role";



GRANT ALL ON TABLE "public"."journal" TO "anon";
GRANT ALL ON TABLE "public"."journal" TO "authenticated";
GRANT ALL ON TABLE "public"."journal" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organisations" TO "anon";
GRANT ALL ON TABLE "public"."organisations" TO "authenticated";
GRANT ALL ON TABLE "public"."organisations" TO "service_role";



GRANT ALL ON TABLE "public"."parametres_entreprise" TO "anon";
GRANT ALL ON TABLE "public"."parametres_entreprise" TO "authenticated";
GRANT ALL ON TABLE "public"."parametres_entreprise" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."parametres_entreprise_public" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."parametres_entreprise_public" TO "authenticated";
GRANT ALL ON TABLE "public"."parametres_entreprise_public" TO "service_role";



GRANT ALL ON TABLE "public"."partner_connection_events" TO "anon";
GRANT ALL ON TABLE "public"."partner_connection_events" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_connection_events" TO "service_role";



GRANT ALL ON TABLE "public"."partner_connections" TO "anon";
GRANT ALL ON TABLE "public"."partner_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_connections" TO "service_role";



GRANT ALL ON TABLE "public"."partner_intervention_events" TO "anon";
GRANT ALL ON TABLE "public"."partner_intervention_events" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_intervention_events" TO "service_role";



GRANT ALL ON TABLE "public"."partner_intervention_requests" TO "anon";
GRANT ALL ON TABLE "public"."partner_intervention_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_intervention_requests" TO "service_role";



GRANT ALL ON TABLE "public"."partner_messages" TO "anon";
GRANT ALL ON TABLE "public"."partner_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_messages" TO "service_role";



GRANT ALL ON TABLE "public"."partner_profiles" TO "anon";
GRANT ALL ON TABLE "public"."partner_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT ALL ON TABLE "public"."prestations" TO "anon";
GRANT ALL ON TABLE "public"."prestations" TO "authenticated";
GRANT ALL ON TABLE "public"."prestations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



REVOKE ALL ON TABLE "storage"."buckets" FROM "supabase_storage_admin";
GRANT ALL ON TABLE "storage"."buckets" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."buckets" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets" TO "anon";
GRANT ALL ON TABLE "storage"."buckets" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "storage"."buckets_analytics" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "anon";



GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "service_role";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "authenticated";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "anon";



REVOKE ALL ON TABLE "storage"."objects" FROM "supabase_storage_admin";
GRANT ALL ON TABLE "storage"."objects" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."objects" TO "service_role";
GRANT ALL ON TABLE "storage"."objects" TO "authenticated";
GRANT ALL ON TABLE "storage"."objects" TO "anon";
GRANT ALL ON TABLE "storage"."objects" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "storage"."s3_multipart_uploads" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "anon";



GRANT ALL ON TABLE "storage"."s3_multipart_uploads_parts" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "anon";



GRANT SELECT ON TABLE "storage"."vector_indexes" TO "service_role";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "authenticated";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "anon";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "service_role";




