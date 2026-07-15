-- Phase 4 (Stripe self-service remediation):
-- Minimal-surface RPC allowing any authenticated member of an organisation
-- (admin/assistant/intervenant) to read their organisation's linked
-- subscription status, without opening a new RLS policy on `subscriptions`
-- (which would otherwise expose the founder's stripe_customer_id/email/plan
-- to every invited employee). Returns nothing if the organisation has no
-- linked subscription at all — this is the safety property the frontend
-- gating relies on to never block kaytek-inter or any pre-Stripe org.

CREATE OR REPLACE FUNCTION public.get_my_organisation_subscription_status()
  RETURNS TABLE(subscription_status text, trial_ends_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT s.subscription_status, s.trial_ends_at
  FROM public.subscriptions s
  JOIN public.profiles p ON p.organisation_id = s.organisation_id
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

ALTER FUNCTION public.get_my_organisation_subscription_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_my_organisation_subscription_status() TO authenticated;
