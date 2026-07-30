// tests/e2e/12-echeancier-parcours-principal.spec.ts
// Parcours complet échéancier de paiement, du devis à la facture de solde.
// Chaque étape pilote le VRAI navigateur (pas de mocks) et vérifie ensuite
// l'état réellement écrit en base via un client service-role (dbAdmin).
import { test, expect } from '@playwright/test'
import fs from 'fs'
import { dbAdmin, getOrgId, getProfileId, cleanupTestDevis } from '../helpers/echeancierDb'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })

test.describe.configure({ mode: 'serial' })

let clientLabel: string
let devisId: string
let devisNumero: string
let echeanceAcompteId: string
let echeanceSoldeId: string
let factureAcompteId: string
let factureSoldeId: string
let factureAcompteNumero: string
let factureSoldeNumero: string
const downloadedFiles: string[] = []

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Échéancier — parcours principal (devis 619,08 € / acompte 30 %)', () => {
  // ── 1. Création d'un devis ──────────────────────────────────────────────
  test('1. création d\'un devis via le formulaire réel (619,08 € TTC exact)', async ({ page }) => {
    clientLabel = `PWE2E-Client-${Date.now()}`
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const { data: client, error } = await dbAdmin.from('clients').insert({
      organisation_id: orgId, nom: clientLabel, prenom: 'Test', type: 'particulier',
      email: `${clientLabel.toLowerCase()}@test.local`, telephone: '0600000099', created_by: adminId,
    }).select('id').single()
    expect(error).toBeNull()

    await page.goto('/devis/nouveau')
    await page.getByRole('button', { name: /Sélectionner un client/ }).click()
    await page.getByText(clientLabel, { exact: false }).click()

    await page.getByRole('button', { name: '+ Ajouter une prestation manuelle' }).click()
    await page.getByRole('textbox', { name: /Ex : Remplacement serrure/ }).fill('Remplacement barillet — Playwright')
    // Le prix HT est le 2e spinbutton du modal (quantité = 1er, déjà à 1 par défaut)
    const modalNumbers = page.locator('.form-group', { hasText: 'Prix unitaire HT' }).getByRole('spinbutton')
    await modalNumbers.fill('515.90')
    await page.locator('.form-group', { hasText: 'TVA *' }).getByRole('combobox').selectOption('20')
    await expect(page.getByText('619,08 € TTC')).toBeVisible()
    await page.getByRole('button', { name: '+ Ajouter cette prestation' }).click()

    await page.getByRole('button', { name: '✉ Enregistrer & Envoyer' }).click()
    await page.waitForURL(/\/devis\/.+\/apercu/, { timeout: 15_000 })

    devisId = page.url().match(/\/devis\/([^/]+)\/apercu/)![1]

    const { data: devisRow } = await dbAdmin.from('devis').select('numero, total_ht, tva_montant, total_ttc, statut').eq('id', devisId).single()
    expect(devisRow).not.toBeNull()
    devisNumero = devisRow!.numero
    expect(devisRow!.total_ht).toBe(515.9)
    expect(devisRow!.tva_montant).toBe(103.18)
    expect(devisRow!.total_ttc).toBe(619.08)
    expect(['envoye', 'accepte']).toContain(devisRow!.statut)
  })

  // ── 2. Menu d'actions + 3/4/5. Création échéancier 2 paiements, acompte 30%, montants exacts ──
  test('2-5. menu d\'actions → créer un échéancier 2 paiements, acompte 30 % → montants exacts', async ({ page }) => {
    await page.goto('/devis')
    await page.locator('table').getByText(devisNumero, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    const row = page.locator('table tr', { hasText: devisNumero })
    await row.getByRole('button', { name: 'Actions' }).click()

    const createBtn = page.getByRole('button', { name: /Créer un échéancier \/ acompte/ })
    await expect(createBtn).toBeVisible()
    await expect(page.getByText('Gérer un acompte et jusqu\'à 4 paiements')).toBeVisible()
    await createBtn.click()

    await expect(page.getByText('Créer un échéancier de paiement')).toBeVisible()
    // 2 paiements est déjà sélectionné par défaut — le confirmer explicitement.
    await page.getByRole('button', { name: '2 paiements' }).click()
    await page.getByRole('button', { name: '30 %' }).click()

    // Vérification exacte des montants (item 5) : 185,72 € / 433,36 €
    await expect(page.getByTestId('echeance-montant-preview-0')).toHaveText('185,72 €')
    await expect(page.getByTestId('echeance-montant-preview-1')).toHaveText('433,36 €')
  })

  // ── 6. Vérification des dates d'échéance ────────────────────────────────
  test('6. dates d\'échéance saisies et persistées', async ({ page }) => {
    // Reprend la modale ouverte à l'étape précédente (même worker séquentiel,
    // mais Playwright recharge une nouvelle page par test) — on la rouvre.
    await page.goto('/devis')
    const row = page.locator('table tr', { hasText: devisNumero })
    await row.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('button', { name: /Créer un échéancier \/ acompte/ }).click()
    await page.getByRole('button', { name: '30 %' }).click()

    const dateAcompte = new Date(); dateAcompte.setDate(dateAcompte.getDate() + 7)
    const dateSolde = new Date(); dateSolde.setDate(dateSolde.getDate() + 37)
    const isoAcompte = dateAcompte.toISOString().slice(0, 10)
    const isoSolde = dateSolde.toISOString().slice(0, 10)

    await page.getByTestId('echeance-date-0').fill(isoAcompte)
    await page.getByTestId('echeance-date-1').fill(isoSolde)
    await expect(page.getByTestId('echeance-date-0')).toHaveValue(isoAcompte)
    await expect(page.getByTestId('echeance-date-1')).toHaveValue(isoSolde)

    await expect(page.getByTestId('echeancier-submit')).toBeEnabled()
    await page.getByTestId('echeancier-submit').click()
    await page.waitForURL(/\/devis\/.+\/apercu/, { timeout: 15_000 })

    // Vérification en base : dates persistées telles que saisies, montants exacts.
    const { data: echeancier } = await dbAdmin.from('echeanciers').select('*, echeances(*)').eq('devis_id', devisId).is('annule_le', null).single()
    expect(echeancier).not.toBeNull()
    expect(echeancier!.montant_ttc).toBe(619.08)
    expect(echeancier!.nombre_echeances).toBe(2)
    const echeances = (echeancier!.echeances as any[]).sort((a, b) => a.numero_ordre - b.numero_ordre)
    expect(echeances[0].date_prevue).toBe(isoAcompte)
    expect(echeances[1].date_prevue).toBe(isoSolde)
    expect(echeances[0].montant_ttc).toBe(185.72)
    expect(echeances[1].montant_ttc).toBe(433.36)
    expect(echeances[0].montant_ttc + echeances[1].montant_ttc).toBe(619.08)
    echeanceAcompteId = echeances[0].id
    echeanceSoldeId = echeances[1].id
  })

  // ── 7/8/9. Génération facture d'acompte, numéro FAC-YYYY-NNN, pas de paiement automatique ──
  test('7-9. génère la facture d\'acompte : numéro FAC-YYYY-NNN, aucun paiement marqué reçu', async ({ page }) => {
    await page.goto(`/devis/${devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-statut-1')).toContainText('En attente de paiement', { timeout: 10_000 })

    const { data: echeance } = await dbAdmin.from('echeances').select('facture_id, montant_paye, statut').eq('id', echeanceAcompteId).single()
    expect(echeance!.facture_id).not.toBeNull()
    // Item 9 : la facture ne doit JAMAIS marquer le paiement comme reçu.
    expect(echeance!.montant_paye).toBe(0)
    expect(echeance!.statut).toBe('en_attente_paiement')

    factureAcompteId = echeance!.facture_id
    const { data: facture } = await dbAdmin.from('factures').select('numero, type_facture, montant_ttc, statut_paiement').eq('id', factureAcompteId).single()
    expect(facture!.numero).toMatch(/^FAC-\d{4}-\d{3}$/)
    expect(facture!.type_facture).toBe('acompte')
    expect(facture!.montant_ttc).toBe(185.72)
    expect(facture!.statut_paiement).toBe('impayee')
    factureAcompteNumero = facture!.numero
  })

  // ── 10/11. Paiement partiel + statut ─────────────────────────────────────
  test('10-11. enregistrement d\'un paiement partiel (100 €) → statut "Paiement partiel"', async ({ page }) => {
    await page.goto(`/devis/${devisId}/apercu`)
    await page.getByTestId('echeance-enregistrer-paiement-1').click()
    await expect(page.getByTestId('paiement-modal')).toBeVisible()
    await page.getByTestId('paiement-montant').fill('100')
    await page.getByTestId('paiement-submit').click()
    await expect(page.getByTestId('paiement-modal')).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByTestId('echeance-statut-1')).toContainText('Paiement partiel')

    const { data: echeance } = await dbAdmin.from('echeances').select('montant_paye, montant_restant, statut').eq('id', echeanceAcompteId).single()
    expect(echeance!.montant_paye).toBe(100)
    expect(echeance!.montant_restant).toBe(85.72)
    expect(echeance!.statut).toBe('paiement_partiel')

    const { data: echeancier } = await dbAdmin.from('echeanciers').select('statut, montant_paye').eq('devis_id', devisId).is('annule_le', null).single()
    expect(echeancier!.statut).toBe('paiement_partiel')
    expect(echeancier!.montant_paye).toBe(100)
  })

  // ── 12/13. Complément de paiement → statut payé ──────────────────────────
  test('12-13. enregistrement du complément (85,72 €) → statut "Payée"', async ({ page }) => {
    await page.goto(`/devis/${devisId}/apercu`)
    await page.getByTestId('echeance-enregistrer-paiement-1').click()
    // Le montant proposé par défaut doit déjà être le reste à payer exact.
    await expect(page.getByTestId('paiement-montant')).toHaveValue('85.72')
    await page.getByTestId('paiement-submit').click()
    await expect(page.getByTestId('paiement-modal')).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByTestId('echeance-statut-1')).toContainText('Payée')

    const { data: echeance } = await dbAdmin.from('echeances').select('montant_paye, montant_restant, statut').eq('id', echeanceAcompteId).single()
    expect(echeance!.montant_paye).toBe(185.72)
    expect(echeance!.montant_restant).toBe(0)
    expect(echeance!.statut).toBe('paye')
  })

  // ── 14/15. Facture de solde — déduction de l'acompte ─────────────────────
  test('14-15. génère la facture de solde : montant = 433,36 € (acompte déduit, pas le TTC entier)', async ({ page }) => {
    await page.goto(`/devis/${devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-2').click()
    await expect(page.getByTestId('echeance-statut-2')).toContainText('En attente de paiement', { timeout: 10_000 })

    const { data: echeance } = await dbAdmin.from('echeances').select('facture_id').eq('id', echeanceSoldeId).single()
    factureSoldeId = echeance!.facture_id
    const { data: facture } = await dbAdmin.from('factures').select('numero, type_facture, montant_ttc').eq('id', factureSoldeId).single()
    expect(facture!.type_facture).toBe('solde')
    expect(facture!.montant_ttc).toBe(433.36) // jamais 619.08 (le TTC entier du devis)
    factureSoldeNumero = facture!.numero

    // Total des deux factures = TTC exact du devis, sans double comptage.
    expect(185.72 + facture!.montant_ttc).toBe(619.08)
  })

  // ── 16/17. Vérification des PDF (téléchargement réel) ───────────────────
  test('16. PDF de la facture d\'acompte se télécharge (fichier non vide, nom correct)', async ({ page }) => {
    await page.goto('/factures')
    await page.locator('table').getByText(factureAcompteNumero, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    const row = page.locator('table tr', { hasText: factureAcompteNumero })
    await row.getByRole('button', { name: 'Actions' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Exporter PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toContain(factureAcompteNumero)
    const path = await download.path()
    expect(path).not.toBeNull()
    const size = fs.statSync(path!).size
    expect(size).toBeGreaterThan(1000) // PDF réel, pas un fichier vide/erreur
    downloadedFiles.push(path!)
  })

  test('17. PDF de la facture de solde se télécharge (fichier non vide, nom correct)', async ({ page }) => {
    await page.goto('/factures')
    await page.locator('table').getByText(factureSoldeNumero, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    const row = page.locator('table tr', { hasText: factureSoldeNumero })
    await row.getByRole('button', { name: 'Actions' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Exporter PDF' }).click(),
    ])
    expect(download.suggestedFilename()).toContain(factureSoldeNumero)
    const path = await download.path()
    const size = fs.statSync(path!).size
    expect(size).toBeGreaterThan(1000)
    downloadedFiles.push(path!)
  })

  // ── 18. Page Échéanciers ─────────────────────────────────────────────────
  test('18. la page Échéanciers affiche l\'échéancier avec le bon reste à payer', async ({ page }) => {
    await page.goto('/echeanciers')
    await expect(page.locator('[data-testid="echeanciers-row"]', { hasText: devisNumero })).toBeVisible({ timeout: 10_000 })
    const row = page.locator('[data-testid="echeanciers-row"]', { hasText: devisNumero })
    await expect(row.getByTestId('echeanciers-row-restant')).toHaveText('433,36 €')
    // Statut agrégé de l'échéancier (pas de l'échéance) : une échéance payée sur
    // deux → "Paiement partiel" au niveau échéancier, conforme à la règle
    // métier section 17 ("certaines échéances payées -> Paiement partiel").
    await expect(row.getByTestId('echeanciers-row-statut')).toContainText('Paiement partiel')
  })

  // ── 19. Page Impayés (l'échéance solde n'est pas en retard → absente) ───
  test('19. la page Impayés ne montre pas une échéance non encore en retard', async ({ page }) => {
    await page.goto('/impayes')
    await page.waitForLoadState('networkidle').catch(() => {})
    const rows = page.locator('[data-testid="impaye-row"]', { hasText: devisNumero })
    await expect(rows).toHaveCount(0)
  })

  // ── 20. Situation financière client ──────────────────────────────────────
  test('20. la fiche client affiche la situation financière exacte', async ({ page }) => {
    const { data: client } = await dbAdmin.from('clients').select('id').eq('nom', clientLabel).single()
    await page.goto(`/clients/${client!.id}`)
    await expect(page.getByTestId('client-situation-financiere')).toBeVisible({ timeout: 10_000 })
    const section = page.getByTestId('client-situation-financiere')
    await expect(section).toContainText('619,08 €') // total facturé
    await expect(section).toContainText('185,72 €') // total encaissé
    await expect(section).toContainText('433,36 €') // reste à payer
  })

  // ── 21. Carte dashboard "Paiements à surveiller" ─────────────────────────
  test('21. le dashboard affiche l\'échéance de solde dans "Paiements à surveiller"', async ({ page }) => {
    await page.goto('/dashboard')
    const card = page.getByTestId('dashboard-paiements-surveiller')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText(clientLabel)
    await expect(card).toContainText('433')
  })

  test.afterAll(async () => {
    for (const f of downloadedFiles) { try { fs.unlinkSync(f) } catch {} }
    if (devisId) {
      const { data: client } = await dbAdmin.from('clients').select('id').eq('nom', clientLabel).maybeSingle()
      await cleanupTestDevis([devisId], client ? [client.id] : [])
    }
  })
})
