// supabase/functions/_shared/emailContract.test.ts
// Tests unitaires du contrat backend envoyer-email — AUCUN appel réseau
// réel : callBrevo() reçoit toujours un fetchImpl fourni par le test (jamais
// le vrai global fetch), donc jamais un seul octet envoyé à api.brevo.com,
// ni besoin de clé API Brevo réelle. Ce sont les seuls tests qui exercent
// réellement les branches "Brevo rejette la requête" et "erreur réseau" —
// jusqu'ici non couvertes automatiquement (voir scripts/test-security-
// edge-functions.mjs, qui documente explicitement cette lacune).
//
// Exécution : deno test --allow-env supabase/functions/_shared/emailContract.test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  MAX_PDF_BYTES,
  buildBrevoPayload,
  callBrevo,
  estimatePdfBytes,
  interpretBrevoResponse,
  isValidEmail,
  parseEmailFrom,
  validateEnvoyerEmailBody,
  type EnvoyerEmailPayload,
} from './emailContract.ts'

function validBody(overrides: Partial<EnvoyerEmailPayload> = {}): Partial<EnvoyerEmailPayload> {
  return {
    to: 'client@example.fr',
    subject: 'Devis DEV-0001',
    html: '<p>Bonjour</p>',
    documentType: 'devis',
    documentId: 'devis-123',
    pdfBase64: 'QQ==',
    pdfFilename: 'devis.pdf',
    ...overrides,
  }
}

// ── isValidEmail ──────────────────────────────────────────────────────
Deno.test('isValidEmail — accepte une adresse valide', () => {
  assert(isValidEmail('client@example.fr'))
})
Deno.test('isValidEmail — rejette une chaîne vide', () => {
  assert(!isValidEmail(''))
})
Deno.test('isValidEmail — rejette un format invalide', () => {
  assert(!isValidEmail('pas-un-email'))
})
Deno.test('isValidEmail — rejette null/undefined', () => {
  assert(!isValidEmail(null))
  assert(!isValidEmail(undefined))
})

// ── estimatePdfBytes ──────────────────────────────────────────────────
Deno.test('estimatePdfBytes — 0 pour une entrée vide', () => {
  assertEquals(estimatePdfBytes(''), 0)
  assertEquals(estimatePdfBytes(undefined), 0)
})

// ── validateEnvoyerEmailBody ────────────────────────────────────────────
// Utilise désormais EXACTEMENT le même schéma zod que le frontend
// (EnvoyerEmailPayloadSchema, supabase/functions/_shared/emailContract.ts)
// — une seule définition, plus de risque de divergence entre deux fichiers.
Deno.test('validateEnvoyerEmailBody — accepte un body devis valide', () => {
  const result = validateEnvoyerEmailBody(validBody())
  assertEquals(result.error, null)
  assertEquals(result.data?.to, 'client@example.fr')
})

Deno.test('validateEnvoyerEmailBody — rejette to absent', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ to: undefined }))
  assert(error)
  assertEquals(error.field, 'to')
  assertEquals(error.status, 400)
})

Deno.test('validateEnvoyerEmailBody — rejette une adresse email invalide', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ to: 'pas-un-email' }))
  assert(error)
  assertEquals(error.field, 'to')
})

Deno.test('validateEnvoyerEmailBody — rejette documentType absent', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ documentType: undefined }))
  assert(error)
  assertEquals(error.field, 'documentType')
})

Deno.test('validateEnvoyerEmailBody — rejette documentId absent', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ documentId: undefined }))
  assert(error)
  assertEquals(error.field, 'documentId')
})

Deno.test('validateEnvoyerEmailBody — rejette un PDF vide (400, pas 413)', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ pdfBase64: '' }))
  assert(error)
  assertEquals(error.field, 'pdfBase64')
  assertEquals(error.status, 400)
})

Deno.test('validateEnvoyerEmailBody — rejette un PDF trop volumineux (413, pas 400)', () => {
  const oversized = 'A'.repeat(Math.ceil((MAX_PDF_BYTES + 1024) / 3) * 4)
  const { error } = validateEnvoyerEmailBody(validBody({ pdfBase64: oversized }))
  assert(error)
  assertEquals(error.field, 'pdfBase64')
  assertEquals(error.status, 413)
})

