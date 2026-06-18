// guide/admin/07-gerer-utilisateur.ts — Gérer un utilisateur
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click, scrollTo } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick, highlightEl } from '../setup/visual-effects'

const SLUG = '07-gerer-utilisateur'
test.use({ storageState: GUIDE_ADMIN_AUTH })

test('guide admin — gérer un utilisateur', async ({ page }) => {
  await nav(page, '/utilisateurs')
  await injectVisualLayer(page)
  await showTitle(page, 'Gérer un utilisateur', 'Guide Admin')

  await page.evaluate(() => window.scrollTo({ top: 100, behavior: 'smooth' }))
  await pause(page, 600)

  // ── Étape 1 : Ouvrir la fiche ────────────────────────────────────────────
  await showStep(page, 'Étape 1 / 4')
  const editBtn = page.locator('button:has-text("Modifier")').first()
  await editBtn.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, editBtn, '✏️ Modifiez un intervenant', 1000)

  const modal = page.locator('[class*="modal"], [role="dialog"]').first()
  await modal.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  await pause(page, 700)

  // ── Étape 2 : Onglet Profil ──────────────────────────────────────────────
  await showStep(page, 'Étape 2 / 4')
  const profileTab = page.locator('[role="tab"]:has-text("Profil"), button:has-text("Profil")').first()
  if (await profileTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await vClick(page, profileTab, '👤 Consultez le profil', 600)
  }

  const commissionInput = page.locator('input[placeholder*="ommission"], input[name*="commission"]').first()
  if (await commissionInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(commissionInput)
    await highlightEl(page, commissionInput)
    await showTip(page, '💰 Taux de commission de l\'intervenant')
    await pause(page, 1200)
    await hideTip(page)
  }

  // ── Étape 3 : Permissions ────────────────────────────────────────────────
  await showStep(page, 'Étape 3 / 4')
  const createDocsCheck = page.locator('input[name*="can_create_documents"], label:has-text("créer des documents") input').first()
  if (await createDocsCheck.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(createDocsCheck)
    await highlightEl(page, createDocsCheck)
    await showTip(page, '🔐 Permissions de création de documents')
    await pause(page, 1200)
    await hideTip(page)
  }

  // ── Étape 4 : Enregistrer ────────────────────────────────────────────────
  await showStep(page, 'Étape 4 / 4')
  const saveBtn = page.locator('button[type="submit"], button:has-text("Enregistrer"), button:has-text("Sauvegarder")').first()
  if (await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await vClick(page, saveBtn, '💾 Enregistrez les modifications', 1500)
  }

  await pause(page, 800)
  await showConclusion(page, 'Profil mis à jour avec succès.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
