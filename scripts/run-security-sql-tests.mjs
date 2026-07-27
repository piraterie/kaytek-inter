#!/usr/bin/env node
// scripts/run-security-sql-tests.mjs
// Correction 6 (TEST-01) — exécuteur Node portable (Windows/Linux/macOS)
// des tests SQL des Corrections 2 à 5. Chaque fichier .sql gère sa propre
// transaction (BEGIN ... ROLLBACK) : ils sont exécutés un par un via un
// sous-processus `psql` dédié — jamais concaténés — pour ne jamais faire
// fuir l'état d'une transaction dans une autre.
//
// N'exécute jamais rien contre un projet Supabase distant : réutilise le
// même garde central que toutes les autres suites (runPreflight), qui
// valide que SUPABASE_TEST_DB_URL pointe vers un hôte local.
//
// TEST-02 — sur cette machine, le client `psql` natif n'est pas
// disponible (Windows/Git-Bash sans installation PostgreSQL séparée).
// Repli automatique : exécution via `docker exec -i <conteneur> psql`
// sur le conteneur Postgres du stack Supabase local déjà démarré par
// `supabase start`. Le SQL est transmis par STDIN (jamais via un chemin
// de fichier passé au conteneur) pour éviter la conversion de chemin
// MSYS/Git-Bash sur Windows (`/tmp/...` réécrit en `C:/...`) et pour
// rester strictement identique sur Windows/Linux/macOS. Le conteneur
// est détecté par l'image Docker qu'il fait tourner (ancre
// `/supabase/postgres:`), jamais par un nom de conteneur en dur : ce nom
// dépend du nom du projet (`supabase_db_<projet>`) et n'est donc pas un
// identifiant stable sur toutes les machines/projets. Aucune commande ne
// touche jamais une base distante : `runPreflight()` a déjà validé que
// SUPABASE_TEST_DB_URL pointe vers un hôte local avant que ce mode ne
// soit même envisagé.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

// Ancre stricte : distingue le conteneur Postgres réel des autres
// images `supabase/postgres-*` (ex. `supabase/postgres-meta`) et de
// `supabase/postgrest`, qui ne correspondent pas à la base de données.
const POSTGRES_IMAGE_PATTERN = /\/supabase\/postgres:/

let dockerContainerId = null // résolu une seule fois par exécution, jamais recalculé par fichier

const TEST_FILES_DIR = 'audit-kaytek-inter/corrections/tests'

// Ordre imposé : Correction 2 (helpers d'accès) doit s'exécuter avant les
// autres car les Corrections 3+ en dépendent implicitement (organisations
// actives/abonnements) ; sinon, ordre chronologique des corrections.
const SQL_TEST_FILES = [
  'correction-02-helper-tests.sql',
  'correction-03-partner-rls-tests.sql',
  'correction-03b-partner-preview-rpc-tests.sql',
  'correction-04-numbering-tests.sql',
  'correction-05-commission-tests.sql',
  'correction-06-google-integrations-rls-tests.sql',
  'correction-07-google-oauth-phase2-tests.sql',
  'correction-08-google-account-selection-tests.sql',
]

// Objets Postgres dont la présence prouve que les migrations des
// Corrections 2 à 5 sont réellement appliquées sur la base ciblée — pas
// seulement que les fichiers de migration existent dans le dépôt.
const REQUIRED_DB_OBJECTS = [
  { label: 'fonction current_organisation_has_app_access (Correction 2)',
    sql: "SELECT to_regprocedure('public.current_organisation_has_app_access()') IS NOT NULL" },
  { label: 'table document_counters (Correction 4)',
    sql: "SELECT to_regclass('public.document_counters') IS NOT NULL" },
  { label: 'fonction next_document_number (Correction 4)',
    sql: "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'next_document_number')" },
  { label: 'fonction calculate_commission_for_facture (Correction 5)',
    sql: "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_commission_for_facture')" },
  { label: 'table google_ads_connections (Correction 6)',
    sql: "SELECT to_regclass('public.google_ads_connections') IS NOT NULL" },
  { label: 'table review_requests (Correction 6)',
    sql: "SELECT to_regclass('public.review_requests') IS NOT NULL" },
  { label: 'colonne factures.envoyee_le (Correction 6)',
    sql: "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='factures' AND column_name='envoyee_le')" },
  { label: 'table google_oauth_states (Correction 7)',
    sql: "SELECT to_regclass('public.google_oauth_states') IS NOT NULL" },
  { label: 'fonction google_oauth_vault_create (Correction 7)',
    sql: "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'google_oauth_vault_create')" },
]

function fail(message) {
  console.error(`[test:security:sql] ÉCHEC — ${message}`)
  process.exit(1)
}

// Repère le conteneur Postgres du stack Supabase local via l'image qu'il
// exécute (jamais via un nom de conteneur en dur). Échoue explicitement
// si aucun conteneur ou plusieurs conteneurs correspondent — mieux vaut
// arrêter que de deviner lequel utiliser.
function detectDockerPostgresContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.ID}}\t{{.Image}}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  if (result.error || result.status !== 0) {
    return null
  }
  const matches = (result.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => POSTGRES_IMAGE_PATTERN.test(line))
    .map(line => line.split('\t')[0])

  if (matches.length === 0) {
    fail('aucun conteneur Docker exécutant une image `supabase/postgres:*` n\'a été trouvé. Démarrer le stack local avec `supabase start` avant d\'exécuter cette suite.')
  }
  if (matches.length > 1) {
    fail(`plusieurs conteneurs Docker correspondent à l'image \`supabase/postgres:*\` (${matches.join(', ')}) — impossible de choisir sans ambiguïté. Arrêter les stacks Supabase superflus avant de relancer cette suite.`)
  }
  return matches[0]
}

