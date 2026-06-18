// guide/intervenant/00-visite-complete.ts — Visite complète Intervenant
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showTip, hideTip, showStep, vClick } from '../setup/visual-effects'

const SLUG = '00-visite-complete'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

async function navPage(page: any, url: string, step: string, tip: string) {
  await nav(page, url)
  await injectVisualLayer(page)
  await showStep(page, step)
  await showTip(page, tip)
  await pause(page, 1300)
  await hideTip(page)
  await pause(page, 200)
}

test('guide intervenant — visite complète', async ({ page }) => {
  // ── Dashboard ────────────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  await showTitle(page, 'Visite complète', 'Guide Intervenant — Kaytek Inter')
  await showStep(page, '1 / 7 — Tableau de bord')
  await showTip(page, '🏠 Résumé de votre activité')
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }))
  await pause(page, 1200)
  await hideTip(page)

  // ── Interventions + détail ────────────────────────────────────────────────
  await navPage(page, '/interventions', '2 / 7 — Interventions', '🔧 Liste de vos interventions')
  const firstInter = page.locator('tbody tr').first()
  if (await firstInter.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await vClick(page, firstInter, '🔍 Consultez le détail', 800)
    await page.waitForURL(/interventions\/[\w-]+/, { timeout: 10_000 }).catch(() => {})
    await pause(page, 800)
    await injectVisualLayer(page)
    await showStep(page, '2 / 7 — Détail intervention')
    await showTip(page, '📋 Informations client, adresse et statuts')
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }))
    await pause(page, 1200)
    await hideTip(page)
    await page.goBack()
    await pause(page, 500)
  }

  // ── Planning ─────────────────────────────────────────────────────────────
  await navPage(page, '/planning',      '3 / 7 — Planning',      '📅 Vos interventions planifiées')

  // ── Messagerie ───────────────────────────────────────────────────────────
  await navPage(page, '/messagerie',    '4 / 7 — Messagerie',    '💬 Discussions avec votre responsable')

  // ── Commissions ──────────────────────────────────────────────────────────
  await navPage(page, '/commissions',   '5 / 7 — Commissions',   '💰 Suivi de vos rémunérations')

  // ── Devis (si droits) ────────────────────────────────────────────────────
  await navPage(page, '/devis',         '6 / 7 — Devis',         '📄 Devis des interventions')

  // ── Retour dashboard ─────────────────────────────────────────────────────
  await nav(page, '/dashboard')
  await injectVisualLayer(page)
  await showStep(page, '7 / 7 — Tableau de bord')
  await showTip(page, '🏠 Retour au tableau de bord')
  await pause(page, 1200)
  await hideTip(page)
  await pause(page, 500)
  await showConclusion(page, 'Visite complète terminée.', 'Toutes vos fonctionnalités en un regard.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
