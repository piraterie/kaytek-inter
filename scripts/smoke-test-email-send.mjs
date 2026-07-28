#!/usr/bin/env node
// scripts/smoke-test-email-send.mjs
//
// Test réel de bout en bout de l'envoi d'un devis/facture par email — envoie
// un VRAI email via Brevo à une adresse réelle. MANUEL UNIQUEMENT, jamais
// automatique : voir la liste de gardes ci-dessous, toutes vérifiées AVANT
// le moindre appel réseau, qui font échouer ce script (code non nul) si une
// seule d'entre elles n'est pas remplie.
//
// GARDES (dans l'ordre, chacune bloquante) :
//   1. Refus si exécuté sous CI (variable CI définie — GitHub Actions,
//      et la plupart des autres CI, la définissent automatiquement).
//   2. Toutes les variables d'environnement requises doivent être présentes.
//   3. ALLOW_REAL_EMAIL_SEND doit valoir EXACTEMENT la chaîne "true".
//   4. TEST_EMAIL_RECIPIENT doit appartenir à un domaine listé dans
//      ALLOWED_TEST_EMAIL_DOMAINS (liste configurable, aucune valeur par
//      défaut — doit être explicitement fournie).
//   5. Si SMOKE_TEST_SUPABASE_URL correspond au projet Supabase de
//      PRODUCTION connu de ce dépôt, CONFIRM_PRODUCTION_SEND doit EN PLUS
//      valoir EXACTEMENT "true" (double confirmation explicite).
//
// Variables d'environnement requises :
//   SMOKE_TEST_SUPABASE_URL        — URL du projet Supabase ciblé
//   SMOKE_TEST_SUPABASE_ANON_KEY   — clé anon du même projet (pas la service role)
//   SMOKE_TEST_USER_EMAIL / SMOKE_TEST_USER_PASSWORD — compte réel autorisé à envoyer
//   TEST_EMAIL_RECIPIENT           — adresse qui recevra le VRAI email de test
//   ALLOWED_TEST_EMAIL_DOMAINS     — domaines autorisés pour TEST_EMAIL_RECIPIENT,
//                                    séparés par des virgules (ex: "example.test,ma-boite.fr")
//   SMOKE_TEST_DOCUMENT_TYPE       — 'devis' ou 'facture'
//   SMOKE_TEST_DOCUMENT_ID         — id d'un document réel appartenant à SMOKE_TEST_USER_EMAIL
//   ALLOW_REAL_EMAIL_SEND=true     — confirmation explicite obligatoire (chaîne exacte "true")
//   CONFIRM_PRODUCTION_SEND=true   — obligatoire UNIQUEMENT si la cible est la production
//
// Ne journalise JAMAIS : mot de passe, clé anon, token de session.
//
// Exemple (cible non-production) :
//   SMOKE_TEST_SUPABASE_URL=https://xxx.supabase.co \
//   SMOKE_TEST_SUPABASE_ANON_KEY=... \
//   SMOKE_TEST_USER_EMAIL=admin@example.fr SMOKE_TEST_USER_PASSWORD=... \
//   TEST_EMAIL_RECIPIENT=test-inbox@example.test \
//   ALLOWED_TEST_EMAIL_DOMAINS=example.test \
//   SMOKE_TEST_DOCUMENT_TYPE=devis SMOKE_TEST_DOCUMENT_ID=<uuid réel> \
//   ALLOW_REAL_EMAIL_SEND=true npm run smoke:email
import { createClient } from '@supabase/supabase-js'
import { isProductionHost, extractHostname } from './lib/production-guard.mjs'

const REQUIRED = [
  'SMOKE_TEST_SUPABASE_URL', 'SMOKE_TEST_SUPABASE_ANON_KEY',
  'SMOKE_TEST_USER_EMAIL', 'SMOKE_TEST_USER_PASSWORD',
  'TEST_EMAIL_RECIPIENT', 'ALLOWED_TEST_EMAIL_DOMAINS',
  'SMOKE_TEST_DOCUMENT_TYPE', 'SMOKE_TEST_DOCUMENT_ID',
]

// Construit un PDF minimal mais réellement valide (xref calculé, pas
// approximatif) — suffisant pour prouver que le pipeline pièce-jointe
// (encodage base64, acceptation Brevo, ouverture du fichier reçu)
// fonctionne réellement de bout en bout. Le contenu détaillé d'un vrai
// devis/facture est déjà couvert par src/lib/pdf/generator.emailFlow.test.ts
// (génération multi-pages/CGV longues) — pas l'objet de ce test réseau.
function buildMinimalPdf(titleText) {
  const escaped = titleText.replace(/([()\\])/g, '\\$1')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 320 160] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const streamContent = `BT /F1 12 Tf 20 100 Td (${escaped}) Tj ET`
  objects.push(`<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`)

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefStart = pdf.length
  const n = objects.length + 1
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`
  for (let i = 1; i < n; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += xref
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return pdf
}

function fail(message) {
  console.error(`[smoke:email] REFUS — ${message}`)
  process.exit(1)
}

// ── Garde 1 — jamais sous CI ────────────────────────────────────────────
// Aucun test automatique, build, prebuild, prepare, hook Git ou workflow CI
// standard de ce dépôt n'appelle ce script (vérifiable : grep "smoke:email"
// dans package.json/.husky/.github ne le trouve que dans sa propre
// définition de script) — cette garde est une protection supplémentaire,
// pas une réaction à un appel existant.
function guardNotCI() {
  if (process.env.CI) {
    fail("détecté comme exécuté sous CI (variable d'environnement CI définie) — ce script ne doit jamais tourner en automatique, uniquement à la main par un opérateur.")
  }
}

function guardRequiredEnv() {
  const missing = REQUIRED.filter(n => !process.env[n]?.trim())
  if (missing.length > 0) {
    console.error('[smoke:email] Variable(s) manquante(s) :')
    missing.forEach(n => console.error(`  - ${n}`))
    console.error("\nVoir l'en-tête de scripts/smoke-test-email-send.mjs pour la liste complète et leur usage.")
    process.exit(1)
  }
}

function guardExplicitConfirmation() {
  if (process.env.ALLOW_REAL_EMAIL_SEND !== 'true') {
    fail('ALLOW_REAL_EMAIL_SEND doit valoir exactement "true" pour envoyer un email réel. Relancez avec ALLOW_REAL_EMAIL_SEND=true pour confirmer explicitement.')
  }
}

function guardAllowedRecipientDomain() {
  const recipient = process.env.TEST_EMAIL_RECIPIENT
  const domain = recipient.split('@')[1]?.toLowerCase()
  const allowed = process.env.ALLOWED_TEST_EMAIL_DOMAINS.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  if (allowed.length === 0) {
    fail('ALLOWED_TEST_EMAIL_DOMAINS est vide — au moins un domaine autorisé doit être configuré explicitement.')
  }
  if (!domain || !allowed.includes(domain)) {
    fail(`TEST_EMAIL_RECIPIENT ("${recipient}") n'appartient à aucun domaine autorisé (ALLOWED_TEST_EMAIL_DOMAINS=${allowed.join(', ')}).`)
  }
}

