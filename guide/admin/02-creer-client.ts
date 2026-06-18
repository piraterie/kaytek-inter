// guide/admin/02-creer-client.ts — Créer un client
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, hideTip, vClick, vFill } from '../setup/visual-effects'

const SLUG = '02-creer-client'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — créer un client', async ({ page }) => {
  await nav(page, '/clients')
  await injectVisualLayer(page)
  await showTitle(page, 'Créer un client', 'Guide Admin')

  // ── Étape 1 : Ouvrir le formulaire ───────────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const newBtn = page.locator('.page-actions button:has-text("Ajouter"), button.btn-primary:has-text("Ajouter")').first()
  await vClick(page, newBtn, '➕ Cliquez sur Ajouter un client', 1000)

  const modal = page.locator('.modal').first()
  await modal.waitFor({ state: 'visible', timeout: 10_000 })
  await pause(page, 600)

  // ── Étape 2 : Remplir le formulaire ──────────────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  const formInputs = modal.locator('input:not([type="hidden"])')

  const nomInput = formInputs.nth(0)
  if (await nomInput.isVisible().catch(() => false)) {
    await vFill(page, nomInput, 'Martin', '✏️ Nom du client')
  }

  const prenomInput = formInputs.nth(1)
  if (await prenomInput.isVisible().catch(() => false)) {
    await vFill(page, prenomInput, 'Sophie', '✏️ Prénom')
  }

  const telInput = modal.locator('input[type="tel"]').first()
  if (await telInput.isVisible().catch(() => false)) {
    await vFill(page, telInput, '0698765432', '📞 Téléphone')
  }

  const emailInput = modal.locator('input[type="email"]').first()
  if (await emailInput.isVisible().catch(() => false)) {
    await vFill(page, emailInput, 'sophie.martin@exemple.fr', '📧 Email')
  }

  const adresseInput = modal.locator('input:not([type="tel"]):not([type="email"])').last()
  if (await adresseInput.isVisible().catch(() => false)) {
    await vFill(page, adresseInput, '8 Avenue Victor Hugo, 69001 Lyon', '📍 Adresse')
  }

  await pause(page, 800)

  // ── Étape 3 : Enregistrer ────────────────────────────────────────────────
  await showStep(page, 'Étape 3 / 3')
  const submitBtn = modal.locator('button[type="submit"]').first()
  await vClick(page, submitBtn, '💾 Enregistrez la fiche client', 1500)

  await page.locator('text=Martin').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  await hideTip(page)
  await pause(page, 1000)
  await showConclusion(page, 'Client créé avec succès.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
