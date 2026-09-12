// tests/e2e/16-biometric-login.spec.ts — Connexion par empreinte/passkey
//
// Architecture (2026-09-12, remplace l'ancienne implémentation locale-only) :
// supabase.auth.registerPasskey() / signInWithPasskey() délèguent tout le
// travail cryptographique et l'émission de session au serveur GoTrue — une
// passkey réussie renvoie une VRAIE session Supabase directement, sans jamais
// avoir besoin d'une session antérieure encore valide. Voir src/lib/biometric.ts.
//
// Ces tests utilisent un authenticateur WebAuthn virtuel (CDP) contre une
// stack Supabase LOCALE avec les passkeys réellement activés
// (supabase/config.toml : [auth.passkey] enabled = true), pas un mock — la
// vérification de signature serveur est donc réellement exercée.
import { test, expect, type CDPSession, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

test.use({ storageState: { cookies: [], origins: [] } })

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_TEST_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD non définis')

// Les passkeys enregistrées côté serveur PERSISTENT entre les runs de tests
// (contrairement à l'authenticateur virtuel, recréé neuf à chaque test) —
// sans ce nettoyage, registerPasskey() échoue silencieusement dès le 2e run
// avec ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED (HTTP 422), et les tests
// suivants s'exécutent contre un état serveur qui ne correspond à aucun
// credential réellement présent dans l'authenticateur virtuel du test.
async function clearExistingPasskeys(email: string) {
  if (!SERVICE_ROLE_KEY) return
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { experimental: { passkey: true } } })
  const { data: profile } = await admin.from('profiles').select('id').eq('email', email).single()
  if (!profile) return
  const { data: passkeys } = await admin.auth.admin.passkey.listPasskeys({ userId: profile.id })
  for (const pk of passkeys ?? []) {
    await admin.auth.admin.passkey.deletePasskey({ userId: profile.id, passkeyId: pk.id })
  }
}

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

async function registerPasskeyFromDashboard(page: Page) {
  await expect(page.getByText("Activer l'empreinte")).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: "Activer l'empreinte" }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
  // handleRegisterPasskey() redirige inconditionnellement même en cas d'échec
  // (voir LoginPage.tsx) — l'indice local est donc la seule preuve directement
  // vérifiable ici que l'enregistrement a réellement réussi côté serveur.
  const hint = await page.evaluate(() => localStorage.getItem('kaytek-passkey-registered'))
  expect(hint, 'registerPasskey() a échoué silencieusement (voir logs serveur/beforeEach)').toBe('1')
}

async function logout(page: Page) {
  const logoutBtn = page.locator(
    'button:has-text("Quitter"), button:has-text("Déconnexion"), button[title*="onnexion"], a:has-text("Déconnexion")'
  ).first()
  await logoutBtn.click({ timeout: 10_000 })
  await expect(page).toHaveURL(/login/, { timeout: 10_000 })
}

const bioButtonRe = /connecter.*empreinte/i

