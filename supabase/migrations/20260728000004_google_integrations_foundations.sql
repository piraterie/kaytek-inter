-- Phase 1 (fondations) — modules Google Ads / Google Business Profile.
-- Canal de demande d'avis : EMAIL UNIQUEMENT (SMS définitivement abandonné
-- — aucune table, colonne, fonction ni secret SMS n'existe dans ce
-- fichier ni ailleurs dans ce dépôt).
--
-- Ce fichier ne contient AUCUN secret, AUCUNE clé, AUCUN token réel — il
-- ne fait que poser le schéma. Les tables google_ads_connections et
-- gbp_connections sont volontairement PRIVÉES : RLS activée, ZÉRO policy
-- accordée à anon/authenticated (deny-all), exactement comme
-- public.stripe_webhook_events (migration 20260709000002). Seul
-- service_role (rolbypassrls = true en local, confirmé par requête directe
-- sur pg_roles) peut lire/écrire ces tables.
--
-- Protection renforcée des tokens : access_token/refresh_token ne sont PAS
-- stockés en clair dans une colonne text de ces tables. Ils sont stockés
-- exclusivement dans Supabase Vault (extension pgsodium — chiffrement
-- authentifié at-rest), référencés ici par un simple id opaque
-- (*_secret_id uuid REFERENCES vault.secrets(id)). Vérifié en local :
-- vault.secrets / vault.decrypted_secrets ne sont accordées qu'à
-- service_role (SELECT, DELETE) — anon/authenticated n'ont AUCUN droit,
-- ni sur ces tables Vault, ni sur vault.create_secret()/update_secret()
-- (has_function_privilege confirmé false pour anon ET authenticated). La
-- Phase 2 (Edge Functions OAuth) écrira les tokens via
-- vault.create_secret()/vault.update_secret() et ne stockera ici que
-- l'id retourné — jamais la valeur en clair, nulle part.
--
-- Le client_secret de l'application OAuth Google (unique, global à
-- Kaytek, pas par organisation) n'a PAS sa place dans ces tables : il
-- vivra exclusivement en secret d'Edge Function (Phase 2), jamais en
-- base — donc par construction aucun rôle Postgres ne peut le lire, il
-- n'existe même pas de colonne pour lui ici.

-- ────────────────────────────────────────────────────────────────────────
-- 1. google_ads_connections (table privée, 1 ligne par organisation)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_connections (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL UNIQUE REFERENCES public.organisations(id) ON DELETE CASCADE,
  google_customer_id        text,
  google_login_customer_id  text,
  -- Références opaques vers Supabase Vault — jamais la valeur en clair ici.
  access_token_secret_id    uuid REFERENCES vault.secrets(id) ON DELETE SET NULL,
  refresh_token_secret_id   uuid REFERENCES vault.secrets(id) ON DELETE SET NULL,
  token_expires_at          timestamptz,
  scopes                    text,
  status                    text NOT NULL DEFAULT 'disconnected'
                              CHECK (status IN ('disconnected', 'connected', 'expired', 'revoked')),
  connected_by              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at              timestamptz,
  last_synced_at            timestamptz,
  last_error                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_ads_connections ENABLE ROW LEVEL SECURITY;
-- Aucune policy pour anon/authenticated : deny-all par design (service_role uniquement).

-- ────────────────────────────────────────────────────────────────────────
-- 2. gbp_connections (table privée, 1 ligne par organisation)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gbp_connections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL UNIQUE REFERENCES public.organisations(id) ON DELETE CASCADE,
  google_location_id       text,
  google_account_id        text,
  account_name             text,
  access_token_secret_id   uuid REFERENCES vault.secrets(id) ON DELETE SET NULL,
  refresh_token_secret_id  uuid REFERENCES vault.secrets(id) ON DELETE SET NULL,
  token_expires_at         timestamptz,
  scopes                   text,
  status                   text NOT NULL DEFAULT 'disconnected'
                             CHECK (status IN ('disconnected', 'connected', 'expired', 'revoked')),
  connected_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at             timestamptz,
  last_synced_at           timestamptz,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gbp_connections ENABLE ROW LEVEL SECURITY;
-- Aucune policy pour anon/authenticated : deny-all par design (service_role uniquement).

-- ────────────────────────────────────────────────────────────────────────
-- 3. google_ads_metrics_daily (série temporelle, écrite par service_role
--    uniquement — sync Edge Function Phase 3 — lue par les admins de l'org)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_metrics_daily (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  date               date NOT NULL,
  campaign_id        text NOT NULL DEFAULT '',
  campaign_name      text,
  impressions        bigint NOT NULL DEFAULT 0,
  clicks             bigint NOT NULL DEFAULT 0,
  cost_micros        bigint NOT NULL DEFAULT 0,
  conversions        numeric NOT NULL DEFAULT 0,
  conversions_value  numeric NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_metrics_daily_unique UNIQUE (organisation_id, date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_metrics_daily_org_date
  ON public.google_ads_metrics_daily (organisation_id, date);

ALTER TABLE public.google_ads_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_ads_metrics_select_admin" ON public.google_ads_metrics_daily;
CREATE POLICY "google_ads_metrics_select_admin" ON public.google_ads_metrics_daily
  FOR SELECT
  USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id));
-- Pas de policy INSERT/UPDATE/DELETE pour anon/authenticated : alimentée
-- exclusivement par la future Edge Function de synchronisation (service_role).

-- ────────────────────────────────────────────────────────────────────────
-- 4. gbp_reviews (cache local des avis Google Business Profile)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gbp_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  google_review_id      text NOT NULL,
  reviewer_display_name text,
  star_rating           smallint CHECK (star_rating BETWEEN 1 AND 5),
  comment                text,
  review_created_at     timestamptz,
  -- Rapprochement avis ↔ client : jamais garanti par l'API Google (pas
  -- d'email/téléphone du reviewer) — 'suggested' = heuristique par nom,
  -- 'confirmed' = validé manuellement par un admin. Voir plan §3.1.
  matched_client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  match_confidence      text NOT NULL DEFAULT 'none'
                          CHECK (match_confidence IN ('none', 'suggested', 'confirmed')),
  confirmed_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gbp_reviews_unique UNIQUE (organisation_id, google_review_id)
);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_org ON public.gbp_reviews (organisation_id);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_matched_client ON public.gbp_reviews (matched_client_id);

