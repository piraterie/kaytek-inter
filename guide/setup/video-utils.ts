// guide/setup/video-utils.ts
// Utilitaires partagés entre tous les scénarios du guide.
import { mkdirSync } from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'

export const VIDEO_BASE = path.resolve('guide', 'output', 'videos')

export function videoDest(role: 'admin' | 'intervenant', slug: string): string {
  const dir = path.join(VIDEO_BASE, role)
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${slug}.webm`)
}

/** Sauvegarde la vidéo Playwright vers le chemin nommé.
 *  À appeler en DERNIER dans le test, après page.close(). */
export async function saveVideo(page: Page, dest: string): Promise<void> {
  try {
    await page.video()?.saveAs(dest)
    console.log(`  🎬 Vidéo sauvegardée : ${dest}`)
  } catch (e: any) {
    console.warn(`  ⚠ Impossible de sauvegarder la vidéo : ${e.message}`)
  }
}

/** Pause visuelle entre deux étapes (rend les vidéos lisibles). */
export async function pause(page: Page, ms = 800): Promise<void> {
  await page.waitForTimeout(ms)
}

/** Navigation vers une page avec attente du chargement. */
export async function nav(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await pause(page, 600)
}

/** Clic visible : survol → pause → clic → pause. */
export async function click(
  locator: Awaited<ReturnType<Page['locator']>>,
  waitMs = 600
): Promise<void> {
  await locator.hover()
  await locator.page().waitForTimeout(300)
  await locator.click()
  await locator.page().waitForTimeout(waitMs)
}

/** Remplit un champ de saisie caractère par caractère pour la lisibilité. */
export async function fill(
  locator: Awaited<ReturnType<Page['locator']>>,
  value: string,
  delayMs = 60
): Promise<void> {
  await locator.click()
  await locator.fill('')
  await locator.pressSequentially(value, { delay: delayMs })
  await locator.page().waitForTimeout(400)
}

/** Défile vers un élément pour s'assurer qu'il est visible à l'écran. */
export async function scrollTo(
  locator: Awaited<ReturnType<Page['locator']>>
): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  await locator.page().waitForTimeout(300)
}
