#!/usr/bin/env node
// scripts/run-deno-tests.mjs
// Exécuteur Node portable (Windows/Linux/macOS) des tests Deno des Edge
// Functions (supabase/functions/_shared/*.test.ts, et le handler
// google-oauth-callback).
//
// Pourquoi un wrapper et pas un simple `deno test supabase/functions/_shared/` :
// google-ads-api-no-devtoken.test.ts vérifie le comportement quand
// GOOGLE_ADS_DEVELOPER_TOKEN est ABSENT, alors que google-ads-api.test.ts
// (et les autres fichiers _shared/*.test.ts) exigent au contraire qu'il soit
// défini. Deno partage un seul cache de modules par invocation de `deno
// test` : si les deux fichiers sont exécutés dans le même process, celui
// qui s'exécute en second réutilise la valeur déjà lue par le premier au
// chargement du module (google-ads-api.ts la lit une seule fois), rendant
// son scénario invérifiable. D'où deux invocations séparées ici — jamais
// concaténées — chacune avec son propre environnement.
//
// Ce fichier existe parce que ces tests Deno (couvrant notamment la
// vérification du state OAuth — signature HMAC, expiration, rejeu — et le
// parsing des réponses Google Ads/Business Profile) existaient déjà mais
// n'étaient reliés à aucun script npm ni à la CI : ils ne s'exécutaient
// donc jamais automatiquement. `npm run test:deno` les couvre désormais
// tous.
//
// Périmètre volontairement limité aux tests Google sur cette branche
// d'intégration (integration/google-connection-main) : emailContract.ts/
// .test.ts appartient à un chantier distinct (email-contract-hardening),
// non intégré ici — voir le rapport d'intégration.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHARED_DIR = 'supabase/functions/_shared'

// Tous les fichiers de test _shared/*.test.ts SAUF le scénario "token
// absent", qui doit tourner seul (voir explication ci-dessus).
const STANDARD_TEST_FILES = [
  'google-oauth-state.test.ts',
  'google-oauth-refresh.test.ts',
  'google-oauth-auth.test.ts',
  'google-business-api.test.ts',
  'google-ads-api.test.ts',
].map((f) => path.posix.join(SHARED_DIR, f))

const NO_DEVTOKEN_TEST_FILE = path.posix.join(SHARED_DIR, 'google-ads-api-no-devtoken.test.ts')

// Tests des handlers hors _shared/ (chemins complets, pas de join sur
// SHARED_DIR) :
//  - google-oauth-callback : branches de rejet précoce (consentement
//    refusé, paramètres manquants, state invalide/expiré) ;
//  - google-select-connection : régression sur le bug corrigé lors de
//    l'audit du 2026-08-04 — la validation de locationResourceName
//    rejetait TOUJOURS une sélection Business Profile légitime.
const CALLBACK_TEST_FILE = 'supabase/functions/google-oauth-callback/index.test.ts'
const SELECT_CONNECTION_TEST_FILE = 'supabase/functions/google-select-connection/index.test.ts'

// Handlers publics de la fréquence/désinscription/webhook Brevo (2026-08-05) :
//  - google-brevo-webhook : secret erroné rejeté, hard bounce/plainte
//    créent bien une suppression scopée à l'organisation d'origine ;
//  - google-review-unsubscribe : token opaque valide/invalide/expiré,
//    idempotence de la confirmation, GET jamais destructif.
const BREVO_WEBHOOK_TEST_FILE = 'supabase/functions/google-brevo-webhook/index.test.ts'
const REVIEW_UNSUBSCRIBE_TEST_FILE = 'supabase/functions/google-review-unsubscribe/index.test.ts'

// Valeurs factices — jamais un secret réel, uniquement des chaînes lues par
// les mocks des tests pour emprunter le chemin "developer token présent".
// SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY sont toujours forcées ici (jamais
// héritées de l'environnement de l'exécutant, même si un vrai projet y est
// configuré) : google-oauth-auth.test.ts intercepte tout fetch vers ces
// URLs, un vrai SUPABASE_URL de production romprait cette isolation en cas
// de mock manquant/incomplet.
const FAKE_TEST_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-dev-token',
  GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://example.local/callback',
  GOOGLE_OAUTH_STATE_SECRET: 'test-state-secret',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
}

function runDeno(label, files, env) {
  console.log(`[test:deno] ${label}...`)
  const result = spawnSync(
    'deno',
    ['test', '--allow-env', ...files],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
      env,
      // shell: true — requis sur Windows pour les mêmes raisons que les
      // autres wrappers de ce dossier (spawnSync d'un binaire externe sans
      // shell échoue silencieusement en EINVAL sur Windows). Arguments
      // strictement statiques ci-dessus, aucune entrée utilisateur.
      shell: process.platform === 'win32',
    }
  )
  if (result.error) {
    console.error(`[test:deno] ÉCHEC — impossible de lancer Deno (${label}).`)
    console.error(`  → ${result.error.message}`)
    console.error('  Deno doit être installé et présent dans le PATH (https://deno.com/).')
    return false
  }
  if (result.status !== 0) {
    console.error(`[test:deno] ÉCHEC — ${label} (code ${result.status}).`)
    return false
  }
  return true
}

function main() {
  // Environnement du process hérité, avec les valeurs de test forcées —
  // jamais une valeur réelle potentiellement présente dans l'environnement
  // de l'exécutant ne doit se substituer aux valeurs factices attendues par
  // les mocks.
  const standardEnv = { ...process.env, ...FAKE_TEST_ENV }

  // Environnement SANS GOOGLE_ADS_DEVELOPER_TOKEN, même s'il était défini
  // dans l'environnement de l'exécutant (sinon le scénario "absent" ne
  // teste plus rien).
  const noDevTokenEnv = { ...process.env }
  delete noDevTokenEnv.GOOGLE_ADS_DEVELOPER_TOKEN

  const okStandard = runDeno('suite standard (Google OAuth state/refresh/Ads/Business)', STANDARD_TEST_FILES, standardEnv)
  const okNoDevToken = runDeno('scénario developer token absent (isolé)', [NO_DEVTOKEN_TEST_FILE], noDevTokenEnv)
  const okCallback = runDeno('google-oauth-callback (rejets précoces)', [CALLBACK_TEST_FILE], standardEnv)
  const okSelectConnection = runDeno('google-select-connection (régression sélection GBP)', [SELECT_CONNECTION_TEST_FILE], standardEnv)
  const okBrevoWebhook = runDeno('google-brevo-webhook (secret, bounce/plainte)', [BREVO_WEBHOOK_TEST_FILE], standardEnv)
  const okReviewUnsubscribe = runDeno('google-review-unsubscribe (token opaque valide/invalide/expiré)', [REVIEW_UNSUBSCRIBE_TEST_FILE], standardEnv)

  if (!okStandard || !okNoDevToken || !okCallback || !okSelectConnection || !okBrevoWebhook || !okReviewUnsubscribe) {
    process.exit(1)
  }
  console.log('[test:deno] OK — toutes les suites Deno ont réussi.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main()
}
