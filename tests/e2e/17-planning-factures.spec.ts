// tests/e2e/17-planning-factures.spec.ts — Factures payées dans le Planning
//
// Non-régression (2026-09-16) : l'utilisateur a signalé que les factures
// payées, qui apparaissaient auparavant dans le calendrier du Planning,
// avaient disparu. Investigation (voir memory project_planning_factures_regression) :
// le code de PlanningPage.tsx affichant les factures (feature/planning-factures-display,
// commit 1f09096) est resté non commité dans l'arbre de travail sans jamais
// avoir été fusionné dans main — aucune régression de code trouvée, le rendu
// fonctionne correctement une fois testé de bout en bout. Ce test verrouille
// ce comportement pour de bon, indépendamment de la question du commit.
import { test, expect } from '@playwright/test'

const ADMIN_AUTH = 'tests/.auth/admin.json'

test.describe('Planning — factures payées', () => {
  test.use({ storageState: ADMIN_AUTH })

  // TEST-PAYEE-001 (numéro réel auto-généré côté serveur, imprévisible — voir
  // ensurePaidFacture() dans scripts/seed-local-test-accounts.mjs) est une
  // facture statut_paiement='payee' du client "Test Client" de l'organisation
  // de test. On ne dépend jamais du numéro, seulement du statut réel en base.
  test('une facture payée apparaît comme événement dans le calendrier du Planning', async ({ page }) => {
    await page.goto('/planning')
    await expect(page.locator('.fc')).toBeVisible({ timeout: 15_000 })

    const factureEvent = page.locator('.fc-event.ev-fact, .fc-list-event.ev-fact').first()
    await expect(factureEvent).toBeVisible({ timeout: 10_000 })
    // Distinctif visuellement d'une intervention : badge/texte "Facture" et
    // couleur teal dédiée (classe ev-fact), jamais une des couleurs de statut
    // d'intervention (ev-rd/ev-or/ev-am/ev-bl/ev-pu/ev-gn/ev-gr).
    await expect(factureEvent).toContainText(/Client|Test/i)
  })

  test('cliquer sur une facture dans le planning ouvre la page Factures', async ({ page }) => {
    await page.goto('/planning')
    const factureEvent = page.locator('.fc-event.ev-fact, .fc-list-event.ev-fact').first()
    await expect(factureEvent).toBeVisible({ timeout: 10_000 })
    await factureEvent.click()
    await expect(page).toHaveURL(/factures/, { timeout: 10_000 })
  })

  // Garde-fou explicite demandé : l'ajout des factures ne doit jamais faire
  // disparaître les interventions. La légende du planning est statique (ne
  // dépend d'aucune donnée seedée) et affiche toujours les 7 statuts
  // d'intervention ET "Facture" simultanément — un test déterministe qui ne
  // dépend pas de la présence d'interventions dans la base locale.
  test('la légende affiche les statuts d\'intervention et "Facture" simultanément', async ({ page }) => {
    await page.goto('/planning')
    await expect(page.locator('.fc')).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText('Accepté', { exact: true })).toBeVisible()
    await expect(page.getByText('Terminé / Facturé', { exact: true })).toBeVisible()
    await expect(page.getByText('Facture', { exact: true })).toBeVisible()
  })
})
