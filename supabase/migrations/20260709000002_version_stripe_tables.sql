-- Phase 2 (Stripe self-service remediation):
-- Version the two tables that already exist live in production but were
-- never captured in any migration file (created directly by the external
-- Stripe integration, outside this repo). This migration is purely
-- additive/documentary: CREATE TABLE IF NOT EXISTS reproduces the exact
-- live schema/constraints/RLS so a fresh environment provisioned from this
-- repo's migrations would end up with the same tables. It changes nothing
-- for the current production database.
--
-- Also adds a nullable organisation_id column to subscriptions, unused by
-- any code today, to be populated by a future org-creation mechanism
-- (Phase 3, not part of this migration). Nullable means zero impact on
-- existing rows or on the external app's inserts.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan text CHECK (plan = ANY (ARRAY['starter'::text, 'pro'::text, 'founder'::text])),
  subscription_status text NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'unpaid'::text])),
  is_founder boolean NOT NULL DEFAULT false,
  extra_users integer NOT NULL DEFAULT 0,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx ON public.subscriptions USING btree (stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;
CREATE POLICY subscriptions_select_own ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all for anon/authenticated by design (service-role only).

-- New column for future organisation linkage (Phase 3). Nullable, unused
-- by any current code path, no default fallback logic attached here.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations(id);

CREATE INDEX IF NOT EXISTS subscriptions_organisation_id_idx ON public.subscriptions (organisation_id);
