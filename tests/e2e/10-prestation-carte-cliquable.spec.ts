// tests/e2e/10-prestation-carte-cliquable.spec.ts
// Valide que toute la carte prestation est cliquable (ajout au devis),
// sans double-ajout, avec mise à jour correcte des totaux.
import { test, expect, type Page } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'
test.use({ storageState: ADMIN_AUTH })

// Playwright storageState ne capture pas sessionStorage. kaytek-active est
// requis par initAuth() (App.tsx) pour charger le profil depuis la session
// Supabase restaurée via localStorage — sans lui, user reste null → /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kaytek-active', '1'))
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
})

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** Ouvre /devis/nouveau et sélectionne le premier client disponible via CustomSelect */
async function openFormWithClient(page: Page): Promise<boolean> {
  await page.goto('/devis/nouveau')
  await page.waitForTimeout(1500)

  const trigger = page.locator('button[type="button"]')
    .filter({ hasText: /Sélectionner un client/ }).first()
  if (!await trigger.isVisible({ timeout: 8_000 }).catch(() => false)) return false

  await trigger.click()
  await page.waitForTimeout(400)

  // Le portal CustomSelect injecte les options avec data-selected dans document.body
  const firstOpt = page.locator('div[data-selected]').first()
  if (!await firstOpt.isVisible({ timeout: 4_000 }).catch(() => false)) return false

  await firstOpt.click()
  await page.waitForTimeout(600)
  return true
}

/** Première carte du catalogue (role="button" contenant "€ HT") */
function firstCard(page: Page) {
  return page.locator('[role="button"]').filter({ hasText: /€ HT/ }).first()
}

/** Nombre de lignes dans "Sélectionnées (N)" — 0 si la section n'existe pas encore */
async function countLignes(page: Page): Promise<number> {
  const header = page.locator('div').filter({ hasText: /Sélectionnées \(\d+\)/ }).first()
  if (await header.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const text = await header.textContent()
    const m = text?.match(/Sélectionnées \((\d+)\)/)
    return m ? parseInt(m[1]) : 0
  }
  return 0
}

/** Clic à une position relative (0-1) dans la bounding box d'un élément */
async function clickAt(page: Page, locator: ReturnType<Page['locator']>, xRatio: number, yRatio: number) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Élément sans bounding box')
  await page.mouse.click(
    box.x + box.width  * xRatio,
    box.y + box.height * yRatio
  )
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

