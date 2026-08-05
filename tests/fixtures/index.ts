// tests/fixtures/index.ts — Fixtures partagées avec auth Supabase persistée
import { test as base, expect, type Page } from '@playwright/test'

// Chemins relatifs à la racine du projet
const ADMIN_AUTH       = 'tests/.auth/admin.json'
const INTERVENANT_AUTH = 'tests/.auth/intervenant.json'
const ADMIN_B_AUTH     = 'tests/.auth/admin-b.json'
const ASSISTANT_AUTH   = 'tests/.auth/assistant.json'

// ── Admin org A ──────────────────────────────────────────────────────────────
export const adminTest = base.extend<object>({
  storageState: ADMIN_AUTH,
})

// ── Intervenant org A ────────────────────────────────────────────────────────
export const intervenantTest = base.extend<object>({
  storageState: INTERVENANT_AUTH,
})

// ── Admin org B (multi-tenant) ───────────────────────────────────────────────
export const adminBTest = base.extend<object>({
  storageState: ADMIN_B_AUTH,
})

// ── Assistant org A (aucun accès financier — cf. SEC-01) ─────────────────────
export const assistantTest = base.extend<object>({
  storageState: ASSISTANT_AUTH,
})

// ── Non authentifié ──────────────────────────────────────────────────────────
export const anonTest = base.extend<object>({
  storageState: { cookies: [], origins: [] },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function waitForLoaded(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
}

export async function expectToast(page: Page, text: string | RegExp) {
  await page.locator(`[class*="toast"], [role="status"]`).filter({ hasText: text }).waitFor({ timeout: 10_000 })
}

export { expect }
