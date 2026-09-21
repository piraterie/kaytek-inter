-- ================================================================
-- MIGRATION : Google Ads — données horaires, appareils, démographie,
--             géographie, zones ciblées, statut réel des campagnes
-- Date      : 2026-09-21
-- ================================================================
-- 100 % ADDITIVE : uniquement de nouvelles tables + une colonne nullable
-- (google_ads_connections.metrics_synced_at). Aucune donnée ni table
-- existante n'est modifiée ou supprimée.
--
-- Chaque table est alimentée EXCLUSIVEMENT par les Edge Functions de
-- synchronisation (service_role, qui contourne la RLS) et lue par les
-- administrateurs de l'organisation — même logique que
-- google_ads_metrics_daily : SELECT USING (is_same_org AND is_admin_in_org),
-- aucune policy INSERT/UPDATE/DELETE pour anon/authenticated.
--
-- Toutes les dates (local_date) et heures (hour) sont exprimées dans le
-- FUSEAU DU COMPTE Google Ads (google_ads_connections.time_zone), jamais en
-- UTC. customer_id fait partie de chaque clé d'unicité : changer de compte
-- Google Ads sélectionné ne mélange jamais les données de deux comptes.
--
-- Schémas alignés sur ce que Google Ads API v25 retourne réellement
-- (validé en lecture seule le 2026-09-21) :
--  * âge et sexe viennent de deux ressources distinctes (age_range_view,
--    gender_view) ; le croisement âge × sexe est IMPOSSIBLE avec l'API →
--    une seule table, dimension ('age_range' | 'gender') + value, jamais
--    deux colonnes âge/sexe qui laisseraient croire à un croisement ;
--  * les valeurs Google (AGE_RANGE_UNDETERMINED, UNDETERMINED…) sont
--    conservées telles quelles ;
--  * Google ne fournit AUCUNE coordonnée pour une ville / un code postal :
--    ni latitude ni longitude dans les tables géographiques.
-- Les coûts sont en micros (comme google_ads_metrics_daily).
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 0. Horodatage dédié des métriques (jamais modifié par OAuth / refresh
--    de token / connexion Google, contrairement à last_synced_at)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.google_ads_connections
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz;

COMMENT ON COLUMN public.google_ads_connections.metrics_synced_at IS
  'Dernière synchronisation RÉUSSIE des métriques Google Ads (quotidienne, horaire ou manuelle). Écrit uniquement par la synchronisation des métriques — jamais par OAuth, le refresh de token ou la connexion.';

