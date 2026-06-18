// guide/admin/04-assigner-intervention.ts — Assigner une intervention
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, hideTip, vClick } from '../setup/visual-effects'

const SLUG = '04-assigner-intervention'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — assigner une intervention', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Assigner une intervention', 'Guide Admin')

  // ── Étape 1 : Sélectionner une intervention ──────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const firstRow = page.locator('tbody tr').first()
  await firstRow.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstRow, '🔧 Ouvrez l\'intervention à assigner', 1000)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 2 : Modifier / Assigner ────────────────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  const editBtn = page.locator('button:has-text("Modifier"), button:has-text("Éditer"), button[aria-label*="modifier"]').first()
  if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, editBtn, '✏️ Cliquez sur Modifier', 800)
  }

  const intervenantSelect = page.locator(
    'select[name*="intervenant"], [placeholder*="ntervenant"], button:has-text("Assigner"), ' +
    '[class*="select"]:near(:text("Intervenant"))'
  ).first()

  if (await intervenantSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, intervenantSelect, '👤 Choisissez l\'intervenant', 600)
    const firstOption = page.locator('[class*="option"]:not(:empty), option:not(:first-child)').first()
    if (await firstOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await click(firstOption, 600)
    }
  }

  await pause(page, 800)

  // ── Étape 3 : Enregistrer ────────────────────────────────────────────────
  await showStep(page, 'Étape 3 / 3')
  const saveBtn = page.locator('button:has-text("Enregistrer"), button:has-text("Valider"), button[type="submit"]').first()
  if (await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, saveBtn, '💾 Enregistrez l\'assignation', 2000)
  }

  await hideTip(page)
  await pause(page, 800)
  await showConclusion(page, 'Intervention assignée avec succès.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
