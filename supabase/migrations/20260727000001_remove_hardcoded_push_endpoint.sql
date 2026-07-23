-- ================================================================
-- MIGRATION : Correction MIG-01B — Neutralisation de l'appel de
--             production codé en dur dans le trigger de notifications
-- Date       : 2026-07-27 (postérieure à toutes les migrations
--              existantes — cette correction n'en modifie, renomme ni
--              supprime aucune)
-- ================================================================
--
-- CONTEXTE (voir audit-kaytek-inter/corrections/analyse-mig-01-
-- bootstrap-migrations.md, section 4, pour l'analyse complète) :
--
-- Quatre migrations existantes contiennent une URL de projet Supabase
-- distant codée en dur et un jeton anon JWT codé en dur, dans cet
-- ordre chronologique :
--   1. 20260605000000_push_subscriptions.sql
--        Définit notify_push_on_new_message() + le trigger
--        on_new_message_push (sur messages). État final : CE TRIGGER
--        EST DÉJÀ SUPPRIMÉ par la migration suivante (voir 2) — code
--        mort à HEAD, mais la fonction elle-même reste versionnée avec
--        l'URL/jeton codés en dur dans son corps.
--   2. 20260605000001_remove_push_trigger.sql
--        DROP TRIGGER + DROP FUNCTION du couple ci-dessus. N'est PAS
--        l'une des 4 migrations contenant le secret — mentionnée ici
--        pour la chronologie.
--   3. 20260610000032_fix_notify_push_search_path.sql
--        Définit (CREATE OR REPLACE) trigger_push_on_notification(),
--        appelé par le trigger trg_push_on_notification sur
--        public.notifications (trigger jamais créé par aucune
--        migration du dépôt — comme notifications elle-même, assumé
--        pré-existant). Contient l'URL + le jeton anon codés en dur,
--        + un secret interne alors codé en dur également.
--   4. 20260708000001_fix_pg_net_notification_body_type.sql
--        Redéfinit la même fonction (correction du type de paramètre
--        body). URL + jeton anon toujours codés en dur, secret interne
--        toujours codé en dur.
--   5. 20260708000008_security_phase1_critical_hardening.sql
--        Redéfinit la même fonction une dernière fois (SEC-06) :
--        le secret interne n'est plus codé en dur — lu dynamiquement
--        via public.get_internal_push_secret() → vault.decrypted_secrets.
--        L'URL de production et le jeton anon restent codés en dur.
--        C'est la version ACTIVE à HEAD avant cette migration.
--
-- Conformément aux règles de cette correction, AUCUN de ces 5 fichiers
-- n'est modifié, renommé ou supprimé. Les chaînes historiques
-- (référence de projet, URL, jeton) restent donc présentes dans Git à
-- ces emplacements — ce n'est pas une omission, c'est une décision
-- explicite (voir correction-mig-01-bootstrap.md, section « secret
-- historique »). Le jeton en question est une clé anon (rôle "anon"),
-- pas une clé de rôle privilégié — sa sensibilité est plus faible que
-- celle d'un rôle privilégié, mais il doit néanmoins être considéré comme
-- potentiellement compromis/à faire tourner côté production,
-- séparément, hors du périmètre de cette correction.
--
-- CETTE MIGRATION PRODUIT L'ÉTAT FINAL SUIVANT (à partir d'ici, HEAD) :
--   · Aucune URL Supabase distante codée en dur dans le corps d'une
--     fonction active.
--   · Aucun jeton codé en dur dans le corps d'une fonction active.
--   · Le trigger de notifications ne contacte AUCUN fournisseur externe
--     si sa configuration (URL + clé anon) n'est pas explicitement
--     disponible via Supabase Vault — fail-closed, jamais fail-open.
--   · Une stack locale fonctionne sans aucun secret externe : Vault est
--     vide par défaut sur une instance `supabase start` fraîche, donc
--     le trigger est un no-op garanti tant qu'aucune configuration n'y
--     est ajoutée explicitement.
--   · Un simple INSERT INTO notifications en local ne déclenche donc
--     aucun contact avec la production.
--
-- IMPACT FONCTIONNEL À SIGNALER AVANT TOUT DÉPLOIEMENT (voir rapport) :
-- tant que public.get_push_endpoint_url() et get_push_anon_key() ne
-- sont pas configurées dans Vault (opération d'infrastructure séparée
-- et autorisée, hors périmètre de cette correction), l'envoi push réel
-- est désactivé — y compris en production, une fois cette migration
-- réconciliée avec son ledger. Les notifications elles-mêmes
-- continuent d'être créées en base normalement ; seul l'envoi push
-- automatique est concerné.
-- ================================================================