-- ────────────────────────────────────────────────────────────────
-- 1. google_ads_metrics_hourly — métriques par campagne, jour et heure
--    (fenêtre glissante courte : J-2 → aujourd'hui ; purge à 60 jours)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_metrics_hourly (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id        text NOT NULL,
  campaign_id        text NOT NULL,
  campaign_name      text,
  local_date         date NOT NULL,
  hour               smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  impressions        bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks             bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_micros        bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  conversions        numeric NOT NULL DEFAULT 0,
  conversions_value  numeric NOT NULL DEFAULT 0,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_metrics_hourly_unique
    UNIQUE (organisation_id, customer_id, local_date, hour, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_metrics_hourly_org_date
  ON public.google_ads_metrics_hourly (organisation_id, customer_id, local_date);

-- ────────────────────────────────────────────────────────────────
-- 2. google_ads_devices_daily — par appareil (niveau compte)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_devices_daily (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id        text NOT NULL,
  local_date         date NOT NULL,
  device             text NOT NULL,          -- MOBILE, DESKTOP, TABLET, CONNECTED_TV, OTHER… (valeur Google)
  impressions        bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks             bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_micros        bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  conversions        numeric NOT NULL DEFAULT 0,
  conversions_value  numeric NOT NULL DEFAULT 0,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_devices_daily_unique
    UNIQUE (organisation_id, customer_id, local_date, device)
);

-- ────────────────────────────────────────────────────────────────
-- 3. google_ads_demographics_daily — âge OU sexe (jamais croisés)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_demographics_daily (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id        text NOT NULL,
  local_date         date NOT NULL,
  dimension          text NOT NULL CHECK (dimension IN ('age_range', 'gender')),
  value              text NOT NULL,          -- AGE_RANGE_25_34, AGE_RANGE_UNDETERMINED, FEMALE, MALE, UNDETERMINED… (valeur Google)
  impressions        bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks             bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_micros        bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  conversions        numeric NOT NULL DEFAULT 0,
  conversions_value  numeric NOT NULL DEFAULT 0,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_demographics_daily_unique
    UNIQUE (organisation_id, customer_id, local_date, dimension, value)
);

-- ────────────────────────────────────────────────────────────────
-- 4. google_ads_geo_daily — où étaient réellement les utilisateurs
--    (geographic_view). Deux niveaux SÉPARÉS : ville et code postal
--    (couverture 99,8 % vs ~76 % — on ne les fusionne jamais).
--    Noms et région : voir google_geo_targets (jointure sur geo_target_id).
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_geo_daily (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id        text NOT NULL,
  local_date         date NOT NULL,
  geo_level          text NOT NULL CHECK (geo_level IN ('city', 'postal_code')),
  presence_type      text NOT NULL,          -- LOCATION_OF_PRESENCE | AREA_OF_INTEREST (valeur Google)
  geo_target_id      bigint NOT NULL,
  impressions        bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks             bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_micros        bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  conversions        numeric NOT NULL DEFAULT 0,
  conversions_value  numeric NOT NULL DEFAULT 0,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_geo_daily_unique
    UNIQUE (organisation_id, customer_id, local_date, geo_level, presence_type, geo_target_id)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_geo_daily_target
  ON public.google_ads_geo_daily (geo_target_id);

-- ────────────────────────────────────────────────────────────────
-- 5. google_ads_targeted_zones — zones CIBLÉES par les campagnes (positives)
--    Distinct de la présence réelle : jamais fusionné avec google_ads_geo_daily.
--    PROXIMITY : rayon avec latitude/longitude/distance fournis par Google
--    (dessinable). LOCATION : zone nommée (geo_target_id) SANS coordonnée.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_targeted_zones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id        text NOT NULL,
  campaign_id        text NOT NULL,
  campaign_name      text,
  campaign_status    text,
  criterion_id       bigint NOT NULL,
  zone_type          text NOT NULL CHECK (zone_type IN ('PROXIMITY', 'LOCATION')),
  latitude           double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude          double precision CHECK (longitude BETWEEN -180 AND 180),
  radius             numeric CHECK (radius > 0),
  radius_unit        text CHECK (radius_unit IN ('KILOMETERS', 'MILES')),
  geo_target_id      bigint,
  label              text,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_targeted_zones_unique
    UNIQUE (organisation_id, customer_id, campaign_id, criterion_id),
  -- Un rayon n'existe que s'il a RÉELLEMENT latitude, longitude, distance
  -- et unité : aucune coordonnée inventée.
  CONSTRAINT google_ads_targeted_zones_proximity_complete
    CHECK (zone_type <> 'PROXIMITY'
           OR (latitude IS NOT NULL AND longitude IS NOT NULL AND radius IS NOT NULL AND radius_unit IS NOT NULL)),
  -- Une zone nommée n'a jamais de coordonnées.
  CONSTRAINT google_ads_targeted_zones_location_no_coords
    CHECK (zone_type <> 'LOCATION' OR (latitude IS NULL AND longitude IS NULL AND radius IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_google_ads_targeted_zones_target
  ON public.google_ads_targeted_zones (geo_target_id) WHERE geo_target_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 6. google_ads_campaigns — statut RÉEL des campagnes (campaign.status)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_campaigns (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id               text NOT NULL,
  campaign_id               text NOT NULL,
  name                      text,
  status                    text NOT NULL,   -- ENABLED, PAUSED, REMOVED… (valeur Google, jamais déduite)
  advertising_channel_type  text,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_ads_campaigns_unique UNIQUE (organisation_id, customer_id, campaign_id)
);

-- ────────────────────────────────────────────────────────────────
-- 7. google_geo_targets — référentiel Google des zones (noms, type, région)
--    Données de référence publiques SANS coordonnées (Google n'en fournit pas).
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_geo_targets (
  geo_target_id         bigint PRIMARY KEY,
  name                  text,
  canonical_name        text,
  target_type           text,
  country_code          text,
  region_name           text,           -- extrait du nom canonique quand disponible (ex. « Occitanie »)
  parent_geo_target_id  bigint,
  status                text,
  synced_at             timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────
-- 8. google_ads_sync_state — état de synchronisation par jeu de données
--    (fraîcheur affichée « Données synchronisées à HH:mm », rattrapage
--    initial, limitation des synchronisations manuelles complètes)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_ads_sync_state (
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  customer_id      text NOT NULL,
  dataset          text NOT NULL CHECK (dataset IN
                     ('hourly', 'devices', 'demographics', 'geo', 'structure', 'manual_full')),
  synced_at        timestamptz,          -- dernière synchronisation RÉUSSIE de ce jeu de données
  attempted_at     timestamptz,          -- dernière tentative (réussie ou non)
  backfilled_at    timestamptz,          -- rattrapage initial terminé (devices/demographics/geo)
  last_error       text,                 -- code d'erreur nettoyé, jamais un jeton
  PRIMARY KEY (organisation_id, customer_id, dataset)
);

-- ────────────────────────────────────────────────────────────────
-- RLS — identique à google_ads_metrics_daily
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'google_ads_metrics_hourly', 'google_ads_devices_daily', 'google_ads_demographics_daily',
    'google_ads_geo_daily', 'google_ads_targeted_zones', 'google_ads_campaigns', 'google_ads_sync_state'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id))',
      t || '_select_admin', t);
    -- Défense en profondeur : aucun droit d'écriture pour anon/authenticated
    -- (l'écriture passe uniquement par service_role, qui contourne la RLS).
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;
END $$;

-- google_geo_targets : référentiel partagé entre organisations. Pour ne jamais
-- révéler à une organisation les zones où une AUTRE reçoit du trafic, une
-- ligne n'est lisible que si elle est référencée par des données de sa
-- PROPRE organisation (les sous-requêtes appliquent la RLS des tables
-- référencées).
ALTER TABLE public.google_geo_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "google_geo_targets_select_referenced" ON public.google_geo_targets;
CREATE POLICY "google_geo_targets_select_referenced" ON public.google_geo_targets
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.google_ads_geo_daily g WHERE g.geo_target_id = google_geo_targets.geo_target_id)
    OR EXISTS (SELECT 1 FROM public.google_ads_targeted_zones z WHERE z.geo_target_id = google_geo_targets.geo_target_id)
  );
REVOKE ALL ON public.google_geo_targets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.google_geo_targets FROM authenticated;
