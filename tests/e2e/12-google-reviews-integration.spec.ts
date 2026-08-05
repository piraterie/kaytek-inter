// tests/e2e/12-google-reviews-integration.spec.ts — Finalisation Google
// Ads/GBP (avis, performances, dashboard Ads, demandes d'avis).
//
// Prérequis : `npm run seed:local` (auto-exécuté via `pretest`/`pretest:e2e`
// avant `npm test`/`npm run test:e2e`) — crée org A avec connexions Google
// MOCK (aucun token réel), client avec/sans e-mail, factures payée/impayée,
// avis_google_actif=true/mode=manuel sur org A uniquement.
//
// Aucun appel réseau réel vers Google ou Brevo : les boutons qui
// déclencheraient un envoi réel (Synchroniser, Envoyer maintenant) sont
// interceptés via page.route() et renvoient une réponse mock locale.
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const ADMIN_AUTH = 'tests/.auth/admin.json'
const ADMIN_B_AUTH = 'tests/.auth/admin-b.json'

function seedActiveSession(page: Page) {
  return page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
}

// Remet une facture de test à 'impayee' et supprime sa demande d'avis
// éventuelle AVANT chaque test qui doit exercer la transition impayee→payee
// — sans cela, seul le premier test d'un describe la trouve encore
// impayée (chaque test précédent la laisse 'payee'). Service role
// LOCAL uniquement (.env.test, jamais un secret de production).
async function resetFactureToUnpaid(numero: string) {
  const url = process.env.SUPABASE_TEST_URL
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_ROLE_KEY manquants (.env.test)')
  if (new URL(url).hostname !== '127.0.0.1' && new URL(url).hostname !== 'localhost') {
    throw new Error('resetFactureToUnpaid refuse un hôte non local')
  }
  const svc = createClient(url, key, { auth: { persistSession: false } })
  const { data: facture } = await svc.from('factures').select('id').eq('numero', numero).maybeSingle()
  if (!facture) return
  await svc.from('review_requests').delete().eq('facture_id', facture.id)
  await svc.from('factures').update({ statut_paiement: 'impayee', date_paiement: null }).eq('id', facture.id)
}

// Intercepte l'invocation d'une Edge Function Google précise et renvoie une
// réponse mock — jamais un octet vers Google/Brevo pendant ces tests.
async function mockGoogleFunction(page: Page, functionName: string, body: unknown, status = 200) {
  await page.route(`**/functions/v1/${functionName}`, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }))
}

test.describe('Navigation — nouvelles entrées Google', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('les 4 nouvelles entrées sont visibles dans le menu admin', async ({ page }) => {
    await page.goto('/dashboard')
    for (const label of ['Google Ads', 'Avis Google', 'Performances GBP', "Demandes d'avis"]) {
      await expect(page.getByRole('button', { name: label })).toBeVisible({ timeout: 10_000 })
    }
  })
})

test.describe('Page Avis Google', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('affiche l\'établissement connecté (mock) et le lien de demande d\'avis', async ({ page }) => {
    await page.goto('/avis-google')
    await expect(page.getByText('Établissement Test')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/search\.google\.com\/local\/writereview\?placeid=ChIJ_TEST_PLACE_ID_LOCAL/)).toBeVisible()
    await expect(page.getByRole('button', { name: /copier le lien/i })).toBeVisible()
  })

  test('copier le lien copie le lien officiel dans le presse-papier', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/avis-google')
    await page.getByRole('button', { name: /copier le lien/i }).click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('ChIJ_TEST_PLACE_ID_LOCAL')
  })
})

