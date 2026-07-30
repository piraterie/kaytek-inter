// tests/e2e/14-echeancier-cas-limites.spec.ts
// Cas limites : trop-perçu bloqué, plusieurs paiements sur une même échéance,
// arrondi absorbé par la dernière échéance (100 € / 3 -> 33.33/33.33/33.34).
import { test, expect } from '@playwright/test'
import { dbAdmin, getOrgId, getProfileId, createTestDevis, cleanupTestDevis } from '../helpers/echeancierDb'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

const devisIdsToClean: string[] = []
const clientIdsToClean: string[] = []

test.describe('Échéancier — cas limites (trop-perçu, paiements multiples, arrondi)', () => {
  // ── 28. Paiement supérieur au montant restant — refusé par l'UI ─────────
  test('28. un paiement supérieur au reste à payer est bloqué (soumission désactivée)', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-TropPercu-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'TROPPERCU',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    const { data: schedId } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 100, tva_montant: 20, montant_ttc: 120, date_prevue: new Date().toISOString().slice(0, 10) }],
    })

    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-enregistrer-paiement-1')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('echeance-enregistrer-paiement-1').click()

    await page.getByTestId('paiement-montant').fill('150') // > 120 restant
    await expect(page.getByTestId('paiement-trouble')).toContainText('dépasse')
    await expect(page.getByTestId('paiement-submit')).toBeDisabled()

    // Confirme qu'aucun paiement n'a été inséré malgré la tentative de saisie.
    const { data: schedRow } = await dbAdmin.from('echeances').select('id').eq('echeancier_id', schedId as string).single()
    const { data: paiements } = await dbAdmin.from('paiements').select('id').eq('echeance_id', schedRow!.id)
    expect(paiements!.length).toBe(0)
  })

  // ── 29/30. Plusieurs paiements sur une même échéance ─────────────────────
  test('29-30. deux paiements partiels puis le complément sur la même échéance', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-MultiPaiement-${Date.now()}`,
      totalHt: 250, tvaMontant: 50, totalTtc: 300, numeroSuffix: 'MULTIPAY',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    const { data: schedId } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 250, tva_montant: 50, montant_ttc: 300, date_prevue: new Date().toISOString().slice(0, 10) }],
    })
    const { data: ech } = await dbAdmin.from('echeances').select('id').eq('echeancier_id', schedId as string).single()

    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-enregistrer-paiement-1')).toBeVisible({ timeout: 10_000 })

    // Paiement 1/3
    await page.getByTestId('echeance-enregistrer-paiement-1').click()
    await page.getByTestId('paiement-montant').fill('100')
    await page.getByTestId('paiement-submit').click()
    await expect(page.getByTestId('paiement-modal')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('echeance-statut-1')).toContainText('Paiement partiel')

    // Paiement 2/3 (deuxième paiement PARTIEL sur la même échéance — item 30)
    await page.getByTestId('echeance-enregistrer-paiement-1').click()
    await page.getByTestId('paiement-montant').fill('100')
    await page.getByTestId('paiement-submit').click()
    await expect(page.getByTestId('paiement-modal')).not.toBeVisible({ timeout: 10_000 })

    let { data: row } = await dbAdmin.from('echeances').select('montant_paye, montant_restant, statut').eq('id', ech!.id).single()
    expect(row!.montant_paye).toBe(200)
    expect(row!.montant_restant).toBe(100)
    expect(row!.statut).toBe('paiement_partiel')

    // Paiement 3/3 (complément — solde exact)
    await page.getByTestId('echeance-enregistrer-paiement-1').click()
    await expect(page.getByTestId('paiement-montant')).toHaveValue('100')
    await page.getByTestId('paiement-submit').click()
    await expect(page.getByTestId('paiement-modal')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('echeance-statut-1')).toContainText('Payée')

    const { data: paiements } = await dbAdmin.from('paiements').select('montant').eq('echeance_id', ech!.id).order('created_at')
    expect(paiements!.length).toBe(3)
    expect(paiements!.reduce((s, p) => s + p.montant, 0)).toBe(300)

    ;({ data: row } = await dbAdmin.from('echeances').select('montant_paye, montant_restant, statut').eq('id', ech!.id).single())
    expect(row!.montant_paye).toBe(300)
    expect(row!.montant_restant).toBe(0)
    expect(row!.statut).toBe('paye')
  })

  // ── 31. Dernier paiement / dernière échéance absorbe l'écart d'arrondi ──
  test('31. répartition égale sur 3 échéances (100 €) : la dernière absorbe l\'écart d\'arrondi', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-Arrondi-${Date.now()}`,
      totalHt: 83.33, tvaMontant: 16.67, totalTtc: 100, numeroSuffix: 'ARRONDI',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    await page.goto('/devis')
    const row = page.locator('table tr', { hasText: fixture.devisNumero })
    await row.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('button', { name: /Créer un échéancier \/ acompte/ }).click()
    await page.getByRole('button', { name: '3 paiements' }).click()
    await expect(page.getByRole('button', { name: 'Répartition égale' })).toHaveClass(/btn-primary/)

    await expect(page.getByTestId('echeance-montant-preview-0')).toHaveText('33,33 €')
    await expect(page.getByTestId('echeance-montant-preview-1')).toHaveText('33,33 €')
    await expect(page.getByTestId('echeance-montant-preview-2')).toHaveText('33,34 €')

    const today = new Date().toISOString().slice(0, 10)
    const plus30 = new Date(); plus30.setDate(plus30.getDate() + 30)
    const plus60 = new Date(); plus60.setDate(plus60.getDate() + 60)
    await page.getByTestId('echeance-date-0').fill(today)
    await page.getByTestId('echeance-date-1').fill(plus30.toISOString().slice(0, 10))
    await page.getByTestId('echeance-date-2').fill(plus60.toISOString().slice(0, 10))
    await page.getByTestId('echeancier-submit').click()
    await page.waitForURL(/\/devis\/.+\/apercu/, { timeout: 15_000 })

    const { data: echeancier } = await dbAdmin.from('echeanciers').select('*, echeances(*)').eq('devis_id', fixture.devisId).is('annule_le', null).single()
    const echeances = (echeancier!.echeances as any[]).sort((a, b) => a.numero_ordre - b.numero_ordre)
    expect(echeances.map(e => e.montant_ttc)).toEqual([33.33, 33.33, 33.34])
    expect(echeances.reduce((s, e) => s + e.montant_ttc, 0)).toBe(100)
    expect(echeancier!.montant_ttc).toBe(100)
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})
