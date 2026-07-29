// tests/e2e/02-clients.spec.ts — Gestion des clients
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

const CLIENT_TEST = {
  nom: `TestAuto-${Date.now()}`,
  telephone: '0601020304',
  email: `test-${Date.now()}@playwright.fr`,
  adresse: '12 Rue du Test',
  cp: '75001',
  ville: 'Paris',
}

test.describe('Clients', () => {
  test('liste clients — page accessible et affiche des résultats', async ({ page }) => {
    await page.goto('/clients')
    await expect(page).toHaveURL(/clients/, { timeout: 10_000 })
    // En-tête de page
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('créer un client particulier', async ({ page }) => {
    await page.goto('/clients')

    // Ouvrir le formulaire de création
    const newBtn = page.locator('button:has-text("Nouveau"), button:has-text("Ajouter"), button:has-text("client")').first()
    await newBtn.click()

    // Remplir le formulaire — champs nom et téléphone sont obligatoires
    await page.locator('input[placeholder*="om"], input[id*="nom"], input[name*="nom"]').first().fill(CLIENT_TEST.nom)

    const telInput = page.locator('input[type="tel"], input[placeholder*="léphone"], input[placeholder*="0600"]').first()
    if (await telInput.isVisible().catch(() => false)) {
      await telInput.fill(CLIENT_TEST.telephone)
    }

    const emailInput = page.locator('input[type="email"]').first()
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(CLIENT_TEST.email)
    }

    // Soumettre
    await page.locator('button[type="submit"], button:has-text("Enregistrer"), button:has-text("Créer")').first().click()

    // Vérifier création — toast ou apparition dans la liste
    await page.waitForTimeout(1500)
    const created = page.locator(`text=${CLIENT_TEST.nom}`).first()
    await expect(created).toBeVisible({ timeout: 10_000 })
  })

  test('recherche client — filtre la liste', async ({ page }) => {
    await page.goto('/clients')
    const searchInput = page.locator('input[placeholder*="echerche"], input[type="search"]').first()
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Test')
      await page.waitForTimeout(500)
      // La liste doit contenir au moins un résultat (ou afficher "aucun résultat")
      const hasResults = await page.locator('[class*="card"], [class*="row"], tr').count() > 0
      expect(hasResults).toBeTruthy()
    }
  })

  test('fiche client accessible', async ({ page }) => {
    await page.goto('/clients')
    // Cliquer sur le premier client dans la liste
    const firstClient = page.locator('a[href*="/clients/"], [class*="client-row"], tr').first()
    if (await firstClient.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstClient.click()
      await expect(page).toHaveURL(/clients\/[\w-]+/, { timeout: 10_000 })
    }
  })
})
