// tests/auth.setup.ts — Sauvegarde les sessions Supabase pour les tests
// Doit être exécuté avant tous les tests via le projet "setup" dans playwright.config.ts
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// Chemins relatifs à la racine du projet (là où tourne playwright)
export const ADMIN_AUTH       = 'tests/.auth/admin.json'
export const INTERVENANT_AUTH = 'tests/.auth/intervenant.json'
export const ADMIN_B_AUTH     = 'tests/.auth/admin-b.json'

function ensureAuthDir() {
  const dir = path.resolve('tests/.auth')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function loginAs(page: any, email: string, password: string, authFile: string) {
  await page.goto('/login', { waitUntil: 'load' })

  // Si l'écran biométrique est affiché (empreinte déjà enregistrée), basculer vers mot de passe
  const bioSwitch = page.locator('button:has-text("Utiliser le mot de passe")')
  if (await bioSwitch.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await bioSwitch.click()
    await page.waitForTimeout(500)
  }

  // Attendre le champ email (React + Supabase ont besoin d'un moment pour s'initialiser)
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  // Dans Playwright Chromium headless, PublicKeyCredential est défini mais aucune
  // empreinte n'est enregistrée → l'app affiche l'écran "Connexion rapide" (biométrique).
  // Race entre : navigation /dashboard (si pas d'écran bio) OU écran biométrique.
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

setup('authenticate — admin org A', async ({ page }) => {
  const email    = process.env.TEST_ADMIN_EMAIL
  const password = process.env.TEST_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error(
      'TEST_ADMIN_EMAIL et TEST_ADMIN_PASSWORD doivent être définis dans .env.test\n' +
      'Copier .env.test.example → .env.test et renseigner les valeurs.'
    )
  }
  ensureAuthDir()
  await loginAs(page, email, password, ADMIN_AUTH)
})

setup('authenticate — intervenant org A', async ({ page }) => {
  const email    = process.env.TEST_INTERVENANT_EMAIL
  const password = process.env.TEST_INTERVENANT_PASSWORD
  if (!email || !password) {
    console.warn('[setup] TEST_INTERVENANT_EMAIL non défini — auth intervenant ignorée')
    ensureAuthDir()
    fs.writeFileSync(INTERVENANT_AUTH, JSON.stringify({ cookies: [], origins: [] }))
    return
  }
  ensureAuthDir()
  await loginAs(page, email, password, INTERVENANT_AUTH)
})

setup('authenticate — admin org B (multi-tenant)', async ({ page }) => {
  const email    = process.env.TEST_ADMIN_B_EMAIL
  const password = process.env.TEST_ADMIN_B_PASSWORD
  if (!email || !password) {
    console.warn('[setup] TEST_ADMIN_B_EMAIL non défini — auth org B ignorée')
    ensureAuthDir()
    fs.writeFileSync(ADMIN_B_AUTH, JSON.stringify({ cookies: [], origins: [] }))
    return
  }
  ensureAuthDir()
  await loginAs(page, email, password, ADMIN_B_AUTH)
})
