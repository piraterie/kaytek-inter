// guide/admin/01-connexion.ts — Connexion administrateur
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, fill, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showTip, hideTip, showStep, vClick, vFill } from '../setup/visual-effects'

const SLUG = '01-connexion'
const EMAIL    = process.env.GUIDE_ADMIN_EMAIL    || 'admin@kaytek.test'
const PASSWORD = process.env.GUIDE_ADMIN_PASSWORD || 'KaytekAdmin2024!'

test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — connexion', async ({ page }) => {
  // Session active → /login redirige automatiquement vers /dashboard
  await nav(page, '/login')
  await pause(page, 800)

  const emailInput = page.locator('input[type="email"]')
  const onLoginPage = await emailInput.isVisible({ timeout: 2_000 }).catch(() => false)

  if (onLoginPage) {
    // Formulaire visible — injecter la couche avant les interactions
    await injectVisualLayer(page)
    await showTitle(page, 'Connexion', 'Guide Admin — Kaytek Inter')

    const bioSwitch = page.locator('button:has-text("Utiliser le mot de passe")')
    if (await bioSwitch.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await vClick(page, bioSwitch)
    }

    await showStep(page, 'Étape 1 / 2')
    await vFill(page, emailInput, EMAIL, '📧 Saisissez votre email')
    await vFill(page, page.locator('input[type="password"]'), PASSWORD, '🔑 Saisissez votre mot de passe')

    await showStep(page, 'Étape 2 / 2')
    await vClick(page, page.locator('button[type="submit"]'), '✅ Connectez-vous')

    const skipBio = page.locator('button:has-text("Non merci, continuer")')
    const race = await Promise.race([
      page.waitForURL('**/dashboard', { timeout: 30_000 }).then(() => 'dashboard').catch(() => 'timeout'),
      skipBio.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'bio').catch(() => 'timeout'),
    ])
    if (race === 'bio') {
      await click(skipBio)
      await page.waitForURL('**/dashboard', { timeout: 20_000 })
    }
  }

  // ── Tableau de bord ──────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  if (!onLoginPage) await showTitle(page, 'Connexion', 'Guide Admin — Kaytek Inter')

  await showStep(page, 'Tableau de bord')
  await showTip(page, '🏠 Vous êtes connecté — voici votre tableau de bord')
  await pause(page, 1200)
  await hideTip(page)
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }))
  await pause(page, 1500)
  await showConclusion(page, 'Connexion réussie.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
