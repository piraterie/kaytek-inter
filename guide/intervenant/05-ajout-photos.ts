// guide/intervenant/05-ajout-photos.ts — Ajouter des photos
import { test } from '../setup/guide-test'
import { GUIDE_INTERVENANT_AUTH } from '../setup/auth-paths'
import { videoDest, saveVideo, pause, nav, click, scrollTo } from '../setup/video-utils'
import { injectVisualLayer, showTitle, showConclusion, showStep, showTip, hideTip, vClick, highlightEl } from '../setup/visual-effects'
import path from 'path'
import { writeFileSync, mkdirSync } from 'fs'

const SLUG = '05-ajout-photos'
test.use({ storageState: GUIDE_INTERVENANT_AUTH })

function createDemoPhoto(dest: string): string {
  mkdirSync(path.dirname(dest), { recursive: true })
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000' +
    'a49444154789c6260000000020001e221bc330000000049454e44ae426082', 'hex'
  )
  writeFileSync(dest, png)
  return dest
}

test('guide intervenant — ajouter des photos', async ({ page }) => {
  const demoPhoto = createDemoPhoto(path.resolve('guide', 'setup', 'demo-photo.png'))

  await nav(page, '/interventions')
  await injectVisualLayer(page)
  await showTitle(page, 'Ajouter des photos', 'Guide Intervenant')

  // ── Étape 1 : Ouvrir l'intervention ──────────────────────────────────────
  await showStep(page, 'Étape 1 / 3')
  const firstInter = page.locator('tbody tr').first()
  await firstInter.waitFor({ state: 'visible', timeout: 10_000 })
  await vClick(page, firstInter, '🔧 Ouvrez l\'intervention', 1200)

  await page.waitForURL(/interventions\/[\w-]+/, { timeout: 15_000 }).catch(() => {})
  await pause(page, 800)
  await injectVisualLayer(page)

  // ── Étape 2 : Trouver la section photos ──────────────────────────────────
  await showStep(page, 'Étape 2 / 3')
  const photosSection = page.locator('text=Photos, [class*="photo"], [class*="Photos"]').first()
  if (await photosSection.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollTo(photosSection)
    await highlightEl(page, photosSection)
    await showTip(page, '📸 Section photos avant / après l\'intervention')
    await pause(page, 1200)
    await hideTip(page)
  } else {
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }))
    await showTip(page, '📸 Faites défiler pour accéder aux photos')
    await pause(page, 1000)
    await hideTip(page)
  }

  // ── Étape 3 : Ajouter une photo ──────────────────────────────────────────
  await showStep(page, 'Étape 3 / 3')
  const addPhotoBtn = page.locator(
    'button:has-text("Photo"), button:has-text("Ajouter une photo"), ' +
    'button[aria-label*="photo"], input[type="file"]'
  ).first()

  if (await addPhotoBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    const fileInput = page.locator('input[type="file"]').first()
    if (await fileInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await showTip(page, '📷 Sélectionnez une photo')
      await fileInput.setInputFiles(demoPhoto)
    } else {
      await vClick(page, addPhotoBtn, '📷 Ajoutez une photo', 500)
      const [fileChooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 8_000 }).catch(() => null),
      ])
      if (fileChooser) {
        await fileChooser.setFiles(demoPhoto)
      }
    }
    await pause(page, 2000)
    await hideTip(page)
  }

  await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }))
  await pause(page, 1500)
  await showConclusion(page, 'Photo ajoutée avec succès.')

  await page.close()
  await saveVideo(page, videoDest('intervenant', SLUG))
})