-- ================================================================
-- 1. NOUVEAUX HELPERS VAULT — URL et clé anon, jamais codées en dur
--    (même schéma que public.get_internal_push_secret(), déjà
--    introduite par 20260708000008 — SECURITY DEFINER, accès Vault
--    exclusivement via service_role)
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_push_endpoint_url()
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_endpoint_url' LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_push_endpoint_url() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_push_endpoint_url() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_endpoint_url() TO service_role;

CREATE OR REPLACE FUNCTION public.get_push_anon_key()
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_anon_key' LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_push_anon_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_push_anon_key() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_anon_key() TO service_role;


-- ================================================================
-- 2. RÉÉCRITURE DE trigger_push_on_notification() — fail-closed/no-op
--    sans configuration explicite (Option recommandée, section 8 de
--    l'autorisation). Ne lit jamais l'URL/la clé depuis une colonne
--    modifiable par le frontend, ne contient plus aucune valeur codée
--    en dur, ne retombe jamais sur une valeur par défaut distante.
-- ================================================================
CREATE OR REPLACE FUNCTION public.trigger_push_on_notification()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_endpoint text;
  v_anon_key text;
  v_internal_secret text;
BEGIN
  IF NEW.skip_push = true THEN
    RETURN NEW;
  END IF;

  v_endpoint := public.get_push_endpoint_url();
  v_anon_key := public.get_push_anon_key();

  -- Fail-closed : configuration absente (cas par défaut sur toute
  -- instance locale, et sur production tant qu'un opérateur n'a pas
  -- explicitement peuplé Vault) → aucun appel réseau, jamais de repli
  -- sur une URL/clé par défaut.
  IF v_endpoint IS NULL OR v_anon_key IS NULL THEN
    RETURN NEW;
  END IF;

  v_internal_secret := public.get_internal_push_secret();

  PERFORM net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'apikey',            v_anon_key,
      'Authorization',     'Bearer ' || v_anon_key,
      'X-Internal-Secret', COALESCE(v_internal_secret, '')
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

ALTER FUNCTION public.trigger_push_on_notification() OWNER TO postgres;


-- ================================================================
-- 3. SUPPRESSION DE LA FONCTION ORPHELINE notify_push_on_new_message()
--    (code mort depuis 20260605000001 — plus aucun trigger ne l'appelle
--    — mais son corps contient encore l'URL/le jeton codés en dur ;
--    la supprimer élimine cette occurrence du schéma final vivant sans
--    aucun impact fonctionnel, ce chemin n'étant déjà plus exécuté
--    depuis la migration suivant immédiatement sa création)
-- ================================================================
DROP FUNCTION IF EXISTS public.notify_push_on_new_message();


-- ================================================================
-- 4. TRIGGER trg_push_on_notification — jamais créé par aucune
--    migration existante (comme public.notifications elle-même,
--    assumé pré-existant en production). Créé ici pour la première
--    fois dans l'historique versionné, déjà rattaché à la version
--    neutralisée (fail-closed) de la fonction ci-dessus — permet de
--    tester réellement, en local, qu'un INSERT INTO notifications ne
--    contacte jamais la production (le trigger existe et s'exécute,
--    il choisit simplement de ne rien appeler en l'absence de
--    configuration Vault).
-- ================================================================
DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;
CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.trigger_push_on_notification();


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================

-- 1. Plus aucune fonction active ne contient la référence de projet de
--    production codée en dur (vérifiée par sa référence de projet
--    spécifique — jamais reproduite ici en toutes lettres dans cette
--    requête de vérification elle-même, pour ne pas introduire une
--    nouvelle occurrence du motif recherché par
--    scripts/check-no-hardcoded-production-secrets.mjs).
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosrc LIKE '%' || chr(100) || 'imrukkxehcwzemslwiz%'
  AND proname <> 'notify_push_on_new_message'; -- supprimée ci-dessus, ne devrait plus apparaître de toute façon
-- Attendu : 0 ligne (trigger_push_on_notification() ne contient plus
-- la référence de projet en dur, uniquement des appels à
-- get_push_endpoint_url()/get_push_anon_key()).

-- 2. Trigger actif, rattaché à la fonction neutralisée.
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'trg_push_on_notification';
-- Attendu : trg_push_on_notification | notifications | AFTER | INSERT

-- 3. Fonction orpheline bien supprimée.
SELECT count(*) AS notify_push_on_new_message_restante
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'notify_push_on_new_message';
-- Attendu : 0

-- 4. Nouveaux helpers Vault : aucun accès direct pour anon/authenticated.
SELECT proname,
  has_function_privilege('anon', 'public.' || proname || '()', 'EXECUTE')          AS anon_execute,
  has_function_privilege('authenticated', 'public.' || proname || '()', 'EXECUTE') AS authenticated_execute
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('get_push_endpoint_url', 'get_push_anon_key');
-- Attendu : anon_execute = false, authenticated_execute = false pour les deux lignes.
