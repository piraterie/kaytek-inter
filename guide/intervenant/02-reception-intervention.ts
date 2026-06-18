// guide/intervenant/02-reception-intervention.ts — Réception d'une intervention
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick, highlightEl } from '../setup/visual-effects'

const SLUG = '02-reception-intervention'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

test('guide intervenant — réception d\'une intervention', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Recevoir une intervention', 'Guide Intervenant')

  // ── Étape 1 : Voir la liste ──────────────────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  await showTip(page, '📋 Vos interventions assignées apparaissent ici')
  await pause(page, 1400)
  await hideTip(page)

  const enAttenteFilter = page.locator('button:has-text("En attente"), [data-value="en_attente"]').first()
  if (await enAttenteFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await vClick(page, enAttenteFilter, '🔍 Filtrez les interventions en attente', 800)
  }

  // ── Étape 2 : Ouvrir l'intervention ──────────────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  const firstInter = page.locator('tbody tr').first()
  await firstInter.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstInter, '🔧 Ouvrez l\'intervention assignée', 1200)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 3 : Consulter les détails ──────────────────────────────────────
  await showStep(page, 'Étape 3 / 3')
  await showTip(page, '👁️ Vérifiez le client, l\'adresse et le type d\'intervention')
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await pause(page, 1000)
  await hideTip(page)
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }))
  await pause(page, 1200)
  await showConclusion(page, 'Intervention consultée.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
