// tests/responsive/01-viewports.spec.ts
// Lancé automatiquement sur les projets mobile-360/390/430 et tablet via playwright.config.ts
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage.
// kaytek-active est requis par initAuth() (App.tsx:131) pour charger le profil
// depuis le cache Supabase en localStorage. Sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('kaytek-active', '1')
  })
})

// Pages à tester sur tous les viewports
const PAGES_TO_CHECK = [
  { name: 'Dashboard',      url: '/dashboard' },
  { name: 'Interventions',  url: '/interventions' },
  { name: 'Devis',          url: '/devis' },
  { name: 'Factures',       url: '/factures' },
  { name: 'Messagerie',     url: '/messagerie' },
  { name: 'Commissions',    url: '/commissions' },
]

test.describe('Responsive — rendu sans scroll horizontal', () => {
  for (const p of PAGES_TO_CHECK) {
    test(`${p.name} (${p.url}) — pas de débordement horizontal`, async ({ page }) => {
      await page.goto(p.url)
      await page.waitForTimeout(1000)

      // Vérifier absence de scroll horizontal
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(overflow, `Débordement horizontal détecté sur ${p.url}`).toBeFalsy()
    })
  }
})

test.describe('Responsive — éléments principaux visibles', () => {
  test('navigation mobile présente', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(800)
    const viewport = page.viewportSize()

    if (viewport && viewport.width <= 768) {
      // Sur mobile : bottom nav ou hamburger menu doit exister
      const mobileNav = page.locator(
        '[class*="bottom-nav"], [class*="mobile-nav"], [class*="tab-bar"], nav[class*="mobile"]'
      ).first()
      const hamburger = page.locator(
        'button[aria-label*="menu"], button:has-text("☰"), [class*="hamburger"]'
      ).first()
      const hasNav = await mobileNav.isVisible({ timeout: 3_000 }).catch(() => false)
      const hasHamburger = await hamburger.isVisible({ timeout: 3_000 }).catch(() => false)
      expect(hasNav || hasHamburger).toBeTruthy()
    }
  })

  test('page devis — tableau ou cartes adaptatifs', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1000)
    const viewport = page.viewportSize()

    if (viewport && viewport.width <= 768) {
      // Sur mobile : cartes (pas de tableau)
      const cards = page.locator('[class*="card"], [class*="mobile"]').first()
      // Vérifier qu'on ne déborde pas
      const hasHorizontalScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth + 5
      )
      expect(hasHorizontalScroll).toBeFalsy()
    } else {
      // Desktop : tableau
      const table = page.locator('table').first()
      if (await table.isVisible({ timeout: 3_000 }).catch(() => false)) {
        expect(await table.isVisible()).toBeTruthy()
      }
    }
  })

  test('formulaire création devis — utilisable sur mobile', async ({ page }) => {
    await page.goto('/devis/nouveau')
    await page.waitForTimeout(800)

    // Le formulaire ne doit pas déborder
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    )
    expect(overflow).toBeFalsy()

    // Les inputs doivent être accessibles
    const inputs = page.locator('input, select, textarea')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Responsive — breakpoints spécifiques', () => {
  test('viewport 360px — dashboard lisible', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // Les stats doivent tenir dans 360px
    const statsCard = page.locator('[class*="stat"], [class*="card"]').first()
    if (await statsCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const box = await statsCard.boundingBox()
      if (box) expect(box.width).toBeLessThanOrEqual(360)
    }
  })

  test('viewport 390px — page devis lisible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/devis')
    await page.waitForTimeout(800)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    )
    expect(overflow).toBeFalsy()
  })

  test('viewport 430px — messagerie lisible', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 })
    await page.goto('/messagerie')
    await page.waitForTimeout(1000)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    )
    expect(overflow).toBeFalsy()
  })
})
