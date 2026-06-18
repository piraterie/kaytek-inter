// guide/setup/guide-test.ts
// Fixture Playwright qui injecte kaytek-active + supprime le WelcomeModal
// avant chaque navigation — requis quand on utilise storageState sauvegardé.
// L'app lit kaytek-active depuis sessionStorage, qui n'est PAS persisté par storageState().
import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('kaytek-active', '1')
      sessionStorage.setItem('kaytek-welcome-dismissed', '1')
    })
    await use(page)
  },
})

export { expect }
