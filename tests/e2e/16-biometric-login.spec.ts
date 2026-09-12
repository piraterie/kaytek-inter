// tests/e2e/16-biometric-login.spec.ts — Connexion par empreinte (WebAuthn)
//
// Bug corrigé : sur mobile, navigator.credentials.get() peut ne jamais se
// résoudre NI rejeter (Credential Manager Android dans un état incohérent,
// authenticateur qui ne répond jamais). Le code n'avait aucun garde-fou côté
// navigateur (le `timeout` de l'objet publicKey n'est qu'un hint que les
// authenticateurs plateforme ignorent souvent) : l'écran de connexion restait
// figé indéfiniment sur "Vérification…" dès que l'utilisateur appuyait sur le
// bouton empreinte. Voir src/lib/biometric.ts (AbortController + timeout réel).
import { test, expect, type CDPSession, type Page } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD

test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD non définis')

// Authenticateur virtuel WebAuthn (CDP) — approuve automatiquement toute
// création/assertion de credential, comme le ferait un vrai capteur d'empreinte.
async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return client
}

async function loginWithPassword(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL!)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD!)
  await page.locator('button[type="submit"]').click()
}

test.describe('Connexion biométrique', () => {
  test('activation puis connexion par empreinte mène au dashboard avec une session valide', async ({ page }) => {
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)

    // Première connexion sur cet appareil (aucune empreinte enregistrée) →
    // l'app propose l'activation.
    await expect(page.getByText("Activer l'empreinte")).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: "Activer l'empreinte" }).click()
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })

    // Revenir sur /login sans se déconnecter (la session Supabase reste valide) :
    // c'est le seul cas où le bouton empreinte de /login peut réellement aboutir,
    // puisqu'il exige une session Supabase déjà valide en plus de l'assertion
    // WebAuthn — voir handleBiometricLogin dans LoginPage.tsx.
    await page.goto('/login')
    const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('authenticateur qui ne répond jamais → le bouton se débloque après le délai au lieu de figer l\'app', async ({ page }) => {
    test.setTimeout(60_000)
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)
    await expect(page.getByText("Activer l'empreinte")).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: "Activer l'empreinte" }).click()
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })

    await page.goto('/login')

    // Simule le cas réel du bug : navigator.credentials.get() ne se résout ni ne
    // rejette jamais tout seul (authenticateur natif muet). Le mock respecte
    // néanmoins le `signal` passé par authenticateWithBiometric() — exactement
    // ce que fait un vrai navigateur — pour vérifier que c'est bien NOTRE
    // AbortController qui débloque la situation, et non un hasard du navigateur.
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, 'get', {
        configurable: true,
        value: (options?: CredentialRequestOptions) => new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Simulated hang aborted', 'AbortError'))
          })
        }),
      })
    })

    const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    // Avant le correctif, ce bouton restait bloqué sur "Vérification…" indéfiniment.
    await expect(page.getByText('Vérification…')).toBeVisible({ timeout: 5_000 })

    // Le correctif doit débloquer l'UI une fois le délai interne écoulé (25s par
    // défaut) : message d'erreur explicite + retour au formulaire mot de passe,
    // sans jamais planter ni rester figé.
    await expect(page.getByText(/n'a pas répondu à temps/i)).toBeVisible({ timeout: 35_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(bioButton).not.toBeVisible()
  })
})