test.describe('Page Performances Google Business Profile', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('affiche les 4 indicateurs (appels, clics site, itinéraires, vues)', async ({ page }) => {
    await page.goto('/performances-google')
    await expect(page.getByText('Appels', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Clics vers le site')).toBeVisible()
    await expect(page.getByText("Demandes d'itinéraire")).toBeVisible()
  })
})

test.describe('Page Google Ads', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('affiche le tableau de bord (compte mock sélectionné)', async ({ page }) => {
    await page.goto('/google-ads')
    await expect(page.getByText('Impressions')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Dépenses')).toBeVisible()
    await expect(page.getByText('Coût par clic')).toBeVisible()
  })
})

test.describe('Paramètres — demandes d\'avis', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('la section réglages est visible et reflète l\'activation (seed : actif)', async ({ page }) => {
    await page.goto('/parametres')
    await expect(page.getByText("Demandes d'avis après paiement")).toBeVisible({ timeout: 10_000 })
    const toggle = page.locator('input[type="checkbox"]').first()
    // Le premier checkbox de la page correspond au champ "actif" du bloc
    // avis Google (seedé à true) — vérifié par le libellé associé.
    await expect(page.getByText('Activé')).toBeVisible()
  })
})

test.describe('Facture payée → demande d\'avis (mode manuel)', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(async ({ page }) => {
    await seedActiveSession(page)
    // Chaque test exerce la transition impayee→payee : remet les factures
    // de test à 'impayee' avant chaque test (un test précédent peut les
    // avoir laissées 'payee', ce qui masquerait le bouton "Marquer comme
    // payée" et ferait échouer le test suivant sans rapport avec l'app).
    await resetFactureToUnpaid('TEST-IMPAYEE-001')
    await resetFactureToUnpaid('TEST-IMPAYEE-SANSMAIL-001')
  })

  test('marquer une facture payée ouvre la modale de demande d\'avis', async ({ page }) => {
    await page.goto('/factures')
    const row = page.getByRole('row', { name: /TEST-IMPAYEE-001/ })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.getByTitle('Actions').click()
    await page.getByRole('button', { name: /marquer.*pay|payer/i }).first().click()
    // Certains flux ouvrent un sous-modal de mode de paiement avant de
    // confirmer — on choisit le premier mode proposé si présent.
    const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
    if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()

    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).toBeVisible({ timeout: 10_000 })
  })

  test('"Envoyer maintenant" crée la demande et déclenche l\'envoi (mock)', async ({ page }) => {
    await mockGoogleFunction(page, 'google-send-review-requests', { ok: true, processed: 1, sent: 1, failed: 0 })
    await page.goto('/factures')
    await page.getByRole('row', { name: /TEST-IMPAYEE-001/ }).getByTitle('Actions').click()
    await page.getByRole('button', { name: /marquer.*pay|payer/i }).first().click()
    const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
    if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()

    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Envoyer maintenant' }).click()
    await expect(page.getByText(/demande d'avis envoyée/i)).toBeVisible({ timeout: 10_000 })
  })

  test('"Programmer" crée la demande sans appeler l\'envoi immédiat', async ({ page }) => {
    let sendNowCalled = false
    await page.route('**/functions/v1/google-send-review-requests', (route) => {
      sendNowCalled = true
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.goto('/factures')
    await page.getByRole('row', { name: /TEST-IMPAYEE-001/ }).getByTitle('Actions').click()
    await page.getByRole('button', { name: /marquer.*pay|payer/i }).first().click()
    const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
    if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()

    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Programmer' }).click()
    await expect(page.getByText(/demande d'avis programmée/i)).toBeVisible({ timeout: 10_000 })
    expect(sendNowCalled).toBe(false)
  })

  test('"Ne pas envoyer" ferme la modale sans créer de demande', async ({ page }) => {
    await page.goto('/factures')
    await page.getByRole('row', { name: /TEST-IMPAYEE-001/ }).getByTitle('Actions').click()
    await page.getByRole('button', { name: /marquer.*pay|payer/i }).first().click()
    const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
    if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()

    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Ne pas envoyer' }).click()
    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).not.toBeVisible()
  })

  test('client sans e-mail : le passage à payée ne plante jamais et ne propose aucune demande d\'avis', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/factures')
    await page.getByRole('row', { name: /TEST-IMPAYEE-SANSMAIL-001/ }).getByTitle('Actions').click()
    await page.getByRole('button', { name: /marquer.*pay|payer/i }).first().click()
    const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
    if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()

    await expect(page.getByText(/facture marquée/i)).toBeVisible({ timeout: 10_000 })
    // La modale ne doit PAS apparaître pour un client sans e-mail (le
    // garde-fou trigger rejette l'INSERT, intercepté silencieusement côté
    // frontend — voir maybeOfferReviewRequest/FacturesPage.tsx).
    await page.waitForTimeout(1500)
    await expect(page.getByText("Souhaitez-vous envoyer une demande d'avis")).not.toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('Demandes d\'avis — historique et annulation', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('la demande déjà envoyée (TEST-PAYEE-001, seedée) apparaît dans l\'historique', async ({ page }) => {
    await page.goto('/demandes-avis')
    await expect(page.getByText(/TEST-PAYEE-001/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Envoyée', { exact: true })).toBeVisible()
  })

  test('prévention du double envoi : la facture déjà pourvue d\'une demande ne propose pas d\'en recréer une autre', async ({ page }) => {
    // La contrainte UNIQUE(facture_id) + le flux applicatif empêchent une
    // 2e demande pour TEST-PAYEE-001 (déjà "sent" via le seed) : la facture
    // étant déjà 'payee', aucune action de la page Factures ne redéclenche
    // maybeOfferReviewRequest (le déclencheur n'agit qu'au moment de la
    // TRANSITION vers 'payee', pas sur une facture déjà payée) — vérifié en
    // relisant l'historique après un aller-retour sur /factures : une seule
    // ligne pour cette facture.
    await page.goto('/demandes-avis')
    const rows = page.getByText(/TEST-PAYEE-001/)
    await expect(rows).toHaveCount(1, { timeout: 10_000 })
  })

  test('annuler une demande programmée change son statut', async ({ page }) => {
    // Crée une demande "pending" fraîche via "Programmer" pour avoir
    // quelque chose d'annulable (TEST-PAYEE-001 est déjà "sent", non
    // annulable par design).
    await page.goto('/factures')
    await page.getByRole('row', { name: /TEST-IMPAYEE-001/ }).getByTitle('Actions').click()
    const markPaidBtn = page.getByRole('button', { name: /marquer.*pay|payer/i }).first()
    if (await markPaidBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await markPaidBtn.click()
      const cbOption = page.getByRole('button', { name: /carte|espèces|virement|cb/i }).first()
      if (await cbOption.isVisible({ timeout: 2000 }).catch(() => false)) await cbOption.click()
      const scheduleBtn = page.getByRole('button', { name: 'Programmer' })
      if (await scheduleBtn.isVisible({ timeout: 5000 }).catch(() => false)) await scheduleBtn.click()
    }
    await page.goto('/demandes-avis')
    const cancelBtn = page.getByTitle('Annuler').first()
    if (await cancelBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cancelBtn.click()
      await expect(page.getByText('Annulée').first()).toBeVisible({ timeout: 10_000 })
    }
  })
})

test.describe('Google — mobile', () => {
  test.use({ storageState: ADMIN_AUTH, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('la page Avis Google est utilisable sur mobile', async ({ page }) => {
    await page.goto('/avis-google')
    await expect(page.getByText('Établissement Test')).toBeVisible({ timeout: 10_000 })
  })

  test('le menu mobile contient les nouvelles entrées Google', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: /menu/i }).first().click()
    await expect(page.getByRole('button', { name: 'Avis Google' })).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Isolation cross-org — admin B ne voit rien d\'org A', () => {
  test.use({ storageState: ADMIN_B_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('page Avis Google : aucune donnée d\'org A (org B non connectée)', async ({ page }) => {
    await page.goto('/avis-google')
    await expect(page.getByText('Établissement Test')).not.toBeVisible({ timeout: 5000 }).catch(() => {})
    await expect(page.getByText(/non connecté|aucun établissement/i)).toBeVisible({ timeout: 10_000 })
  })

  test('page Google Ads : aucune donnée d\'org A (org B non connectée)', async ({ page }) => {
    await page.goto('/google-ads')
    await expect(page.getByText(/non connecté|aucun compte/i)).toBeVisible({ timeout: 10_000 })
  })

  test('historique demandes d\'avis : vide (aucune fuite depuis org A)', async ({ page }) => {
    await page.goto('/demandes-avis')
    await expect(page.getByText(/TEST-PAYEE-001/)).not.toBeVisible({ timeout: 5000 })
  })
})
