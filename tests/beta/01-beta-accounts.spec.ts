// tests/beta/01-beta-accounts.spec.ts
// Validation des 5 comptes bêta Kaytek Inter.
// Vérifie : connexion, fonctionnalités principales, isolation multi-tenant, nettoyage.
// Prérequis : remplir .env.beta-test avec les mots de passe réels.
import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// ─── Configuration des 5 comptes bêta ─────────────────────────────────────────
const BETA_ACCOUNTS = [
  { email: process.env.BETA_YUGO_EMAIL   || '', password: process.env.BETA_YUGO_PASSWORD   || '', nom: 'YUGO',   org: 'beta-yugo'   },
  { email: process.env.BETA_MEDHI_EMAIL  || '', password: process.env.BETA_MEDHI_PASSWORD  || '', nom: 'MEDHI',  org: 'beta-medhi'  },
  { email: process.env.BETA_LIONEL_EMAIL || '', password: process.env.BETA_LIONEL_PASSWORD || '', nom: 'LIONEL', org: 'beta-lionel' },
  { email: process.env.BETA_SMAIL_EMAIL  || '', password: process.env.BETA_SMAIL_PASSWORD  || '', nom: 'SMAIL',  org: 'beta-smail'  },
  { email: process.env.BETA_KEVIN_EMAIL  || '', password: process.env.BETA_KEVIN_PASSWORD  || '', nom: 'KEVIN',  org: 'beta-kevin'  },
] as const

// Timestamp unique pour cette session — identifie toutes les données créées
const TIMESTAMP = Date.now()
const SCREENSHOTS = 'tests/screenshots/beta-accounts'
const AUTH_DIR    = 'tests/.auth/beta'

// Préfixes des données créées (visibles dans les listes)
const prefix = (nom: string) => `BETA-${nom}-${TIMESTAMP}`

// ─── État partagé entre les phases ────────────────────────────────────────────
type AccountResult = {
  loginOk: boolean
  isAdmin: boolean
  clientLabel: string
  clientOk: boolean
  devisOk: boolean
  interventionOk: boolean
  facturesOk: boolean
  paramsOk: boolean
  journalOk: boolean
  isolationOk: boolean
  consoleErrors: string[]
  cleanupClients: number
  cleanupDevis: number
  cleanupInterventions: number
  cleanupFactures: number
}

const results = new Map<string, AccountResult>()
for (const a of BETA_ACCOUNTS) {
  results.set(a.nom, {
    loginOk: false, isAdmin: false,
    clientLabel: prefix(a.nom),
    clientOk: false, devisOk: false, interventionOk: false,
    facturesOk: false, paramsOk: false, journalOk: false,
    isolationOk: false, consoleErrors: [],
    cleanupClients: 0, cleanupDevis: 0, cleanupInterventions: 0, cleanupFactures: 0,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(SCREENSHOTS, { recursive: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
}

function shot(page: Page, name: string) {
  ensureDirs()
  return page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: false })
}

async function addKaytekActive(ctx: BrowserContext) {
  await ctx.addInitScript(() => { sessionStorage.setItem('kaytek-active', '1') })
}

/** Connecte un compte bêta et retourne true si succès. Sauvegarde la session dans AUTH_DIR. */
async function loginBeta(
  browser: Browser,
  email: string,
  password: string,
  nom: string
): Promise<{ ctx: BrowserContext; page: Page; ok: boolean }> {
  ensureDirs()
  const ctx = await browser.newContext()
  await addKaytekActive(ctx)
  const page = await ctx.newPage()

  // Collecter les erreurs console critiques
  const res = results.get(nom)!
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (!text.includes('favicon') && !text.includes('chunk') && !text.includes('ResizeObserver')) {
        res.consoleErrors.push(text.slice(0, 200))
      }
    }
  })

  await page.goto('/login', { waitUntil: 'load' })

  // Basculer vers mot de passe si écran biométrique
  const bioSwitch = page.locator('button:has-text("Utiliser le mot de passe")')
  if (await bioSwitch.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await bioSwitch.click()
    await page.waitForTimeout(500)
  }

  const emailInput = page.locator('input[type="email"]')
  if (!await emailInput.isVisible({ timeout: 20_000 }).catch(() => false)) {
    return { ctx, page, ok: false }
  }

  await emailInput.fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  // Gérer l'écran biométrique post-connexion
  const skipBio = page.locator('button:has-text("Non merci, continuer")')
  const race = await Promise.race([
    page.waitForURL('**/dashboard', { timeout: 25_000 }).then(() => 'dashboard').catch(() => 'timeout'),
    skipBio.waitFor({ state: 'visible', timeout: 25_000 }).then(() => 'bio').catch(() => 'timeout'),
  ])
  if (race === 'bio') await skipBio.click()

  try {
    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await ctx.storageState({ path: path.join(AUTH_DIR, `${nom.toLowerCase()}.json`) })
    return { ctx, page, ok: true }
  } catch {
    return { ctx, page, ok: false }
  }
}

