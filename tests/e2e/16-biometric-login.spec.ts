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
async function addVirtualAuthenticator(page: Page): Promise<{ client: CDPSession; authenticatorId: string }> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { client, authenticatorId }
}

async function loginWithPassword(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL!)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD!)
  await page.locator('button[type="submit"]').click()
}

async function registerBiometricFromDashboard(page: Page) {
  await expect(page.getByText("Activer l'empreinte")).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: "Activer l'empreinte" }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
}

async function logout(page: Page) {
  const logoutBtn = page.locator(
    'button:has-text("Quitter"), button:has-text("Déconnexion"), button[title*="onnexion"], a:has-text("Déconnexion")'
  ).first()
  await logoutBtn.click({ timeout: 10_000 })
  await expect(page).toHaveURL(/login/, { timeout: 10_000 })
}

test.describe('Connexion biométrique', () => {
  test('activation puis connexion par empreinte mène au dashboard avec une session valide', async ({ page }) => {
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)

    // Première connexion sur cet appareil (aucune empreinte enregistrée) →
    // l'app propose l'activation.
    await registerBiometricFromDashboard(page)

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
    await registerBiometricFromDashboard(page)

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

  // Cause racine réellement trouvée en prod (2026-09-12) : l'assertion WebAuthn
  // elle-même est locale et rapide — le blocage se produit APRÈS, quand
  // supabase.auth.getSession()/la requête profils qui suit parlent au réseau.
  // Sur une connexion mobile dégradée, cet appel HTTP peut rester en attente
  // indéfiniment (aucun timeout natif dans supabase-js pour ce cas). Le
  // précédent correctif (AbortController sur navigator.credentials.get())
  // laissait ce chemin totalement sans protection.
  test('requête profils qui ne répond jamais après empreinte valide → l\'UI se débloque au lieu de rester figée', async ({ page }) => {
    test.setTimeout(30_000)
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)
    await registerBiometricFromDashboard(page)

    await page.goto('/login')

    // Simule une requête REST qui ne répond jamais (réseau mobile dégradé) —
    // sans jamais appeler fulfill/abort/continue, la requête reste indéfiniment
    // en attente côté page, exactement comme un socket mobile qui ne reçoit
    // jamais de réponse.
    await page.route('**/rest/v1/profiles*', () => {
      // ne rien faire : la requête reste en attente pour toujours
    })

    const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page.getByText('Vérification…')).toBeVisible({ timeout: 5_000 })

    // Le correctif doit débloquer l'UI après le timeout applicatif (12s) avec
    // un message distinct de celui du timeout WebAuthn, sans jamais rester figé.
    await expect(page.getByText(/serveur trop lente/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(bioButton).not.toBeVisible()
  })

  // Vérifie explicitement que l'empreinte ne fait QUE déverrouiller une session
  // Supabase déjà valide — elle ne réauthentifie jamais auprès de Supabase par
  // elle-même. Après une vraie déconnexion (session Supabase révoquée), une
  // empreinte pourtant reconnue par l'appareil doit échouer proprement, SANS
  // effacer l'enregistrement biométrique (le capteur reste valide, seul le
  // token Supabase a expiré).
  test('session Supabase réellement invalide → échec propre, empreinte non désactivée', async ({ page }) => {
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)
    await registerBiometricFromDashboard(page)
    await logout(page)

    // La déconnexion invalide la session Supabase (localStorage 'kaytek-auth')
    // mais ne touche jamais à l'enregistrement biométrique ('kaytek-biometric-cred').
    const bioCredAfterLogout = await page.evaluate(() => localStorage.getItem('kaytek-biometric-cred'))
    expect(bioCredAfterLogout).not.toBeNull()

    const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    // L'empreinte elle-même réussit (même appareil, même authenticateur) mais
    // il n'y a plus de session Supabase valide derrière — échec explicite,
    // jamais une redirection silencieuse vers /dashboard.
    await expect(page.getByText(/session expirée/i)).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/login/)
    await expect(page.locator('input[type="password"]')).toBeVisible()

    // L'empreinte reste enregistrée après cet échec — pas de désactivation
    // silencieuse (voir le retrait de clearBiometric() sur ce chemin).
    const bioCredAfterFailure = await page.evaluate(() => localStorage.getItem('kaytek-biometric-cred'))
    expect(bioCredAfterFailure).toBe(bioCredAfterLogout)
  })

  test('annulation/empreinte non reconnue par l\'authenticateur → message clair, pas de blocage', async ({ page }) => {
    const { client, authenticatorId } = await addVirtualAuthenticator(page)

    await loginWithPassword(page)
    await registerBiometricFromDashboard(page)
    await page.goto('/login')

    // Simule un authenticateur qui ne reconnaît plus l'identifiant enregistré
    // (téléphone réinitialisé, credential supprimé côté OS, etc.) — get()
    // rejette rapidement avec NotAllowedError, sans jamais planter l'app.
    const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId })
    for (const cred of credentials) {
      await client.send('WebAuthn.removeCredential', { authenticatorId, credentialId: cred.credentialId })
    }

    const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page.getByText(/empreinte non reconnue/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()

    // L'empreinte reste enregistrée : un rejet natif ne prouve pas qu'elle est
    // invalide (voir le commentaire 'denied' dans biometric.ts).
    const bioCred = await page.evaluate(() => localStorage.getItem('kaytek-biometric-cred'))
    expect(bioCred).not.toBeNull()
  })

  test('plusieurs connexions biométriques successives ne dégradent pas le flux', async ({ page }) => {
    await addVirtualAuthenticator(page)

    await loginWithPassword(page)
    await registerBiometricFromDashboard(page)

    // Simule un utilisateur qui revient plusieurs fois de suite sur /login
    // (relances d'app successives) tant que la session Supabase reste valide —
    // aucun état résiduel (timers, closures, flag de chargement) ne doit
    // s'accumuler ou bloquer une tentative suivante.
    for (let i = 0; i < 3; i++) {
      await page.goto('/login')
      const bioButton = page.getByRole('button', { name: /connecter.*empreinte/i })
      await expect(bioButton).toBeVisible({ timeout: 10_000 })
      await bioButton.click()
      await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
      await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
    }
  })
})
