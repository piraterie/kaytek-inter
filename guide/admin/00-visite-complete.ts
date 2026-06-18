// guide/admin/00-visite-complete.ts — Visite complète Admin
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showTip, hideTip, showStep, vClick } from '../setup/visual-effects'

const SLUG = '00-visite-complete'
test.use({ storageState: GUIDE_ADMIN_AUTH })

async function navPage(page: any, url: string, step: string, tip: string, scroll = 0) {
  await nav(page, url)
  await injectVisualLayer(page)
  await showStep(page, step)
  await showTip(page, tip)
  if (scroll > 0) await page.evaluate((s: number) => window.scrollTo({ top: s, behavior: 'smooth' }), scroll)
  await pause(page, 1300)
  await hideTip(page)
  await pause(page, 200)
}

test('guide admin — visite complète', async ({ page }) => {
  // ── Dashboard ────────────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  await showTitle(page, 'Visite complète', 'Guide Admin — Kaytek Inter')
  await showStep(page, '1 / 10 — Tableau de bord')
  await showTip(page, '🏠 KPIs et résumé de votre activité')
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }))
  await pause(page, 1200)
  await hideTip(page)

  // ── Interventions + détail ────────────────────────────────────────────────
  await navPage(page, '/interventions', '2 / 10 — Interventions', '🔧 Liste des interventions')
  const firstInter = page.locator('tbody tr').first()
  if (await firstInter.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await vClick(page, firstInter, '🔍 Ouvrez le détail', 800)
    await page.waitForURL(/interventions\/[\w-]+/, { timeout: 10_000 }).catch(() => {})
    await pause(page, 800)
    await injectVisualLayer(page)
    await showStep(page, '2 / 10 — Détail intervention')
    await showTip(page, '📋 Informations complètes de l\'intervention')
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }))
    await pause(page, 1200)
    await hideTip(page)
    await page.goBack()
    await pause(page, 500)
  }

  // ── Planning ─────────────────────────────────────────────────────────────
  await navPage(page, '/planning',      '3 / 10 — Planning',      '📅 Planification des interventions')

  // ── Clients ──────────────────────────────────────────────────────────────
  await navPage(page, '/clients',       '4 / 10 — Clients',       '👥 Gestion des clients')

  // ── Devis ────────────────────────────────────────────────────────────────
  await navPage(page, '/devis',         '5 / 10 — Devis',         '📄 Création et suivi des devis')

  // ── Factures ─────────────────────────────────────────────────────────────
  await navPage(page, '/factures',      '6 / 10 — Factures',      '🧾 Facturation client')

  // ── Catalogue ────────────────────────────────────────────────────────────
  await navPage(page, '/catalogue',     '7 / 10 — Catalogue',     '📦 Prestations et tarifs')

  // ── Commissions ──────────────────────────────────────────────────────────
  await navPage(page, '/commissions',   '8 / 10 — Commissions',   '💰 Suivi des commissions')

  // ── Messagerie ───────────────────────────────────────────────────────────
  await navPage(page, '/messagerie',    '9 / 10 — Messagerie',    '💬 Échanges avec l\'équipe')

  // ── Paramètres ───────────────────────────────────────────────────────────
  await nav(page, '/parametres')
  await injectVisualLayer(page)
  await showStep(page, '10 / 10 — Paramètres')
  await showTip(page, '⚙️ Informations et configuration de l\'entreprise')
  await pause(page, 1300)
  await hideTip(page)
  await pause(page, 500)
  await showConclusion(page, 'Visite complète terminée.', 'Vous connaissez toutes les fonctionnalités.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