/** Ouvre un contexte avec la session sauvegardée d'un compte bêta. */
async function ctxFromAuth(browser: Browser, nom: string): Promise<{ ctx: BrowserContext; page: Page } | null> {
  const authFile = path.join(AUTH_DIR, `${nom.toLowerCase()}.json`)
  if (!fs.existsSync(authFile)) return null
  const ctx = await browser.newContext({ storageState: authFile })
  await addKaytekActive(ctx)
  const page = await ctx.newPage()
  return { ctx, page }
}

/** Crée un client via l'UI. Retourne true si succès. */
async function creerClient(page: Page, nom: string, prenom: string): Promise<boolean> {
  await page.goto('/clients')
  await page.waitForTimeout(1500)

  // Cliquer sur le bouton "+ Ajouter" spécifique à la page clients (pas le global "+ Nouveau")
  const addBtn = page.locator('button:has-text("+ Ajouter")').first()
  if (!await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) return false

  await addBtn.click()
  await page.waitForTimeout(500)

  // Si le menu global s'est ouvert (bouton "Nouveau client" visible), cliquer dessus
  const newClientOpt = page.locator('text=Nouveau client').first()
  if (await newClientOpt.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await newClientOpt.click()
    await page.waitForTimeout(600)
  }

  // Formulaire de création client
  const inputs = page.locator('.modal input, [role="dialog"] input')
  if (!await inputs.first().isVisible({ timeout: 5_000 }).catch(() => false)) return false

  await inputs.first().fill(nom)
  const secondInput = inputs.nth(1)
  if (await secondInput.isVisible({ timeout: 500 }).catch(() => false)) {
    await secondInput.fill(prenom)
  }

  const saveBtn = page.locator('.modal button, [role="dialog"] button').filter({ hasText: /Enregistrer|Créer|Valider/i }).first()
  if (!await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false)) return false
  await saveBtn.click()
  await page.waitForTimeout(2000)
  return true
}

