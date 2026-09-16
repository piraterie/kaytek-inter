// tests/e2e/18-impayes-removed.spec.ts — Suppression de la page Impayés
//
// La page /impayes (composant, route, entrée de menu) a été retirée
// (2026-09-16) : inutile car les impayés étaient déjà visibles ailleurs
// (indicateur "Impayés" du Dashboard, onglet "Impayés" de la page
// Échéanciers). Ce test verrouille la suppression et vérifie explicitement
// que ces indicateurs restants sont toujours présents.
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.describe('Page Impayés — suppression', () => {
  test.use({ storageState: ADMIN_AUTH })

  test('la route /impayes n\'existe plus (redirection, pas de crash)', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('pageerror', err => consoleErrors.push(err.message))

    await page.goto('/impayes')
    await page.waitForTimeout(1000)

    // Le catch-all de App.tsx renvoie vers /dashboard pour toute route
    // inconnue à l'intérieur du layout authentifié — jamais un crash.
    await expect(page).not.toHaveURL(/\/impayes$/)
    expect(consoleErrors).toEqual([])
  })

  test('le menu de navigation n\'affiche plus "Impayés"', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('nav').getByText('Impayés', { exact: true })).toHaveCount(0)
  })

  // Garde-fou explicite demandé : la suppression de la page ne doit pas
  // faire disparaître les indicateurs d'impayés présents ailleurs.
  test('l\'indicateur "Impayés" reste visible sur le Dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText('Impayés', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('l\'onglet de filtre "Impayés" reste disponible sur la page Échéanciers', async ({ page }) => {
    await page.goto('/echeanciers')
    await expect(page.getByText('Impayés', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  })
})
