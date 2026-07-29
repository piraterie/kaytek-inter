// tests/e2e/11-google-integration.spec.ts — Entrée de navigation "Connexion
// Google" (Administration → /parametres/integrations) : visibilité par
// rôle, accès direct par URL, comportement mobile.
//
// Aucun appel OAuth réel n'est déclenché : le bouton "Connecter" est
// vérifié présent/cliquable mais jamais cliqué jusqu'à la redirection vers
// accounts.google.com (voir 05-signature.spec.ts / autres suites pour le
// pattern équivalent sur d'autres intégrations externes). Le statut de
// connexion affiché dépend du backend local (Edge Function
// google-oauth-status) — non connecté par défaut sur un environnement de
// test fraîchement provisionné.
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'
const INTERVENANT_AUTH = 'tests/.auth/intervenant.json'

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
function seedActiveSession(page: import('@playwright/test').Page) {
  return page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
}

test.describe('Connexion Google — admin', () => {
  test.use({ storageState: ADMIN_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('entrée "Connexion Google" visible dans la navigation', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: 'Connexion Google' })).toBeVisible({ timeout: 10_000 })
  })

  test('clic sur l\'entrée ouvre /parametres/integrations', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Connexion Google' }).click()
    await expect(page).toHaveURL(/parametres\/integrations/, { timeout: 10_000 })
    await expect(page.getByText('Connexion Google').first()).toBeVisible()
  })

  test('accès direct par URL (rechargement) fonctionne — pas de page blanche ni de 404', async ({ page }) => {
    await page.goto('/parametres/integrations')
    await expect(page).toHaveURL(/parametres\/integrations/, { timeout: 10_000 })
    await expect(page.getByText(/google ads/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/google business profile/i).first()).toBeVisible()
  })

  test('état non connecté (par défaut) : boutons de connexion visibles, jamais un faux statut "Connecté"', async ({ page }) => {
    await page.goto('/parametres/integrations')
    await expect(page.getByRole('button', { name: /connecter google ads/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /connecter google business profile/i })).toBeVisible()
  })

  test('aucune erreur console critique sur la page', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      // Un statut Google non configuré en local (Edge Function indisponible/
      // secrets absents) déclenche un échec réseau normal, déjà géré par
      // l'état d'erreur de la page (voir IntegrationsGooglePage.test.tsx) —
      // seul le bruit navigateur correspondant est filtré ici, pas les
      // erreurs applicatives (React, JS non gérées, etc.).
      if (/Failed to load resource/i.test(msg.text())) return
      errors.push(msg.text())
    })
    await page.goto('/parametres/integrations')
    await page.waitForTimeout(1500)
    expect(errors, `Erreurs console : ${errors.join(' | ')}`).toEqual([])
  })
})

test.describe('Connexion Google — mobile', () => {
  test.use({ storageState: ADMIN_AUTH, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('le menu mobile contient l\'entrée "Connexion Google"', async ({ page }) => {
    await page.goto('/dashboard')
    // Deux déclencheurs équivalents ouvrent la même sidebar sur mobile (icône
    // hamburger de la topbar + bouton "Menu" de la bottom-nav) — .first()
    // évite une ambiguïté de sélecteur, peu importe lequel est saisi.
    await page.getByRole('button', { name: /menu/i }).first().click()
    await expect(page.getByRole('button', { name: 'Connexion Google' })).toBeVisible({ timeout: 10_000 })
  })

  test('accès direct par URL fonctionne sur mobile', async ({ page }) => {
    await page.goto('/parametres/integrations')
    await expect(page).toHaveURL(/parametres\/integrations/, { timeout: 10_000 })
    await expect(page.getByText(/google ads/i).first()).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Connexion Google — rôle non autorisé', () => {
  test.use({ storageState: INTERVENANT_AUTH })
  test.beforeEach(({ page }) => seedActiveSession(page))

  test('un intervenant ne voit pas l\'entrée "Connexion Google"', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(800)
    await expect(page.getByRole('button', { name: 'Connexion Google' })).not.toBeVisible()
  })

  test('accès direct à /parametres/integrations est refusé (redirection, pas de contenu Google)', async ({ page }) => {
    await page.goto('/parametres/integrations')
    await page.waitForTimeout(1000)
    await expect(page).not.toHaveURL(/parametres\/integrations/)
    await expect(page.getByRole('button', { name: /connecter google ads/i })).not.toBeVisible()
  })
})

test.describe('Connexion Google — non authentifié', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('accès direct à /parametres/integrations redirige vers /login', async ({ page }) => {
    await page.goto('/parametres/integrations')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })
})