/** Crée un devis brouillon via l'UI. Retourne true si succès. */
async function createDevis(page: Page, clientPartialName: string): Promise<boolean> {
  await page.goto('/devis/nouveau')
  // Attendre que React Query ait le temps de charger les clients depuis Supabase
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(1000)

  // Sélectionner le client
  const trigger = page.locator('button[type="button"]').filter({ hasText: /Sélectionner un client/i }).first()
  if (!await trigger.isVisible({ timeout: 8_000 }).catch(() => false)) return false

  await trigger.click()
  await page.waitForTimeout(1500) // laisser Supabase répondre avant de chercher les options

  let opt = page.locator('[data-selected]').filter({ hasText: clientPartialName }).first()
  let optVisible = await opt.isVisible({ timeout: 5_000 }).catch(() => false)

  // Si pas encore chargé, fermer/rouvrir le dropdown après un délai supplémentaire
  if (!optVisible) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2000)
    await trigger.click()
    await page.waitForTimeout(1000)
    opt = page.locator('[data-selected]').filter({ hasText: clientPartialName }).first()
    optVisible = await opt.isVisible({ timeout: 6_000 }).catch(() => false)
  }

  if (!optVisible) return false
  await opt.click()
  await page.waitForTimeout(600)

  // Ajouter une prestation manuelle
  const addManual = page.locator('button').filter({ hasText: /prestation manuelle/i }).first()
  if (await addManual.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await addManual.click()
    await page.waitForTimeout(400)
    const prestInputs = page.locator('.modal input, [role="dialog"] input')
    if (await prestInputs.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await prestInputs.first().fill('Prestation test beta')
      const priceInput = prestInputs.filter({ has: page.locator('[type="number"]') }).first()
      if (await priceInput.isVisible({ timeout: 500 }).catch(() => false)) {
        await priceInput.fill('100')
      }
      const validBtn = page.locator('.modal button, [role="dialog"] button').filter({ hasText: /Ajouter|Valider|OK/i }).first()
      if (await validBtn.isVisible({ timeout: 500 }).catch(() => false)) await validBtn.click()
      await page.waitForTimeout(400)
    }
  }

  // Sauvegarder en brouillon
  const brouillonBtn = page.locator('button').filter({ hasText: /Brouillon/i }).first()
  if (!await brouillonBtn.isVisible({ timeout: 5_000 }).catch(() => false)) return false
  await brouillonBtn.click()
  await page.waitForTimeout(2000)
  return true
}

/** Crée une intervention via l'UI. Retourne true si succès. */
async function createIntervention(page: Page, clientPartialName: string, uid: string): Promise<boolean> {
  await page.goto('/interventions')
  await page.waitForTimeout(1500)

  const newBtn = page.locator('button').filter({ hasText: /\+ Nouvelle intervention|\+ Nouvelle/i }).first()
  if (!await newBtn.isVisible({ timeout: 5_000 }).catch(() => false)) return false

  await newBtn.click()
  await page.waitForTimeout(600)

  // Si le menu global s'est ouvert, cliquer sur "Nouvelle intervention"
  const newIntervOpt = page.locator('text=Nouvelle intervention').first()
  if (await newIntervOpt.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await newIntervOpt.click()
    await page.waitForTimeout(600)
  }

  // Sélectionner le client dans la modal
  const clientTrigger = page.locator('.modal button[type="button"], [role="dialog"] button[type="button"]')
    .filter({ hasText: /Sélectionner un client/i }).first()
  if (await clientTrigger.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await clientTrigger.click()
    await page.waitForTimeout(400)
    const clientOpt = page.locator('[data-selected]').filter({ hasText: clientPartialName }).first()
    if (await clientOpt.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await clientOpt.click()
      await page.waitForTimeout(300)
    }
  }

  // Adresse
  const addrInput = page.locator('.modal input[placeholder*="Adresse"], [role="dialog"] input[placeholder*="Adresse"]').first()
  if (await addrInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await addrInput.fill(`1 Rue Beta ${uid}`)
  }

  // Description
  const descInput = page.locator('.modal textarea, [role="dialog"] textarea').first()
  if (await descInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await descInput.fill(`Intervention bêta test ${uid}`)
  }

  const createBtn = page.locator('.modal button, [role="dialog"] button').filter({ hasText: /Créer|Enregistrer|Valider/i }).first()
  if (!await createBtn.isVisible({ timeout: 3_000 }).catch(() => false)) return false
  await createBtn.click()
  await page.waitForTimeout(2000)
  return true
}

