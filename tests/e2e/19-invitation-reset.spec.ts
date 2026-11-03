// tests/e2e/19-invitation-reset.spec.ts
// Parcours « Activer mon compte » (invitation intervenant / assistant) et
// « Mot de passe oublié » contre la pile Supabase locale (vrai GoTrue :
// verifyOtp, updateUser, signInWithPassword).
//
// Régressions couvertes :
//  - un lien d'invitation arrivant sur la racine ouvrait l'application (ou
//    renvoyait vers /login) sans que la personne ait choisi de mot de passe ;
//  - « Mot de passe oublié » affichait une erreur SMTP technique ;
//  - liens invalides / expirés / déjà utilisés.
import { test, expect, type Page } from '@playwright/test'
import {
  orgOf, uniqueEmail, createInvite, createRecovery, createActiveUser,
  roleAndOrg, deleteUsers, followLegacyLink,
} from '../helpers/authLinks'

test.use({ storageState: { cookies: [], origins: [] } })

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL!
const PASSWORD = 'Activation2026'
const INVALID = 'Ce lien est invalide, a expiré ou a déjà été utilisé.'
const created: string[] = []
let ORG = ''

test.beforeAll(async () => { ORG = await orgOf(ADMIN_EMAIL) })
test.afterAll(async () => { await deleteUsers(created) })

async function choosePassword(page: Page, pw: string, confirm = pw) {
  await page.locator('#new-password').fill(pw)
  await page.locator('#confirm-password').fill(confirm)
  await page.getByRole('button', { name: /Activer mon compte|Enregistrer le mot de passe/ }).click()
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.locator('form button[type="submit"]').click()
  // Offre « Connexion rapide » (passkeys activés sur la pile locale) : on la décline.
  const skip = page.getByRole('button', { name: 'Non merci, continuer' })
  await Promise.race([
    skip.waitFor({ timeout: 8_000 }).then(() => skip.click()).catch(() => {}),
    page.waitForURL(/\/dashboard/, { timeout: 8_000 }).catch(() => {}),
  ])
}