test.describe('Connexion par passkey (architecture native Supabase)', () => {
  test.beforeEach(async () => {
    await clearExistingPasskeys(ADMIN_EMAIL!)
  })

  test('activation puis reconnexion immédiate mènent au dashboard avec une session valide', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)

    await page.goto('/login')
    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  // Le test central de la correction : contrairement à l'ancienne implémentation,
  // la passkey doit fonctionner MÊME APRÈS une vraie déconnexion (session Supabase
  // pleinement révoquée) — c'est exactement le scénario qui échouait avant, et
  // qui prouve qu'il ne s'agit plus d'un simple déverrouillage local d'une
  // session qui traînerait encore.
  test('connexion par empreinte après une vraie déconnexion (session Supabase révoquée)', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await logout(page)

    // La session Supabase est révoquée (localStorage 'kaytek-auth' vidé par
    // signOut()) — seul l'indice local ('kaytek-passkey-registered', pas un
    // credential) et la passkey côté serveur/authenticateur subsistent.
    const session = await page.evaluate(() => localStorage.getItem('kaytek-auth'))
    expect(session).toBeNull()

    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()

    // Une vraie nouvelle session a été émise par le serveur.
    const newSession = await page.evaluate(() => localStorage.getItem('kaytek-auth'))
    expect(newSession).not.toBeNull()
  })

  // Scénario "session locale supprimée" / "app réinstallée" : même l'indice
  // local disparaît, mais la passkey reste utilisable via le lien secondaire
  // (voir LoginPage.tsx : le lien "Se connecter avec l'empreinte" reste
  // atteignable même sans kaytek-passkey-registered, tant que l'appareil et le
  // serveur le permettent).
  test('storage local entièrement vidé (app réinstallée) → passkey toujours accessible via le lien secondaire', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await logout(page)

    await page.evaluate(() => localStorage.clear())
    await page.goto('/login')

    // Sans l'indice local, le formulaire mot de passe s'affiche en premier,
    // mais un lien vers la passkey doit rester visible et fonctionnel.
    await expect(page.locator('input[type="password"]')).toBeVisible()
    const bioLink = page.getByRole('button', { name: bioButtonRe })
    await expect(bioLink).toBeVisible({ timeout: 10_000 })
    await bioLink.click()

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
  })

  test('authenticateur qui ne répond jamais → le bouton se débloque après le délai au lieu de figer l\'app', async ({ page }) => {
    test.setTimeout(40_000)
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await page.goto('/login')

    // Simule le cas réel du bug historique : navigator.credentials.get() ne se
    // résout ni ne rejette jamais tout seul (authenticateur natif muet). Le mock
    // respecte néanmoins le `signal` transmis par signInWithPasskey() — exactement
    // ce que fait un vrai navigateur — pour vérifier que c'est bien NOTRE timeout
    // applicatif (withTimeout, indépendant du signal) qui débloque la situation.
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

    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page.getByText('Vérification…')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/n'a pas répondu à temps/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('requête réseau (verify) qui ne répond jamais → l\'UI se débloque au lieu de rester figée', async ({ page }) => {
    test.setTimeout(30_000)
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await page.goto('/login')

    // Simule une requête réseau qui ne répond jamais (réseau mobile dégradé) au
    // moment de vérifier l'assertion côté serveur — sans jamais appeler
    // fulfill/abort/continue, la requête reste indéfiniment en attente.
    await page.route('**/auth/v1/passkeys/authentication/verify*', () => {
      // ne rien faire : la requête reste en attente pour toujours
    })

    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page.getByText('Vérification…')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/serveur trop lente|n'a pas répondu à temps/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('annulation/empreinte non reconnue par l\'authenticateur → message clair, pas de blocage', async ({ page }) => {
    const { client, authenticatorId } = await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await page.goto('/login')

    // Simule un authenticateur qui ne reconnaît plus la passkey (téléphone
    // réinitialisé, credential supprimé côté OS, etc.) — get() rejette
    // rapidement, sans jamais planter l'app.
    const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId })
    for (const cred of credentials) {
      await client.send('WebAuthn.removeCredential', { authenticatorId, credentialId: cred.credentialId })
    }

    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page.getByText(/empreinte non reconnue/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('plusieurs connexions par empreinte successives ne dégradent pas le flux', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)

    for (let i = 0; i < 3; i++) {
      await logout(page)
      const bioButton = page.getByRole('button', { name: bioButtonRe })
      await expect(bioButton).toBeVisible({ timeout: 10_000 })
      await bioButton.click()
      await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
      await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
    }
  })

  // Cause racine du bug "connecté sans empreinte" (2026-09-12) : le serveur
  // Supabase envoie userVerification: 'preferred' dans les options d'assertion
  // (vérifié via POST /auth/v1/passkeys/authentication/options — ce champ n'est
  // configurable nulle part côté Supabase). Avec 'preferred', un authenticateur
  // peut se contenter de la présence de l'utilisateur sans exiger empreinte/PIN.
  // biometric.ts force désormais 'required' avant d'appeler
  // navigator.credentials.get() — ce test vérifie que cette valeur est
  // RÉELLEMENT celle reçue par le navigateur, indépendamment de ce que le
  // serveur a suggéré.
  test('userVerification est forcé à \'required\' avant l\'appel WebAuthn, quelle que soit la préférence du serveur', async ({ page }) => {
    await addVirtualAuthenticator(page)
    await loginWithPassword(page)
    await registerPasskeyFromDashboard(page)
    await logout(page)
    await page.goto('/login')

    const capturedUserVerification: string[] = []
    await page.exposeFunction('__reportUserVerification', (value: string) => {
      capturedUserVerification.push(value)
    })
    await page.evaluate(() => {
      const originalGet = navigator.credentials.get.bind(navigator.credentials)
      Object.defineProperty(navigator.credentials, 'get', {
        configurable: true,
        value: (options?: CredentialRequestOptions) => {
          ;(window as any).__reportUserVerification(options?.publicKey?.userVerification ?? 'undefined')
          return originalGet(options)
        },
      })
    })

    const bioButton = page.getByRole('button', { name: bioButtonRe })
    await expect(bioButton).toBeVisible({ timeout: 10_000 })
    await bioButton.click()

    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    expect(capturedUserVerification).toEqual(['required'])
  })
})

