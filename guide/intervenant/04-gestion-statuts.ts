// guide/intervenant/04-gestion-statuts.ts — Gérer les statuts
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick } from '../setup/visual-effects'

const SLUG = '04-gestion-statuts'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

test('guide intervenant — gestion des statuts', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Gérer les statuts', 'Guide Intervenant')

  // ── Étape 1 : Ouvrir une intervention ────────────────────────────────────
  await showStep(page, 'Étape 1 / 4')
  const firstInter = page.locator('tbody tr').first()
  await firstInter.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstInter, '🔧 Ouvrez l\'intervention', 1200)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 2 : Montrer les boutons de statut ──────────────────────────────
  await showStep(page, 'Étape 2 / 4')
  const statusBtns = page.locator(
    'button:has-text("En route"), button:has-text("Sur place"), ' +
    'button:has-text("Terminé"), button:has-text("En cours"), ' +
    '[class*="statut"] button, [class*="status"] button'
  )
  const count = await statusBtns.count()
  if (count > 0) {
    await statusBtns.first().scrollIntoViewIfNeeded()
    await showTip(page, '🔄 Mettez à jour le statut au fil de l\'intervention')
    await pause(page, 1200)
    await hideTip(page)
  }

  // ── Étape 3 : Passer "En route" ──────────────────────────────────────────
  await showStep(page, 'Étape 3 / 4')
  const enRouteBtn = page.locator('button:has-text("En route"), button:has-text("En cours")').first()
  if (await enRouteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, enRouteBtn, '🚗 Vous êtes en route', 1500)

    const confirmBtn = page.locator('button:has-text("Oui"), button:has-text("Confirmer")').first()
    if (await confirmBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await vClick(page, confirmBtn, '✅ Confirmez', 1000)
    }
    await pause(page, 1200)
  }

  // ── Étape 4 : Passer "Sur place" ─────────────────────────────────────────
  await showStep(page, 'Étape 4 / 4')
  const surPlaceBtn = page.locator('button:has-text("Sur place"), button:has-text("Arrivé")').first()
  if (await surPlaceBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, surPlaceBtn, '📍 Vous êtes sur place', 1500)
    const confirmBtn2 = page.locator('button:has-text("Oui"), button:has-text("Confirmer")').first()
    if (await confirmBtn2.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await vClick(page, confirmBtn2, '✅ Confirmez', 1000)
    }
    await pause(page, 1200)
  }

  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await pause(page, 800)
  await showConclusion(page, 'Statut mis à jour avec succès.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
