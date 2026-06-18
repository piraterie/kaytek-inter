// guide/intervenant/00-quick-start.ts — Démarrage rapide Intervenant
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showTip, hideTip, showStep } from '../setup/visual-effects'

const SLUG = '00-quick-start'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

async function navPage(page: any, url: string, step: string, tip: string) {
  await nav(page, url)
  await injectVisualLayer(page)
  await showStep(page, step)
  await showTip(page, tip)
  await pause(page, 1500)
  await hideTip(page)
  await pause(page, 300)
}

test('guide intervenant — démarrage rapide', async ({ page }) => {
  // ── Tableau de bord ──────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  await showTitle(page, 'Démarrage rapide', 'Guide Intervenant — Kaytek Inter')

  await showStep(page, '1 / 5 — Tableau de bord')
  await showTip(page, '🏠 Vos interventions du jour en un coup d\'œil')
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }))
  await pause(page, 1200)
  await hideTip(page)

  // ── Interventions ────────────────────────────────────────────────────────
  await navPage(page, '/interventions', '2 / 5 — Interventions',  '🔧 Vos interventions assignées')

  // ── Planning ─────────────────────────────────────────────────────────────
  await navPage(page, '/planning',      '3 / 5 — Planning',       '📅 Votre calendrier d\'interventions')

  // ── Messagerie ───────────────────────────────────────────────────────────
  await navPage(page, '/messagerie',    '4 / 5 — Messagerie',     '💬 Échangez avec votre responsable')

  // ── Commissions ──────────────────────────────────────────────────────────
  await nav(page, '/commissions')
  await injectVisualLayer(page)
  await showStep(page, '5 / 5 — Commissions')
  await showTip(page, '💰 Suivez vos commissions et gains')
  await pause(page, 1200)
  await hideTip(page)
  await pause(page, 400)
  await showConclusion(page, 'Bienvenue sur Kaytek Inter.', 'Vous êtes prêt à démarrer.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
