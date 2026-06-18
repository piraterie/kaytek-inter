// guide/intervenant/03-acceptation-intervention.ts — Accepter une intervention
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick, highlightEl } from '../setup/visual-effects'

const SLUG = '03-acceptation-intervention'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

test('guide intervenant — accepter une intervention', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Accepter une intervention', 'Guide Intervenant')

  // ── Étape 1 : Ouvrir l'intervention ──────────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const firstInter = page.locator('tbody tr').first()
  await firstInter.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstInter, '🔧 Ouvrez l\'intervention assignée', 1200)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 2 : Localiser le bouton Accepter ───────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  const acceptBtn = page.locator(
    'button:has-text("Accepter"), button:has-text("Accepté"), ' +
    'button:has-text("Confirmer"), [class*="accept"]'
  ).first()

  if (await acceptBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await acceptBtn.scrollIntoViewIfNeeded()
    await pause(page, 600)

    // ── Étape 3 : Accepter ───────────────────────────────────────────────
    await showStep(page, 'Étape 3 / 3')
    await vClick(page, acceptBtn, '✅ Acceptez l\'intervention', 1500)

    const confirmBtn = page.locator('button:has-text("Oui"), button:has-text("Confirmer")').first()
    if (await confirmBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await vClick(page, confirmBtn, '✅ Confirmez', 1500)
    }

    await pause(page, 1500)
    await hideTip(page)
    await showConclusion(page, 'Intervention acceptée.')
  } else {
    // Intervention déjà acceptée — montrer l'état actuel
    await showStep(page, 'Étape 2 / 2')
    await showTip(page, '✅ L\'intervention est déjà acceptée')
    await page.evaluate(() => window.scrollTo({ top: 0 }))
    await pause(page, 1000)
    await hideTip(page)
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }))
    await pause(page, 1500)
    await showConclusion(page, 'Intervention déjà acceptée.', '✓ Statut confirmé')
  }

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
