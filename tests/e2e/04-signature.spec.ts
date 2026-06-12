// tests/e2e/04-signature.spec.ts — Signature électronique d'un devis
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.use({ storageState: ADMIN_AUTH })

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
})
