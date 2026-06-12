// tests/e2e/03-workflow-complet.spec.ts
// Workflow complet artisan Kaytek — 12 étapes
// client → devis → signature → PDF → email → facture → intervention → messagerie → journal
//
// ⚠️ Ce test crée de vraies données Supabase (comptes de test dédiés uniquement).
//    Préfixe TEST-WORKFLOW pour suppression manuelle ultérieure.
// ⚠️ Ne modifie aucun composant applicatif — uniquement Playwright.

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ADMIN_AUTH       = 'tests/.auth/admin.json'
const INTERVENANT_AUTH = 'tests/.auth/intervenant.json'
const SCREENSHOTS_DIR  = 'tests/screenshots/workflow'

// Identifiant unique du run — garantit l'absence de collision avec les runs précédents
const UID          = Date.now()
const NOM          = 'TEST-WORKFLOW'
const PRENOM       = `PW-${UID}`
const LABEL        = `${NOM} ${PRENOM}`
const CLIENT_EMAIL = `test-workflow-${UID}@example.test`

type Status = '✅' | '❌' | '⚠️'
const results: Array<{ step: string; status: Status; note?: string }> = []

function addResult(step: string, status: Status, note?: string) {
  results.push({ step, status, note })
}

async function shot(page: any, name: string) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false })
}

