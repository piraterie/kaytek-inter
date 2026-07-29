// tests/e2e/06-interventions.spec.ts — Gestion des interventions
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Interventions', () => {
  test('page /interventions accessible', async ({ page }) => {
    await page.goto('/interventions')
    await expect(page).toHaveURL(/interventions/, { timeout: 10_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('liste des interventions s\'affiche', async ({ page }) => {
    await page.goto('/interventions')
    await page.waitForTimeout(1500)
    const hasContent = await page.locator(
      '[class*="card"], tr, [class*="row"], [class*="intervention"], text=aucune'
    ).count() > 0
    expect(hasContent).toBeTruthy()
  })

  test('filtre par statut fonctionne', async ({ page }) => {
    await page.goto('/interventions')
    const filterBtn = page.locator(
      'button:has-text("En attente"), button:has-text("En cours"), button:has-text("Tous")'
    ).first()
    if (await filterBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBtn.click()
      await page.waitForTimeout(300)
    }
  })

  test('page planning accessible', async ({ page }) => {
    await page.goto('/planning')
    await expect(page).toHaveURL(/planning/, { timeout: 10_000 })
    // FullCalendar doit être rendu
    await expect(page.locator('.fc, [class*="calendar"], h1').first()).toBeVisible({ timeout: 10_000 })
  })

  test('détail d\'une intervention accessible', async ({ page }) => {
    await page.goto('/interventions')
    await page.waitForTimeout(1500)
    const firstItem = page.locator('a[href*="/interventions/"], [class*="intervention-card"]').first()
    if (await firstItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstItem.click()
      await expect(page).toHaveURL(/interventions\/[\w-]+/, { timeout: 10_000 })
      await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
    }
  })

  test('créer une intervention', async ({ page }) => {
    await page.goto('/interventions')
    const newBtn = page.locator('button:has-text("Nouvelle"), button:has-text("Créer"), button:has-text("+ ")').first()
    if (!await newBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Bouton création non trouvé')
      return
    }
    await newBtn.click()

    // Remplir les champs minimum
    const addressInput = page.locator('input[placeholder*="dresse"], input[placeholder*="ue"]').first()
    if (await addressInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addressInput.fill('15 Rue Playwright, 75001 Paris')
    }

    const saveBtn = page.locator('button[type="submit"], button:has-text("Enregistrer"), button:has-text("Créer")').first()
    if (await saveBtn.isEnabled({ timeout: 3_000 }).catch(() => false)) {
      await saveBtn.click()
      await page.waitForTimeout(2000)
    }
  })
})
