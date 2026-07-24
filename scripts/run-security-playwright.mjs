#!/usr/bin/env node
// scripts/run-security-playwright.mjs
// Correction 6 (TEST-01) — wrapper Node portable (Windows/Linux/macOS)
// autour de la suite Playwright multi-tenant critique
// (tests/multi-tenant/*.spec.ts, exécutée via playwright.security.config.ts).
//
// Pourquoi un wrapper et pas seulement `playwright test` :
// Playwright termine avec le code de sortie 0 dès lors qu'aucun test n'a
// échoué — y compris si TOUS les tests ont été ignorés (skipped) ou si
// AUCUN test n'a été découvert. Un run entièrement ignoré serait donc
// rapporté à tort comme un succès par un simple `&&` shell. Ce wrapper
// lit le reporter JSON natif de Playwright (stats.expected/unexpected/
// skipped/flaky) pour distinguer explicitement "exécuté et réussi" de
// "silencieusement ignoré", et échoue bruyamment dans ce dernier cas.
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = [
  'TEST_ADMIN_A_EMAIL',
  'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL',
  'TEST_ADMIN_B_PASSWORD',
  'TEST_INTERVENANT_A_EMAIL',
  'TEST_INTERVENANT_A_PASSWORD',
]

function main() {
  // Garde anti-production exécutée ici AUSSI (en plus de
  // playwright.security.config.ts) : ce wrapper doit échouer avant même de
  // tenter de démarrer un serveur ou un navigateur si la configuration est
  // incomplète ou pointe vers un environnement non local.
  runPreflight(EXTRA_REQUIRED_VARS)

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'kaytek-security-playwright-'))
  const jsonReportPath = path.join(tmpDir, 'report.json')

  console.log('[test:security:playwright] Lancement de la suite Playwright multi-tenant (config dédiée)...')

  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(
    npxBin,
    ['playwright', 'test', '--config=playwright.security.config.ts', '--reporter=list,json'],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReportPath },
      // shell: true — requis sur Windows : Node ne peut pas spawnSync() un
      // .cmd (npx.cmd) directement sans passer par un shell (EINVAL sinon,
      // constaté ici). Sans lien avec un quelconque garde anti-production :
      // tous les arguments passés à spawnSync sont des littéraux statiques
      // ci-dessus, jamais une entrée utilisateur/variable non contrôlée —
      // aucun risque d'injection de commande via ce shell.
      shell: process.platform === 'win32',
    }
  )

  if (result.error) {
    console.error('[test:security:playwright] ÉCHEC — impossible de lancer le processus Playwright.')
    console.error(`  → ${result.error.message}`)
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  let stats = null
  try {
    const raw = readFileSync(jsonReportPath, 'utf-8')
    stats = JSON.parse(raw).stats
  } catch (err) {
    console.error('[test:security:playwright] ÉCHEC — impossible de lire ou analyser le rapport JSON Playwright.')
    console.error(`  → ${err.message}`)
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }
  rmSync(tmpDir, { recursive: true, force: true })

  const { expected = 0, unexpected = 0, skipped = 0, flaky = 0 } = stats ?? {}
  const discovered = expected + unexpected + skipped + flaky

  console.log('[test:security:playwright] Résumé (source : reporter JSON Playwright — jamais le seul code de sortie) :')
  console.log(`  - découverts : ${discovered}`)
  console.log(`  - réussis    : ${expected}`)
  console.log(`  - échoués    : ${unexpected}`)
  console.log(`  - ignorés    : ${skipped}`)
  console.log(`  - instables  : ${flaky}`)

  let failed = false

  if (discovered === 0) {
    console.error('[test:security:playwright] ÉCHEC — aucun test découvert. Une suite de sécurité critique ne doit jamais rapporter 0 test.')
    failed = true
  }
  if (skipped > 0) {
    console.error(`[test:security:playwright] ÉCHEC — ${skipped} test(s) ignoré(s) (skipped). La suite multi-tenant critique ne doit JAMAIS être ignorée silencieusement (Correction 6 / TEST-01).`)
    failed = true
  }
  if (unexpected > 0) {
    console.error(`[test:security:playwright] ÉCHEC — ${unexpected} test(s) en échec.`)
    failed = true
  }
  if (result.status !== 0) {
    console.error(`[test:security:playwright] Le processus Playwright s'est terminé avec le code ${result.status}.`)
    failed = true
  }

  if (failed) process.exit(1)

  console.log('[test:security:playwright] OK — tous les tests critiques multi-tenant ont été découverts, exécutés et ont réussi (aucun skip).')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main()
}