ALTER TABLE public.gbp_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gbp_reviews_select" ON public.gbp_reviews;
CREATE POLICY "gbp_reviews_select" ON public.gbp_reviews
  FOR SELECT
  USING (is_same_org(organisation_id) AND can_manage_operations(organisation_id));

-- Seule la confirmation manuelle du rapprochement (admin) est modifiable
-- depuis le frontend — l'insertion des avis reste réservée à service_role
-- (Edge Function de synchronisation, Phase 4).
DROP POLICY IF EXISTS "gbp_reviews_update_admin_confirm" ON public.gbp_reviews;
CREATE POLICY "gbp_reviews_update_admin_confirm" ON public.gbp_reviews
  FOR UPDATE
  USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id))
  WITH CHECK (organisation_id = current_org_id() AND is_admin_in_org(current_org_id()));

-- ────────────────────────────────────────────────────────────────────────
-- 5. review_requests (workflow de demande d'avis PAR E-MAIL après facture
--    envoyée — SMS définitivement abandonné, aucune colonne "channel")
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.review_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- NOT NULL + UNIQUE : une demande d'avis est TOUJOURS rattachée à une
  -- facture précise, et une seule demande par facture (jamais un
  -- déclenchement arbitraire hors du workflow d'envoi de facture — voir
  -- la policy INSERT ci-dessous, qui vérifie en plus que cette facture a
  -- réellement été envoyée : factures.envoyee_le IS NOT NULL).
  facture_id         uuid NOT NULL REFERENCES public.factures(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reminded_1', 'reminded_2',
                                           'stopped_review_detected', 'stopped_manual', 'expired')),
  sent_at            timestamptz,
  reminder_1_at      timestamptz,
  reminder_2_at      timestamptz,
  stopped_at         timestamptz,
  stopped_reason     text,
  matched_review_id  uuid REFERENCES public.gbp_reviews(id) ON DELETE SET NULL,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_requests_facture_unique UNIQUE (facture_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_org ON public.review_requests (organisation_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON public.review_requests (organisation_id, status);

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_requests_select" ON public.review_requests;
CREATE POLICY "review_requests_select" ON public.review_requests
  FOR SELECT
  USING (is_same_org(organisation_id) AND can_manage_operations(organisation_id));

-- INSERT : lié STRICTEMENT au workflow d'envoi de facture — impossible de
-- créer une demande d'avis "hors sol". La ligne facturée doit :
--   1. appartenir à la même organisation que la demande (anti cross-tenant) ;
--   2. avoir réellement été envoyée (factures.envoyee_le IS NOT NULL) —
--      empêche de générer une demande pour une facture en brouillon ou
--      jamais transmise au client ;
--   3. avoir pour client exactement le client_id fourni (anti-mismatch —
--      empêche d'associer la demande à un autre client que celui de la
--      facture réellement envoyée).
-- Et le rôle appelant doit être celui qui peut effectivement envoyer une
-- facture (admin, ou intervenant avec can_create_documents +
-- can_bypass_validation) — même condition que requireCanSendEmail() dans
-- supabase/functions/envoyer-email.
DROP POLICY IF EXISTS "review_requests_insert" ON public.review_requests;
CREATE POLICY "review_requests_insert" ON public.review_requests
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.factures f
      WHERE f.id = review_requests.facture_id
        AND f.organisation_id = current_org_id()
        AND f.envoyee_le IS NOT NULL
        AND f.client_id = review_requests.client_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organisation_id = current_org_id()
        AND p.actif = true
        AND (p.role = 'admin' OR (p.can_create_documents AND p.can_bypass_validation))
    )
  );

-- Arrêt manuel ("stopped_manual") réservé à l'admin ; les transitions
-- automatiques (relances, détection d'avis) sont écrites par service_role
-- (bypass RLS), pas par cette policy.
DROP POLICY IF EXISTS "review_requests_update_admin" ON public.review_requests;
CREATE POLICY "review_requests_update_admin" ON public.review_requests
  FOR UPDATE
  USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id))
  WITH CHECK (organisation_id = current_org_id() AND is_admin_in_org(current_org_id()));

-- ────────────────────────────────────────────────────────────────────────
-- 6. google_oauth_events (audit, deny-all — même pattern que
--    public.stripe_webhook_events)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_oauth_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('google_ads', 'google_business')),
  event_type       text NOT NULL,
  detail           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_oauth_events ENABLE ROW LEVEL SECURITY;
-- Aucune policy pour anon/authenticated : deny-all par design (service_role uniquement).
