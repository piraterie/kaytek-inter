#!/usr/bin/env node
// scripts/run-google-sql-tests.mjs
// Exécuteur Node portable (Windows/Linux/macOS) des tests SQL RLS du module
// Google (Corrections 6/7/8 UNIQUEMENT — jamais les Corrections 2 à 5, sans
// rapport avec Google et non intégrées sur cette branche). Volontairement
// indépendant de scripts/test-security-preflight.mjs (absent de cette
// branche d'intégration) : le garde anti-production est réimplémenté ici,
// minimal et autonome.
//
// Chaque fichier .sql gère sa propre transaction (BEGIN ... ROLLBACK) —
// exécutés un par un via un sous-processus psql dédié, jamais concaténés,
// pour ne jamais faire fuir l'état d'une transaction dans une autre.
// N'exécute jamais rien contre un projet distant : SUPABASE_TEST_DB_URL
// (ou le défaut local ci-dessous) doit pointer vers 127.0.0.1/localhost,
// vérifié avant toute connexion.
//
// psql natif indisponible sur cette machine (Windows/Git-Bash) : repli
// automatique sur `docker exec` vers le conteneur Postgres du stack
// Supabase local (détecté par l'image `supabase/postgres:*`, jamais par un
// nom de conteneur en dur — dépend du nom du projet). SQL transmis par
// STDIN (jamais un chemin de fichier passé au conteneur, pour éviter la
// conversion de chemin MSYS/Git-Bash sur Windows).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const POSTGRES_IMAGE_PATTERN = /\/supabase\/postgres:/

const TEST_FILES_DIR = 'audit-kaytek-inter/corrections/tests'
const SQL_TEST_FILES = [
  'correction-06-google-integrations-rls-tests.sql',
  'correction-07-google-oauth-phase2-tests.sql',
  'correction-08-google-account-selection-tests.sql',
]

// Objets dont la présence prouve que les 6 migrations Google sont
// réellement appliquées sur la base ciblée — pas seulement que les
// fichiers de migration existent dans le dépôt.
const REQUIRED_DB_OBJECTS = [
  { label: 'colonne factures.envoyee_le (000003)',
    sql: "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='factures' AND column_name='envoyee_le')" },
  { label: 'table google_ads_connections (000004)',
    sql: "SELECT to_regclass('public.google_ads_connections') IS NOT NULL" },
  { label: 'table review_requests (000004)',
    sql: "SELECT to_regclass('public.review_requests') IS NOT NULL" },
  { label: 'vue google_ads_connection_status (000005)',
    sql: "SELECT to_regclass('public.google_ads_connection_status') IS NOT NULL" },
  { label: 'table google_oauth_states (000006)',
    sql: "SELECT to_regclass('public.google_oauth_states') IS NOT NULL" },
  { label: 'fonction google_oauth_vault_create (000006)',
    sql: "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'google_oauth_vault_create')" },
  { label: 'colonne google_ads_connections.selected_at (000008)',
    sql: "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='google_ads_connections' AND column_name='selected_at')" },
]

let dockerContainerId = null

function fail(message) {
  console.error(`[test:security:google-sql] ÉCHEC — ${message}`)
  process.exit(1)
}

// Garde anti-production minimal et autonome : refuse toute URL dont l'hôte
// n'est pas explicitement local, avant même de tenter une connexion.
function guardLocalOnly(dbUrl) {
  let host
  try {
    host = new URL(dbUrl).hostname
  } catch {
    fail(`SUPABASE_TEST_DB_URL invalide : ${dbUrl}`)
  }
  const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
  if (!LOCAL_HOSTS.has(host)) {
    fail(`SUPABASE_TEST_DB_URL pointe vers un hôte non local (${host}) — cette suite ne s'exécute JAMAIS contre une base distante/production. Arrêt.`)
  }
}

function detectDockerPostgresContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.ID}}\t{{.Image}}'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  if (result.error || result.status !== 0) return null
  const matches = (result.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => POSTGRES_IMAGE_PATTERN.test(l))
    .map((l) => l.split('\t')[0])

  if (matches.length === 0) {
    fail("aucun conteneur Docker exécutant une image `supabase/postgres:*` n'a été trouvé. Démarrer le stack local avec `supabase start` avant d'exécuter cette suite.")
  }
  if (matches.length > 1) {
    fail(`plusieurs conteneurs Docker correspondent à \`supabase/postgres:*\` (${matches.join(', ')}) — ambigu, arrêt.`)
  }
  return matches[0]
}

