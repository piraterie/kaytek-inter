import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { guardViteEnvOrExit } from './scripts/lib/production-guard.mjs'

// Exécuté au chargement de ce fichier — avant toute chose, y compris la
// construction de defineConfig() et le démarrage du webServer (`npm run
// dev`, qui est de toute façon protégé indépendamment par le hook predev,
// voir scripts/guard-no-production.mjs). Défense en profondeur : cette
// suite (tests/e2e, tests/responsive, tests/beta) n'avait jusqu'ici AUCUNE
// vérification anti-production, contrairement à playwright.security.
// config.ts — elle héritait silencieusement de VITE_SUPABASE_URL tel que
// défini dans .env.local, qui pointait vers la production avant cette
// correction.
guardViteEnvOrExit('playwright.config.ts (suite Playwright fonctionnelle : e2e/responsive/beta)')

// Charge un fichier .env spécifié si présent
function loadEnvFile(file: string) {
  if (!existsSync(file)) return
  readFileSync(file, 'utf-8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .forEach(l => {
      const idx = l.indexOf('=')
      if (idx === -1) return
      const k = l.slice(0, idx).trim()
      const v = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (k && !process.env[k]) process.env[k] = v
    })
}

loadEnvFile('.env.test')       // credentials tests E2E standards
loadEnvFile('.env.beta-test')  // credentials comptes bêta

// 127.0.0.1 explicite (pas "localhost") — cohérent avec vite.config.ts
// (server.host: '127.0.0.1') et avec playwright.security.config.ts (déjà
// en 127.0.0.1 en dur) : évite tout mismatch IPv4/IPv6 selon la
// résolution DNS locale de "localhost" sur la machine.
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,

  // Séquentiel : Supabase RLS + rate limits + état partagé
  fullyParallel: false,
  workers: 1,

  // En CI : interdire .only et activer les retries
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Locale française pour les formats de date
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    // ── 1. Setup auth (s'exécute en premier, sauvegarde les sessions) ─────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // ── 2. Desktop Chrome (tests E2E principaux) ────────────────────────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /responsive|multi-tenant/,
    },

    // NB : les tests tests/multi-tenant/*.spec.ts ne sont plus rattachés à un
    // projet de cette configuration (Correction 6 / TEST-01). Ils exigent
    // désormais une configuration de sécurité dédiée (SUPABASE_TEST_*,
    // TEST_ADMIN_A_*) via requireSecurityTestEnv() et s'exécutent
    // exclusivement sous playwright.security.config.ts
    // (`npm run test:security:playwright`), jamais sous ce fichier — pour
    // ne jamais dépendre du 'setup' non-bloquant ci-dessus (qui écrit un
    // storageState vide + un avertissement si un identifiant est absent).

    // ── 3. Desktop Firefox ──────────────────────────────────────────────
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
      testMatch: /e2e\/0[13].*\.spec\.ts/, // auth + devis seulement sur Firefox
    },

    // ── 4. Mobile 360px — Galaxy S / Android standard ──────────────────
    {
      name: 'mobile-360',
      use: {
        ...devices['Galaxy S5'],
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
      dependencies: ['setup'],
      testMatch: /responsive\/.*\.spec\.ts/,
    },

    // ── 5. Mobile 390px — iPhone 12/13 ─────────────────────────────────
    {
      name: 'mobile-390',
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
      testMatch: /responsive\/.*\.spec\.ts/,
    },

    // ── 6. Mobile 430px — iPhone 14 Pro Max ────────────────────────────
    {
      name: 'mobile-430',
      use: { ...devices['iPhone 14 Pro Max'] },
      dependencies: ['setup'],
      testMatch: /responsive\/.*\.spec\.ts/,
    },

    // ── 7. Tablette — iPad ──────────────────────────────────────────────
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
      dependencies: ['setup'],
      testMatch: /responsive\/.*\.spec\.ts/,
    },

    // ── 9. Beta accounts — validation des 5 comptes bêta serruriers ────
    {
      name: 'beta',
      use: { ...devices['Desktop Chrome'] },
      // Pas de dépendance sur 'setup' : la suite gère son propre auth
      testMatch: /beta\/.*\.spec\.ts/,
      timeout: 90_000, // Plus de temps : 5 comptes × 4 phases
    },
  ],

  // Démarre Vite dev server avant les tests
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
