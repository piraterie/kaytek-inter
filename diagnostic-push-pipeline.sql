-- ================================================================
-- DIAGNOSTIC COMPLET DU PIPELINE PUSH NOTIFICATIONS
-- Exécuter dans Supabase → SQL Editor → Run
-- Lire les résultats section par section
-- ================================================================

-- ── [1] Vérifier que pg_net est activé ───────────────────────────
SELECT 'pg_net extension' AS check,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN '✅ ACTIVE' ELSE '❌ ABSENTE — PROBLÈME CRITIQUE' END AS status;

-- ── [2] Vérifier la table push_subscriptions ─────────────────────
SELECT 'push_subscriptions' AS check,
  count(*) AS total_abonnements,
  count(DISTINCT user_id) AS utilisateurs_distincts
FROM public.push_subscriptions;

-- ── [3] Voir les souscriptions existantes ────────────────────────
SELECT
  ps.id,
  p.email,
  p.prenom,
  p.nom,
  p.role,
  left(ps.endpoint, 60) || '…' AS endpoint_court,
  ps.created_at
FROM public.push_subscriptions ps
JOIN public.profiles p ON p.id = ps.user_id
ORDER BY ps.created_at DESC;

-- ── [4] Vérifier le trigger sur notifications ─────────────────────
SELECT 'trigger notifications' AS check,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_push_on_notification'
    AND event_object_table = 'notifications'
  ) THEN '✅ EXISTE' ELSE '❌ ABSENT — push via DB non fonctionnel' END AS status;

-- ── [5] Détail du trigger ─────────────────────────────────────────
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'notifications'
ORDER BY trigger_name;

-- ── [6] Vérifier la fonction trigger ─────────────────────────────
SELECT 'fonction trigger_push_on_notification' AS check,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_push_on_notification'
  ) THEN '✅ EXISTE' ELSE '❌ ABSENTE' END AS status;

-- ── [7] Voir le corps de la fonction trigger ──────────────────────
SELECT prosrc AS code_fonction
FROM pg_proc
WHERE proname = 'trigger_push_on_notification';

-- ── [8] Vérifier les RLS sur notifications ────────────────────────
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY cmd;

-- ── [9] Vérifier les requêtes pg_net récentes (appels HTTP sortants)
-- Montre si le trigger a bien appelé send-push
SELECT
  id,
  method,
  left(url, 80) AS url_court,
  status_code,
  left(response_body::text, 200) AS reponse_courte,
  created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;

-- ── [10] Test direct : insérer une notification de test ──────────
-- ATTENTION : remplace 'ID_UTILISATEUR_CIBLE' par un vrai UUID de profiles
-- Exemple : SELECT id FROM profiles WHERE role = 'intervenant' LIMIT 1;
-- Après insertion → regarder les logs Edge Functions + net._http_response

-- DÉCOMMENTE LES 5 LIGNES CI-DESSOUS ET REMPLACE L'UUID POUR TESTER :
/*
INSERT INTO public.notifications (user_id, titre, contenu, type, lue, lien)
VALUES (
  (SELECT id FROM public.profiles WHERE role = 'intervenant' LIMIT 1),
  '🔔 Test pipeline push',
  'Si vous voyez cette notification sur votre téléphone, le pipeline fonctionne.',
  'info',
  false,
  '/dashboard'
);
*/

-- ── [11] Vérifier les dernières notifications créées ─────────────
SELECT n.id, p.email, n.titre, n.contenu, n.lue, n.created_at
FROM public.notifications n
JOIN public.profiles p ON p.id = n.user_id
ORDER BY n.created_at DESC
LIMIT 10;