function runPsqlNative(args, sqlInput, { silent = false } = {}) {
  const dbUrl = process.env.SUPABASE_TEST_DB_URL
  return spawnSync('psql', [dbUrl, ...args], {
    input: sqlInput,
    stdio: silent ? ['pipe', 'pipe', 'pipe'] : (sqlInput !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit'),
    encoding: 'utf-8',
  })
}

function runPsqlDocker(args, sqlInput, { silent = false } = {}) {
  // -U postgres -d postgres : identifiants par défaut du conteneur
  // Postgres local Supabase CLI (identiques à ceux de SUPABASE_TEST_DB_URL,
  // déjà validée comme locale par runPreflight()). Le SQL transite
  // toujours par STDIN, jamais par un chemin de fichier passé au
  // conteneur (voir note d'en-tête sur la conversion de chemin MSYS).
  return spawnSync(
    'docker',
    ['exec', '-i', dockerContainerId, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
    {
      input: sqlInput,
      stdio: silent ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
      encoding: 'utf-8',
    }
  )
}

// Point d'entrée unique utilisé par le reste du script : bascule
// automatiquement entre `psql` natif et le repli Docker, sans jamais
// changer le comportement observable (mêmes options `-v ON_ERROR_STOP=1`,
// même flux SQL, même code de sortie propagé).
function runPsql(args, sqlInput, opts) {
  if (dockerContainerId) {
    return runPsqlDocker(args, sqlInput, opts)
  }
  return runPsqlNative(args, sqlInput, opts)
}

function checkPsqlAvailable() {
  const native = spawnSync('psql', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' })
  if (!native.error && native.status === 0) {
    console.log(`[test:security:sql] psql natif détecté : ${(native.stdout || '').trim()}`)
    return
  }

  console.log('[test:security:sql] psql natif introuvable dans le PATH — repli sur `docker exec` vers le conteneur Postgres local.')
  const containerId = detectDockerPostgresContainer()
  const dockerVersion = spawnSync('docker', ['exec', containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  if (dockerVersion.error || dockerVersion.status !== 0) {
    fail(`impossible d'exécuter \`psql\` dans le conteneur Docker ${containerId}.\n${dockerVersion.stderr || ''}`)
  }
  dockerContainerId = containerId
  console.log(`[test:security:sql] psql (via docker exec, conteneur ${containerId}) détecté : ${(dockerVersion.stdout || '').trim()}`)
}

function checkDbConnectivity() {
  const result = runPsql(['-t', '-v', 'ON_ERROR_STOP=1'], 'SELECT 1;\n', { silent: true })
  if (result.status !== 0) {
    fail(`impossible de se connecter à la base de test locale (Supabase local démarré ? \`supabase start\`).\n${result.stderr || ''}`)
  }
  console.log('[test:security:sql] Connexion à la base de test locale confirmée.')
}

function checkMigrationsApplied() {
  console.log('[test:security:sql] Vérification de la présence réelle des objets des Corrections 2 à 5...')
  for (const obj of REQUIRED_DB_OBJECTS) {
    const result = runPsql(['-t', '-A', '-v', 'ON_ERROR_STOP=1'], `${obj.sql};\n`, { silent: true })
    const present = result.status === 0 && result.stdout.trim() === 't'
    if (!present) {
      fail(`objet manquant sur la base de test : ${obj.label}. Les migrations des Corrections 2 à 5 doivent être appliquées avant d'exécuter cette suite (\`supabase db reset\` ou application manuelle des migrations).`)
    }
    console.log(`  - OK : ${obj.label}`)
  }
}

function runSqlTestFiles() {
  const summary = []
  for (const fileName of SQL_TEST_FILES) {
    const filePath = path.posix.join(TEST_FILES_DIR, fileName)
    if (!existsSync(filePath)) {
      fail(`fichier de test introuvable : ${filePath}`)
    }

    console.log(`\n[test:security:sql] ── Exécution de ${fileName} ──────────────────────────`)
    const startedAt = Date.now()
    const sqlContent = readFileSync(filePath, 'utf-8')
    const result = runPsql(['-v', 'ON_ERROR_STOP=1'], sqlContent)
    const durationMs = Date.now() - startedAt

    if (result.status !== 0) {
      summary.push({ file: fileName, ok: false, durationMs })
      console.error(`[test:security:sql] ÉCHEC dans ${fileName} (code de sortie ${result.status}).`)
      printSummary(summary)
      console.error('[test:security:sql] Arrêt immédiat — les fichiers suivants ne sont pas exécutés.')
      process.exit(1)
    }

    summary.push({ file: fileName, ok: true, durationMs })
    console.log(`[test:security:sql] ${fileName} — OK (${durationMs} ms)`)
  }
  return summary
}

function printSummary(summary) {
  console.log('\n[test:security:sql] Résumé :')
  for (const entry of summary) {
    console.log(`  - ${entry.ok ? 'OK  ' : 'FAIL'} : ${entry.file}`)
  }
  const executed = summary.length
  const total = SQL_TEST_FILES.length
  if (executed < total) {
    console.log(`  - NON EXÉCUTÉS : ${total - executed} fichier(s)`)
  }
}

function main() {
  runPreflight()
  checkPsqlAvailable()
  checkDbConnectivity()
  checkMigrationsApplied()
  const summary = runSqlTestFiles()
  printSummary(summary)

  if (summary.length !== SQL_TEST_FILES.length || summary.some(s => !s.ok)) {
    process.exit(1)
  }
  console.log('\n[test:security:sql] OK — tous les fichiers de test SQL (Corrections 2 à 5) ont été exécutés avec succès.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main()
}
