-- ================================================================
-- MIGRATION : fréquence de relance, désinscription, rebonds/plaintes Brevo
-- Date      : 2026-08-04
-- ================================================================
-- 1. Fréquence minimale configurable entre deux demandes d'avis pour un
--    même client (organisation), vérifiée en base (trigger), pas
--    seulement côté UI.
-- 2. Suppressions (désinscription volontaire + bounce définitif + plainte
--    spam) : un e-mail supprimé pour une organisation ne reçoit plus
--    jamais de demande d'avis de cette organisation. Table dédiée,
--    append-only (historique complet), jamais partagée entre organisations.
-- 3. Token de désinscription OPAQUE (aléatoire, aucune donnée personnelle
--    encodée dedans) sur review_requests — résolu uniquement par lookup
--    serveur (service_role), jamais décodable côté client.
-- 4. Colonnes de corrélation webhook Brevo (message-id) + statuts de
--    livraison étendus (deferred/bounced_soft/bounced_hard/blocked/complained).
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Fréquence de relance — paramètres d'organisation
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.parametres_entreprise
  ADD COLUMN IF NOT EXISTS avis_google_relance_delai text NOT NULL DEFAULT '90j'
    CHECK (avis_google_relance_delai IN ('jamais', '30j', '60j', '90j', 'personnalise')),
  ADD COLUMN IF NOT EXISTS avis_google_relance_jours_personnalise integer
    CHECK (avis_google_relance_jours_personnalise IS NULL OR avis_google_relance_jours_personnalise > 0);

-- ────────────────────────────────────────────────────────────────
-- 2. review_requests — token de désinscription opaque, corrélation Brevo,
--    statuts de livraison étendus (webhook)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.review_requests
  ADD COLUMN IF NOT EXISTS unsubscribe_token text UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  ADD COLUMN IF NOT EXISTS brevo_message_id text,
  ADD COLUMN IF NOT EXISTS webhook_last_event text,
  ADD COLUMN IF NOT EXISTS webhook_last_event_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_review_requests_unsubscribe_token ON public.review_requests (unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_review_requests_brevo_message_id ON public.review_requests (brevo_message_id);

-- Statuts étendus : deferred (Brevo réessaie), bounced_soft (rebond
-- temporaire), bounced_hard (rebond définitif), blocked (adresse
-- invalide/bloquée), complained (plainte spam), unsubscribed_brevo
-- (désinscription détectée par Brevo, indépendante de notre propre lien —
-- traité comme un opt-out par le webhook).
ALTER TABLE public.review_requests DROP CONSTRAINT IF EXISTS review_requests_delivery_status_check;
ALTER TABLE public.review_requests ADD CONSTRAINT review_requests_delivery_status_check
  CHECK (delivery_status IN (
    'pending', 'sent', 'delivered', 'deferred',
    'bounced_soft', 'bounced_hard', 'blocked', 'complained', 'unsubscribed_brevo',
    'failed', 'cancelled'
  ));

-- ────────────────────────────────────────────────────────────────
-- 3. google_review_suppressions — désinscriptions + bounces/plaintes,
--    historique complet (append-only), jamais de croisement entre
--    organisations (l'unicité est PAR organisation, pas globale : un même
--    e-mail peut légitimement être client de plusieurs organisations
--    Kaytek Inter et se désinscrire de l'une sans affecter l'autre).
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_review_suppressions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  email                    text NOT NULL,
  reason                   text NOT NULL CHECK (reason IN ('opt_out', 'hard_bounce', 'complaint')),
  source_review_request_id uuid REFERENCES public.review_requests(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Un e-mail n'est supprimé qu'UNE fois par organisation et par raison — le
-- webhook/la désinscription sont idempotents (voir ON CONFLICT DO NOTHING
-- dans les Edge Functions correspondantes), pas d'accumulation de doublons.
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_review_suppressions_unique
  ON public.google_review_suppressions (organisation_id, lower(email), reason);
CREATE INDEX IF NOT EXISTS idx_google_review_suppressions_lookup
  ON public.google_review_suppressions (organisation_id, lower(email));

ALTER TABLE public.google_review_suppressions ENABLE ROW LEVEL SECURITY;

-- Lecture : admin/assistant de l'organisation uniquement (jamais une autre
-- organisation, jamais anon). Écriture : service_role uniquement (Edge
-- Functions désinscription/webhook) — aucune policy INSERT/UPDATE/DELETE
-- pour authenticated, un admin ne peut donc jamais se retirer lui-même de
-- la liste de suppression d'un client (protection contre un contournement
-- accidentel ou malveillant).
DROP POLICY IF EXISTS "google_review_suppressions_select" ON public.google_review_suppressions;
CREATE POLICY "google_review_suppressions_select" ON public.google_review_suppressions
  FOR SELECT
  USING (is_same_org(organisation_id) AND can_manage_operations(organisation_id));

