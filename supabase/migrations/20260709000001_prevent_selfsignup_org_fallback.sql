-- Phase 1 (Stripe self-service remediation, Option C):
-- handle_new_user() must never fall back to the kaytek-inter production
-- organisation for signups that don't carry a valid organisation_id in
-- raw_user_meta_data. Invitation flows (assistant/intervenant) always pass
-- a valid organisation_id and keep working unchanged. Self-service/Stripe
-- signups (no organisation_id yet) get an auth.users row but NO profile,
-- until the Stripe webhook / RPC (future phase) creates their organisation
-- and profile properly. A user with no profile cannot access the app.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
