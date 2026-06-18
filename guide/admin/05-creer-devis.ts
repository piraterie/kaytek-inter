// guide/admin/05-creer-devis.ts — Créer un devis (vidéo enrichie)
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import {
  injectVisualLayer,
  showTitle, showConclusion,
  showTip, hideTip,
  showStep, hideStep,
  vClick, vFill,
} from '../setup/visual-effects'

const SLUG = '05-creer-devis'

test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — créer un devis', async ({ page }) => {
  // ── Navigation vers le formulaire ────────────────────────────────────────
  await nav(page, '/devis/nouveau')
  await pause(page, 1000)

  // ── Couche visuelle pédagogique ───────────────────────────────────────────
  await injectVisualLayer(page)
  await pause(page, 400)

  // ── Titre d'introduction ──────────────────────────────────────────────────
  await showTitle(page, 'Créer un devis', 'Guide Admin — Kaytek Inter')
  await pause(page, 300)

  // ── Étape 1 : Sélectionner le client ─────────────────────────────────────
  await showStep(page, 'Étape 1 / 4')
  const clientField = page.locator(
    'button[style*="text-align: left"]:has-text("Sélectionner"), button:has-text("Sélectionner un client")'
  ).first()

  if (await clientField.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, clientField, '👤 Sélectionnez le client', 500)
    await pause(page, 500)

    const firstOption = page.locator('[data-selected="false"]').first()
    if (await firstOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await vClick(page, firstOption, undefined, 800)
    }
  }

  await pause(page, 800)

  // ── Étape 2 : Ajouter une prestation ─────────────────────────────────────
  await showStep(page, 'Étape 2 / 4')
  const addLineBtn = page.locator(
    'button:has-text("Ajouter une ligne"), button:has-text("+ Ligne"), button:has-text("Ajouter")'
  ).first()

  if (await addLineBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, addLineBtn, '➕ Ajoutez une prestation', 700)
    await pause(page, 500)

    // Description de la prestation
    const lineDesc = page.locator(
      'input[placeholder*="escription"], input[placeholder*="Prestation"], input[placeholder*="ligne"]'
    ).last()
    if (await lineDesc.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await vFill(page, lineDesc, "Main d'œuvre serrurerie", '✏️ Décrivez la prestation')
    }

    await pause(page, 400)

    // Prix unitaire HT
    const prixInput = page.locator('input[placeholder*="rix"], input[placeholder*="HT"]').first()
    if (await prixInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await vFill(page, prixInput, '120', '💶 Saisissez le prix unitaire HT')
    }
  }

  await hideTip(page)
  await pause(page, 1000)

  // ── Étape 3 : Vérifier le récapitulatif ──────────────────────────────────
  await showStep(page, 'Étape 3 / 4')
  await showTip(page, '📋 Vérifiez le récapitulatif du devis')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(page, 700)
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
  await pause(page, 1200)
  await hideTip(page)
  await pause(page, 400)

  // ── Étape 4 : Enregistrer le devis ───────────────────────────────────────
  await showStep(page, 'Étape 4 / 4')
  const saveBtn = page.locator(
    'button:has-text("Enregistrer"), button:has-text("Sauvegarder brouillon"), ' +
    'button:has-text("Créer le devis"), button:has-text("Soumettre")'
  ).last()
  await saveBtn.waitFor({ state: 'visible', timeout: 15_000 })
  await vClick(page, saveBtn, '💾 Enregistrez le devis', 2500)

  await hideStep(page)
  await pause(page, 800)

  // ── Conclusion ────────────────────────────────────────────────────────────
  await showConclusion(page, 'Le devis est créé avec succès.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