-- ────────────────────────────────────────────────────────────────
-- 4. Trigger de garde — remplace trg_review_requests_require_client_email
--    (20260804000000) par une version qui vérifie EN PLUS : suppression
--    active (désinscription/bounce/plainte) et fréquence minimale
--    configurée par l'organisation. Un seul trigger, trois vérifications,
--    messages distincts (préfixe machine-lisible côté frontend) :
--      CLIENT_SANS_EMAIL / CLIENT_DESABONNE / FREQUENCE_BLOQUEE
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_review_requests_guard()
RETURNS trigger AS $$
DECLARE
  v_email        text;
  v_delai        text;
  v_jours_perso  integer;
  v_jours_requis integer;
BEGIN
  SELECT email INTO v_email FROM public.clients WHERE id = NEW.client_id;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'CLIENT_SANS_EMAIL: le client % n''a pas d''adresse e-mail — aucune demande d''avis possible (canal email uniquement)', NEW.client_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.google_review_suppressions s
    WHERE s.organisation_id = NEW.organisation_id AND lower(s.email) = lower(v_email)
  ) THEN
    RAISE EXCEPTION 'CLIENT_DESABONNE: % ne souhaite plus recevoir de demandes d''avis de cette organisation', v_email
      USING ERRCODE = '23514';
  END IF;

  SELECT avis_google_relance_delai, avis_google_relance_jours_personnalise
    INTO v_delai, v_jours_perso
    FROM public.parametres_entreprise WHERE organisation_id = NEW.organisation_id;
  v_delai := COALESCE(v_delai, '90j');

  IF v_delai = 'jamais' THEN
    IF EXISTS (
      SELECT 1 FROM public.review_requests rr
      JOIN public.clients c ON c.id = rr.client_id
      WHERE rr.organisation_id = NEW.organisation_id
        AND lower(c.email) = lower(v_email)
        AND rr.delivery_status IN ('sent', 'delivered', 'deferred')
    ) THEN
      RAISE EXCEPTION 'FREQUENCE_BLOQUEE: ce client a déjà reçu une demande d''avis (réglage organisation : ne jamais relancer)'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    v_jours_requis := CASE v_delai
      WHEN '30j' THEN 30
      WHEN '60j' THEN 60
      WHEN '90j' THEN 90
      WHEN 'personnalise' THEN COALESCE(v_jours_perso, 90)
      ELSE 90
    END;
    IF EXISTS (
      SELECT 1 FROM public.review_requests rr
      JOIN public.clients c ON c.id = rr.client_id
      WHERE rr.organisation_id = NEW.organisation_id
        AND lower(c.email) = lower(v_email)
        AND rr.delivery_status IN ('sent', 'delivered', 'deferred')
        AND rr.sent_at > now() - (v_jours_requis || ' days')::interval
    ) THEN
      RAISE EXCEPTION 'FREQUENCE_BLOQUEE: ce client a déjà reçu une demande d''avis dans les % derniers jours (réglage organisation)', v_jours_requis
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_review_requests_require_email ON public.review_requests;
DROP TRIGGER IF EXISTS trg_review_requests_guard_trigger ON public.review_requests;
CREATE TRIGGER trg_review_requests_guard_trigger
  BEFORE INSERT ON public.review_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_review_requests_guard();

-- Ancienne fonction remplacée — supprimée pour éviter toute confusion sur
-- laquelle des deux est réellement active (une seule doit exister).
DROP FUNCTION IF EXISTS public.trg_review_requests_require_client_email();

-- ────────────────────────────────────────────────────────────────
-- 5. Secret dédié webhook Brevo — Vault, jamais en clair, jamais
--    réutilisé pour un autre usage (séparé de internal_push_secret :
--    frontière de confiance différente, ce secret est connu de Brevo,
--    un service tiers, contrairement à internal_push_secret qui ne
--    quitte jamais l'infrastructure Supabase).
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_brevo_webhook_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'google_brevo_webhook_secret',
      'Secret partagé Brevo → google-brevo-webhook (query param ?secret=). À copier dans la config webhook Brevo après déploiement.'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Impossible de préparer google_brevo_webhook_secret (%) — schéma vault probablement indisponible.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.get_google_brevo_webhook_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_brevo_webhook_secret' LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_google_brevo_webhook_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_google_brevo_webhook_secret() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_brevo_webhook_secret() TO service_role;

-- ================================================================
-- Vérification bloquante
-- ================================================================
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(missing, ', ') INTO v_missing FROM (
    SELECT 'parametres_entreprise.avis_google_relance_delai' AS missing WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parametres_entreprise' AND column_name='avis_google_relance_delai')
    UNION ALL
    SELECT 'review_requests.unsubscribe_token' WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='review_requests' AND column_name='unsubscribe_token')
    UNION ALL
    SELECT 'google_review_suppressions' WHERE to_regclass('public.google_review_suppressions') IS NULL
    UNION ALL
    SELECT 'trigger trg_review_requests_guard_trigger' WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_review_requests_guard_trigger')
  ) t;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC — objet(s) manquant(s) après migration : %', v_missing;
  END IF;

  RAISE NOTICE 'OK — fréquence de relance, suppressions et garde-fous mis à jour avec succès.';
END $$;
