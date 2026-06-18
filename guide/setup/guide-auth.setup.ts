// guide/setup/guide-auth.setup.ts
// Authentifie les comptes démo et sauvegarde les sessions pour les scénarios vidéo.
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { GUIDE_ADMIN_AUTH, GUIDE_INTERVENANT_AUTH } from './auth-paths'

export { GUIDE_ADMIN_AUTH, GUIDE_INTERVENANT_AUTH }

function ensureDir(p: string) {
  const dir = path.dirname(path.resolve(p))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function loginAs(
  page: Parameters<Parameters<typeof setup>[1]>[0],
  email: string,
  password: string,
  authFile: string
) {
  await page.goto('/login', { waitUntil: 'load' })

  // Biométrie : basculer vers mot de passe si nécessaire
  const bioSwitch = page.locator('button:has-text("Utiliser le mot de passe")')
  if (await bioSwitch.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await bioSwitch.click()
    await page.waitForTimeout(500)
  }

  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  // Race : tableau de bord OU écran proposition biométrie
  const skipBio = page.locator('button:has-text("Non merci, continuer")')
  const race = await Promise.race([
    page.waitForURL('**/dashboard', { timeout: 30_000 }).then(() => 'dashboard').catch(() => 'timeout'),
    skipBio.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'bio').catch(() => 'timeout'),
  ])
  if (race === 'bio') {
    await skipBio.click()
    await page.waitForURL('**/dashboard', { timeout: 20_000 })
  }

  await expect(page).toHaveURL(/dashboard/)
  await page.context().storageState({ path: authFile })
  console.log(`  ✓ Session sauvegardée : ${authFile}`)
}

setup('auth guide — admin', async ({ page }) => {
  const email    = process.env.GUIDE_ADMIN_EMAIL    || 'admin@kaytek.test'
  const password = process.env.GUIDE_ADMIN_PASSWORD || 'KaytekAdmin2024!'
  ensureDir(GUIDE_ADMIN_AUTH)
  await loginAs(page, email, password, GUIDE_ADMIN_AUTH)
})

setup('auth guide — intervenant', async ({ page }) => {
  const email    = process.env.GUIDE_INTERVENANT_EMAIL    || 'intervenant@kaytek.test'
  const password = process.env.GUIDE_INTERVENANT_PASSWORD || 'KaytekInter2024!'
  ensureDir(GUIDE_INTERVENANT_AUTH)
  await loginAs(page, email, password, GUIDE_INTERVENANT_AUTH)
})
