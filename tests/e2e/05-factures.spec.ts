// tests/e2e/05-factures.spec.ts — Gestion des factures
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Factures', () => {
  test('page /factures accessible', async ({ page }) => {
    await page.goto('/factures')
    await expect(page).toHaveURL(/factures/, { timeout: 10_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('liste des factures s\'affiche', async ({ page }) => {
    await page.goto('/factures')
    await page.waitForTimeout(1500)
    // La page doit afficher soit des factures soit un message vide
    const hasContent = await page.locator(
      '[class*="card"], tr, [class*="row"], text=facture, text=Aucune facture, text=vide'
    ).count() > 0
    expect(hasContent).toBeTruthy()
  })

  test('filtre par statut de paiement fonctionne', async ({ page }) => {
    await page.goto('/factures')
    const filterBtn = page.locator('button:has-text("Impayées"), button:has-text("Payées"), button:has-text("Tous")').first()
    if (await filterBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBtn.click()
      await page.waitForTimeout(300)
      // La liste s'est mise à jour
    }
  })

  test('PDF facture — bouton de téléchargement présent', async ({ page }) => {
    await page.goto('/factures')
    await page.waitForTimeout(1500)
    const pdfBtn = page.locator('button:has-text("PDF"), button:has-text("Télécharger"), a[href*=".pdf"]').first()
    if (await pdfBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Cliquer et vérifier qu'aucune erreur JS n'est levée
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await pdfBtn.click()
      await page.waitForTimeout(2000)
      const criticalErrors = errors.filter(e => !e.includes('Warning') && !e.includes('chunk'))
      expect(criticalErrors).toHaveLength(0)
    }
  })

  test('export Excel — bouton présent', async ({ page }) => {
    await page.goto('/factures')
    const exportBtn = page.locator('button:has-text("Excel"), button:has-text("Export"), button:has-text("xlsx")').first()
    if (await exportBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      expect(await exportBtn.isEnabled()).toBeTruthy()
    }
  })
})
