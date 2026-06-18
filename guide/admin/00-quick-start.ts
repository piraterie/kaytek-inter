// guide/admin/00-quick-start.ts — Démarrage rapide Admin
import { test } from '../setup/guide-test'
import { GUIDE_ADMIN_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showTip, hideTip, showStep } from '../setup/visual-effects'

const SLUG = '00-quick-start'
test.use({ storageState: GUIDE_ADMIN_AUTH })

// Injecte la couche visuelle et affiche un tooltip descriptif par page
async function navPage(page: any, url: string, step: string, tip: string) {
  await nav(page, url)
  await injectVisualLayer(page)
  await showStep(page, step)
  await showTip(page, tip)
  await pause(page, 1500)
  await hideTip(page)
  await pause(page, 300)
}

test('guide admin — démarrage rapide', async ({ page }) => {
  // ── Tableau de bord ──────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  await showTitle(page, 'Démarrage rapide', 'Guide Admin — Kaytek Inter')

  await showStep(page, '1 / 7 — Tableau de bord')
  await showTip(page, '🏠 Vue d\'ensemble de votre activité')
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }))
  await pause(page, 1200)
  await hideTip(page)

  // ── Interventions ────────────────────────────────────────────────────────
  await navPage(page, '/interventions',   '2 / 7 — Interventions',  '🔧 Gérez toutes vos interventions')

  // ── Clients ──────────────────────────────────────────────────────────────
  await navPage(page, '/clients',         '3 / 7 — Clients',        '👥 Consultez vos clients')

  // ── Devis ────────────────────────────────────────────────────────────────
  await navPage(page, '/devis',           '4 / 7 — Devis',          '📄 Créez et gérez vos devis')

  // ── Factures ─────────────────────────────────────────────────────────────
  await navPage(page, '/factures',        '5 / 7 — Factures',       '🧾 Suivez vos factures')

  // ── Utilisateurs ─────────────────────────────────────────────────────────
  await navPage(page, '/utilisateurs',    '6 / 7 — Utilisateurs',   '👤 Gérez votre équipe')

  // ── Paramètres ───────────────────────────────────────────────────────────
  await nav(page, '/parametres')
  await injectVisualLayer(page)
  await showStep(page, '7 / 7 — Paramètres')
  await showTip(page, '⚙️ Configurez votre entreprise')
  await pause(page, 1200)
  await hideTip(page)
  await pause(page, 400)
  await showConclusion(page, 'Bienvenue sur Kaytek Inter.', 'L\'application n\'a plus de secrets pour vous.')

  await page.close()
  await saveVideo(page, videoDest('admin', SLUG))
})
