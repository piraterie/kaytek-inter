// guide/admin/08-parametres-entreprise.ts — Paramètres entreprise
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, scrollTo } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, highlightEl } from '../setup/visual-effects'

const SLUG = '08-parametres-entreprise'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — paramètres entreprise', async ({ page }) => {
  await nav(page, '/parametres')
  await injectVisualLayer(page)
  await showTitle(page, 'Paramètres entreprise', 'Guide Admin')

  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await pause(page, 600)

  // ── Section 1 : Informations générales ───────────────────────────────────
  await showStep(page, 'Section 1 / 4')
  const infoSection = page.locator('text=Informations, text=Entreprise, h2, h3').first()
  if (await infoSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(infoSection)
    await highlightEl(page, infoSection)
    await showTip(page, '🏢 Nom, adresse et coordonnées de votre entreprise')
    await pause(page, 1400)
    await hideTip(page)
  }

  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }))
  await pause(page, 900)

  // ── Section 2 : SIRET / Financier ────────────────────────────────────────
  await showStep(page, 'Section 2 / 4')
  const siretSection = page.locator('text=SIRET, input[name*="siret"], label:has-text("SIRET")').first()
  if (await siretSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(siretSection)
    await highlightEl(page, siretSection)
    await showTip(page, '🔢 SIRET, TVA et IBAN pour la facturation')
    await pause(page, 1400)
    await hideTip(page)
  }

  await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }))
  await pause(page, 900)

  // ── Section 3 : Emails automatiques ──────────────────────────────────────
  await showStep(page, 'Section 3 / 4')
  const emailSection = page.locator('text=Email, text=automatique, label:has-text("Email")').first()
  if (await emailSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(emailSection)
    await highlightEl(page, emailSection)
    await showTip(page, '📧 Emails automatiques envoyés aux clients')
    await pause(page, 1400)
    await hideTip(page)
  }

  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'smooth' }))
  await pause(page, 900)

  // ── Section 4 : Logo ─────────────────────────────────────────────────────
  await showStep(page, 'Section 4 / 4')
  const logoSection = page.locator('text=Logo, [class*="logo"], label:has-text("Logo")').first()
  if (await logoSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(logoSection)
    await highlightEl(page, logoSection)
    await showTip(page, '🖼️ Logo affiché sur vos devis et factures')
    await pause(page, 1400)
    await hideTip(page)
  }

  // ── Bouton d'enregistrement (sans cliquer) ────────────────────────────────
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(page, 800)
  const saveBtn = page.locator('button[type="submit"], button:has-text("Enregistrer"), button:has-text("Sauvegarder")').first()
  if (await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(saveBtn)
    await highlightEl(page, saveBtn)
    await showTip(page, '💾 Enregistrez vos paramètres après modification')
    await pause(page, 1200)
    await hideTip(page)
  }

  await pause(page, 600)
  await showConclusion(page, 'Paramètres configurés.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
