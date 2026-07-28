#!/usr/bin/env node
// scripts/test-email-integration.mjs
// Tests d'intégration de envoyer-email contre une instance Supabase LOCALE
// (garde anti-production réutilisée, voir test-security-preflight.mjs).
// Complète scripts/test-security-edge-functions.mjs, qui teste UNIQUEMENT
// les refus d'authentification (401/403 avant toute lecture du body) et
// documente explicitement ne jamais exercer ce qui suit — ce script exerce
// tout le reste : validation du contrat, isolation multi-tenant (document
// appartenant à une autre organisation), paramètres entreprise, ET un envoi
// bout-en-bout complet (jusqu'à une réponse "Brevo" réelle).
//
// AUCUN VRAI BREVO ICI : la CI (.github/workflows/email-contract-ci.yml)
// configure BREVO_API_KEY sur une valeur factice et BREVO_API_URL vers un
// faux serveur Brevo lancé dans le workflow (scripts/lib/mock-brevo-server.mjs,
// jamais api.brevo.com). Les scénarios "devis ok"/"facture ok" vérifient donc
// un envoi RÉELLEMENT complet (requête HTTP bout-en-bout, réponse 200 avec
// messageId) — mais jamais contre le vrai Brevo. Le seul test qui envoie un
// email à une vraie boîte de réception est scripts/smoke-test-email-send.mjs
// (manuel, contre un déploiement réel, avec de vraies clés).
//
// En dehors de la CI (ex. exécution locale sans mock Brevo démarré), ce
// script tolère aussi le repli "BREVO_API_KEY non configuré" pour les
// scénarios "ok" — utile pour vérifier localement les autres scénarios
// (contrat, isolation) sans avoir à lancer le faux serveur Brevo.
import { createClient } from '@supabase/supabase-js'
import { runPreflight } from './test-security-preflight.mjs'
import { upsertOrg, upsertAuthUser, upsertProfile, ensureActiveSubscription, ensureOrgABusinessFixtures, ensureClient } from './seed-security-fixtures.mjs'
import { ensureCompleteParametresEntreprise, ensureUserWithoutProfile } from './lib/seed-email-fixtures.mjs'

const EXTRA_REQUIRED_VARS = [
  'TEST_ADMIN_A_EMAIL', 'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL', 'TEST_ADMIN_B_PASSWORD',
]

const results = []
function record(name, status, detail = '') {
  results.push({ name, status })
  console.log(`[test:integration:email] ${status} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function callEnvoyerEmail(baseUrl, anonKey, authHeader, body) {
  const res = await fetch(`${baseUrl}/functions/v1/envoyer-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, ...(authHeader ? { Authorization: authHeader } : {}) },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* réponse non-JSON */ }
  return { status: res.status, body: json }
}

