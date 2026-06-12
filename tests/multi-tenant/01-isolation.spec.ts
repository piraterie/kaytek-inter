// tests/multi-tenant/01-isolation.spec.ts
// Vérifie que les données d'une organisation ne sont pas visibles par une autre.
// Prérequis : TEST_ADMIN_B_EMAIL défini dans .env.test (organisation B distincte).
import { test, expect } from '@playwright/test'

const ADMIN_A_AUTH = 'tests/.auth/admin.json'
const ADMIN_B_AUTH = 'tests/.auth/admin-b.json'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getListItems(page: any, url: string, selector: string): Promise<string[]> {
  await page.goto(url)
  await page.waitForTimeout(2000)
  return page.locator(selector).allInnerTexts().catch(() => [])
}

// ── Tests isolation ──────────────────────────────────────────────────────────

test.describe('Multi-tenant — isolation des données', () => {
  test.skip(!process.env.TEST_ADMIN_B_EMAIL, 'TEST_ADMIN_B_EMAIL non défini — tests multi-tenant ignorés')

  test('clients org A non visibles par org B', async ({ browser }) => {
    // Contexte A
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    const pageA = await ctxA.newPage()
    const clientsA = await getListItems(pageA, '/clients', '[class*="nom"], td:first-child, [class*="client-name"]')

    // Contexte B
    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    const pageB = await ctxB.newPage()
    const clientsB = await getListItems(pageB, '/clients', '[class*="nom"], td:first-child, [class*="client-name"]')

    // Aucun client de A ne doit apparaître dans B
    const intersection = clientsA.filter(c => clientsB.includes(c) && c.trim().length > 2)
    expect(intersection, `Fuite de données clients entre orgs : ${intersection.join(', ')}`).toHaveLength(0)

    await ctxA.close()
    await ctxB.close()
  })

  test('devis org A non visibles par org B', async ({ browser }) => {
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    const pageA = await ctxA.newPage()
    const devisA = await getListItems(pageA, '/devis', '[class*="numero"], td:nth-child(2), text=/DEV-/')

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    const pageB = await ctxB.newPage()
    const devisB = await getListItems(pageB, '/devis', '[class*="numero"], td:nth-child(2), text=/DEV-/')

    const intersection = devisA.filter(d => devisB.includes(d) && d.trim().startsWith('DEV-'))
    expect(intersection, `Fuite de données devis entre orgs : ${intersection.join(', ')}`).toHaveLength(0)

    await ctxA.close()
    await ctxB.close()
  })

  test('factures org A non visibles par org B', async ({ browser }) => {
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    const pageA = await ctxA.newPage()
    const facturesA = await getListItems(pageA, '/factures', '[class*="numero"], text=/FAC-/')

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    const pageB = await ctxB.newPage()
    const facturesB = await getListItems(pageB, '/factures', '[class*="numero"], text=/FAC-/')

    const intersection = facturesA.filter(f => facturesB.includes(f) && f.trim().startsWith('FAC-'))
    expect(intersection, `Fuite de données factures entre orgs : ${intersection.join(', ')}`).toHaveLength(0)

    await ctxA.close()
    await ctxB.close()
  })

  test('interventions org A non visibles par org B', async ({ browser }) => {
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    const pageA = await ctxA.newPage()
    const interA = await getListItems(pageA, '/interventions', '[class*="numero"], text=/INT-/')

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    const pageB = await ctxB.newPage()
    const interB = await getListItems(pageB, '/interventions', '[class*="numero"], text=/INT-/')

    const intersection = interA.filter(i => interB.includes(i) && i.trim().startsWith('INT-'))
    expect(intersection, `Fuite de données interventions entre orgs : ${intersection.join(', ')}`).toHaveLength(0)

    await ctxA.close()
    await ctxB.close()
  })

  test('utilisateurs org A non visibles par org B', async ({ browser }) => {
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    const pageA = await ctxA.newPage()
    const usersA = await getListItems(pageA, '/utilisateurs', '[class*="email"], input[type="email"]')

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    const pageB = await ctxB.newPage()
    const usersB = await getListItems(pageB, '/utilisateurs', '[class*="email"], input[type="email"]')

    const intersection = usersA.filter(u => usersB.includes(u) && u.includes('@'))
    expect(intersection, `Fuite d'emails utilisateurs entre orgs : ${intersection.join(', ')}`).toHaveLength(0)

    await ctxA.close()
    await ctxB.close()
  })
})

// ── Tests intervenant (accès restreint dans la même org) ─────────────────────

test.describe('Intervenant — accès restreint', () => {
  test.skip(!process.env.TEST_INTERVENANT_EMAIL, 'TEST_INTERVENANT_EMAIL non défini')
  test.use({ storageState: 'tests/.auth/intervenant.json' })

  test('intervenant ne voit pas /clients (admin only)', async ({ page }) => {
    await page.goto('/clients')
    // Doit rediriger vers /dashboard (accès refusé)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })
  })

  test('intervenant ne voit pas /utilisateurs', async ({ page }) => {
    await page.goto('/utilisateurs')
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })
  })

  test('intervenant ne voit pas /parametres', async ({ page }) => {
    await page.goto('/parametres')
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })
  })

  test('intervenant ne voit pas /journal', async ({ page }) => {
    await page.goto('/journal')
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })
  })

  test('intervenant accède à /messagerie', async ({ page }) => {
    await page.goto('/messagerie')
    await expect(page).toHaveURL(/messagerie/, { timeout: 10_000 })
  })
})