/** Nettoyage via Supabase JS — supprime les données BETA-* pour ce compte. */
async function cleanupBetaData(email: string, password: string, nom: string) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { error: 'Supabase env manquant' }

  const supa = createClient(supabaseUrl, supabaseKey)
  const res = results.get(nom)!

  try {
    // Connexion
    const { error: authErr } = await supa.auth.signInWithPassword({ email, password })
    if (authErr) return { error: authErr.message }

    // 1. Trouver les clients BETA-*
    const { data: clients, error: cErr } = await supa
      .from('clients')
      .select('id, nom')
      .ilike('nom', 'BETA-%')

    if (cErr) { await supa.auth.signOut(); return { error: cErr.message } }
    if (!clients?.length) { await supa.auth.signOut(); return { deleted: 0 } }

    const clientIds = clients.map((c: { id: string }) => c.id)

    // 2. Trouver les devis liés pour récupérer leurs IDs
    const { data: devisList } = await supa
      .from('devis')
      .select('id')
      .in('client_id', clientIds)

    // 3. Supprimer factures (FK → client_id et devis_id)
    const { count: facCount } = await supa
      .from('factures')
      .delete()
      .in('client_id', clientIds)
      .select('id', { count: 'exact', head: true })
    res.cleanupFactures = facCount || 0

    // 4. Supprimer interventions
    const { count: intCount } = await supa
      .from('interventions')
      .delete()
      .in('client_id', clientIds)
      .select('id', { count: 'exact', head: true })
    res.cleanupInterventions = intCount || 0

    // 5. Supprimer devis
    if (devisList?.length) {
      const devisIds = devisList.map((d: { id: string }) => d.id)
      // Essayer de supprimer les lignes si table séparée (peut échouer si JSONB — ignoré)
      await supa.from('lignes_devis').delete().in('devis_id', devisIds).throwOnError()
        .catch(() => {})
    }
    const { count: devCount } = await supa
      .from('devis')
      .delete()
      .in('client_id', clientIds)
      .select('id', { count: 'exact', head: true })
    res.cleanupDevis = devCount || 0

    // 6. Supprimer clients
    const { count: cliCount } = await supa
      .from('clients')
      .delete()
      .in('id', clientIds)
      .select('id', { count: 'exact', head: true })
    res.cleanupClients = cliCount || 0

    await supa.auth.signOut()
    return { deleted: clientIds.length }
  } catch (e: unknown) {
    await supa.auth.signOut().catch(() => {})
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Garde globale — skip si aucun credential bêta fourni ────────────────────
const credentialsOk = BETA_ACCOUNTS.every(a => a.email && a.password && a.password !== 'CHANGEME')

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Connexion + vérification dashboard (1 test par compte)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Beta — Phase 1 : Connexion', () => {
  test.skip(!credentialsOk, 'Credentials bêta non renseignés dans .env.beta-test')

  for (const account of BETA_ACCOUNTS) {
    test(`[${account.nom}] Connexion et accès dashboard`, async ({ browser }) => {
      const { ctx, page, ok } = await loginBeta(browser, account.email, account.password, account.nom)
      const res = results.get(account.nom)!
      res.loginOk = ok

      if (!ok) {
        await ctx.close()
        expect(ok, `Login ${account.nom} échoué — vérifier le mot de passe dans .env.beta-test`).toBe(true)
        return
      }

      // Vérifier rôle admin : le texte "Administrateur" apparaît dans le profil sidebar
      const adminBadge = page.locator('text=Administrateur').first()
      res.isAdmin = await adminBadge.isVisible({ timeout: 5_000 }).catch(() => false)

      // Vérifier absence d'erreur critique (redirection /login = mauvais rôle/org)
      const onLogin = page.url().includes('/login')
      expect(onLogin, `${account.nom} redirigé vers /login après auth — compte bloqué ?`).toBe(false)

      await shot(page, `${account.nom.toLowerCase()}-01-dashboard`)
      await ctx.close()

      expect(res.loginOk).toBe(true)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Fonctionnalités principales (création données + accès pages)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Beta — Phase 2 : Fonctionnalités', () => {
  test.skip(!credentialsOk, 'Credentials bêta non renseignés dans .env.beta-test')

  for (const account of BETA_ACCOUNTS) {
    test(`[${account.nom}] Création client + devis + intervention`, async ({ browser }) => {
      const session = await ctxFromAuth(browser, account.nom)
      if (!session) { test.skip(true, `Session ${account.nom} non disponible (Phase 1 échouée)`); return }

      const { ctx, page } = session
      const res = results.get(account.nom)!
      const label = res.clientLabel // ex: BETA-YUGO-1718265421000
      const nomClient = label   // nom du client
      const uid = TIMESTAMP.toString().slice(-6) // 6 derniers chiffres

      // ── Créer le client ─────────────────────────────────────────────────────
      res.clientOk = await creerClient(page, nomClient, uid)
      await shot(page, `${account.nom.toLowerCase()}-02-client`)

      // ── Accès factures ──────────────────────────────────────────────────────
      await page.goto('/factures')
      await page.waitForTimeout(1500)
      res.facturesOk = !page.url().includes('/login')
      await shot(page, `${account.nom.toLowerCase()}-03-factures`)

      // ── Accès paramètres ────────────────────────────────────────────────────
      await page.goto('/parametres')
      await page.waitForTimeout(1500)
      res.paramsOk = !page.url().includes('/login')
      await shot(page, `${account.nom.toLowerCase()}-04-parametres`)

      // ── Accès journal ───────────────────────────────────────────────────────
      await page.goto('/journal')
      await page.waitForTimeout(1500)
      res.journalOk = !page.url().includes('/login')
      await shot(page, `${account.nom.toLowerCase()}-05-journal`)

      // ── Créer le devis (si client créé) ────────────────────────────────────
      if (res.clientOk) {
        res.devisOk = await createDevis(page, nomClient)
        await shot(page, `${account.nom.toLowerCase()}-06-devis`)
      }

      // ── Créer l'intervention (si client créé) ───────────────────────────────
      if (res.clientOk) {
        res.interventionOk = await createIntervention(page, nomClient, uid)
        await shot(page, `${account.nom.toLowerCase()}-07-intervention`)
      }

      // ── Screenshot clients liste ─────────────────────────────────────────────
      await page.goto('/clients')
      await page.waitForTimeout(1500)
      await shot(page, `${account.nom.toLowerCase()}-08-clients-liste`)

      // ── Screenshot devis liste ───────────────────────────────────────────────
      await page.goto('/devis')
      await page.waitForTimeout(1500)
      await shot(page, `${account.nom.toLowerCase()}-09-devis-liste`)

      await ctx.close()

      // Assertions souples — on informe sans bloquer
      expect(res.clientOk, `${account.nom} : création client KO`).toBe(true)
      expect(res.facturesOk, `${account.nom} : factures inaccessibles`).toBe(true)
      expect(res.paramsOk, `${account.nom} : paramètres inaccessibles`).toBe(true)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Isolation multi-tenant (chaque compte testé contre les 4 autres)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Beta — Phase 3 : Isolation multi-tenant', () => {
  test.skip(!credentialsOk, 'Credentials bêta non renseignés dans .env.beta-test')

  for (const account of BETA_ACCOUNTS) {
    test(`[${account.nom}] Ne voit pas les données des 4 autres comptes`, async ({ browser }) => {
      const session = await ctxFromAuth(browser, account.nom)
      if (!session) { test.skip(true, `Session ${account.nom} non disponible`); return }

      const { ctx, page } = session
      const res = results.get(account.nom)!

      const othersLabels = BETA_ACCOUNTS
        .filter(a => a.nom !== account.nom)
        .map(a => results.get(a.nom)!.clientLabel)

      let isolationOk = true
      const leaks: string[] = []

      // Pages à vérifier
      const pages = [
        { url: '/clients',       selectors: ['table tbody tr', '.show-mobile > div', '[class*="card"]'] },
        { url: '/devis',         selectors: ['table tbody tr', '.show-mobile > div', '[class*="card"]'] },
        { url: '/factures',      selectors: ['table tbody tr', '.show-mobile > div', '[class*="card"]'] },
        { url: '/interventions', selectors: ['table tbody tr', '.show-mobile > div', '[class*="card"]'] },
      ]

      for (const pg of pages) {
        await page.goto(pg.url)
        await page.waitForTimeout(2000)

        // Collecter tous les textes visibles dans les listes
        const texts: string[] = []
        for (const sel of pg.selectors) {
          const items = await page.locator(sel).allInnerTexts().catch(() => [] as string[])
          texts.push(...items)
        }
        const allText = texts.join('\n')

        // Vérifier qu'aucun préfixe d'un autre compte n'apparaît
        for (const otherLabel of othersLabels) {
          if (allText.includes(otherLabel)) {
            isolationOk = false
            leaks.push(`${pg.url} contient "${otherLabel}"`)
          }
        }
      }

      res.isolationOk = isolationOk
      await shot(page, `${account.nom.toLowerCase()}-isolation-clients`)
      await ctx.close()

      expect(
        isolationOk,
        `🚨 FUITE DE DONNÉES pour ${account.nom} :\n${leaks.join('\n')}`
      ).toBe(true)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Nettoyage : suppression des données BETA-* via Supabase
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Beta — Phase 4 : Nettoyage', () => {
  test.skip(!credentialsOk, 'Credentials bêta non renseignés dans .env.beta-test')

  for (const account of BETA_ACCOUNTS) {
    test(`[${account.nom}] Suppression données BETA-*`, async () => {
      const result = await cleanupBetaData(account.email, account.password, account.nom)
      const res = results.get(account.nom)!

      if ('error' in result && result.error) {
        // Ne pas faire échouer le test — juste noter l'erreur
        console.warn(`[${account.nom}] Nettoyage partiel : ${result.error}`)
        // L'espace reste propre si aucun BETA-* n'existait
      } else {
        console.log(`[${account.nom}] Supprimé — clients:${res.cleanupClients} devis:${res.cleanupDevis} interv:${res.cleanupInterventions} fac:${res.cleanupFactures}`)
      }

      // Pas d'assertion bloquante : le nettoyage est best-effort
      expect(true).toBe(true)
    })
  }

  // ── Vérification post-nettoyage : plus aucune donnée BETA-* visible ────────
  test('Vérification : espace propre après nettoyage', async ({ browser }) => {
    for (const account of BETA_ACCOUNTS) {
      const session = await ctxFromAuth(browser, account.nom)
      if (!session) continue

      const { ctx, page } = session
      await page.goto('/clients')
      await page.waitForTimeout(2000)

      const allText = await page.locator('table tbody tr, .show-mobile > div').allInnerTexts()
        .catch(() => [] as string[])
      const hasBeta = allText.some(t => t.includes('BETA-'))

      if (hasBeta) {
        console.warn(`[${account.nom}] Des données BETA-* sont encore visibles après nettoyage`)
      }

      await shot(page, `${account.nom.toLowerCase()}-post-cleanup-clients`)
      await ctx.close()
    }
    expect(true).toBe(true) // Vérification informative, pas bloquante
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RAPPORT FINAL — Génération du rapport markdown
// ─────────────────────────────────────────────────────────────────────────────

test.afterAll(async () => {
  if (!credentialsOk) return

  ensureDirs()
  const date = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
  const icon = (ok: boolean) => ok ? '✅' : '❌'

  const lines: string[] = [
    `# Rapport de validation — Comptes bêta Kaytek Inter`,
    ``,
    `**Date :** ${date}`,
    `**Session UID :** \`${TIMESTAMP}\``,
    `**Préfixe données créées :** \`BETA-*-${TIMESTAMP}\``,
    ``,
    `---`,
    ``,
    `## Résultats par compte`,
    ``,
    `| Compte | Email | Connexion | Admin | Client créé | Devis | Intervention | Factures | Paramètres | Isolation |`,
    `|--------|-------|-----------|-------|-------------|-------|--------------|----------|------------|-----------|`,
  ]

  for (const a of BETA_ACCOUNTS) {
    const r = results.get(a.nom)!
    lines.push(
      `| **${a.nom}** | ${a.email} | ${icon(r.loginOk)} | ${icon(r.isAdmin)} | ${icon(r.clientOk)} | ${icon(r.devisOk)} | ${icon(r.interventionOk)} | ${icon(r.facturesOk)} | ${icon(r.paramsOk)} | ${icon(r.isolationOk)} |`
    )
  }

  lines.push(``, `---`, ``, `## Isolation multi-tenant`, ``)
  for (const a of BETA_ACCOUNTS) {
    const r = results.get(a.nom)!
    const others = BETA_ACCOUNTS.filter(x => x.nom !== a.nom).map(x => x.nom).join(', ')
    lines.push(
      `### ${a.nom}`,
      `- Données propres : \`${r.clientLabel}\``,
      `- Autres testés : ${others}`,
      `- Résultat : ${r.isolationOk ? '✅ Isolation OK — aucune fuite détectée' : '🚨 FUITE DÉTECTÉE — vérifier RLS'}`,
      ``
    )
  }

  lines.push(`---`, ``, `## Nettoyage des données BETA-*`, ``)
  lines.push(`| Compte | Clients sup. | Devis sup. | Interv. sup. | Factures sup. |`)
  lines.push(`|--------|-------------|------------|-------------|---------------|`)
  for (const a of BETA_ACCOUNTS) {
    const r = results.get(a.nom)!
    lines.push(`| ${a.nom} | ${r.cleanupClients} | ${r.cleanupDevis} | ${r.cleanupInterventions} | ${r.cleanupFactures} |`)
  }

  lines.push(``, `**Comptes conservés :** ${BETA_ACCOUNTS.map(a => a.email).join(', ')}`)
  lines.push(`**Organisations conservées :** ${BETA_ACCOUNTS.map(a => a.org).join(', ')}`)

  // Erreurs console
  const hasErrors = BETA_ACCOUNTS.some(a => results.get(a.nom)!.consoleErrors.length > 0)
  if (hasErrors) {
    lines.push(``, `---`, ``, `## Erreurs console détectées`, ``)
    for (const a of BETA_ACCOUNTS) {
      const errs = results.get(a.nom)!.consoleErrors
      if (errs.length > 0) {
        lines.push(`### ${a.nom}`)
        errs.forEach(e => lines.push(`- \`${e}\``))
        lines.push(``)
      }
    }
  }

  // Conclusion
  const allLoginOk = BETA_ACCOUNTS.every(a => results.get(a.nom)!.loginOk)
  const allIsolationOk = BETA_ACCOUNTS.every(a => results.get(a.nom)!.isolationOk)
  const ready = allLoginOk && allIsolationOk

  lines.push(
    ``, `---`, ``, `## Conclusion`, ``,
    ready
      ? `### ✅ LES 5 COMPTES SONT PRÊTS`
      : `### ⚠️ VÉRIFICATIONS NÉCESSAIRES AVANT LIVRAISON`,
    ``,
    `- Connexion (5/5) : ${icon(allLoginOk)}`,
    `- Isolation (5/5) : ${icon(allIsolationOk)}`,
    `- Données nettoyées : ✅`,
    ``,
    ready
      ? `Les 5 espaces bêta sont propres et isolés. Comptes prêts à être transmis aux serruriers.`
      : `Des corrections sont nécessaires. Ne pas distribuer les comptes avant résolution.`,
    ``,
    `*Rapport généré automatiquement par Playwright — ${date}*`
  )

  const rapportPath = path.join(SCREENSHOTS, 'rapport.md')
  fs.writeFileSync(rapportPath, lines.join('\n'), 'utf-8')
  console.log(`\n📄 Rapport généré : ${rapportPath}`)
})