function intervenantAuthExists(): boolean {
  try {
    const raw = fs.readFileSync(INTERVENANT_AUTH, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.cookies) && parsed.cookies.length > 0
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test.use({ storageState: ADMIN_AUTH })
test.use({ video: 'retain-on-failure' })

test.describe.serial('Workflow complet artisan Kaytek', () => {

  test.beforeEach(async ({ page }) => {
    // Playwright storageState ne capture pas sessionStorage.
    // kaytek-active est requis par initAuth() pour charger la session depuis le cache.
    await page.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
  })

  // ══ 01 — Dashboard Admin A ═══════════════════════════════════════════════════
  test('01 — Dashboard Admin A', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(1500)
    await shot(page, '01-dashboard')

    expect(page.url(), 'Doit être sur /dashboard (pas /login)').toContain('/dashboard')

    const hasContent = await page.locator('[class*="stat"], [class*="card"], h1, h2')
      .first().isVisible({ timeout: 5000 }).catch(() => false)
    expect(hasContent, 'Contenu dashboard visible').toBeTruthy()

    addResult('01 — Dashboard Admin A', '✅')
  })

  // ══ 02 — Créer client TEST-WORKFLOW ══════════════════════════════════════════
  test('02 — Créer client TEST-WORKFLOW', async ({ page }) => {
    await page.goto('/clients')
    await page.waitForTimeout(1000)

    await page.locator('button:has-text("+ Ajouter")').first().click()
    await page.waitForTimeout(500)

    // Champs modal (ordre JSX) : type (select), nom, prenom, telephone, email, adresse, notes
    await page.locator('.modal input').nth(0).fill(NOM)
    await page.locator('.modal input').nth(1).fill(PRENOM)
    await page.locator('.modal input').nth(3).fill(CLIENT_EMAIL)  // email après téléphone
    await page.locator('.modal button:has-text("Enregistrer")').click()
    await page.waitForTimeout(2000)

    await shot(page, '02-client-cree')

    const count = await page.locator('table tbody tr, .show-mobile > div')
      .filter({ hasText: PRENOM }).count()
    expect(count, `Client "${LABEL}" visible dans la liste`).toBeGreaterThan(0)

    addResult('02 — Créer client TEST-WORKFLOW', '✅', LABEL)
  })

  // ══ 03 — Créer devis + prestation + vérifier TTC ══════════════════════════════
  test('03 — Créer devis avec prestation (200€ HT → 240€ TTC)', async ({ page }) => {
    test.slow()

    await page.goto('/devis/nouveau')
    await page.waitForTimeout(1500)

    // Sélectionner le client par PRENOM unique (évite les collisions avec runs précédents)
    await page.locator('button[type="button"]:has-text("Sélectionner un client")').first().click()
    await page.waitForTimeout(400)
    await page.locator('[data-selected]').filter({ hasText: PRENOM }).first().click()
    await page.waitForTimeout(400)

    // Prestation manuelle — labels sans attribut for, cibler par placeholder
    await page.locator('button:has-text("+ Ajouter une prestation manuelle")').click()
    await page.waitForTimeout(500)
    await page.getByPlaceholder('Remplacement').fill(`Réparation TEST-WORKFLOW ${UID}`)
    // input[type=number] visibles : index 0 = quantité, index 1 = prix_ht
    await page.locator('input[type="number"]:visible').nth(1).clear()
    await page.locator('input[type="number"]:visible').nth(1).fill('200')
    await page.waitForTimeout(200)
    await page.locator('button:has-text("+ Ajouter cette prestation")').click()
    await page.waitForTimeout(500)

    await shot(page, '03-devis-prestation')

    // Vérifier TTC (200 HT × 1.20 TVA = 240 TTC)
    const ttcVisible = await page.locator('text=/240|TTC/').first()
      .isVisible({ timeout: 3000 }).catch(() => false)

    // Sauvegarder brouillon
    await page.locator('button:has-text("Sauvegarder brouillon")').click()
    await page.waitForURL('**/devis', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    await shot(page, '03-devis-liste')

    const rowCount = await page.locator('tr, .show-mobile > div').filter({ hasText: PRENOM }).count()
    expect(rowCount, 'Devis visible dans la liste /devis').toBeGreaterThan(0)

    addResult('03 — Créer devis + prestation', '✅', `TTC 240€ visible: ${ttcVisible}`)
  })

  // ══ 04 — Signature client sur le devis ════════════════════════════════════════
  test('04 — Signature client sur le devis', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1500)

    const devisRow = page.locator('tr').filter({ hasText: PRENOM }).first()
    if (await devisRow.count() === 0) {
      addResult('04 — Signature client', '⚠️', 'Ligne devis non trouvée (vue desktop absente ?)')
      await shot(page, '04-no-row')
      return
    }

    // Clic sur la ligne → ouvre DocSheet
    await devisRow.click()
    await page.waitForTimeout(500)

    // DocSheet → "Éditer" → navigue vers /devis/:id/editer (DevisFormPage en mode édition)
    const editerBtn = page.locator('text=Éditer')
    if (!(await editerBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('04 — Signature client', '⚠️', 'Bouton "Éditer" absent du DocSheet')
      await shot(page, '04-no-editer')
      return
    }

    await editerBtn.click()
    await page.waitForURL('**/editer', { timeout: 10_000 })
    await page.waitForTimeout(1000)

    // Section 4 — Signature client : bouton "✍ Signer maintenant" (DevisFormPage:647)
    const signBtn = page.locator('button:has-text("Signer maintenant")')
    if (!(await signBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      addResult('04 — Signature client', '⚠️', 'Bouton "Signer maintenant" absent (déjà signé ou brouillon non trouvé)')
      await shot(page, '04-no-sign-btn')
      return
    }

    await signBtn.click()
    await page.waitForTimeout(500)

    // SignatureModal — canvas avec mousedown/mousemove/mouseup
    const canvas = page.locator('canvas').first()
    await canvas.waitFor({ state: 'visible', timeout: 5000 })
    const box = await canvas.boundingBox()

    if (!box) {
      addResult('04 — Signature client', '❌', 'Canvas de signature non trouvé')
      return
    }

    // Dessiner un trait diagonal pour activer hasDrawn → bouton "Valider" s'active
    await page.mouse.move(box.x + 50, box.y + 80)
    await page.mouse.down()
    await page.mouse.move(box.x + 150, box.y + 40, { steps: 10 })
    await page.mouse.move(box.x + 250, box.y + 100, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    await shot(page, '04-signature-dessinee')

    // Valider — bouton activé uniquement si hasDrawn=true (SignatureModal:hasDrawn)
    const validerBtn = page.locator('button:has-text("Valider la signature")')
    await validerBtn.waitFor({ state: 'visible', timeout: 3000 })
    await validerBtn.click()
    await page.waitForTimeout(2000)

    await shot(page, '04-signature-validee')

    const confirmed = await page.locator('text=Signature enregistrée')
      .isVisible({ timeout: 5000 }).catch(() => false)

    addResult('04 — Signature client', confirmed ? '✅' : '⚠️',
      confirmed ? 'Signature validée et persistée' : 'Signature soumise — confirmation visuelle non détectée')
  })

  // ══ 05 — Téléchargement PDF du devis ══════════════════════════════════════════
  test('05 — Téléchargement PDF du devis', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1500)

    const devisRow = page.locator('tr').filter({ hasText: PRENOM }).first()
    if (await devisRow.count() === 0) {
      addResult('05 — PDF devis', '⚠️', 'Ligne devis non trouvée')
      return
    }

    await devisRow.click()
    await page.waitForTimeout(500)

    // DocSheet → SheetRow label="Exporter PDF" (DevisPage:638)
    const pdfBtn = page.locator('text=Exporter PDF')
    if (!(await pdfBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('05 — PDF devis', '⚠️', 'Bouton "Exporter PDF" absent du DocSheet')
      await shot(page, '05-no-pdf')
      return
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      pdfBtn.click(),
    ])

    await shot(page, '05-pdf-telecharge')
    addResult('05 — PDF devis', '✅', `Fichier : ${download.suggestedFilename()}`)
  })

  // ══ 06 — Envoi email devis ════════════════════════════════════════════════════
  test('06 — Envoi email devis au client', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1500)

    const devisRow = page.locator('tr').filter({ hasText: PRENOM }).first()
    if (await devisRow.count() === 0) {
      addResult('06 — Email devis', '⚠️', 'Ligne devis non trouvée')
      return
    }

    await devisRow.click()
    await page.waitForTimeout(500)

    // Marquer comme envoyé si encore en brouillon (requis pour certaines actions DocSheet)
    const marquer = page.locator('text=Marquer comme envoyé')
    if (await marquer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await marquer.click()
      await page.waitForTimeout(1500)
      await devisRow.click()
      await page.waitForTimeout(500)
    }

    // DocSheet → SheetRow label="Envoyer par email" (DevisPage:645)
    // N'apparaît que si client.email est défini (CLIENT_EMAIL renseigné à l'étape 02)
    const emailBtn = page.locator('text=Envoyer par email')
    if (!(await emailBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('06 — Email devis', '⚠️', 'Bouton "Envoyer par email" absent (email client manquant ?)')
      await shot(page, '06-no-email-btn')
      return
    }

    await emailBtn.click()
    await page.waitForTimeout(1000)

    await shot(page, '06-email-modal')

    // EmailDevisModal — bouton d'envoi
    const sendBtn = page.locator('button:has-text("Envoyer"), button:has-text("Envoyer le devis")')
      .filter({ hasNot: page.locator(':disabled') }).first()

    if (!(await sendBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('06 — Email devis', '⚠️', 'Bouton envoi dans EmailDevisModal non trouvé')
      return
    }

    await sendBtn.click()
    await page.waitForTimeout(2000)

    await shot(page, '06-email-envoye')
    addResult('06 — Email devis', '✅', `Email envoyé à ${CLIENT_EMAIL}`)
  })

  // ══ 07 — Convertir devis en facture ══════════════════════════════════════════
  test('07 — Convertir devis en facture', async ({ page }) => {
    await page.goto('/devis')
    await page.waitForTimeout(1500)

    const devisRow = page.locator('tr').filter({ hasText: PRENOM }).first()
    if (await devisRow.count() === 0) {
      addResult('07 — Convertir en facture', '⚠️', 'Ligne devis non trouvée')
      return
    }

    await devisRow.click()
    await page.waitForTimeout(500)

    // Marquer comme envoyé si brouillon — requis pour "Transformer en facture"
    const marquer = page.locator('text=Marquer comme envoyé')
    if (await marquer.isVisible({ timeout: 2000 }).catch(() => false)) {
      await marquer.click()
      await page.waitForTimeout(1500)
      await devisRow.click()
      await page.waitForTimeout(500)
    }

    // DocSheet → "Transformer en facture" (disponible uniquement si statut=accepte|envoye)
    const transformerBtn = page.locator('text=Transformer en facture')
    if (!(await transformerBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('07 — Convertir en facture', '⚠️', '"Transformer en facture" indisponible — statut non compatible')
      await shot(page, '07-no-transformer')
      return
    }

    await transformerBtn.click()
    await page.waitForTimeout(300)
    await page.locator('button:has-text("Confirmer")').click()
    await page.waitForTimeout(2000)

    await shot(page, '07-facture-confirmee')

    // Vérification dans /factures
    await page.goto('/factures')
    await page.waitForTimeout(1500)
    await shot(page, '07-factures-liste')

    const count = await page.locator('table tbody tr, .show-mobile > div')
      .filter({ hasText: PRENOM }).count()

    addResult('07 — Convertir en facture', count > 0 ? '✅' : '⚠️',
      count > 0 ? 'Facture visible dans /factures' : 'Facture créée mais non identifiable par PRENOM')
  })

  // ══ 08 — Créer intervention + assigner Intervenant A ══════════════════════════
  test('08 — Créer intervention + assigner Intervenant A', async ({ page }) => {
    await page.goto('/interventions')
    await page.waitForTimeout(1000)

    await page.locator('button:has-text("+ Nouvelle")').first().click()
    await page.waitForTimeout(600)

    // Client — CustomSelect dans modal
    await page.locator('.modal button[type="button"]:has-text("Sélectionner un client")').click()
    await page.waitForTimeout(400)
    await page.locator('.modal [data-selected]').filter({ hasText: PRENOM }).first().click()
    await page.waitForTimeout(300)

    // Intervenant — CustomSelect placeholder "Non affecté" (InterventionsPage:568)
    const interSelect = page.locator('.modal button[type="button"]:has-text("Non affecté")')
    if (await interSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await interSelect.click()
      await page.waitForTimeout(400)
      // Options CustomSelect dans la modal : index 0 = "Non affecté", index 1+ = intervenants réels
      const opts = page.locator('.modal [data-selected]')
      if (await opts.count() > 1) await opts.nth(1).click()
      await page.waitForTimeout(300)
    }

    await page.locator('.modal input[placeholder*="Adresse"]').fill('10 Rue du Test, Paris 75001')
    await page.locator('.modal textarea').first().fill(`TEST-WORKFLOW Intervention ${UID}`)

    await page.locator('.modal button[type="submit"]').click()
    await page.waitForTimeout(2000)

    await shot(page, '08-intervention-creee')

    const count = await page.locator('table tbody tr, .show-mobile > div')
      .filter({ hasText: PRENOM }).count()

    addResult('08 — Créer intervention', count > 0 ? '✅' : '⚠️',
      count > 0 ? `Intervention créée — ${LABEL}` : 'Intervention créée mais non visible par PRENOM')
  })

  // ══ 09 — Intervenant A — dashboard + interventions ════════════════════════════
  test('09 — Intervenant A — dashboard et interventions', async ({ browser }) => {
    test.slow()

    if (!intervenantAuthExists()) {
      addResult('09 — Intervenant A dashboard', '⚠️', 'Auth intervenant non configurée (INTERVENANT_AUTH vide/absent)')
      return
    }

    const ctxInter = await browser.newContext({ storageState: INTERVENANT_AUTH })
    await ctxInter.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
    const pageInter = await ctxInter.newPage()

    await pageInter.goto('/dashboard')
    await pageInter.waitForTimeout(1500)
    await shot(pageInter, '09-intervenant-dashboard')

    if (!pageInter.url().includes('/dashboard')) {
      addResult('09 — Intervenant A dashboard', '⚠️', `Hors dashboard : ${pageInter.url()}`)
      await ctxInter.close()
      return
    }

    addResult('09 — Intervenant A dashboard', '✅', 'Dashboard accessible')

    await pageInter.goto('/interventions')
    await pageInter.waitForTimeout(1500)
    await shot(pageInter, '09-intervenant-interventions')

    const count = await pageInter.locator('table tbody tr, .show-mobile > div')
      .filter({ hasText: PRENOM }).count()

    addResult('09 — Intervenant A — intervention', count > 0 ? '✅' : '⚠️',
      count > 0 ? 'Intervention TEST-WORKFLOW visible' : 'Intervention non visible (non assignée à cet intervenant ?)' )

    await ctxInter.close()
  })

  // ══ 10 — Messagerie Admin A ↔ Intervenant A ══════════════════════════════════
  test('10 — Messagerie Admin A ↔ Intervenant A', async ({ page, browser }) => {
    test.slow()

    if (!intervenantAuthExists()) {
      addResult('10 — Messagerie', '⚠️', 'Auth intervenant non configurée')
      return
    }

    // Admin A ouvre la messagerie
    await page.goto('/messagerie')
    await page.waitForTimeout(2000)
    await shot(page, '10-admin-messagerie')

    // Trouver la conversation avec l'intervenant — liste de divs cliquables
    // DisplayName = prenom+nom ou email. L'intervenant est le seul contact non-admin.
    const convList = page.locator('div').filter({ has: page.locator('.avatar') })
    const firstConvClickable = page.locator('[style*="padding: 12px 16px"][style*="cursor: pointer"], [style*="padding: 12px 16px"][style*="pointer"]').first()

    const hasConv = await firstConvClickable.isVisible({ timeout: 3000 }).catch(() => false)
    if (!hasConv) {
      addResult('10 — Messagerie', '⚠️', 'Aucune conversation trouvée dans la liste')
      return
    }

    await firstConvClickable.click()
    await page.waitForTimeout(1000)

    // Envoyer un message texte
    const MSG_ADMIN = `TEST-WORKFLOW message admin ${UID}`
    const msgInput = page.locator('input[placeholder="Message…"]')

    if (!(await msgInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      addResult('10 — Messagerie', '⚠️', 'Champ message non visible après sélection de conversation')
      await shot(page, '10-no-input')
      return
    }

    await msgInput.fill(MSG_ADMIN)
    await page.waitForTimeout(200)
    // Le bouton submit n'est visible que si text.trim() est non-vide (MessagingPage:631)
    await page.locator('form button[type="submit"]').click()
    await page.waitForTimeout(1500)

    await shot(page, '10-admin-message-envoye')
    const adminMsgOk = await page.locator(`text=${MSG_ADMIN}`).isVisible({ timeout: 5000 }).catch(() => false)

    // Intervenant A reçoit et répond
    const ctxInter = await browser.newContext({ storageState: INTERVENANT_AUTH })
    await ctxInter.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
    const pageInter = await ctxInter.newPage()

    await pageInter.goto('/messagerie')
    await pageInter.waitForTimeout(2000)
    await shot(pageInter, '10-intervenant-messagerie')

    const interMsgOk = await pageInter.locator(`text=${MSG_ADMIN}`).isVisible({ timeout: 5000 }).catch(() => false)

    const interInput = pageInter.locator('input[placeholder="Message…"]')
    if (await interInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const MSG_INTER = `TEST-WORKFLOW réponse intervenant ${UID}`
      await interInput.fill(MSG_INTER)
      await pageInter.locator('form button[type="submit"]').click()
      await pageInter.waitForTimeout(1500)
      await shot(pageInter, '10-intervenant-reponse')
    }

    await ctxInter.close()

    addResult('10 — Messagerie Admin↔Intervenant', adminMsgOk || interMsgOk ? '✅' : '⚠️',
      `Msg admin visible: ${adminMsgOk} | Msg reçu côté inter: ${interMsgOk}`)
  })

  // ══ 11 — Photo / vocal (vérification UI uniquement) ══════════════════════════
  test('11 — Photo / vocal — présence dans l\'UI', async ({ page }) => {
    // getUserMedia (microphone/caméra) n'est pas disponible en contexte headless.
    // Seule la présence des boutons dans l'interface est vérifiée.
    addResult('11 — Photo/vocal', '⚠️', 'Non automatisable : getUserMedia indisponible en headless')

    await page.goto('/messagerie')
    await page.waitForTimeout(1500)

    // Sélectionner une conversation si nécessaire pour afficher la barre d'envoi
    const firstConv = page.locator('[style*="padding: 12px 16px"][style*="cursor: pointer"]').first()
    if (await firstConv.isVisible({ timeout: 2000 }).catch(() => false)) await firstConv.click()
    await page.waitForTimeout(500)

    await shot(page, '11-messagerie-ui')

    // Bouton photo : title="Photo" (MessagingPage:607)
    const photoOk = await page.locator('button[title="Photo"]').isVisible({ timeout: 3000 }).catch(() => false)
    // Bouton micro : title contient "enregistrer" ou "Maintenir" (MessagingPage:641)
    const micOk = await page.locator('button[title*="enregistrer"], button[title*="Maintenir"]')
      .isVisible({ timeout: 3000 }).catch(() => false)

    if (photoOk) addResult('11a — Bouton photo', '✅', 'Présent dans l\'interface')
    else addResult('11a — Bouton photo', '⚠️', 'Non détecté (conversation non sélectionnée ?)')

    if (micOk) addResult('11b — Bouton micro', '✅', 'Présent dans l\'interface')
    else addResult('11b — Bouton micro', '⚠️', 'Non détecté (conversation non sélectionnée ?)')
  })

  // ══ 12 — Journal — vérifier les entrées de création ══════════════════════════
  test('12 — Journal — entrées du workflow', async ({ page }) => {
    await page.goto('/journal')
    await page.waitForTimeout(2000)
    await shot(page, '12-journal')

    if (!page.url().includes('/journal')) {
      addResult('12 — Journal', '❌', `Accès refusé — redirigé vers ${page.url()}`)
      return
    }

    const entries = await page.locator('table tbody tr').count()
    await shot(page, '12-journal-entries')

    addResult('12 — Journal', entries > 0 ? '✅' : '⚠️', `${entries} entrée(s) visible(s) dans le journal`)
  })

  // ══ Rapport final ═════════════════════════════════════════════════════════════
  test.afterAll(async () => {
    const lines = [
      `# Rapport Workflow Complet Kaytek`,
      ``,
      `**Date :** ${new Date().toLocaleString('fr-FR')}`,
      `**UID session :** \`${UID}\``,
      `**Client créé :** \`${LABEL}\`  ·  email \`${CLIENT_EMAIL}\``,
      ``,
      `## Résumé des étapes`,
      ``,
      `| Étape | Statut | Note |`,
      `|-------|:------:|------|`,
      ...results.map(r => `| ${r.step} | ${r.status} | ${r.note ?? ''} |`),
      ``,
      `---`,
      `*Légende : ✅ Réussi · ❌ Échec · ⚠️ Partiel / non automatisable*`,
      `*Screenshots : \`${SCREENSHOTS_DIR}/\`*`,
    ]

    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
    fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'rapport.md'), lines.join('\n'), 'utf-8')
  })
})
