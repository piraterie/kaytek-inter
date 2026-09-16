// tests/e2e/13-echeancier-echeance-retard.spec.ts
// Génération d'une facture à partir d'une échéance dont la date prévue est
// déjà dépassée → l'échéance doit basculer au statut "en_retard".
//
// Historiquement ce fichier couvrait aussi l'envoi de relances de paiement
// (bouton "Relancer" de la page Impayés, tests 23-27) — supprimé avec la
// page Impayés elle-même (voir memory project_impayes_page_removal). Seul le
// test 22, qui vérifie le calcul du statut "en_retard" et ne dépend pas de
// cette page, a été conservé.
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

test.describe('Échéancier — échéance en retard', () => {
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

  test.afterAll(async () => {
    await cleanupTestDevis(devisIdsToClean, clientIdsToClean)
  })
})
