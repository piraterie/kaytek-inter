// guide/admin/06-transformer-devis-facture.ts — Transformer un devis en facture
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick } from '../setup/visual-effects'

const SLUG = '06-transformer-devis-facture'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — transformer un devis en facture', async ({ page }) => {
  await nav(page, '/devis')
  await injectVisualLayer(page)
  await showTitle(page, 'Transformer en facture', 'Guide Admin')

  // ── Étape 1 : Ouvrir un devis ────────────────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const accepteFilter = page.locator('button:has-text("Accepté"), [data-value="accepte"]').first()
  if (await accepteFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await vClick(page, accepteFilter, '📋 Filtrez les devis acceptés', 600)
  }

  const firstDevis = page.locator('tbody tr, [data-devis-id], div[style*="borderRadius"]').first()
  await firstDevis.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstDevis, '📄 Ouvrez le devis à transformer', 1200)
  await pause(page, 1000)

  // ── Étape 2 : Transformer ────────────────────────────────────────────────
  await injectVisualLayer(page)
  await showStep(page, 'Étape 2 / 3')

  const transformBtn = page.locator(
    'button:has-text("Transformer"), button:has-text("Facture"), ' +
    '[class*="sheet"] button:has-text("facture")'
  ).first()

  if (await transformBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await vClick(page, transformBtn, '🧾 Cliquez sur Transformer en facture', 1500)

    // ── Étape 3 : Confirmer ──────────────────────────────────────────────
    await showStep(page, 'Étape 3 / 3')
    const confirmBtn = page.locator('button:has-text("Confirmer"), button:has-text("Oui"), button:has-text("Valider")').first()
    if (await confirmBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await vClick(page, confirmBtn, '✅ Confirmez la transformation', 2000)
    }

    await page.waitForURL(/factures/, { timeout: 10_000 }).catch(() => {})
    if (page.url().includes('factures')) {
      await injectVisualLayer(page)
    }
    await pause(page, 1500)
  } else {
    // Fallback : aperçu du devis
    await nav(page, '/devis')
    await injectVisualLayer(page)
    await showStep(page, 'Étape 2 / 3')
    const firstApercu = page.locator('a[href*="/apercu"]').first()
    if (await firstApercu.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await vClick(page, firstApercu, '📄 Ouvrez l\'aperçu du devis', 1000)
      await pause(page, 800)
      await injectVisualLayer(page)
      const btn = page.locator('button:has-text("Transformer"), button:has-text("Facture")').first()
      if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await vClick(page, btn, '🧾 Transformez en facture', 2000)
      }
    }
    await pause(page, 1500)
  }

  await hideTip(page)
  await showConclusion(page, 'La facture est générée.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