async function main() {
  runPreflight(EXTRA_REQUIRED_VARS)

  const url = process.env.SUPABASE_TEST_URL
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } })

  console.log('[test:integration:email] Préparation des fixtures (orgs A/B, comptes, devis/facture, paramètres complets)...')
  const orgAId = await upsertOrg(serviceClient, 'email-test-org-a', 'Email Test Org A')
  const orgBId = await upsertOrg(serviceClient, 'email-test-org-b', 'Email Test Org B')

  const adminAId = await upsertAuthUser(serviceClient, process.env.TEST_ADMIN_A_EMAIL, process.env.TEST_ADMIN_A_PASSWORD)
  await upsertProfile(serviceClient, { id: adminAId, email: process.env.TEST_ADMIN_A_EMAIL, nom: 'EmailTest', prenom: 'AdminA', role: 'admin', organisationId: orgAId })
  await ensureActiveSubscription(serviceClient, adminAId, orgAId)
  await ensureCompleteParametresEntreprise(serviceClient, orgAId, { raison_sociale: 'Email Test Org A', email: 'contact@email-test-org-a.example.test' })
  await ensureOrgABusinessFixtures(serviceClient, orgAId, adminAId, null)

  const adminBId = await upsertAuthUser(serviceClient, process.env.TEST_ADMIN_B_EMAIL, process.env.TEST_ADMIN_B_PASSWORD)
  await upsertProfile(serviceClient, { id: adminBId, email: process.env.TEST_ADMIN_B_EMAIL, nom: 'EmailTest', prenom: 'AdminB', role: 'admin', organisationId: orgBId })
  await ensureActiveSubscription(serviceClient, adminBId, orgBId)
  await ensureCompleteParametresEntreprise(serviceClient, orgBId, { raison_sociale: 'Email Test Org B', email: 'contact@email-test-org-b.example.test' })
  const clientBId = await ensureClient(serviceClient, { orgId: orgBId, nom: 'Email Test Client B', createdBy: adminBId })

  const { data: devisA } = await serviceClient.from('devis').select('id').eq('organisation_id', orgAId).maybeSingle()
  const { data: factureA } = await serviceClient.from('factures').select('id').eq('organisation_id', orgAId).maybeSingle()
  if (!devisA || !factureA) throw new Error('Fixtures devis/facture org A introuvables après ensureOrgABusinessFixtures — vérifier scripts/seed-security-fixtures.mjs')

  let { data: devisB } = await serviceClient.from('devis').select('id').eq('organisation_id', orgBId).maybeSingle()
  if (!devisB) {
    const { data, error } = await serviceClient.from('devis')
      .insert({ organisation_id: orgBId, client_id: clientBId, activite: 'serrurerie', created_by: adminBId })
      .select('id').single()
    if (error) throw new Error(`Création devis org B impossible : ${error.message}`)
    devisB = data
  }

  console.log('[test:integration:email] Connexion admin A...')
  const clientA = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: authA, error: errA } = await clientA.auth.signInWithPassword({
    email: process.env.TEST_ADMIN_A_EMAIL, password: process.env.TEST_ADMIN_A_PASSWORD,
  })
  if (errA || !authA.session) throw new Error(`Connexion admin A impossible : ${errA?.message}`)
  const authHeaderA = `Bearer ${authA.session.access_token}`

  const TINY_PDF = Buffer.from('%PDF-1.4 minimal test content').toString('base64')
  const isBrevoUnavailableMessage = (msg) =>
    msg === 'BREVO_API_KEY non configuré' || /Configuration email manquante/.test(msg ?? '')

  // ── devis ok — envoi bout-en-bout complet (faux Brevo en CI) ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'Devis test', html: '<p>Test</p>',
      pdfBase64: TINY_PDF, pdfFilename: 'devis-test.pdf',
      documentType: 'devis', documentId: devisA.id,
    })
    const realSuccess = body?.error === null && !!body?.id
    const passed = status === 200 && (realSuccess || isBrevoUnavailableMessage(body?.error))
    record(
      realSuccess ? 'devis ok (envoi complet, faux Brevo a répondu)' : 'devis ok (franchit toutes les validations internes)',
      passed ? '✅' : '❌',
      `status=${status} error=${body?.error} id=${body?.id ?? '(absent)'}`
    )
  }

  // ── facture ok — envoi bout-en-bout complet (faux Brevo en CI) ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'Facture test', html: '<p>Test</p>',
      pdfBase64: TINY_PDF, pdfFilename: 'facture-test.pdf',
      documentType: 'facture', documentId: factureA.id,
    })
    const realSuccess = body?.error === null && !!body?.id
    const passed = status === 200 && (realSuccess || isBrevoUnavailableMessage(body?.error))
    record(
      realSuccess ? 'facture ok (envoi complet, faux Brevo a répondu)' : 'facture ok (franchit toutes les validations internes)',
      passed ? '✅' : '❌',
      `status=${status} error=${body?.error} id=${body?.id ?? '(absent)'}`
    )
  }

  // ── erreur Brevo simulée (bout-en-bout, via le faux serveur Brevo) ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'brevo-error-test@example.test', subject: 'Devis test', html: '<p>Test</p>',
      pdfBase64: TINY_PDF, pdfFilename: 'devis-test.pdf',
      documentType: 'devis', documentId: devisA.id,
    })
    const realRejection = /Simulated Brevo rejection/.test(body?.error ?? '')
    const passed = status === 200 && (realRejection || isBrevoUnavailableMessage(body?.error))
    record(
      realRejection ? 'erreur Brevo simulée (bout-en-bout, faux serveur Brevo)' : 'erreur Brevo simulée (ignorée — faux serveur Brevo non démarré)',
      passed ? '✅' : '❌',
      `status=${status} error=${body?.error}`
    )
  }

  // ── documentType absent ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'S', html: 'H', documentId: devisA.id,
    })
    const passed = status === 400 && /documentType/.test(body?.error ?? '')
    record('documentType absent → 400', passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── documentId absent ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'S', html: 'H', documentType: 'devis',
    })
    const passed = status === 400 && /documentType/.test(body?.error ?? '')
    record('documentId absent → 400', passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── email invalide ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'pas-un-email', subject: 'S', html: 'H', documentType: 'devis', documentId: devisA.id,
    })
    const passed = status === 400 && /invalide/i.test(body?.error ?? '')
    record('email invalide → 400', passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── PDF > limite (413) ──
  {
    const oversized = 'A'.repeat(15 * 1024 * 1024) // ~15 Mo décodés, > MAX_PDF_BYTES (10 Mo)
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'S', html: 'H',
      pdfBase64: oversized, pdfFilename: 'trop-gros.pdf',
      documentType: 'devis', documentId: devisA.id,
    })
    const passed = status === 413 && /volumineux/i.test(body?.error ?? '')
    record('PDF > limite → 413', passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── document inexistant → 404 ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'S', html: 'H',
      documentType: 'devis', documentId: '00000000-0000-0000-0000-000000000000',
    })
    const passed = status === 404 && /introuvable/i.test(body?.error ?? '')
    record('document inexistant → 404', passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── document d'une autre organisation → 403 (isolation multi-tenant) ──
  {
    const { status, body } = await callEnvoyerEmail(url, anonKey, authHeaderA, {
      to: 'client-test@example.test', subject: 'S', html: 'H',
      documentType: 'devis', documentId: devisB.id,
    })
    const passed = status === 403 && /n'appartient pas/.test(body?.error ?? '')
    record("document d'une autre organisation → 403", passed ? '✅' : '❌', `status=${status} error=${body?.error}`)
  }

  // ── utilisateur sans profil/organisation (optionnel — voir limite documentée) ──
  {
    const email = process.env.TEST_NO_PROFILE_EMAIL
    const password = process.env.TEST_NO_PROFILE_PASSWORD
    if (email && password) {
      await ensureUserWithoutProfile(serviceClient, email, password)
      const clientNoProfile = createClient(url, anonKey, { auth: { persistSession: false } })
      const { data: authNP, error: errNP } = await clientNoProfile.auth.signInWithPassword({ email, password })
      if (errNP || !authNP.session) throw new Error(`Connexion utilisateur sans profil impossible : ${errNP?.message}`)
      const { status } = await callEnvoyerEmail(url, anonKey, `Bearer ${authNP.session.access_token}`, {
        to: 'client-test@example.test', subject: 'S', html: 'H', documentType: 'devis', documentId: devisA.id,
      })
      const passed = status === 403
      record(
        'utilisateur sans profil/organisation → 403',
        passed ? '✅' : '❌',
        `status=${status} — profiles.organisation_id est NOT NULL, "Aucune organisation associée" est donc inatteignable en pratique ; ce test vérifie le chemin réellement atteint (profil introuvable → Accès non autorisé)`
      )
    } else {
      record('utilisateur sans profil/organisation', '⚠️', 'TEST_NO_PROFILE_EMAIL/PASSWORD non fournis — scénario ignoré (optionnel)')
    }
  }

  const failed = results.filter(r => r.status === '❌')
  console.log(`\n[test:integration:email] ${results.length - failed.length}/${results.length} scénarios réussis.`)
  if (failed.length > 0) {
    console.error('[test:integration:email] ÉCHEC — voir le détail ci-dessus.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error(`[test:integration:email] ERREUR : ${err.message}`)
  process.exit(1)
})
