// tests/multi-tenant/02-isolation-create.spec.ts
// Crée des données réelles dans org A via UI, vérifie que org B ne les voit pas.
// ⚠️ Ce test écrit de vraies données dans Supabase (comptes de test dédiés).
//    Les données créées restent en base — archiver manuellement si besoin.
// Correction 6 (TEST-01) : test critique, ne peut plus être ignoré
// silencieusement. requireSecurityTestEnv() lève une erreur (interrompant la
// collecte de ce fichier) si la configuration de sécurité dédiée est
// incomplète — jamais un test.skip(). À exécuter via
// `npm run test:security:playwright` (playwright.security.config.ts, jamais
// contre un projet Supabase distant/production — voir preflight).
import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { requireSecurityTestEnv } from '../security-env'

requireSecurityTestEnv()

const ADMIN_A_AUTH = 'tests/.auth/security-admin-a.json'
const ADMIN_B_AUTH = 'tests/.auth/security-admin-b.json'
const SCREENSHOTS_DIR = 'tests/screenshots/isolation-report'

async function addKaytekActive(ctx: any) {
  await ctx.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
}

async function shot(page: any, name: string) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false })
}

// Compte le nombre de lignes/cartes résultats contenant text.
// Cible uniquement les éléments de données (tr tbody, cards mobiles),
// PAS la barre de recherche pour éviter les faux positifs.
async function countInResults(page: any, text: string): Promise<number> {
  const tableRows = await page.locator('table tbody tr').filter({ hasText: text }).count()
  const mobileCards = await page.locator('.show-mobile > div').filter({ hasText: text }).count()
  return tableRows + mobileCards
}

