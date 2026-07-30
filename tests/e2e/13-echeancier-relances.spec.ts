// tests/e2e/13-echeancier-relances.spec.ts
// Échéance en retard → relance email → idempotence (double-clic réel) →
// notifications internes → client sans adresse e-mail.
import { test, expect } from '@playwright/test'
import { dbAdmin, getOrgId, getProfileId, createTestDevis, cleanupTestDevis } from '../helpers/echeancierDb'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })
test.describe.configure({ mode: 'serial' })

let orgId: string
let adminId: string
let clientLabel: string
let clientId: string
let devisId: string
let devisNumero: string
let echeanceId: string
let echeancierId: string

const clientIdsToClean: string[] = []
const devisIdsToClean: string[] = []

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.describe('Échéancier — relances et notifications (échéance en retard)', () => {
  test.beforeAll(async () => {
    orgId = await getOrgId('test-org-a-local')
    adminId = await getProfileId('admin-a@kaytek.test')
  })

  // ── 22. Échéance en retard ───────────────────────────────────────────────
  test('22. crée une échéance en retard (date prévue dans le passé)', async ({ page }) => {
    clientLabel = `PWE2E-Relance-${Date.now()}`
    const fixture = await createTestDevis({
      orgId, createdBy: adminId, clientNom: clientLabel,
      totalHt: 250, tvaMontant: 50, totalTtc: 300, numeroSuffix: 'RELANCE',
    })
    devisId = fixture.devisId; devisNumero = fixture.devisNumero; clientId = fixture.clientId
    devisIdsToClean.push(devisId); clientIdsToClean.push(clientId)

    // Crée l'échéancier via la vraie RPC (comme le fait la modale), avec une
    // échéance déjà due depuis 45 jours pour déclencher 'en_retard' dès la
    // génération de facture, sans dépendre d'une saisie de date UI complexe.
    const dateRetard = new Date(); dateRetard.setDate(dateRetard.getDate() - 45)
    const iso = dateRetard.toISOString().slice(0, 10)

    const { data: newEcheancierId, error } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: devisId, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 250, tva_montant: 50, montant_ttc: 300, date_prevue: iso }],
    })
    expect(error).toBeNull()
    echeancierId = newEcheancierId as string
    const { data: echeance } = await dbAdmin.from('echeances').select('id').eq('echeancier_id', echeancierId).single()
    echeanceId = echeance!.id

    await page.goto(`/devis/${devisId}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-statut-1')).toContainText('En retard', { timeout: 10_000 })

    const { data: row } = await dbAdmin.from('echeances').select('statut').eq('id', echeanceId).single()
    expect(row!.statut).toBe('en_retard')
  })

  // ── 23/24/25. Envoi d'une relance + double-clic réel + une seule relance créée ──
  test('23-25. relance envoyée, double-clic réel bloqué par l\'idempotence (une seule ligne créée)', async ({ page }) => {
    await page.goto('/impayes')
    const row = page.locator('[data-testid="impaye-row"]', { hasText: devisNumero })
    await expect(row).toBeVisible({ timeout: 10_000 })

    const relancerBtn = row.getByTestId('impaye-relancer')
    // Double-clic réel, rapide, sur le vrai bouton (pas un mock d'événement).
    await relancerBtn.click()
    await page.waitForTimeout(300)
    await relancerBtn.click()
    await page.waitForTimeout(1500)

    const { data: relances } = await dbAdmin.from('relances_paiement').select('*').eq('echeance_id', echeanceId)
    expect(relances).not.toBeNull()
    // Item 25 : une seule ligne de relance créée pour cette échéance aujourd'hui,
    // quel que soit le nombre de clics.
    expect(relances!.length).toBe(1)
    expect(relances![0].statut).toMatch(/planifie|envoye|echec/)
  })

  // ── 26. Notifications internes ──────────────────────────────────────────
  test('26. une notification interne existe pour la relance envoyée', async ({ page }) => {
    const { data: notifs } = await dbAdmin
      .from('notifications')
      .select('titre, contenu')
      .eq('organisation_id', orgId)
      .ilike('contenu', `%${devisNumero}%`)
    // La notification "Relance envoyée" n'est créée que si l'envoi a réussi
    // (statut 'envoye') ; en sandbox locale sans BREVO_API_KEY, l'envoi peut
    // échouer proprement (statut 'echec') sans notification — les deux sont
    // des comportements corrects. On vérifie la cohérence des deux chemins.
    const { data: relance } = await dbAdmin.from('relances_paiement').select('statut').eq('echeance_id', echeanceId).single()
    if (relance!.statut === 'envoye') {
      expect(notifs!.length).toBeGreaterThan(0)
      expect(notifs!.some(n => n.titre.includes('Relance envoyée'))).toBe(true)
    } else {
      // Échec d'envoi (ex. BREVO_API_KEY absent en local) : documenté et
      // acceptable — vérifié explicitement plutôt que silencieusement ignoré.
      expect(relance!.statut).toBe('echec')
    }
  })

  // ── 27. Client sans adresse e-mail ───────────────────────────────────────
  test('27. relance sur une échéance dont le client n\'a pas d\'e-mail — dégradation propre', async ({ page }) => {
    const orgIdLocal = orgId
    const { data: clientSansEmail, error: cErr } = await dbAdmin.from('clients').insert({
      organisation_id: orgIdLocal, nom: `${clientLabel}-NoEmail`, prenom: 'Test', type: 'particulier',
      email: null, telephone: '0600000001', created_by: adminId,
    }).select('id').single()
    expect(cErr).toBeNull()
    clientIdsToClean.push(clientSansEmail!.id)

    const { data: devis2, error: dErr } = await dbAdmin.from('devis').insert({
      organisation_id: orgIdLocal, client_id: clientSansEmail!.id, numero: `PWTEST-NOEMAIL-${Date.now()}`,
      statut: 'accepte', lignes: [], total_ht: 100, tva_montant: 20, total_ttc: 120, created_by: adminId,
    }).select('id, numero').single()
    expect(dErr).toBeNull()
    devisIdsToClean.push(devis2!.id)

    const dateRetard = new Date(); dateRetard.setDate(dateRetard.getDate() - 10)
    const { data: sched2Id } = await dbAdmin.rpc('create_echeancier', {
      p_devis_id: devis2!.id, p_nombre_echeances: 1, p_mode_repartition: 'egale',
      p_echeances: [{ numero_ordre: 1, libelle: 'Paiement intégral', pourcentage: 100, montant_ht: 100, tva_montant: 20, montant_ttc: 120, date_prevue: dateRetard.toISOString().slice(0, 10) }],
    })
    const { data: ec2 } = await dbAdmin.from('echeances').select('id').eq('echeancier_id', sched2Id as string).single()

    await page.goto(`/devis/${devis2!.id}/apercu`)
    await page.getByTestId('echeance-generer-facture-1').click()
    await expect(page.getByTestId('echeance-statut-1')).toContainText('En retard', { timeout: 10_000 })

    const consoleErrors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

    await page.goto('/impayes')
    const row2 = page.locator('[data-testid="impaye-row"]', { hasText: devis2!.numero })
    await expect(row2).toBeVisible({ timeout: 10_000 })
    await row2.getByTestId('impaye-relancer').click()
    await page.waitForTimeout(1500)

    // Aucune ligne de relance ne doit être créée pour un client sans e-mail.
    const { data: relances2 } = await dbAdmin.from('relances_paiement').select('id').eq('echeance_id', ec2!.id)
    expect(relances2!.length).toBe(0)
    // Aucune exception JS non gérée dans la console.
    expect(consoleErrors.filter(e => !e.includes('Failed to load resource'))).toEqual([])
  })

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})
