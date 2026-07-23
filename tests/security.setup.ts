// tests/security.setup.ts — Correction 6 (TEST-01)
// Authentification dédiée à la suite de sécurité multi-tenant
// (tests/multi-tenant/*.spec.ts exécutés via playwright.security.config.ts).
//
// Diffère volontairement de tests/auth.setup.ts (suite fonctionnelle) :
// ce fichier ne contient AUCUN mécanisme de repli silencieux. Si un
// identifiant est absent ou si la connexion échoue, chaque setup() lève
// une erreur — jamais un console.warn() + storageState vide comme le
// fait tests/auth.setup.ts pour les rôles secondaires. Un run de sécurité
// avec une authentification manquante doit échouer bruyamment, jamais
// être silencieusement dégradé.
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { requireSecurityTestEnv } from './security-env'

export const SECURITY_ADMIN_A_AUTH       = 'tests/.auth/security-admin-a.json'
export const SECURITY_ADMIN_B_AUTH       = 'tests/.auth/security-admin-b.json'
export const SECURITY_INTERVENANT_A_AUTH = 'tests/.auth/security-intervenant-a.json'

function ensureAuthDir() {
  const dir = path.resolve('tests/.auth')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function loginAs(page: any, email: string, password: string, authFile: string) {
  await page.goto('/login', { waitUntil: 'load' })

  const bioSwitch = page.locator('button:has-text("Utiliser le mot de passe")')
  if (await bioSwitch.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await bioSwitch.click()
    await page.waitForTimeout(500)
  }

  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  const skipBio = page.locator('button:has-text("Non merci, continuer")')
  const race = await Promise.race([
    page.waitForURL('**/dashboard', { timeout: 25_000 }).then(() => 'dashboard').catch(() => 'timeout'),
    skipBio.waitFor({ state: 'visible', timeout: 25_000 }).then(() => 'bio').catch(() => 'timeout'),
  ])
  if (race === 'bio') {
    await skipBio.click()
  }

  await page.waitForURL('**/dashboard', { timeout: 30_000 })
  await expect(page).toHaveURL(/dashboard/)
  await page.context().storageState({ path: authFile })
}

// Appelée en tête de fichier, hors de tout test() — une configuration
// incomplète interrompt la collecte du fichier avant même l'exécution
// du premier setup(), au lieu de laisser chaque setup() découvrir
// séparément l'absence de variables.
requireSecurityTestEnv()

setup('security auth — admin org A', async ({ page }) => {
  const email    = process.env.TEST_ADMIN_A_EMAIL
  const password = process.env.TEST_ADMIN_A_PASSWORD
  if (!email || !password) {
    throw new Error(
      'TEST_ADMIN_A_EMAIL et TEST_ADMIN_A_PASSWORD sont obligatoires pour la suite de sécurité ' +
      '(Correction 6 / TEST-01) — aucun repli silencieux n\'est autorisé. Voir .env.test.example.'
    )
  }
  ensureAuthDir()
  await loginAs(page, email, password, SECURITY_ADMIN_A_AUTH)
})

setup('security auth — admin org B (multi-tenant)', async ({ page }) => {
  const email    = process.env.TEST_ADMIN_B_EMAIL
  const password = process.env.TEST_ADMIN_B_PASSWORD
  if (!email || !password) {
    throw new Error(
      'TEST_ADMIN_B_EMAIL et TEST_ADMIN_B_PASSWORD sont obligatoires pour la suite de sécurité ' +
      '(Correction 6 / TEST-01) — aucun repli silencieux n\'est autorisé. Voir .env.test.example.'
    )
  }
  ensureAuthDir()
  await loginAs(page, email, password, SECURITY_ADMIN_B_AUTH)
})

setup('security auth — intervenant org A', async ({ page }) => {
  const email    = process.env.TEST_INTERVENANT_A_EMAIL
  const password = process.env.TEST_INTERVENANT_A_PASSWORD
  if (!email || !password) {
    throw new Error(
      'TEST_INTERVENANT_A_EMAIL et TEST_INTERVENANT_A_PASSWORD sont obligatoires pour la suite de ' +
      'sécurité (Correction 6 / TEST-01) — aucun repli silencieux n\'est autorisé. Voir .env.test.example.'
    )
  }
  ensureAuthDir()
  await loginAs(page, email, password, SECURITY_INTERVENANT_A_AUTH)
})
