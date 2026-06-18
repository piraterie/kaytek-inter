// guide/intervenant/06-signature-client.ts — Signature client
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click, scrollTo } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick } from '../setup/visual-effects'

const SLUG = '06-signature-client'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

test('guide intervenant — signature client', async ({ page }) => {
  await nav(page, '/devis')
  await injectVisualLayer(page)
  await showTitle(page, 'Signature client', 'Guide Intervenant')

  // ── Étape 1 : Ouvrir l'aperçu du devis ───────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const firstApercu = page.locator('a[href*="/apercu"], button:has-text("Aperçu"), button:has-text("Voir")').first()
  if (await firstApercu.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await vClick(page, firstApercu, '📄 Ouvrez l\'aperçu du devis', 1200)
  } else {
    const firstDevis = page.locator('[class*="devis"], a[href*="/devis/"]').first()
    if (await firstDevis.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await vClick(page, firstDevis, '📄 Ouvrez le devis', 1000)
    }
  }

  await pause(page, 1000)
  await injectVisualLayer(page)

  // ── Étape 2 : Trouver la zone de signature ───────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
  await pause(page, 1000)

  const signBtn = page.locator('button:has-text("Signer"), button:has-text("Signature"), [class*="sign"]').first()
  if (await signBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await scrollTo(signBtn)
    await vClick(page, signBtn, '✍️ Cliquez pour ouvrir la zone de signature', 1500)

    // ── Étape 3 : Tracer la signature ─────────────────────────────────────
    await showStep(page, 'Étape 3 / 3')
    const canvas = page.locator('canvas, [class*="signature"]').first()
    if (await canvas.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await showTip(page, '✍️ Le client trace sa signature ici')
      await pause(page, 800)

      const box = await canvas.boundingBox()
      if (box) {
        await page.mouse.move(box.x + 40, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + 80,  box.y + 20,               { steps: 10 })
        await page.mouse.move(box.x + 120, box.y + box.height - 20,  { steps: 10 })
        await page.mouse.move(box.x + 160, box.y + box.height / 2,   { steps: 10 })
        await page.mouse.move(box.x + 200, box.y + 30,               { steps: 10 })
        await page.mouse.move(box.x + 240, box.y + box.height / 2,   { steps: 10 })
        await page.mouse.up()
        await pause(page, 1000)
      }
      await hideTip(page)

      const confirmBtn = page.locator('button:has-text("Valider"), button:has-text("Confirmer"), button:has-text("Enregistrer")').first()
      if (await confirmBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await vClick(page, confirmBtn, '✅ Validez la signature', 2000)
      }
    }
  }

  await pause(page, 1000)
  await showConclusion(page, 'Signature enregistrée avec succès.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
