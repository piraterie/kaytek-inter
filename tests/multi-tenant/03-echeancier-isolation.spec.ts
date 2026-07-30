// tests/multi-tenant/03-echeancier-isolation.spec.ts
// 36/37. Isolation multi-organisation (lecture ET écriture).
// 38. Permissions admin / intervenant / assistant.
// 39. Une facture finale ne peut pas être générée deux fois pour la même échéance.
// 40. Plusieurs factures d'acompte/intermédiaires restent possibles sur un même échéancier.
import { test, expect } from '@playwright/test'
import { dbAdmin, getOrgId, getProfileId, createTestDevis, cleanupTestDevis, createUserClient } from '../helpers/echeancierDb'

const ADMIN_A_AUTH = 'tests/.auth/admin.json'
const ADMIN_B_AUTH = 'tests/.auth/admin-b.json'
const INTERVENANT_A_AUTH = 'tests/.auth/intervenant.json'
const ASSISTANT_A_AUTH = 'tests/.auth/assistant.json'

async function addKaytekActive(ctx: any) {
  await ctx.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
}

const devisIdsToClean: string[] = []
const clientIdsToClean: string[] = []

test.describe('Échéancier — isolation multi-tenant, permissions, règles métier', () => {
  test.skip(!process.env.TEST_ADMIN_B_EMAIL, 'TEST_ADMIN_B_EMAIL non défini — tests multi-tenant ignorés')

  // ── 36/37. Isolation lecture + écriture ─────────────────────────────────
  test('36-37. org B ne peut ni lire ni modifier un échéancier de org A', async ({ browser }) => {
    const orgAId = await getOrgId('test-org-a-local')
    const adminAId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId: orgAId, createdBy: adminAId, clientNom: `PWE2E-IsolationA-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'ISOLATION',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)

    const { data: schedId } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 100, tva_montant: 20, montant_ttc: 120, date_prevue: new Date().toISOString().slice(0, 10) }],
    })
    expect(schedId).not.toBeNull()

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    await addKaytekActive(ctxB)
    const pageB = await ctxB.newPage()

    // Lecture : la page Échéanciers de org B ne doit jamais montrer le devis de org A.
    await pageB.goto('/echeanciers')
    await pageB.waitForTimeout(1000)
    await expect(pageB.locator('[data-testid="echeanciers-row"]', { hasText: fixture.devisNumero })).toHaveCount(0)

    // Lecture directe par URL (IDOR) : l'apercu du devis A ne doit exposer aucune donnée d'échéancier.
    await pageB.goto(`/devis/${fixture.devisId}/apercu`)
    await pageB.waitForTimeout(1000)
    const bodyText = await pageB.locator('body').innerText().catch(() => '')
    expect(bodyText).not.toContain('185,72')
    expect(bodyText).not.toContain(fixture.devisNumero)

    await ctxB.close()

    // Écriture directe via l'API Supabase authentifiée comme un vrai admin org B
    // (RLS pleinement appliquée, pas de service role) — doit être bloquée par la
    // base elle-même, pas seulement par l'absence de bouton dans l'UI.
    const clientB = await createUserClient(process.env.TEST_ADMIN_B_EMAIL!, process.env.TEST_ADMIN_B_PASSWORD!)
    const { data: writeAttempt, error: writeError } = await clientB
      .from('echeanciers')
      .update({ note_interne: 'hack org B' })
      .eq('id', schedId as string)
      .select()
    // RLS bloque de deux façons possibles : erreur explicite, ou 0 ligne affectée
    // (USING filtre silencieusement) — les deux sont un refus valide.
    const blocked = !!writeError || (writeAttempt?.length ?? 0) === 0
    expect(blocked, 'org B a pu modifier un échéancier de org A').toBe(true)

    const readAttempt = await clientB.from('echeanciers').select('id').eq('id', schedId as string)
    expect(readAttempt.data?.length ?? 0).toBe(0)

    const { data: unchanged } = await dbAdmin.from('echeanciers').select('note_interne').eq('id', schedId as string).single()
    expect(unchanged!.note_interne).not.toBe('hack org B')
  })

  // ── 38. Permissions admin / intervenant / assistant ──────────────────────
  test('38a. un assistant est bloqué au niveau route sur /echeanciers et /impayes', async ({ browser }) => {
    test.skip(!process.env.TEST_ASSISTANT_EMAIL, 'TEST_ASSISTANT_EMAIL non défini')
    const ctx = await browser.newContext({ storageState: ASSISTANT_A_AUTH })
    await addKaytekActive(ctx)
    const page = await ctx.newPage()

    await page.goto('/echeanciers')
    await page.waitForTimeout(1000)
    await expect(page).not.toHaveURL(/\/echeanciers$/)

    await page.goto('/impayes')
    await page.waitForTimeout(1000)
    await expect(page).not.toHaveURL(/\/impayes$/)

    await ctx.close()
  })

  test('38b. un intervenant assigné au devis voit l\'échéancier en lecture seule (pas de bouton de gestion)', async ({ browser }) => {
    test.skip(!process.env.TEST_INTERVENANT_EMAIL, 'TEST_INTERVENANT_EMAIL non défini')
    const orgAId = await getOrgId('test-org-a-local')
    const adminAId = await getProfileId('admin-a@kaytek.test')
    const intervenantId = await getProfileId('intervenant-a@kaytek.test')

    const fixture = await createTestDevis({
      orgId: orgAId, createdBy: adminAId, clientNom: `PWE2E-PermIntervenant-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'PERMINT',
    })
    devisIdsToClean.push(fixture.devisId); clientIdsToClean.push(fixture.clientId)
    await dbAdmin.from('devis').update({ intervenant_id: intervenantId }).eq('id', fixture.devisId)

    await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 100, tva_montant: 20, montant_ttc: 120, date_prevue: new Date().toISOString().slice(0, 10) }],
    })

    const ctx = await browser.newContext({ storageState: INTERVENANT_A_AUTH })
    await addKaytekActive(ctx)
    const page = await ctx.newPage()
    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await expect(page.getByTestId('echeancier-section')).toBeVisible({ timeout: 10_000 })
    // Lecture seule : ni bouton "Générer la facture" ni "Enregistrer un paiement"
    // (canManage = isAdmin || can_create_documents, faux pour cet intervenant).
    await expect(page.getByTestId('echeance-generer-facture-1')).toHaveCount(0)
    await expect(page.getByTestId('echeance-enregistrer-paiement-1')).toHaveCount(0)

    await ctx.close()
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})

