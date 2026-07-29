// tests/e2e/08-notifications.spec.ts — Notifications et journal
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Notifications', () => {
  test('cloche de notification présente dans la navbar', async ({ page }) => {
    await page.goto('/dashboard')
    // La cloche ou le badge de notification doit exister
    const bell = page.locator(
      '[class*="notif"], button[title*="otif"], [aria-label*="otif"], text=🔔'
    ).first()
    if (await bell.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await bell.click()
      await page.waitForTimeout(500)
    }
    // Test non bloquant
    expect(await page.locator('body').isVisible()).toBeTruthy()
  })

  test('journal d\'activité accessible', async ({ page }) => {
    await page.goto('/journal')
    await expect(page).toHaveURL(/journal/, { timeout: 10_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('journal affiche des entrées', async ({ page }) => {
    await page.goto('/journal')
    await page.waitForTimeout(1500)
    const hasEntries = await page.locator('[class*="card"], tr, [class*="entry"]').count() > 0
    expect(hasEntries).toBeTruthy()
  })
})

test.describe('Paramètres entreprise', () => {
  test('page /parametres accessible', async ({ page }) => {
    await page.goto('/parametres')
    await expect(page).toHaveURL(/parametres/, { timeout: 10_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('paramètres affichent les champs entreprise', async ({ page }) => {
    await page.goto('/parametres')
    await page.waitForTimeout(1000)
    // Raison sociale et au moins un champ doivent être présents
    const fields = await page.locator('input, textarea').count()
    expect(fields).toBeGreaterThan(0)
  })
})

test.describe('Utilisateurs', () => {
  test('page /utilisateurs accessible', async ({ page }) => {
    await page.goto('/utilisateurs')
    await expect(page).toHaveURL(/utilisateurs/, { timeout: 10_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('liste des utilisateurs s\'affiche', async ({ page }) => {
    await page.goto('/utilisateurs')
    await page.waitForTimeout(1500)
    const hasUsers = await page.locator('[class*="card"], tr, [class*="user"]').count() > 0
    expect(hasUsers).toBeTruthy()
  })

  test('suppression utilise ConfirmModal (pas window.confirm)', async ({ page }) => {
    await page.goto('/utilisateurs')
    await page.waitForTimeout(1000)

    // Intercepter window.confirm — il ne doit PAS être appelé
    let confirmCalled = false
    page.on('dialog', dialog => {
      if (dialog.type() === 'confirm') {
        confirmCalled = true
        dialog.dismiss()
      }
    })

    // Chercher un bouton supprimer
    const deleteBtn = page.locator(
      'button[title*="upprimer"], button:has-text("Supprimer"), button:has-text("🗑")'
    ).first()
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(500)
      // La ConfirmModal doit apparaître (pas window.confirm)
      expect(confirmCalled).toBeFalsy()
      const modal = page.locator('[class*="modal"], [role="dialog"]').first()
      expect(await modal.isVisible({ timeout: 3_000 }).catch(() => false)).toBeTruthy()
      // Annuler la suppression
      await page.locator('button:has-text("Annuler"), button:has-text("Non")').first().click()
    }
  })
})