function guardProductionDoubleConfirmation() {
  const host = extractHostname(process.env.SMOKE_TEST_SUPABASE_URL)
  if (isProductionHost(host)) {
    console.warn(`[smoke:email] ⚠️  CIBLE = PRODUCTION (${host}).`)
    if (process.env.CONFIRM_PRODUCTION_SEND !== 'true') {
      fail('la cible est le projet Supabase de PRODUCTION — CONFIRM_PRODUCTION_SEND doit EN PLUS valoir exactement "true" pour continuer. Relancez avec CONFIRM_PRODUCTION_SEND=true si c\'est réellement voulu.')
    }
  }
  return host
}

async function main() {
  guardNotCI()
  guardRequiredEnv()
  guardExplicitConfirmation()
  guardAllowedRecipientDomain()
  const targetHost = guardProductionDoubleConfirmation()

  const url = process.env.SMOKE_TEST_SUPABASE_URL
  const anonKey = process.env.SMOKE_TEST_SUPABASE_ANON_KEY
  const documentType = process.env.SMOKE_TEST_DOCUMENT_TYPE
  const documentId = process.env.SMOKE_TEST_DOCUMENT_ID
  const recipient = process.env.TEST_EMAIL_RECIPIENT

  if (documentType !== 'devis' && documentType !== 'facture') {
    fail(`SMOKE_TEST_DOCUMENT_TYPE doit être 'devis' ou 'facture' (reçu : ${documentType})`)
  }

  console.log(`[smoke:email] Cible       : ${targetHost}`)
  console.log(`[smoke:email] Document    : ${documentType} ${documentId}`)
  console.log(`[smoke:email] Destinataire : ${recipient}`)
  console.log('[smoke:email] ⚠️  CE SCRIPT VA ENVOYER UN VRAI EMAIL VIA BREVO — action réelle, irréversible, pas une simulation. ⚠️')

  const client = createClient(url, anonKey, { auth: { persistSession: false } })
  console.log('[smoke:email] Connexion...')
  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: process.env.SMOKE_TEST_USER_EMAIL, password: process.env.SMOKE_TEST_USER_PASSWORD,
  })
  if (authErr || !auth.session) {
    // Ne jamais journaliser authErr en entier si jamais il embarquait des
    // détails de requête — uniquement le message d'erreur Supabase.
    console.error(`[smoke:email] ÉCHEC connexion : ${authErr?.message}`)
    process.exit(1)
  }

  const pdf = buildMinimalPdf(`Kaytek Inter — smoke test ${new Date().toISOString()}`)
  const pdfBase64 = Buffer.from(pdf, 'binary').toString('base64')

  console.log('[smoke:email] Appel envoyer-email (ENVOI RÉEL EN COURS)...')
  const t0 = Date.now()
  const { data, error } = await client.functions.invoke('envoyer-email', {
    body: {
      to: recipient,
      subject: `[SMOKE TEST] ${documentType} ${documentId} — ${new Date().toISOString()}`,
      html: `<p>Ceci est un email de test automatisé (smoke test) envoyé le ${new Date().toLocaleString('fr-FR')}.</p>`,
      pdfBase64,
      pdfFilename: 'smoke-test.pdf',
      documentType,
      documentId,
    },
  })
  const elapsed = Date.now() - t0

  if (error) {
    let detail = error.message
    try { detail = (await error.context?.json())?.error ?? detail } catch { /* corps non lisible */ }
    console.error(`[smoke:email] ❌ ÉCHEC (${elapsed}ms) : ${detail}`)
    process.exit(1)
  }
  if (data?.error) {
    console.error(`[smoke:email] ❌ ÉCHEC (${elapsed}ms) : ${data.error}`)
    process.exit(1)
  }

  console.log(`[smoke:email] ✅ SUCCÈS (${elapsed}ms) — Brevo messageId : ${data?.id ?? '(absent)'}`)
  console.log(`[smoke:email] Vérification manuelle restante : ouvrir la boîte ${recipient} et confirmer objet/expéditeur/pièce jointe ouvrable.`)
}

main().catch(err => {
  console.error(`[smoke:email] ERREUR INATTENDUE : ${err.message}`)
  process.exit(1)
})
