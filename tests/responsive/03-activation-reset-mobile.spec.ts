// tests/responsive/03-activation-reset-mobile.spec.ts
// Activation de compte et nouveau mot de passe sur mobile/tablette —
// projets mobile-390 / mobile-430 / tablet = WebKit (moteur de Safari iOS),
// mobile-360 = Chromium Android. Pile Supabase locale requise.
import { test, expect, type Page } from '@playwright/test'
import { orgOf, uniqueEmail, createInvite, createRecovery, createActiveUser, deleteUsers } from '../helpers/authLinks'

test.use({ storageState: { cookies: [], origins: [] } })

const PASSWORD = 'Mobile2026ok'
const created: string[] = []
let ORG = ''

test.beforeAll(async () => { ORG = await orgOf(process.env.TEST_ADMIN_EMAIL!) })
test.afterAll(async () => { await deleteUsers(created) })

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test('activation assistant sur mobile → application', async ({ page }) => {
  const email = uniqueEmail('m-assist')
  const { userId, appPath } = await createInvite({ email, role: 'assistant', organisationId: ORG })
  created.push(userId)

  await page.goto(appPath)
  await expect(page.getByRole('heading', { name: 'Activez votre compte' })).toBeVisible()
  await noHorizontalScroll(page)
  // Champs ≥ 16px sur téléphone : Safari iPhone ne zoome pas au focus
  // (règle globale de globals.css, limitée aux largeurs mobiles).
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const fontSize = await page.locator('#new-password').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
  }

  await page.locator('#new-password').fill(PASSWORD)
  await page.locator('#confirm-password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Activer mon compte' }).tap()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
})

test('nouveau mot de passe sur mobile → connexion', async ({ page }) => {
  const email = uniqueEmail('m-reset')
  created.push(await createActiveUser({ email, password: 'AncienMobile1', role: 'intervenant', organisationId: ORG }))

  await page.goto(await createRecovery(email))
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  await noHorizontalScroll(page)
  await page.locator('#new-password').fill(PASSWORD)
  await page.locator('#confirm-password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).tap()
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  await expect(page.getByRole('status')).toContainText('Mot de passe modifié')
  await noHorizontalScroll(page)
})

test('lien expiré sur mobile → message lisible et actions', async ({ page }) => {
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await expect(page).toHaveURL(/\/activation/)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retour à la connexion' })).toBeVisible()
  await noHorizontalScroll(page)
})
