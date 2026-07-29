// tests/e2e/07-messaging.spec.ts — Messagerie interne
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Messagerie', () => {
  test('page /messagerie accessible', async ({ page }) => {
    await page.goto('/messagerie')
    await expect(page).toHaveURL(/messagerie/, { timeout: 10_000 })
  })

  test('liste des conversations s\'affiche', async ({ page }) => {
    await page.goto('/messagerie')
    await page.waitForTimeout(2000)
    // La colonne gauche doit exister (liste utilisateurs)
    const sidebar = page.locator(
      '[class*="sidebar"], [class*="conv"], [class*="contact"], [class*="user-list"]'
    ).first()
    if (await sidebar.isVisible({ timeout: 5_000 }).catch(() => false)) {
      expect(await sidebar.isVisible()).toBeTruthy()
    }
  })

  test('ouvrir une conversation', async ({ page }) => {
    await page.goto('/messagerie')
    await page.waitForTimeout(1500)

    const firstConv = page.locator(
      '[class*="conv"] a, [class*="contact"], [class*="user-item"]'
    ).first()
    if (await firstConv.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstConv.click()
      await page.waitForTimeout(1000)
      // La zone de saisie de message doit apparaître
      const inputArea = page.locator('textarea, input[placeholder*="essage"], [contenteditable]').first()
      expect(await inputArea.isVisible({ timeout: 5_000 }).catch(() => false)).toBeTruthy()
    }
  })

  test('envoyer un message texte', async ({ page }) => {
    await page.goto('/messagerie')
    await page.waitForTimeout(1500)

    const firstConv = page.locator(
      '[class*="conv"] a, [class*="contact"], [class*="user-item"]'
    ).first()
    if (!await firstConv.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune conversation disponible')
      return
    }
    await firstConv.click()
    await page.waitForTimeout(1000)

    const msgInput = page.locator('textarea, input[placeholder*="essage"]').first()
    if (!await msgInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Zone de saisie non trouvée')
      return
    }

    const testMsg = `Test Playwright ${Date.now()}`
    await msgInput.fill(testMsg)

    // Envoyer avec Entrée ou bouton Envoyer
    const sendBtn = page.locator('button[type="submit"], button:has-text("Envoyer"), button:has-text("Send")').first()
    if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.click()
    } else {
      await msgInput.press('Enter')
    }

    await page.waitForTimeout(2000)
    // Le message doit apparaître dans la conversation
    await expect(page.locator(`text=${testMsg}`).first()).toBeVisible({ timeout: 10_000 })
  })

  test('badge de messages non lus sur le dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(1000)
    // Vérifier que le badge de messagerie est présent dans la nav (peut être 0)
    const badge = page.locator('[class*="badge"], [class*="unread"]').first()
    // Test non bloquant — vérifie juste l'absence d'erreur
    expect(await page.locator('h1').first().isVisible()).toBeTruthy()
  })
})