test.describe('Formulaire de connexion — compatibilité gestionnaires de mots de passe', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('le formulaire expose les attributs attendus par les gestionnaires de mots de passe', async ({ page }) => {
    await page.goto('/login')

    const emailInput = page.locator('input[type="email"]')
    const pwInput = page.locator('input[type="password"]')

    // Un vrai <form> (pas de gestion manuelle en dehors d'un form), soumis via
    // submit — condition nécessaire pour que Chrome/Android et Safari/iOS
    // associent les deux champs comme une paire identifiant/mot de passe.
    await expect(page.locator('form:has(input[type="email"]):has(input[type="password"])')).toHaveCount(1)

    await expect(emailInput).toHaveAttribute('name', 'username')
    await expect(emailInput).toHaveAttribute('autocomplete', 'username')
    await expect(emailInput).toHaveAttribute('id', 'login-email')

    await expect(pwInput).toHaveAttribute('name', 'current-password')
    await expect(pwInput).toHaveAttribute('autocomplete', 'current-password')
    await expect(pwInput).toHaveAttribute('id', 'login-password')

    await expect(page.locator('button[type="submit"]')).toHaveCount(1)
  })

  test('aucune donnée d\'identifiants n\'est écrite en localStorage/sessionStorage', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill('test-autofill@example.com')
    await page.locator('input[type="password"]').fill('un-mot-de-passe-secret')

    const stored = await page.evaluate(() => {
      const all: Record<string, string> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        all[k] = localStorage.getItem(k) || ''
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)!
        all[`session:${k}`] = sessionStorage.getItem(k) || ''
      }
      return all
    })
    const serialized = JSON.stringify(stored)
    expect(serialized).not.toContain('un-mot-de-passe-secret')
  })

  test('la soumission réussie ne recharge pas la page (SPA) — condition requise pour le prompt natif de sauvegarde', async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD non définis')
    // 'load' ne se déclenche que sur un chargement complet de document, jamais
    // sur une navigation History API (pushState) — c'est le signal fiable qu'un
    // rechargement complet n'a PAS eu lieu, condition requise pour que le
    // gestionnaire de mots de passe associe la soumission à la navigation qui suit.
    let loadCount = 0
    page.on('load', () => { loadCount++ })

    await loginWithPassword(page)
    // Selon que cet appareil de test a déjà une passkey enregistrée ou non,
    // la connexion réussie mène soit directement au dashboard, soit à l'écran
    // "Connexion rapide" proposant de l'activer — les deux restent sur /login
    // au niveau de l'URL pour ce second cas, donc on accepte l'un ou l'autre.
    await Promise.race([
      page.waitForURL(/dashboard/, { timeout: 15_000 }),
      page.getByText('Connexion rapide').waitFor({ state: 'visible', timeout: 15_000 }),
    ])

    expect(loadCount).toBe(1)
  })
})
