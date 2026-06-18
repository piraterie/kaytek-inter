// guide/intervenant/07-cloture-intervention.ts — Clôturer une intervention
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, scrollTo } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick, vFill, highlightEl } from '../setup/visual-effects'

const SLUG = '07-cloture-intervention'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

test('guide intervenant — clôturer une intervention', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Clôturer une intervention', 'Guide Intervenant')

  // ── Étape 1 : Ouvrir l'intervention ──────────────────────────────────────
  await showStep(page, 'Étape 1 / 4')
  const firstInter = page.locator('tbody tr').first()
  await firstInter.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstInter, '🔧 Ouvrez l\'intervention à clôturer', 1200)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 2 : Compte-rendu ───────────────────────────────────────────────
  await showStep(page, 'Étape 2 / 4')
  const crSection = page.locator('text=Compte-rendu, text=CR, [class*="cr"], [class*="compte-rendu"]').first()
  if (await crSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(crSection)
    await highlightEl(page, crSection)
    await showTip(page, '📝 Remplissez le compte-rendu de l\'intervention')
    await pause(page, 800)
    await hideTip(page)
  } else {
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }))
    await pause(page, 800)
  }

  const crTextarea = page.locator(
    'textarea[placeholder*="compte-rendu"], textarea[placeholder*="Travaux"], ' +
    'textarea[name*="cr"], textarea[name*="compte_rendu"]'
  ).first()
  if (await crTextarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vFill(page, crTextarea,
      'Remplacement de la serrure effectué. Pose d\'une serrure 3 points haute sécurité. Clés remises au client.',
      '✏️ Décrivez les travaux réalisés'
    )
  }

  // ── Étape 3 : Coût matériaux ─────────────────────────────────────────────
  await showStep(page, 'Étape 3 / 4')
  const coutInput = page.locator('input[placeholder*="oût"], input[name*="cout"], input[name*="materiau"]').first()
  if (await coutInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await vFill(page, coutInput, '85', '💶 Coût des matériaux utilisés')
  }

  await pause(page, 800)

  // ── Étape 4 : Terminer ───────────────────────────────────────────────────
  await showStep(page, 'Étape 4 / 4')
  const terminerBtn = page.locator(
    'button:has-text("Terminé"), button:has-text("Terminer"), ' +
    'button:has-text("Clôturer"), button:has-text("Intervention terminée")'
  ).first()
  if (await terminerBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await scrollTo(terminerBtn)
    await vClick(page, terminerBtn, '✅ Clôturez l\'intervention', 1500)

    const confirmBtn = page.locator('button:has-text("Oui"), button:has-text("Confirmer")').first()
    if (await confirmBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await vClick(page, confirmBtn, '✅ Confirmez la clôture', 2000)
    }
  }

  await pause(page, 1000)
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await pause(page, 800)
  await showConclusion(page, 'Intervention clôturée avec succès.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
