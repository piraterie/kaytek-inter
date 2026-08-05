// tests/responsive/02-echeancier-mobile.spec.ts
// 33. Affichage mobile : nouvelles pages Échéanciers/Impayés + parcours de
// création d'échéancier via carte mobile, sans débordement horizontal.
// Lancé automatiquement sur les projets mobile-360/390/430 et tablet.
import { test, expect } from '@playwright/test'
import { dbAdmin, getOrgId, getProfileId, createTestDevis, cleanupTestDevis } from '../helpers/echeancierDb'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

async function noHorizontalOverflow(page: any) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

const devisIdsToClean: string[] = []
const clientIdsToClean: string[] = []

test.describe('Responsive — Échéanciers / Impayés / création mobile', () => {
  test('pages Échéanciers et Impayés sans débordement horizontal', async ({ page }) => {
    await page.goto('/echeanciers')
    await page.waitForTimeout(500)
    expect(await noHorizontalOverflow(page), 'Débordement horizontal sur /echeanciers').toBeFalsy()

    await page.goto('/impayes')
    await page.waitForTimeout(500)
    expect(await noHorizontalOverflow(page), 'Débordement horizontal sur /impayes').toBeFalsy()
  })

  test('création d\'un échéancier via la carte mobile du devis, sans débordement', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-Mobile-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'MOBILE',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    await page.goto('/devis')
    await page.getByText(fixture.devisNumero, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    // Sur mobile, taper la carte ouvre directement le DocSheet (pas de bouton "Actions" dédié).
    await page.getByText(fixture.devisNumero, { exact: true }).first().click()

    const createBtn = page.getByRole('button', { name: /Créer un échéancier \/ acompte/ })
    await expect(createBtn).toBeVisible({ timeout: 5_000 })
    await createBtn.click()

    await expect(page.getByText('Créer un échéancier de paiement')).toBeVisible()
    expect(await noHorizontalOverflow(page), 'Débordement horizontal dans la modale échéancier (mobile)').toBeFalsy()
    await expect(page.getByTestId('echeance-montant-preview-0')).toBeVisible()

    await page.getByRole('button', { name: 'Annuler' }).click()
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})
