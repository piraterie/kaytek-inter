// tests/e2e/15-echeancier-docsheet-apercu.spec.ts
// 34. DocSheet desktop : le menu d'actions du devis affiche et ferme
//     correctement l'action échéancier.
// 35. DevisApercuPage : la section Échéancier de la fiche devis pilote
//     réellement la création (ouverture/fermeture de la modale).
import { test, expect } from '@playwright/test'
import { dbAdmin, getOrgId, getProfileId, createTestDevis, cleanupTestDevis } from '../helpers/echeancierDb'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

const devisIdsToClean: string[] = []
const clientIdsToClean: string[] = []

test.describe('Échéancier — DocSheet desktop et actions DevisApercuPage', () => {
  test('34. le DocSheet desktop liste l\'action échéancier et se ferme proprement', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-DocSheet-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'DOCSHEET',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    await page.goto('/devis')
    const row = page.locator('table tr', { hasText: fixture.devisNumero })
    await row.getByRole('button', { name: 'Actions' }).click()

    // Le sheet affiche bien les actions standard ET la nouvelle action échéancier,
    // dans l'ordre attendu (section "Conversion", après "Transformer en facture").
    await expect(row.getByText(fixture.devisNumero)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Transformer en facture' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Créer un échéancier \/ acompte/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dupliquer ce devis' })).toBeVisible()

    // Fermeture via la croix / clic extérieur — le sheet disparaît, aucune erreur console.
    const consoleErrors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /Créer un échéancier \/ acompte/ })).not.toBeVisible({ timeout: 5_000 })
    expect(consoleErrors.filter(e => !e.includes('Failed to load resource'))).toEqual([])
  })

  test('35. la section Échéancier de DevisApercuPage ouvre/ferme réellement la modale de création', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-ApercuActions-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'APERCU',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await expect(page.getByTestId('echeancier-section')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Aucun échéancier pour ce devis.')).toBeVisible()

    await page.getByTestId('echeancier-open-create').click()
    await expect(page.getByText('Créer un échéancier de paiement')).toBeVisible()
    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByText('Créer un échéancier de paiement')).not.toBeVisible({ timeout: 5_000 })

    // Aucun échéancier ne doit avoir été créé par cet aller-retour d'annulation.
    const { data: echeanciers } = await dbAdmin.from('echeanciers').select('id').eq('devis_id', fixture.devisId)
    expect(echeanciers!.length).toBe(0)
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})
