// playwright.security.config.ts — Correction 6 (TEST-01)
// Configuration Playwright DÉDIÉE à la suite de sécurité multi-tenant.
// Volontairement séparée de playwright.config.ts (suite fonctionnelle) :
//
//   1. Le garde anti-production central (runPreflight) est importé et
//      exécuté au chargement même de ce fichier — avant defineConfig() —
//      de sorte qu'un lancement direct (`npx playwright test
//      --config=playwright.security.config.ts`, en contournant le
//      wrapper scripts/run-security-playwright.mjs) déclenche quand même
//      le refus anti-production. Il n'existe qu'UNE seule implémentation
//      de ce garde (scripts/test-security-preflight.mjs) — jamais de
//      copie divergente.
//   2. webServer.reuseExistingServer est TOUJOURS false (jamais
//      `!process.env.CI` comme dans playwright.config.ts) : on ne
//      réutilise jamais un serveur Vite déjà démarré qui pourrait être
//      configuré contre un projet Supabase distant/production.
//   3. Le serveur Vite de test est démarré sur un port dédié (5183,
//      distinct de 5173) pour ne jamais entrer en conflit avec un
//      serveur de développement déjà lancé par ailleurs.
//   4. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY sont substitués en
//      mémoire (process.env du processus Node parent, jamais un fichier
//      .env réel) à partir de SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY
//      avant le démarrage du serveur — le processus enfant `npm run dev`
//      hérite de cet environnement, donc l'application sous test se
//      connecte bien à Supabase local, jamais à VITE_SUPABASE_URL tel
//      que défini dans .env.local/.env.production.
import { defineConfig, devices } from '@playwright/test'
import { runPreflight } from './scripts/test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = [
  'TEST_ADMIN_A_EMAIL',
  'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL',
  'TEST_ADMIN_B_PASSWORD',
  'TEST_INTERVENANT_A_EMAIL',
  'TEST_INTERVENANT_A_PASSWORD',
]

// Exécuté à l'import de ce fichier — donc avant toute exécution de test,
// quel que soit le point d'entrée (wrapper npm script ou CLI directe).
runPreflight(EXTRA_REQUIRED_VARS)

// Substitution en mémoire uniquement (process.env du parent) — jamais
// d'écriture disque, jamais de modification d'un fichier .env réel.
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_TEST_URL
process.env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY

const SECURITY_PORT = process.env.TEST_SECURITY_PORT || '5183'
const BASE_URL = `http://127.0.0.1:${SECURITY_PORT}`

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,

  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: 0,

  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report-security' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'security-setup',
      testMatch: /security\.setup\.ts/,
    },
    {
      name: 'multi-tenant-security',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['security-setup'],
      testMatch: /multi-tenant\/.*\.spec\.ts/,
    },
  ],

  // Serveur Vite dédié — jamais de réutilisation d'un serveur existant.
  webServer: {
    command: `npm run dev -- --port ${SECURITY_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