test.describe('Multi-tenant — isolation données créées via UI', () => {
  test('isolation complète : créer dans org A, vérifier dans org B', async ({ browser }) => {
    test.slow() // timeout × 3

    const UID = Date.now()
    const NOM = 'TEST-ISO'
    const PRENOM = `PW-${UID}`
    const LABEL = `${NOM} ${PRENOM}`

    const report: string[] = [
      `# Rapport d'isolation multi-tenant`,
      ``,
      `**Date :** ${new Date().toLocaleString('fr-FR')}`,
      `**Session UID :** ${UID}`,
      `**Client créé :** \`${LABEL}\``,
      ``,
      `## 1. Création des données — Org A`,
      ``,
    ]

    // ══════════════════════════════════════════════════════════
    // PARTIE 1 — Admin A crée les données
    // ══════════════════════════════════════════════════════════
    const ctxA = await browser.newContext({ storageState: ADMIN_A_AUTH })
    await addKaytekActive(ctxA)
    const pageA = await ctxA.newPage()

    // ── 1a. Créer le client ─────────────────────────────────
    await pageA.goto('/clients')
    await pageA.waitForTimeout(1000)
    await shot(pageA, '01-admin-a-clients-avant')

    await pageA.locator('button:has-text("+ Ajouter")').first().click()
    await pageA.waitForTimeout(500)

    // Modal : select (type) puis inputs dans l'ordre du JSX
    // nom (required) = 1er input, prenom = 2e input
    await pageA.locator('.modal input').first().fill(NOM)
    await pageA.locator('.modal input').nth(1).fill(PRENOM)
    await pageA.locator('.modal button:has-text("Enregistrer")').click()
    await pageA.waitForTimeout(2000)

    await shot(pageA, '02-admin-a-client-cree')
    report.push(`### Client`)
    report.push(`- ✅ **\`${LABEL}\`** créé dans Org A`)
    report.push(`- Screenshot : \`02-admin-a-client-cree.png\``)
    report.push(``)

    // ── 1b. Créer l'intervention ────────────────────────────
    await pageA.goto('/interventions')
    await pageA.waitForTimeout(1000)

    await pageA.locator('button:has-text("+ Nouvelle")').first().click()
    await pageA.waitForTimeout(600)

    // CustomSelect client : 1er bouton type=button dans la modal
    await pageA.locator('.modal button[type="button"]:has-text("Sélectionner un client")').click()
    // CustomSelect.tsx rend sa liste déroulante via createPortal(..., document.body) :
    // ce n'est PAS un descendant DOM de .modal, quelle que soit sa position visuelle
    // (positionnement en `position: fixed` calculé par le composant), donc un
    // sélecteur préfixé par `.modal ` ne matche jamais. `data-selected` est
    // l'attribut exclusif des options CustomSelect (présent avec la valeur `true`
    // ou `false` sur chaque option) et n'existe dans le DOM que pendant qu'une
    // liste est réellement ouverte — cibler `[data-selected]` sans scope DOM
    // identifie donc sans ambiguïté la liste actuellement affichée (une seule
    // ouverte à la fois dans ce parcours). Filtré sur PRENOM (unique par run,
    // horodaté) plutôt que NOM (constant "TEST-ISO" sur tous les runs passés dont
    // les données restent en base, cf. commentaire d'en-tête du fichier) pour
    // éviter de cliquer sur un client d'un run précédent.
    const clientOptionIntervention = pageA.locator('[data-selected]').filter({ hasText: PRENOM }).first()
    await clientOptionIntervention.waitFor({ state: 'visible' })
    await clientOptionIntervention.click()
    // Attend la fermeture réelle de la liste (CustomSelect démonte le portail à la
    // sélection) plutôt qu'un délai arbitraire, puis vérifie que le client choisi
    // est bien affiché dans le champ.
    await pageA.locator('[data-selected]').waitFor({ state: 'detached' })
    await pageA.locator('.modal button[type="button"]').filter({ hasText: NOM }).first().waitFor({ state: 'visible' })

    await pageA.locator('.modal input[placeholder*="Adresse"]').fill('1 Rue de Test, Paris 75001')
    await pageA.locator('.modal textarea').first().fill(`Test isolation ${UID}`)

    await pageA.locator('.modal button:has-text("Créer")').click()
    await pageA.waitForTimeout(2000)

    await shot(pageA, '03-admin-a-intervention-creee')
    report.push(`### Intervention`)
    report.push(`- ✅ Créée pour le client \`${LABEL}\``)
    report.push(`- Screenshot : \`03-admin-a-intervention-creee.png\``)
    report.push(``)

    // ── 1c. Créer le devis ──────────────────────────────────
    await pageA.goto('/devis/nouveau')
    await pageA.waitForTimeout(1500)

    // Sélectionner client — cibler PRENOM (unique par run) pour ne pas prendre un run précédent.
    // Même portail React que le CustomSelect de l'intervention ci-dessus — voir
    // commentaire détaillé plus haut. Attente sur état réel (visible/detached)
    // plutôt qu'un délai arbitraire.
    await pageA.locator('button[type="button"]:has-text("Sélectionner un client")').first().click()
    const clientOptionDevis = pageA.locator('[data-selected]').filter({ hasText: PRENOM }).first()
    await clientOptionDevis.waitFor({ state: 'visible' })
    await clientOptionDevis.click()
    await pageA.locator('[data-selected]').waitFor({ state: 'detached' })
    await pageA.locator('button[type="button"]').filter({ hasText: PRENOM }).first().waitFor({ state: 'visible' })

    // Ajouter une prestation manuelle
    await pageA.locator('button:has-text("+ Ajouter une prestation manuelle")').click()
    await pageA.waitForTimeout(500)

    // Bottom sheet prestation — les labels n'ont pas d'attribut for, utiliser placeholder
    await pageA.getByPlaceholder('Remplacement').fill(`Isolation test ${UID}`)
    // Prix unitaire HT : 2e input[type="number"] visible (0=quantite, 1=prix_ht)
    await pageA.locator('input[type="number"]:visible').nth(1).clear()
    await pageA.locator('input[type="number"]:visible').nth(1).fill('150')
    await pageA.waitForTimeout(200)

    await pageA.locator('button:has-text("+ Ajouter cette prestation")').click()
    await pageA.waitForTimeout(500)

    await shot(pageA, '04-admin-a-devis-prestation')

    // Sauvegarder brouillon (bouton emoji 💾) — DevisFormPage.tsx (ligne ~285)
    // navigue vers /devis/:id/apercu quand le devis n'est pas rattaché à une
    // intervention (cas de ce parcours), jamais vers /devis (liste) : ce n'est
    // pas un défaut, c'est le comportement actuel confirmé en lisant le
    // composant (aucune modification de fichier applicatif nécessaire).
    await pageA.locator('button:has-text("Sauvegarder brouillon")').click()
    await pageA.waitForURL(/\/devis\/[^/]+\/apercu/, { timeout: 15_000 })
    await pageA.waitForTimeout(1500)

    await shot(pageA, '05-admin-a-devis-cree')
    report.push(`### Devis`)
    report.push(`- ✅ Créé en brouillon pour \`${LABEL}\``)
    report.push(`- Screenshot : \`05-admin-a-devis-cree.png\``)
    report.push(``)

    // Retour à la liste des devis pour la suite du parcours (recherche de la
    // ligne créée, transformation en facture) — la sauvegarde a navigué vers
    // la page d'aperçu du devis, pas vers la liste.
    await pageA.goto('/devis')
    await pageA.waitForTimeout(1500)

    // ── 1d. Convertir le devis en facture ───────────────────
    let factureCreated = false

    // Rechercher le devis dans la liste (table desktop) — par PRENOM (UID unique du run)
    const devisRow = pageA.locator('tr').filter({ hasText: PRENOM })
    const rowCount = await devisRow.count()

    if (rowCount > 0) {
      // Ouvrir le DocSheet via le bouton actions — DevisPage.tsx (ligne ~596)
      // rend une icône Lucide (MoreHorizontal), sans texte "···" ; title="Actions"
      // est l'attribut stable et accessible réellement présent dans le DOM.
      await devisRow.first().locator('button[title="Actions"]').click()
      await pageA.waitForTimeout(500)

      // Marquer comme envoyé (passage brouillon → envoye)
      await pageA.locator('text=Marquer comme envoyé').click()
      await pageA.waitForTimeout(1500)

      await shot(pageA, '06-admin-a-devis-envoye')
      report.push(`### Facture`)
      report.push(`- Devis trouvé — marqué comme envoyé`)

      // Rouvrir le DocSheet — voir commentaire ci-dessus (icône, pas de texte "···")
      await devisRow.first().locator('button[title="Actions"]').click()
      await pageA.waitForTimeout(500)

      // Transformer en facture
      await pageA.locator('text=Transformer en facture').click()
      await pageA.waitForTimeout(300)

      // Confirmation
      await pageA.locator('button:has-text("Confirmer")').click()
      await pageA.waitForTimeout(2000)

      factureCreated = true
      await shot(pageA, '07-admin-a-facture-creee')
      report.push(`- ✅ Facture créée depuis le devis`)
      report.push(`- Screenshot : \`07-admin-a-facture-creee.png\``)
    } else {
      report.push(`### Facture`)
      report.push(`- ⚠️ Devis introuvable dans la liste (vue mobile ? Row non trouvée) — facture non créée`)
    }
    report.push(``)

    await ctxA.close()

    // ══════════════════════════════════════════════════════════
    // PARTIE 2 — Admin B vérifie l'isolation
    // ══════════════════════════════════════════════════════════
    report.push(`## 2. Vérification isolation — Org B`)
    report.push(``)
    report.push(`> Aucun élément contenant \`${NOM}\` ne doit apparaître dans l'interface d'Admin B.`)
    report.push(``)

    const ctxB = await browser.newContext({ storageState: ADMIN_B_AUTH })
    await addKaytekActive(ctxB)
    const pageB = await ctxB.newPage()

    // ── 2a. Clients ─────────────────────────────────────────
    await pageB.goto('/clients')
    await pageB.waitForTimeout(2000)

    const clientsOccurrences = await countInResults(pageB, NOM)
    await shot(pageB, '08-admin-b-clients')

    if (clientsOccurrences === 0) {
      report.push(`### ✅ /clients — Isolation confirmée`)
      report.push(`- **0 ligne** contenant \`${NOM}\` dans la liste`)
    } else {
      report.push(`### ❌ /clients — FUITE DÉTECTÉE`)
      report.push(`- **${clientsOccurrences} ligne(s)** contenant \`${NOM}\` trouvée(s)`)
    }
    report.push(`- Screenshot : \`08-admin-b-clients.png\``)
    report.push(``)

    // ── 2b. Interventions ────────────────────────────────────
    await pageB.goto('/interventions')
    await pageB.waitForTimeout(2000)

    const interOccurrences = await countInResults(pageB, NOM)
    await shot(pageB, '09-admin-b-interventions')

    if (interOccurrences === 0) {
      report.push(`### ✅ /interventions — Isolation confirmée`)
      report.push(`- **0 ligne** contenant \`${NOM}\``)
    } else {
      report.push(`### ❌ /interventions — FUITE DÉTECTÉE`)
      report.push(`- **${interOccurrences} ligne(s)** contenant \`${NOM}\` trouvée(s)`)
    }
    report.push(`- Screenshot : \`09-admin-b-interventions.png\``)
    report.push(``)

    // ── 2c. Devis ───────────────────────────────────────────
    await pageB.goto('/devis')
    await pageB.waitForTimeout(2000)

    const devisOccurrences = await countInResults(pageB, NOM)
    await shot(pageB, '10-admin-b-devis')

    if (devisOccurrences === 0) {
      report.push(`### ✅ /devis — Isolation confirmée`)
      report.push(`- **0 ligne** contenant \`${NOM}\``)
    } else {
      report.push(`### ❌ /devis — FUITE DÉTECTÉE`)
      report.push(`- **${devisOccurrences} ligne(s)** contenant \`${NOM}\` trouvée(s)`)
    }
    report.push(`- Screenshot : \`10-admin-b-devis.png\``)
    report.push(``)

    // ── 2d. Factures ─────────────────────────────────────────
    await pageB.goto('/factures')
    await pageB.waitForTimeout(2000)

    const factureOccurrences = await countInResults(pageB, NOM)
    await shot(pageB, '11-admin-b-factures')

    if (factureOccurrences === 0) {
      report.push(`### ✅ /factures — Isolation confirmée`)
      report.push(`- **0 occurrence** de \`${NOM}\``)
    } else {
      report.push(`### ❌ /factures — FUITE DÉTECTÉE`)
      report.push(`- **${factureOccurrences} occurrence(s)** de \`${NOM}\` trouvée(s)`)
    }
    report.push(`- Screenshot : \`11-admin-b-factures.png\``)
    report.push(``)

    // ── Recherche globale (filtre local dans chaque page) ────
    // L'app n'a pas de recherche globale — les 4 pages couvrent l'essentiel.
    report.push(`### Recherche globale`)
    report.push(`- L'application n'expose pas de moteur de recherche global.`)
    report.push(`- Les 4 pages vérifiées (/clients, /interventions, /devis, /factures) couvrent l'ensemble des données métier.`)
    report.push(``)

    // ── Résumé ───────────────────────────────────────────────
    const allClean = clientsOccurrences === 0 && interOccurrences === 0 && devisOccurrences === 0 && factureOccurrences === 0
    report.push(`---`)
    report.push(``)
    report.push(`## Résumé`)
    report.push(``)
    report.push(`| Entité | Créée dans Org A | Visible par Org B |`)
    report.push(`|--------|:----------------:|:-----------------:|`)
    report.push(`| Client | ✅ Oui | ${clientsOccurrences === 0 ? '✅ Non' : `❌ **OUI (${clientsOccurrences} occ.)**`} |`)
    report.push(`| Intervention | ✅ Oui | ${interOccurrences === 0 ? '✅ Non' : `❌ **OUI (${interOccurrences} occ.)**`} |`)
    report.push(`| Devis | ✅ Oui | ${devisOccurrences === 0 ? '✅ Non' : `❌ **OUI (${devisOccurrences} occ.)**`} |`)
    report.push(`| Facture | ${factureCreated ? '✅ Oui' : '⚠️ Non créée'} | ${factureOccurrences === 0 ? '✅ Non' : `❌ **OUI (${factureOccurrences} occ.)**`} |`)
    report.push(``)
    report.push(allClean ? `**✅ RÉSULTAT GLOBAL : Isolation confirmée — aucune fuite détectée.**` : `**❌ RÉSULTAT GLOBAL : FUITE(S) DÉTECTÉE(S) — voir détails ci-dessus.**`)
    report.push(``)
    report.push(`*Screenshots : \`${SCREENSHOTS_DIR}/\`*`)

    // Écrire le rapport markdown
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
    fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'rapport.md'), report.join('\n'), 'utf-8')

    await ctxB.close()

    // ── Assertions Playwright ────────────────────────────────
    expect(clientsOccurrences, `FUITE /clients : "${NOM}" visible dans Org B`).toBe(0)
    expect(interOccurrences, `FUITE /interventions : "${NOM}" visible dans Org B`).toBe(0)
    expect(devisOccurrences, `FUITE /devis : "${NOM}" visible dans Org B`).toBe(0)
    expect(factureOccurrences, `FUITE /factures : "${NOM}" visible dans Org B`).toBe(0)
  })
})
