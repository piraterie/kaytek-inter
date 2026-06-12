import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'

// Charge .env.test si présent (credentials de test isolés du .env de prod)
if (existsSync('.env.test')) {
  readFileSync('.env.test', 'utf-8')
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

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5173'

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

    // ── 8. Multi-tenant — Chrome Desktop ───────────────────────────────
    {
      name: 'multi-tenant',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /multi-tenant\/.*\.spec\.ts/,
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
