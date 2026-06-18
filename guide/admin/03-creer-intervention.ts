// guide/admin/03-creer-intervention.ts — Créer une intervention
// NOTE : tous les locateurs de champs sont scopés au modal pour éviter la search bar
// qui a placeholder="Client, adresse, intervenant…" contenant "dresse".
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, hideTip, vClick, vFill } from '../setup/visual-effects'

const SLUG = '03-creer-intervention'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — créer une intervention', async ({ page }) => {
  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Créer une intervention', 'Guide Admin')

  // ── Étape 1 : Ouvrir le formulaire ───────────────────────────────────────
  await showStep(page, 'Étape 1 / 4')
  const newBtn = page.locator('button:has-text("Nouvelle"), button:has-text("Nouveau"), button:has-text("Créer")').first()
  await vClick(page, newBtn, '➕ Cliquez sur Nouvelle intervention', 800)

  const modal = page.locator('[class*="modal"], [role="dialog"]').first()
  await modal.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  await pause(page, 600)

  // ── Étape 2 : Choisir le client (select natif dans le modal) ─────────────
  await showStep(page, 'Étape 2 / 4')
  const clientSelect = modal.locator('select').first()
  if (await clientSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, clientSelect, '👥 Sélectionnez le client', 400)
    await clientSelect.selectOption({ index: 1 }).catch(() => {})
    await pause(page, 500)
  }

  // ── Étape 3 : Remplir les détails (tous scopés au modal) ─────────────────
  await showStep(page, 'Étape 3 / 4')

  // Adresse — premier textarea du modal, ou premier input texte si pas de textarea
  const adresseTextarea = modal.locator('textarea').first()
  const adresseInput    = modal.locator('input[type="text"], input:not([type])').first()

  if (await adresseTextarea.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await vFill(page, adresseTextarea, '15 Rue de la Paix, 75001 Paris', '📍 Adresse de l\'intervention')
  } else if (await adresseInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await vFill(page, adresseInput, '15 Rue de la Paix, 75001 Paris', '📍 Adresse de l\'intervention')
  }

  // Description — dernier textarea ou second input texte du modal
  const textareas = modal.locator('textarea')
  const taCount   = await textareas.count()
  if (taCount > 1) {
    await vFill(page, textareas.last(), 'Remplacement serrure porte d\'entrée — 3 points', '📝 Description des travaux')
  } else if (taCount === 0) {
    const inputs = modal.locator('input[type="text"], input:not([type])')
    const cnt    = await inputs.count()
    if (cnt > 1) {
      await vFill(page, inputs.nth(1), 'Remplacement serrure porte d\'entrée — 3 points', '📝 Description des travaux')
    }
  }

  // Date — scopée au modal
  const dateInput = modal.locator('input[type="date"], input[type="datetime-local"]').first()
  if (await dateInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    await vFill(page, dateInput, tomorrow, '📅 Date prévue')
  }

  await pause(page, 800)

  // ── Étape 4 : Enregistrer (scopé au modal) ───────────────────────────────
  await showStep(page, 'Étape 4 / 4')
  const submitBtn = modal.locator('button[type="submit"], button:has-text("Créer"), button:has-text("Enregistrer")').first()
  if (await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, submitBtn, '💾 Créez l\'intervention', 2000)
  }

  await hideTip(page)
  await pause(page, 1000)
  await showConclusion(page, 'Intervention créée avec succès.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
