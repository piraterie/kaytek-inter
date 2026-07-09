-- Phase 3 (Stripe self-service remediation):
-- Automatically provision a dedicated organisation + admin/founder profile
-- for a self-service Stripe subscriber the moment their subscription row
-- reaches a valid state (trialing/active), with no changes required to the
-- external Stripe webhook code (not present in this repo).
--
-- Also documents the pre-existing `subscriptions_set_updated_at` trigger,
-- which was live in production but never captured in any migration file
-- (same drift pattern already found and fixed for the tables themselves
-- in the Phase 2 migration). Purely documentary re-creation, no behavior
-- change.

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Pre-existing AFTER INSERT ON organisations trigger (added in a prior session
-- to require an authenticated admin session before seeding the default
-- prestations catalogue) unconditionally raises 'Authentification requise'
-- when auth.uid() is NULL. That is exactly the context of a service_role
-- write (the real Stripe webhook, or the trigger below), so it currently
-- blocks ANY organisation from being created outside an interactive admin
-- session. seed_default_prestations() itself is untouched — its guard is
-- correct and still enforced for the authenticated admin flow in Catalogue
-- (src/lib/hooks/index.ts). Only this thin wrapper is hardened to skip
-- seeding gracefully instead of aborting organisation creation.
CREATE OR REPLACE FUNCTION public.seed_default_prestations_on_org_create()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_prestations(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_default_prestations_on_org_create: seeding ignoré pour org % (%)', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.seed_default_prestations_on_org_create() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.provision_subscriber_organisation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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

ALTER FUNCTION public.provision_subscriber_organisation() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_subscription_provision_organisation ON public.subscriptions;
CREATE TRIGGER on_subscription_provision_organisation
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.provision_subscriber_organisation();