test.describe('Invitation — Activer mon compte', () => {
  for (const role of ['assistant', 'intervenant'] as const) {
    test(`${role} : lien → mot de passe → application avec le bon rôle et la bonne entreprise`, async ({ page }) => {
      const email = uniqueEmail(role)
      const { userId, appPath } = await createInvite({ email, role, organisationId: ORG })
      created.push(userId)

      await page.goto(appPath)
      await expect(page.getByRole('heading', { name: 'Activez votre compte' })).toBeVisible()

      // Validation côté client (aucun jeton consommé).
      await choosePassword(page, 'court1')
      await expect(page.getByRole('alert')).toContainText('au moins 8')
      await choosePassword(page, PASSWORD, PASSWORD + 'x')
      await expect(page.getByRole('alert')).toContainText('ne correspondent pas')

      await choosePassword(page, PASSWORD)
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

      expect(await roleAndOrg(userId)).toEqual({ role, organisation_id: ORG })
      const navItem = (label: string) => page.locator('.nav-item', { hasText: new RegExp(`^${label}$`) })
      await expect(navItem('Dashboard')).toHaveCount(1)
      if (role === 'assistant') {
        await expect(navItem('Clients')).toHaveCount(1)
        await expect(navItem('Factures')).toHaveCount(0)
      } else {
        await expect(navItem('Factures')).toHaveCount(1)
        await expect(navItem('Clients')).toHaveCount(0)
      }

      // Le lien est à usage unique.
      await page.evaluate(() => localStorage.clear())
      await page.goto(appPath)
      await choosePassword(page, 'Autre2026x')
      await expect(page.getByRole('alert')).toHaveText(INVALID)

      // Le mot de passe choisi permet ensuite la connexion habituelle.
      await page.evaluate(() => localStorage.clear())
      await loginWith(page, email, PASSWORD)
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    })
  }

  test('ancien lien Supabase arrivant sur la racine → page d\'activation, pas le tableau de bord', async ({ page, baseURL }) => {
    const email = uniqueEmail('legacy')
    const { userId, actionLink } = await createInvite({ email, role: 'intervenant', organisationId: ORG })
    created.push(userId)

    await page.goto(await followLegacyLink(actionLink, baseURL!))
    await expect(page).toHaveURL(/\/activation/)
    await expect(page.getByRole('heading', { name: 'Activez votre compte' })).toBeVisible()
    await choosePassword(page, PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })

  test('lien expiré (erreur renvoyée par Supabase) → message clair, pas de /login muet', async ({ page }) => {
    await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    await expect(page).toHaveURL(/\/activation/)
    await expect(page.getByRole('alert')).toHaveText(INVALID)
    await expect(page.getByRole('button', { name: 'Retour à la connexion' })).toBeVisible()
  })

  test('jeton falsifié → refusé', async ({ page }) => {
    await page.goto('/activation?token_hash=pas-un-vrai-jeton&type=invite')
    await choosePassword(page, PASSWORD)
    await expect(page.getByRole('alert')).toHaveText(INVALID)
  })

  test('lien sans jeton → refusé sans formulaire', async ({ page }) => {
    await page.goto('/activation')
    await expect(page.getByRole('alert')).toHaveText(INVALID)
    await expect(page.locator('#new-password')).toHaveCount(0)
  })
})

test.describe('Mot de passe oublié', () => {
  test('demande : message neutre, sans révéler l\'existence du compte', async ({ page }) => {
    let body: any = null
    await page.route('**/functions/v1/demander-reinitialisation', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: null }) })
    })
    await page.goto('/login?mode=reset')
    await page.locator('#reset-email').fill('quelqu.un@exemple.fr')
    await page.getByRole('button', { name: 'Envoyer le lien' }).click()
    await expect(page.getByText(/Si un compte est associé à/)).toBeVisible()
    expect(body).toEqual({ email: 'quelqu.un@exemple.fr' })
  })

  test('panne d\'envoi : message simple, aucun détail technique (SMTP…)', async ({ page }) => {
    await page.route('**/functions/v1/demander-reinitialisation', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }))
    await page.goto('/login?mode=reset')
    await page.locator('#reset-email').fill('quelqu.un@exemple.fr')
    await page.getByRole('button', { name: 'Envoyer le lien' }).click()
    await expect(page.getByText(/Impossible d'envoyer la demande/)).toBeVisible()
    await expect(page.getByText(/SMTP|Supabase/)).toHaveCount(0)
  })

  test('lien → nouveau mot de passe → connexion avec le nouveau, l\'ancien refusé', async ({ page }) => {
    const email = uniqueEmail('reset')
    const oldPw = 'AncienMdp2025'
    created.push(await createActiveUser({ email, password: oldPw, role: 'intervenant', organisationId: ORG }))
    const path = await createRecovery(email)

    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
    await choosePassword(page, oldPw)
    // GoTrue refuse un mot de passe identique : message simple, on peut corriger sans nouveau lien.
    await expect(page.getByRole('alert')).toContainText('différent')
    await choosePassword(page, PASSWORD)

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
    await expect(page.getByRole('status')).toContainText('Mot de passe modifié')
    await expect(page.locator('#login-email')).toHaveValue(email)

    await page.locator('#login-password').fill(oldPw)
    await page.locator('form button[type="submit"]').click()
    await expect(page).toHaveURL(/\/login/)

    await loginWith(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    // Lien de réinitialisation déjà utilisé.
    await page.evaluate(() => localStorage.clear())
    await page.goto(path)
    await choosePassword(page, 'Encore2026x')
    await expect(page.getByRole('alert')).toHaveText(INVALID)
    await expect(page.getByRole('button', { name: 'Demander un nouveau lien' })).toBeVisible()
  })
})

test.describe('Utilisateurs — renvoi d\'invitation', () => {
  test.use({ storageState: 'tests/.auth/admin.json' })

  test('le bouton renvoie l\'invitation avec le rôle et l\'adresse existants', async ({ page }) => {
    const email = uniqueEmail('resend')
    const { userId } = await createInvite({ email, role: 'assistant', organisationId: ORG })
    created.push(userId)

    let body: any = null
    await page.route('**/functions/v1/inviter-intervenant', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: null, kind: 'invite' }) })
    })
    await page.goto('/utilisateurs')
    const row = page.locator('div', { hasText: email }).filter({ has: page.getByRole('button', { name: "Renvoyer l'invitation" }) }).last()
    await row.getByRole('button', { name: "Renvoyer l'invitation" }).click()
    await expect(page.getByText(`Invitation renvoyée à ${email}`)).toBeVisible()
    expect(body).toMatchObject({ email, role: 'assistant' })
  })
})
