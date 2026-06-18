// playwright.guide.config.ts
// Configuration Playwright dédiée à l'enregistrement des vidéos du centre d'aide.
// Commande : npx playwright test --config=playwright.guide.config.ts
import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'

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

loadEnvFile('.env.guide')
loadEnvFile('.env.test')   // Fournit VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY au webServer

const BASE_URL = process.env.GUIDE_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './guide',
  timeout: 120_000,       // vidéos longues = plus de temps
  fullyParallel: false,   // séquentiel : une vidéo à la fois
  workers: 1,
  retries: 0,

  // Authentification via Node.js (sans navigateur) — plus fiable que le login UI
  globalSetup: './guide/setup/create-auth-files.ts',

  reporter: [
    ['html', { open: 'never', outputFolder: 'guide-report' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    actionTimeout: 20_000,
    navigationTimeout: 40_000,

    // Enregistrement vidéo systématique pour toutes les scènes
    video: 'on',

    // Résolution 1280×720 (HD) — lisible sur mobile en plein écran
    viewport: { width: 1280, height: 720 },

    // Ralentir les interactions pour la lisibilité des vidéos
    launchOptions: {
      slowMo: 200,
    },
  },

  projects: [
    // ── Vidéos Admin ───────────────────────────────────────────────────────
    {
      name: 'guide-admin',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin\/.*\.ts/,
    },

    // ── Vidéos Intervenant ─────────────────────────────────────────────────
    {
      name: 'guide-intervenant',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /intervenant\/.*\.ts/,
    },
  ],

  // Utilise le serveur Vite déjà lancé (ou le démarre si absent)
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_SUPABASE_URL:      process.env.VITE_SUPABASE_URL      || '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
    },
  },

  outputDir: 'guide/output/raw',  // vidéos brutes avant renommage
})