Deno.test('validateEnvoyerEmailBody — rejette un nom de fichier joint non-PDF', () => {
  const { error } = validateEnvoyerEmailBody(validBody({ pdfFilename: 'devis.txt' }))
  assert(error)
  assertEquals(error.field, 'pdfFilename')
})

Deno.test('validateEnvoyerEmailBody — accepte un PDF valide sous la limite', () => {
  const result = validateEnvoyerEmailBody(validBody({ pdfBase64: 'QQ==', pdfFilename: 'devis.pdf' }))
  assertEquals(result.error, null)
})

// ── parseEmailFrom / buildBrevoPayload ─────────────────────────────────
Deno.test('parseEmailFrom — extrait nom et email du format "Nom <email>"', () => {
  assertEquals(parseEmailFrom('Kaytek Inter <contact@kaytekinter.fr>'), { name: 'Kaytek Inter', email: 'contact@kaytekinter.fr' })
})
Deno.test('parseEmailFrom — repli sur une adresse brute sans nom', () => {
  assertEquals(parseEmailFrom('contact@kaytekinter.fr'), { name: 'Kaytek Inter', email: 'contact@kaytekinter.fr' })
})

Deno.test('buildBrevoPayload — inclut la pièce jointe uniquement si pdfBase64 ET pdfFilename sont fournis', () => {
  const sender = { name: 'Kaytek Inter', email: 'contact@kaytekinter.fr' }
  const withPdf = buildBrevoPayload({ sender, to: 'client@example.fr', subject: 'S', html: 'H', replyTo: sender, pdfBase64: 'QQ==', pdfFilename: 'd.pdf' })
  assert('attachment' in withPdf)

  const withoutPdf = buildBrevoPayload({ sender, to: 'client@example.fr', subject: 'S', html: 'H', replyTo: sender })
  assert(!('attachment' in withoutPdf))
})

// ── interpretBrevoResponse ──────────────────────────────────────────────
Deno.test('interpretBrevoResponse — succès renvoie messageId', () => {
  const outcome = interpretBrevoResponse({ ok: true }, { messageId: 'msg-1' })
  assertEquals(outcome, { ok: true, error: null, messageId: 'msg-1' })
})
Deno.test('interpretBrevoResponse — échec Brevo renvoie le message fourni', () => {
  const outcome = interpretBrevoResponse({ ok: false }, { message: 'Sender not authorized' })
  assertEquals(outcome.ok, false)
  assertEquals(outcome.error, 'Sender not authorized')
})
Deno.test('interpretBrevoResponse — échec Brevo sans message renvoie un repli générique', () => {
  const outcome = interpretBrevoResponse({ ok: false }, {})
  assertEquals(outcome.error, 'Erreur Brevo')
})

// ── callBrevo — AUCUN appel réseau réel, fetchImpl toujours fourni par le test ──
Deno.test('callBrevo — succès (Brevo accepte la requête)', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ messageId: 'msg-42' }), { status: 200 })) as typeof fetch
  const outcome = await callBrevo(fakeFetch, 'fake-key-not-real', { to: [{ email: 'client@example.fr' }] })
  assertEquals(outcome, { ok: true, error: null, messageId: 'msg-42' })
})

Deno.test('callBrevo — erreur Brevo simulée (réponse HTTP non-2xx)', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ message: 'Invalid sender email address' }), { status: 400 })) as typeof fetch
  const outcome = await callBrevo(fakeFetch, 'fake-key-not-real', {})
  assertEquals(outcome.ok, false)
  assertEquals(outcome.error, 'Invalid sender email address')
  assertEquals(outcome.networkError, undefined)
})

Deno.test('callBrevo — erreur réseau simulée (fetch rejette)', async () => {
  const fakeFetch = (async () => { throw new TypeError('fetch failed (simulated network error)') }) as typeof fetch
  const outcome = await callBrevo(fakeFetch, 'fake-key-not-real', {})
  assertEquals(outcome.ok, false)
  assertEquals(outcome.networkError, true)
  assert(outcome.error?.includes('simulated network error'))
})

Deno.test('callBrevo — corps de réponse non-JSON traité comme une erreur, pas une exception non gérée', async () => {
  const fakeFetch = (async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })) as typeof fetch
  const outcome = await callBrevo(fakeFetch, 'fake-key-not-real', {})
  assertEquals(outcome.ok, false)
  // res.json() a rejeté (corps non-JSON) → intercepté par le catch de callBrevo.
  assertEquals(outcome.networkError, true)
})