test.describe('[carte-cliquable] Sélection prestation — zone étendue', () => {

  // ── 1. Clic sur le texte/nom ──────────────────────────────────────────────
  test('1 · clic sur le texte (nom) → +1 ligne', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    const before = await countLignes(page)

    // Clic au centre gauche = zone icône+texte (loin du bouton à droite)
    await clickAt(page, card, 0.35, 0.5)
    await page.waitForTimeout(600)

    const after = await countLignes(page)
    await page.screenshot({ path: 'test-results/carte-01-texte.png' })
    expect(after, 'Clic texte → +1 ligne').toBe(before + 1)
  })

  // ── 2. Clic sur le prix ───────────────────────────────────────────────────
  test('2 · clic sur le prix HT → +1 ligne', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    const before = await countLignes(page)

    // Clic en haut à droite = zone prix (le bouton "+ Ajouter" est en bas à droite)
    await clickAt(page, card, 0.88, 0.25)
    await page.waitForTimeout(600)

    const after = await countLignes(page)
    await page.screenshot({ path: 'test-results/carte-02-prix.png' })
    expect(after, 'Clic prix → +1 ligne').toBe(before + 1)
  })

  // ── 3. Clic sur l'icône ───────────────────────────────────────────────────
  test('3 · clic sur l\'icône prestation → +1 ligne', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    const before = await countLignes(page)

    // Clic à l'extrême gauche = zone icône (36×36 px)
    await clickAt(page, card, 0.07, 0.5)
    await page.waitForTimeout(600)

    const after = await countLignes(page)
    await page.screenshot({ path: 'test-results/carte-03-icone.png' })
    expect(after, 'Clic icône → +1 ligne').toBe(before + 1)
  })

  // ── 4. Clic sur "+ Ajouter" → exactement 1 ligne (stopPropagation) ────────
  test('4 · bouton "+ Ajouter" → exactement +1 ligne (pas +2 via bubbling)', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    const before = await countLignes(page)

    // Clic sur le bouton interne — stopPropagation doit empêcher le double-add
    const addBtn = card.locator('button').filter({ hasText: /Ajouter/ })
    await addBtn.click()
    await page.waitForTimeout(600)

    const after = await countLignes(page)
    await page.screenshot({ path: 'test-results/carte-04-bouton.png' })
    expect(after, 'Bouton → exactement +1 (pas +2 via bubbling)').toBe(before + 1)
  })

  // ── 5. Anti double-add : vérification complète ────────────────────────────
  test('5 · anti-double-add : carte=+1, bouton=+1, jamais +2 au même clic', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    // Clic zone carte (hors bouton) → +1
    await clickAt(page, card, 0.3, 0.5)
    await page.waitForTimeout(400)
    const afterCard = await countLignes(page)
    expect(afterCard, 'Clic carte → +1').toBe(1)

    // Clic bouton → +1 supplémentaire (stopPropagation : pas +2)
    const addBtn = card.locator('button').filter({ hasText: /Ajouter/ })
    await addBtn.click()
    await page.waitForTimeout(400)
    const afterBtn = await countLignes(page)
    expect(afterBtn, 'Clic bouton après carte → total +2 (1+1)').toBe(2)

    // Clic bouton rapidement × 3 → +3 supplémentaires (intentionnel, pas de doublon)
    await addBtn.click()
    await addBtn.click()
    await addBtn.click()
    await page.waitForTimeout(600)
    const afterTriple = await countLignes(page)
    expect(afterTriple, '3 clics bouton → +3 lignes (5 total)').toBe(5)

    await page.screenshot({ path: 'test-results/carte-05-anti-double.png' })
  })

  // ── 6. Totaux recalculés après ajout ─────────────────────────────────────
  test('6 · totaux HT / TVA / TTC recalculés correctement', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const cards = page.locator('[role="button"]').filter({ hasText: /€ HT/ })
    if (await cards.count() === 0) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    // Ajouter la première prestation via clic carte
    await cards.first().click()
    await page.waitForTimeout(600)

    // Le récapitulatif doit être visible
    const recap = page.locator('.card').filter({ has: page.locator('text=Récapitulatif') }).first()
    await expect(recap).toBeVisible({ timeout: 5_000 })

    // Total HT, TVA, Total TTC présents
    await expect(recap.locator('text=Total HT')).toBeVisible()
    await expect(recap.locator('text=TVA')).toBeVisible()
    await expect(recap.locator('text=Total TTC')).toBeVisible()

    // Le montant Total TTC doit être > 0,00 €
    const ttcAmount = recap.locator('span').filter({ hasText: /\d+,\d+/ }).last()
    if (await ttcAmount.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const txt = await ttcAmount.textContent()
      expect(txt, 'Total TTC doit être > 0').not.toMatch(/^0,00/)
    }

    // Ajouter une deuxième prestation et vérifier l'incrémentation
    const ttcBefore = await ttcAmount.textContent().catch(() => '')
    if (await cards.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cards.first().click()
      await page.waitForTimeout(600)
      const ttcAfter = await ttcAmount.textContent().catch(() => '')
      // Le TTC doit avoir changé (augmenté)
      expect(ttcAfter, 'TTC doit augmenter après 2ème ajout').not.toBe(ttcBefore)
    }

    await page.screenshot({ path: 'test-results/carte-06-totaux.png' })
  })

  // ── 7. Responsive — cliquabilité sur 360 / 390 / 430 px ─────────────────
  test('7 · responsive 360/390/430 — carte cliquable, sticky bar non cachée', async ({ page }) => {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 812 })
      await page.goto('/devis/nouveau')
      await page.waitForTimeout(1500)

      // Sur mobile la sidebar démarre ouverte (sidebarOpen:true par défaut).
      // La sidebar a z-index:100, le topbar z-index:91 — le hamburger est caché.
      // On clique l'overlay semi-transparent à droite de la sidebar (> 280px)
      // pour la fermer avant d'interagir avec le formulaire.
      await page.mouse.click(width - 10, 400) // overlay à droite de la sidebar
      await page.waitForTimeout(350)

      // Sélectionner le premier client
      const trigger = page.locator('button[type="button"]')
        .filter({ hasText: /Sélectionner un client/ }).first()
      if (!await trigger.isVisible({ timeout: 5_000 }).catch(() => false)) continue
      await trigger.click({ timeout: 10_000 })
      await page.waitForTimeout(400)
      const firstOpt = page.locator('div[data-selected]').first()
      if (!await firstOpt.isVisible({ timeout: 4_000 }).catch(() => false)) continue
      await firstOpt.click()
      await page.waitForTimeout(600)

      // Pas de scroll horizontal
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
      expect(overflow, `Débordement horizontal à ${width}px`).toBeFalsy()

      // La sticky bar (Brouillon / Envoyer) doit être visible et large
      const stickyBtn = page.locator('.bottom-action-bar button').first()
      if (await stickyBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const box = await stickyBtn.boundingBox()
        expect(box?.width, `Bouton sticky invisible à ${width}px`).toBeGreaterThan(0)
      }

      // Carte cliquable → +1 ligne
      const card = firstCard(page)
      if (await card.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const before = await countLignes(page)
        await clickAt(page, card, 0.3, 0.5)
        await page.waitForTimeout(500)
        const after = await countLignes(page)
        expect(after, `Carte cliquable à ${width}px → +1`).toBe(before + 1)
      }

      await page.screenshot({ path: `test-results/carte-07-${width}px.png` })
    }
  })

  // ── 8a. Régression — barre de recherche ──────────────────────────────────
  test('8a · régression — recherche catalogue filtre les prestations', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }

    const search = page.locator('input[placeholder*="catalogue"], input[placeholder*="atalogue"]').first()
    if (!await search.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Barre de recherche non trouvée')
      return
    }

    const initial = await page.locator('[role="button"]').filter({ hasText: /€ HT/ }).count()

    // Recherche inexistante → 0 résultats
    await search.fill('zzz_inexistant_xyz_playwright')
    await page.waitForTimeout(400)
    const filtered = await page.locator('[role="button"]').filter({ hasText: /€ HT/ }).count()
    expect(filtered, 'Recherche invalide → 0 résultats').toBe(0)

    // Effacer → résultats restaurés
    await search.clear()
    await page.waitForTimeout(400)
    const restored = await page.locator('[role="button"]').filter({ hasText: /€ HT/ }).count()
    expect(restored, 'Effacer recherche → catalogue restauré').toBe(initial)

    await page.screenshot({ path: 'test-results/carte-08a-recherche.png' })
  })

  // ── 8b. Régression — suppression ligne sélectionnée ──────────────────────
  test('8b · régression — suppression ligne fonctionne toujours', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }
    const card = firstCard(page)
    if (!await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Aucune prestation dans le catalogue')
      return
    }

    // Ajouter 1 ligne
    await card.click()
    await page.waitForTimeout(500)
    const before = await countLignes(page)
    expect(before, 'Au moins 1 ligne après ajout').toBeGreaterThanOrEqual(1)

    // Supprimer la ligne via le bouton 🗑
    // Scroll vers la section si nécessaire
    const deleteBtn = page.locator('button').filter({ has: page.locator('text=🗑') }).first()
    if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(400)
      const after = await countLignes(page)
      expect(after, 'Suppression → -1 ligne').toBe(before - 1)
    }

    await page.screenshot({ path: 'test-results/carte-08b-suppression.png' })
  })

  // ── 8c. Régression — filtre activité ──────────────────────────────────────
  test('8c · régression — changement d\'activité rafraîchit le catalogue', async ({ page }) => {
    if (!await openFormWithClient(page)) {
      test.skip(true, 'Aucun client disponible')
      return
    }

    // Changer l'activité dans le select natif
    const actSel = page.locator('select').filter({ has: page.locator('option[value="plomberie"]') }).first()
    if (!await actSel.isVisible({ timeout: 4_000 }).catch(() => false)) {
      test.skip(true, 'Select activité non trouvé')
      return
    }

    await actSel.selectOption('plomberie')
    await page.waitForTimeout(600)

    // La page doit rester fonctionnelle (pas de crash)
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 5_000 })

    // Revenir à serrurerie
    await actSel.selectOption('serrurerie')
    await page.waitForTimeout(400)
    await expect(page.locator('.card').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/carte-08c-activite.png' })
  })
})