test.describe('Échéancier — factures multiples et double génération (admin A)', () => {
  test.use({ storageState: ADMIN_A_AUTH })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
  })

  const devisIds2: string[] = []
  const clientIds2: string[] = []

  test('39. impossible de générer deux fois la facture d\'une même échéance', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-DoubleFacture-${Date.now()}`,
      totalHt: 100, tvaMontant: 20, totalTtc: 120, numeroSuffix: 'DOUBLEFACT',
    })
    devisIds2.push(fixture.devisId); clientIds2.push(fixture.clientId)

    const { data: schedId } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 100, tva_montant: 20, montant_ttc: 120, date_prevue: new Date().toISOString().slice(0, 10) }],
    })
    const { data: ech } = await dbAdmin.from('echeances').select('id').eq('echeancier_id', schedId as string).single()

    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-statut-1')).toContainText('En attente de paiement', { timeout: 10_000 })
    // Le bouton disparaît côté UI dès que l'échéance n'est plus "à facturer".
    await expect(page.getByTestId('echeance-generer-facture-1')).toHaveCount(0)

    // Défense en profondeur : un second appel direct à la RPC (contournement UI) est refusé côté serveur.
    const { error } = await dbAdmin.rpc('generate_facture_echeance', { p_echeance_id: ech!.id })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/déjà|à facturer/i)

    const { data: factures } = await dbAdmin.from('factures').select('id').eq('echeance_id', ech!.id)
    expect(factures!.length).toBe(1)
  })

  // ── 40. Plusieurs factures d'acompte/intermédiaires possibles ───────────
  test('40. génère avec succès une facture d\'acompte PUIS une facture intermédiaire distinctes', async ({ page }) => {
    const orgId = await getOrgId('test-org-a-local')
    const adminId = await getProfileId('admin-a@kaytek.test')
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: `PWE2E-MultiFactures-${Date.now()}`,
      totalHt: 250, tvaMontant: 50, totalTtc: 300, numeroSuffix: 'MULTIFACT',
    })
    devisIds2.push(fixture.devisId); clientIds2.push(fixture.clientId)

    const dates = [0, 30, 60].map(d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) })
    await dbAdmin.rpc('create_echeancier', {
      p_devis_id: fixture.devisId, p_nombre_echeances: 3, p_mode_repartition: 'egale',
      p_echeances: [
        { numero_ordre: 1, libelle: 'Acompte', pourcentage: 33.33, montant_ht: 83.33, tva_montant: 16.67, montant_ttc: 100, date_prevue: dates[0] },
        { numero_ordre: 2, libelle: 'Intermédiaire', pourcentage: 33.33, montant_ht: 83.33, tva_montant: 16.67, montant_ttc: 100, date_prevue: dates[1] },
        { numero_ordre: 3, libelle: 'Solde', pourcentage: 33.34, montant_ht: 83.34, tva_montant: 16.66, montant_ttc: 100, date_prevue: dates[2] },
      ],
    })

    await page.goto(`/devis/${fixture.devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-statut-1')).not.toContainText('À facturer', { timeout: 10_000 })
    await page.getByTestId('echeance-generer-facture-2').click()
    await expect(page.getByTestId('echeance-statut-2')).not.toContainText('À facturer', { timeout: 10_000 })

    const { data: echeances } = await dbAdmin.from('echeances').select('id, numero_ordre, facture_id').eq('devis_id', fixture.devisId).order('numero_ordre')
    const facture1Id = echeances!.find(e => e.numero_ordre === 1)!.facture_id
    const facture2Id = echeances!.find(e => e.numero_ordre === 2)!.facture_id
    expect(facture1Id).not.toBeNull()
    expect(facture2Id).not.toBeNull()
    expect(facture1Id).not.toBe(facture2Id)

    const { data: f1 } = await dbAdmin.from('factures').select('numero, type_facture').eq('id', facture1Id).single()
    const { data: f2 } = await dbAdmin.from('factures').select('numero, type_facture').eq('id', facture2Id).single()
    expect(f1!.type_facture).toBe('acompte')
    expect(f2!.type_facture).toBe('intermediaire')
    expect(f1!.numero).not.toBe(f2!.numero)
    expect(f1!.numero).toMatch(/^FAC-\d{4}-\d{3}$/)
    expect(f2!.numero).toMatch(/^FAC-\d{4}-\d{3}$/)
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIds2, clientIds2)
  })
})
