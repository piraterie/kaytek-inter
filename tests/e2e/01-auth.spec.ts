// tests/e2e/01-auth.spec.ts — Connexion, déconnexion, routes protégées
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

// ── Tests avec session admin ──────────────────────────────────────────────────
test.describe('Admin — session active', () => {
  test.use({ storageState: ADMIN_AUTH })

  // Playwright storageState ne capture pas sessionStorage. kaytek-active est
  // requis par initAuth() (App.tsx) pour charger le profil depuis la session
  // Supabase restaurée via localStorage — sans lui, user reste null → /login
  // (voir tests/responsive/01-viewports.spec.ts, seul endroit où ce garde
  // était déjà contourné avant ce fichier).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
  })

  test('dashboard accessible après connexion', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    // Le contenu principal du dashboard est visible
    await expect(page.locator('h1, [class*="page-title"]').first()).toBeVisible()
  })

  test('toutes les routes admin sont accessibles', async ({ page }) => {
    const routes = [
      '/interventions',
      '/devis',
      '/factures',
      '/clients',
      '/messagerie',
      '/commissions',
      '/utilisateurs',
      '/parametres',
      '/parametres/integrations',
      '/journal',
      '/planning',
      '/catalogue',
    ]
    for (const route of routes) {
      await page.goto(route)
      // Ne doit PAS rediriger vers /login
      await expect(page).not.toHaveURL(/login/, { timeout: 10_000 })
    }
  })
})

// ── Tests non authentifié ─────────────────────────────────────────────────────
test.describe('Non authentifié — protection des routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('dashboard → redirige vers /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })

  test('/devis → redirige vers /login', async ({ page }) => {
    await page.goto('/devis')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })

  test('/utilisateurs → redirige vers /login', async ({ page }) => {
    await page.goto('/utilisateurs')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })
})

// ── Login form ────────────────────────────────────────────────────────────────
test.describe('Formulaire de connexion', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('affiche le formulaire email + mot de passe', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('credentials invalides → message d\'erreur', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill('faux@test.fr')
    await page.locator('input[type="password"]').fill('mauvaismdp123')
    await page.locator('button[type="submit"]').click()
    // Message d'erreur visible (fond rouge / texte erreur)
    await expect(
      page.locator('[style*="rdTx"], [style*="rdBg"]').first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('lien "Mot de passe oublié" → affiche formulaire reset', async ({ page }) => {
    await page.goto('/login')
    await page.getByText('Mot de passe oublié').click()
    await expect(page.getByText('Réinitialiser')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})

// ── Déconnexion ───────────────────────────────────────────────────────────────
test.describe('Déconnexion', () => {
  test.use({ storageState: ADMIN_AUTH })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
  })

  test('déconnexion → redirige vers /login', async ({ page }) => {
    await page.goto('/dashboard')
    // Le bouton de déconnexion est dans la sidebar/nav
    // Chercher par texte ou title
    // Le bouton sidebar est libellé "Quitter" (AppLayout.tsx) — pas
    // "Déconnexion" ; conservé en repli au cas où un autre point d'entrée
    // (menu profil mobile, etc.) utiliserait un libellé différent.
    const logoutBtn = page.locator(
      'button:has-text("Quitter"), button:has-text("Déconnexion"), button[title*="onnexion"], a:has-text("Déconnexion")'
    ).first()
    // S'il n'est pas directement visible, chercher via le menu profil
    const isVisible = await logoutBtn.isVisible().catch(() => false)
    if (!isVisible) {
      // Ouvrir le menu profil si présent
      const profileBtn = page.locator('[class*="profil"], [class*="avatar"], button:has-text("Mon profil")').first()
      if (await profileBtn.isVisible().catch(() => false)) {
        await profileBtn.click()
      }
    }
    await logoutBtn.click({ timeout: 10_000 })
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })
})
