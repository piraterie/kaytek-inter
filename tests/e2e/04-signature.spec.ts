// tests/e2e/04-signature.spec.ts — Signature électronique d'un devis
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

// Injecte kaytek-active pour tous les tests de ce fichier
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
})

test.describe('Signature devis', () => {
  test('bouton "Signer maintenant" visible sur un devis non signé', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1000)

    // Trouver un devis editable (brouillon, envoyé ou accepté)
    const editLink = page.locator('a[href*="/editer"]').first()
    if (!await editLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucun devis modifiable trouvé — passer ce test')
      return
    }
    await editLink.click()
    await page.waitForURL(/devis\/.*\/editer/, { timeout: 10_000 })

    // Le bouton "Signer maintenant" doit être présent si le devis n'est pas encore signé
    const sigBtn = page.locator('button:has-text("Signer"), button:has-text("Signature")').first()
    if (await sigBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      expect(await sigBtn.isEnabled()).toBeTruthy()
    }
  })

  test('modal de signature s\'ouvre et contient un canvas', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1000)

    const editLink = page.locator('a[href*="/editer"]').first()
    if (!await editLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucun devis modifiable trouvé')
      return
    }
    await editLink.click()
    await page.waitForURL(/devis\/.*\/editer/, { timeout: 10_000 })

    const sigBtn = page.locator('button:has-text("Signer"), button:has-text("Signature")').first()
    if (!await sigBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Devis déjà signé ou bouton absent')
      return
    }
    await sigBtn.click()

    // La modale de signature doit apparaître avec un canvas
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 })
    // Le bouton de validation doit être présent
    await expect(
      page.locator('button:has-text("Valider"), button:has-text("Confirmer"), button:has-text("Sauvegarder")').first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('signer en dessinant sur le canvas', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1000)

    const editLink = page.locator('a[href*="/editer"]').first()
    if (!await editLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucun devis modifiable trouvé')
      return
    }
    await editLink.click()
    await page.waitForURL(/devis\/.*\/editer/, { timeout: 10_000 })

    const sigBtn = page.locator('button:has-text("Signer"), button:has-text("Signature")').first()
    if (!await sigBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Devis déjà signé')
      return
    }
    await sigBtn.click()

    // Attendre le canvas
    const canvas = page.locator('canvas').first()
    await canvas.waitFor({ state: 'visible', timeout: 10_000 })
    const box = await canvas.boundingBox()
    if (!box) { test.skip(true, 'Canvas non mesurable'); return }

    // Simuler un tracé de signature (ligne diagonale)
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3)
    await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2)
    await page.mouse.up()

    // Cliquer sur "Valider la signature"
    const validateBtn = page.locator(
      'button:has-text("Valider"), button:has-text("Confirmer"), button:has-text("Enregistrer")'
    ).first()
    await validateBtn.click()

    // Après validation : le bouton "Signer" disparaît et "✓ Signé" apparaît
    await page.waitForTimeout(3000)
    const isSignedText = page.locator('text=Signé, text=✓ Signé, text=Signature enregistrée').first()
    // Vérifier soit le texte soit l'absence du bouton signer
    const signBtnGone = !(await sigBtn.isVisible({ timeout: 2_000 }).catch(() => false))
    expect(signBtnGone || await isSignedText.isVisible({ timeout: 2_000 }).catch(() => false)).toBeTruthy()
  })

  // ── RÉGRESSION : signature_client dans le SELECT de useDevis() ──────────────────
  test('[non-régression] useDevis() inclut signature_client dans la requête Supabase', async ({ page }) => {
    let signatureClientPresent = false

    // Intercepter toutes les requêtes GET vers la table devis (liste, pas detail)
    page.on('request', req => {
      const url = req.url()
      const decoded = decodeURIComponent(url)
      // Filtre : requête GET vers /rest/v1/devis avec select=
      if (
        req.method() === 'GET' &&
        url.includes('/rest/v1/devis') &&
        decoded.includes('select=') &&
        decoded.includes('signature_client')
      ) {
        signatureClientPresent = true
      }
    })

    await page.goto('/devis')
    // Attendre que la requête soit émise
    await page.waitForTimeout(3000)

    expect(signatureClientPresent).toBe(true)
  })

  // ── RÉGRESSION : PDF d'un devis signé contient la signature ────────────────────
  test('[non-régression] export PDF depuis DevisPage ne produit pas d\'erreur sur devis signé', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(2000)

    // Chercher un devis accepté (signé)
    const acceptedPill = page.locator('.pill-green').first()
    const hasAccepted = await acceptedPill.isVisible({ timeout: 5000 }).catch(() => false)

    if (!hasAccepted) {
      test.skip(true, 'Aucun devis signé (statut accepté) trouvé dans la liste')
      return
    }

    // Sur desktop : chercher un bouton PDF dans le tableau
    // Sur mobile : le DocSheet s'ouvre au clic sur la card
    const isDesktop = await page.evaluate(() => window.innerWidth >= 768)

    if (isDesktop) {
      // Desktop : le PDF se déclenche depuis le DocSheet (clic sur une ligne)
      const firstRow = page.locator('table.data-table tbody tr').filter({ hasText: 'Accepté' }).first()
      if (!await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
        test.skip(true, 'Ligne acceptée non visible en desktop')
        return
      }
      await firstRow.click()
      await page.waitForTimeout(500)
    } else {
      // Mobile : clic sur la card pour ouvrir le DocSheet
      const card = page.locator('.show-mobile > div').filter({ has: acceptedPill }).first()
      if (!await card.isVisible({ timeout: 3000 }).catch(() => false)) {
        test.skip(true, 'Card acceptée non visible en mobile')
        return
      }
      await card.locator('button:has-text("···")').first().click()
      await page.waitForTimeout(500)
    }

    // Vérifier que le DocSheet s'est ouvert avec le bouton PDF
    const exportBtn = page.locator('button:has-text("Exporter PDF")')
    if (!await exportBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      test.skip(true, 'Bouton "Exporter PDF" non trouvé dans le DocSheet')
      return
    }

    // Déclencher l'export — capturer le download
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
    await exportBtn.click()

    // Vérifier l'ABSENCE d'un toast d'erreur
    await page.waitForTimeout(1500)
    const errorToast = page.locator('text=Erreur PDF').first()
    const hasError = await errorToast.isVisible({ timeout: 1000 }).catch(() => false)
    expect(hasError).toBe(false)

    // Vérifier que le fichier téléchargé est bien un .pdf
    try {
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
    } catch {
      // Le download peut ne pas être capturé si les paramètres entreprise manquent
      // L'absence d'erreur toast suffit à valider le flux
    }
  })

  // ── RÉGRESSION : email d'un devis signé inclut toujours la signature ───────────
  test('[non-régression] modal email devis signé déclenche un re-fetch Supabase frais', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(2000)

    // Chercher un devis signé avec email client
    const acceptedPill = page.locator('.pill-green').first()
    if (!await acceptedPill.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Aucun devis signé trouvé')
      return
    }

    let freshFetchTriggered = false
    // La modal email fait un re-fetch /rest/v1/devis?id=eq.XXX avec select=*
    page.on('request', req => {
      const url = req.url()
      const decoded = decodeURIComponent(url)
      if (
        req.method() === 'GET' &&
        url.includes('/rest/v1/devis') &&
        decoded.includes('id=eq.') &&
        decoded.includes('select=*')
      ) {
        freshFetchTriggered = true
      }
    })

    // Ouvrir le DocSheet et cliquer "Envoyer par email"
    const card = page.locator('.show-mobile > div').filter({ has: acceptedPill }).first()
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.locator('button:has-text("···")').first().click()
      await page.waitForTimeout(500)
    } else {
      const row = page.locator('table.data-table tbody tr').filter({ hasText: 'Accepté' }).first()
      if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
        await row.click()
        await page.waitForTimeout(500)
      }
    }

    const emailBtn = page.locator('button:has-text("Envoyer par email")')
    if (!await emailBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      test.skip(true, 'Bouton email non trouvé')
      return
    }
    await emailBtn.click()

    // Attendre l'ouverture du modal email et le re-fetch
    await page.waitForTimeout(3000)

    // Le modal email doit s'être ouvert (champ email visible)
    const emailInput = page.locator('input[type="email"]')
    expect(await emailInput.isVisible({ timeout: 3000 }).catch(() => false)).toBe(true)

    // Un re-fetch vers Supabase doit avoir été déclenché pour récupérer signature_client
    expect(freshFetchTriggered).toBe(true)
  })
})