function runPsqlNative(dbUrl, args, sqlInput, { silent = false } = {}) {
  return spawnSync('psql', [dbUrl, ...args], {
    input: sqlInput,
    stdio: silent ? ['pipe', 'pipe', 'pipe'] : (sqlInput !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit'),
    encoding: 'utf-8',
  })
}

function runPsqlDocker(args, sqlInput, { silent = false } = {}) {
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

function runPsql(dbUrl, args, sqlInput, opts) {
  return dockerContainerId ? runPsqlDocker(args, sqlInput, opts) : runPsqlNative(dbUrl, args, sqlInput, opts)
}

function checkPsqlAvailable(dbUrl) {
  const native = spawnSync('psql', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' })
  if (!native.error && native.status === 0) {
    console.log(`[test:security:google-sql] psql natif détecté : ${(native.stdout || '').trim()}`)
    return
  }
  console.log('[test:security:google-sql] psql natif introuvable — repli sur `docker exec`.')
  const containerId = detectDockerPostgresContainer()
  const check = spawnSync('docker', ['exec', containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '--version'], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8',
  })
  if (check.error || check.status !== 0) {
    fail(`impossible d'exécuter \`psql\` dans le conteneur Docker ${containerId}.\n${check.stderr || ''}`)
  }
  dockerContainerId = containerId
  console.log(`[test:security:google-sql] psql (via docker exec, conteneur ${containerId}) détecté.`)
}

function checkDbConnectivity(dbUrl) {
  const result = runPsql(dbUrl, ['-t', '-v', 'ON_ERROR_STOP=1'], 'SELECT 1;\n', { silent: true })
  if (result.status !== 0) {
    fail(`impossible de se connecter à la base locale (Supabase local démarré ? \`supabase start\`).\n${result.stderr || ''}`)
  }
  console.log('[test:security:google-sql] Connexion à la base locale confirmée.')
}

function checkMigrationsApplied(dbUrl) {
  console.log('[test:security:google-sql] Vérification de la présence réelle des objets des migrations Google (000003-000008)...')
  for (const obj of REQUIRED_DB_OBJECTS) {
    const result = runPsql(dbUrl, ['-t', '-A', '-v', 'ON_ERROR_STOP=1'], `${obj.sql};\n`, { silent: true })
    const present = result.status === 0 && result.stdout.trim() === 't'
    if (!present) {
      fail(`objet manquant : ${obj.label}. Les 6 migrations Google doivent être appliquées avant cette suite (\`supabase db reset\`).`)
    }
    console.log(`  - OK : ${obj.label}`)
  }
}

function runSqlTestFiles(dbUrl) {
  const summary = []
  for (const fileName of SQL_TEST_FILES) {
    const filePath = path.posix.join(TEST_FILES_DIR, fileName)
    if (!existsSync(filePath)) fail(`fichier de test introuvable : ${filePath}`)

    console.log(`\n[test:security:google-sql] ── Exécution de ${fileName} ──────────────────────────`)
    const startedAt = Date.now()
    const sqlContent = readFileSync(filePath, 'utf-8')
    const result = runPsql(dbUrl, ['-v', 'ON_ERROR_STOP=1'], sqlContent)
    const durationMs = Date.now() - startedAt

    if (result.status !== 0) {
      summary.push({ file: fileName, ok: false, durationMs })
      console.error(`[test:security:google-sql] ÉCHEC dans ${fileName} (code de sortie ${result.status}).`)
      printSummary(summary)
      console.error('[test:security:google-sql] Arrêt immédiat — les fichiers suivants ne sont pas exécutés.')
      process.exit(1)
    }
    summary.push({ file: fileName, ok: true, durationMs })
    console.log(`[test:security:google-sql] ${fileName} — OK (${durationMs} ms)`)
  }
  return summary
}

function printSummary(summary) {
  console.log('\n[test:security:google-sql] Résumé :')
  for (const entry of summary) {
    console.log(`  - ${entry.ok ? 'OK  ' : 'FAIL'} : ${entry.file} (${entry.durationMs} ms)`)
  }
  const executed = summary.length
  const total = SQL_TEST_FILES.length
  if (executed < total) console.log(`  - NON EXÉCUTÉS : ${total - executed} fichier(s)`)
}

function main() {
  const dbUrl = process.env.SUPABASE_TEST_DB_URL || DEFAULT_LOCAL_DB_URL
  guardLocalOnly(dbUrl)
  checkPsqlAvailable(dbUrl)
  checkDbConnectivity(dbUrl)
  checkMigrationsApplied(dbUrl)
  const summary = runSqlTestFiles(dbUrl)
  printSummary(summary)

  if (summary.length !== SQL_TEST_FILES.length || summary.some((s) => !s.ok)) {
    process.exit(1)
  }
  console.log('\n[test:security:google-sql] OK — Corrections 6/7/8 (module Google) exécutées avec succès. Corrections 2-5 volontairement non incluses (sans rapport, non intégrées sur cette branche).')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) main()
