// supabase/functions/_shared/emailContract.ts
//
// SOURCE UNIQUE DE VÉRITÉ du contrat envoyer-email — frontend ET backend
// importent CE fichier, littéralement, pas une copie. Il n'existe qu'UNE
// définition de EnvoyerEmailPayloadSchema dans tout le dépôt.
//
//   Frontend (Vite/vitest) : src/lib/email/contract.ts réexporte ce fichier
//   via un import relatif direct (`export * from '../../../supabase/
//   functions/_shared/emailContract.ts'`). Vite/esbuild n'a aucune
//   restriction sur l'origine des fichiers importés.
//
//   Backend (Deno, envoyer-email/index.ts) : importe ce fichier via un
//   chemin relatif classique (`../_shared/emailContract.ts`).
//
//   Le seul obstacle à un import "zod" identique des deux côtés est la
//   résolution de spécificateur : Vite résout "zod" via node_modules, Deno
//   ne le fait pas nativement. Réglé par deno.json (racine du dépôt) :
//   { "imports": { "zod": "npm:zod@^3.23.8" } } — Deno résout alors "zod"
//   exactement comme Vite, sans changer une seule ligne de code applicatif.
//
// Ce fichier DOIT rester déployable tel quel comme dépendance d'une Edge
// Function (donc rester dans supabase/functions/_shared/, la zone
// officiellement supportée par le bundler de déploiement Supabase) et DOIT
// rester important tel quel par Vite (donc n'utiliser AUCUNE API Deno-only
// comme Deno.env.get — celles-ci restent exclusivement dans
// envoyer-email/index.ts, jamais ici).
//
// Historique : cause racine de deux incidents de production (2026-07-28) —
// un message d'erreur générique masquant la vraie cause, puis un backend
// durci (documentType/documentId) déployé sans que le frontend correspondant
// ne soit jamais fusionné (deux fichiers séparés qui avaient divergé). Le
// choix d'un fichier réellement partagé (plutôt que deux fichiers comparés
// par un test de dérive) élimine la classe de bug entière : il n'y a plus
// rien à faire diverger.
import { z } from 'zod'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim())
}

// Limite pièce jointe Brevo ≈ 10 Mo.
export const MAX_PDF_BYTES = 10 * 1024 * 1024

// Taille décodée d'un PDF encodé en base64 — approximation exacte (le
// padding '=' ne représente aucun octet réel) suffisante pour un seuil.
export function estimatePdfBytes(base64: string | null | undefined): number {
  if (!base64) return 0
  const len = base64.length
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - padding
}

// Exportée (non "const" privée) pour permettre à qui veut introspecter la
// forme brute (ex. RecipientSchema.pick ci-dessous). Ne pas valider un
// payload directement avec elle : elle n'inclut pas la vérification de
// taille du PDF, voir EnvoyerEmailPayloadSchema plus bas. Ordre des champs
// délibéré : destinataire/sujet d'abord (ce qu'un humain fournit et peut
// corriger), document ensuite (déterminé par l'appelant, jamais saisi),
// pièce jointe en dernier (dépend d'une génération PDF qui peut échouer
// indépendamment) — détermine quel message remonte en premier si plusieurs
// champs sont invalides à la fois.
export const BaseEnvoyerEmailPayloadSchema = z.object({
  to: z.string()
    .trim()
    .min(1, 'Adresse email du destinataire manquante.')
    .regex(EMAIL_RE, 'Adresse email invalide — vérifiez le format (ex : nom@domaine.fr).'),
  subject: z.string().trim().min(1, 'Objet du message manquant.'),
  html: z.string().min(1, 'Corps du message manquant.'),
  documentType: z.enum(['devis', 'facture'], {
    errorMap: () => ({ message: 'Type de document invalide (devis ou facture attendu).' }),
  }),
  documentId: z.string().trim().min(1, 'Document introuvable (identifiant manquant).'),
  pdfBase64: z.string().min(1, 'Impossible de générer le PDF (fichier vide).'),
  pdfFilename: z.string()
    .trim()
    .min(1, 'Nom du fichier joint manquant.')
    .regex(/\.pdf$/i, 'Le fichier joint doit être un PDF (extension .pdf).'),
})

// Schéma complet — utilisé juste avant l'appel réseau côté frontend (une
// fois le PDF généré) et pour toute revalidation côté backend.
export const EnvoyerEmailPayloadSchema = BaseEnvoyerEmailPayloadSchema.superRefine((payload, ctx) => {
  const bytes = estimatePdfBytes(payload.pdfBase64)
  if (bytes > MAX_PDF_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pdfBase64'],
      message: `Le PDF est trop volumineux pour être envoyé par email (${(bytes / 1024 / 1024).toFixed(1)} Mo, maximum ${MAX_PDF_BYTES / 1024 / 1024} Mo).`,
    })
  }
})

export type EnvoyerEmailPayload = z.infer<typeof BaseEnvoyerEmailPayloadSchema>

// Sous-ensemble validable AVANT génération du PDF (destinataire + document)
// côté frontend — permet un retour d'erreur immédiat (adresse manquante/
// invalide) sans attendre une génération PDF potentiellement longue (CGV
// multi-pages, etc.).
export const RecipientSchema = BaseEnvoyerEmailPayloadSchema.pick({
  to: true,
  documentType: true,
  documentId: true,
})
export type RecipientInput = z.infer<typeof RecipientSchema>

export interface PayloadValidationError {
  field: string
  message: string
}

function issuesToErrors(issues: z.ZodIssue[]): PayloadValidationError[] {
  return issues.map(issue => ({ field: String(issue.path[0] ?? ''), message: issue.message }))
}

// Erreurs par champ (peut en retourner plusieurs) — utilisé côté frontend.
export function validateEnvoyerEmailPayload(payload: Partial<EnvoyerEmailPayload>): PayloadValidationError[] {
  const result = EnvoyerEmailPayloadSchema.safeParse(payload)
  return result.success ? [] : issuesToErrors(result.error.issues)
}

export function validateRecipient(payload: Partial<RecipientInput>): PayloadValidationError[] {
  const result = RecipientSchema.safeParse(payload)
  return result.success ? [] : issuesToErrors(result.error.issues)
}

// Premier message d'erreur lisible par un utilisateur.
export function firstValidationMessage(errors: PayloadValidationError[]): string | null {
  return errors[0]?.message ?? null
}

// ── Revalidation serveur (envoyer-email/index.ts) ──────────────────────
// Le frontend ne peut jamais être fait confiance (bug, ancien bundle en
// cache, appel direct de l'API) : revalidation complète et indépendante ici,
// via le MÊME schéma zod que le frontend — impossible que les règles
// divergent, il n'y a qu'une seule définition.
export interface BodyValidationError extends PayloadValidationError {
  status: number
}

export type EnvoyerEmailBodyResult =
  | { data: EnvoyerEmailPayload; error: null }
  | { data: null; error: BodyValidationError }

// pdfBase64 a deux modes d'échec distincts avec des statuts HTTP différents :
// "vide/absent" (400, erreur de requête classique) vs "trop volumineux"
// (413 Payload Too Large, ajouté par le .superRefine ci-dessus — seule
// issue de code 'custom' sur ce champ). Tous les autres champs sont 400.
function statusForIssue(issue: z.ZodIssue): number {
  const field = String(issue.path[0] ?? '')
  if (field === 'pdfBase64' && issue.code === z.ZodIssueCode.custom) return 413
  return 400
}

export function validateEnvoyerEmailBody(rawBody: unknown): EnvoyerEmailBodyResult {
  const result = EnvoyerEmailPayloadSchema.safeParse(rawBody)
  if (result.success) return { data: result.data, error: null }
  const issue = result.error.issues[0]
  const field = String(issue.path[0] ?? 'body')
  return { data: null, error: { field, message: issue.message, status: statusForIssue(issue) } }
}

// ── Isolation multi-tenant (envoyer-email/index.ts) ────────────────────
export const DOCUMENT_TABLES = { devis: 'devis', facture: 'factures' } as const

// ── Appel Brevo ──────────────────────────────────────────────────────
export interface BrevoSender {
  name: string
  email: string
}

export function parseEmailFrom(emailFrom: string): BrevoSender {
  const match = emailFrom.match(/^(.+?)\s*<(.+?)>$/)
  return match
    ? { name: match[1].trim(), email: match[2].trim() }
    : { name: 'Kaytek Inter', email: emailFrom.trim() }
}

// Pure — ne fait aucun appel réseau, testable directement.
export function buildBrevoPayload(opts: {
  sender: BrevoSender
  to: string
  subject: string
  html?: string
  replyTo: BrevoSender
  pdfBase64?: string
  pdfFilename?: string
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sender: { name: opts.sender.name, email: opts.sender.email },
    to: [{ email: opts.to }],
    subject: opts.subject,
    htmlContent: opts.html,
    // Reply-To systématique et inconditionnel — jamais optionnel, jamais
    // l'adresse personnelle du compte Brevo ni une adresse globale à la
    // plateforme (voir validateEntreprise.ts).
    replyTo: { name: opts.replyTo.name, email: opts.replyTo.email },
  }
  if (opts.pdfBase64 && opts.pdfFilename) {
    payload.attachment = [{ name: opts.pdfFilename, content: opts.pdfBase64 }]
  }
  return payload
}

export interface BrevoOutcome {
  ok: boolean
  error: string | null
  messageId?: string
  // true uniquement si fetch() a rejeté avant d'obtenir une réponse HTTP
  // (DNS, timeout, connexion refusée...) — distingue un échec réseau d'un
  // rejet applicatif Brevo (ex: expéditeur non autorisé), pour un logging
  // structuré précis (errorCode).
  networkError?: boolean
}

// Interprète la réponse HTTP + le corps JSON déjà parsé de l'appel Brevo —
// ne fait aucun appel réseau elle-même : c'est ce qui la rend testable avec
// un fetch mocké (emailContract.test.ts) sans jamais toucher le vrai Brevo
// ni exiger de clé API en CI.
export function interpretBrevoResponse(res: { ok: boolean }, data: any): BrevoOutcome {
  if (!res.ok) return { ok: false, error: data?.message || 'Erreur Brevo' }
  return { ok: true, error: null, messageId: data?.messageId }
}

export const DEFAULT_BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

// Encapsule l'appel réseau réel vers Brevo — fetchImpl est injecté pour
// rester testable (emailContract.test.ts fournit un faux fetch qui ne
// contacte jamais api.brevo.com). Une erreur réseau (fetch qui rejette :
// DNS, timeout, connexion refusée...) est interceptée ici et renvoyée comme
// un échec normal — jamais une exception qui remonterait jusqu'à l'appelant.
//
// endpoint est optionnel et vaut DEFAULT_BREVO_ENDPOINT (le vrai Brevo) par
// défaut — envoyer-email/index.ts le rend configurable via la variable
// d'environnement optionnelle BREVO_API_URL, JAMAIS définie en production
// (donc toujours le vrai Brevo en prod), utilisée UNIQUEMENT par la CI
// d'intégration pour rediriger vers un faux serveur Brevo local et ne
// jamais toucher le vrai fournisseur pendant les tests automatisés.
export async function callBrevo(
  fetchImpl: typeof fetch,
  apiKey: string,
  payload: Record<string, unknown>,
  endpoint: string = DEFAULT_BREVO_ENDPOINT
): Promise<BrevoOutcome> {
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    return interpretBrevoResponse(res, data)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur envoi email', networkError: true }
  }
}

// ── Logging structuré ──────────────────────────────────────────────────
// Ne journalise JAMAIS : clé API, JWT/Authorization, contenu du PDF,
// contenu de l'email (html), ni l'adresse email du destinataire — seulement
// les identifiants et métriques nécessaires au diagnostic.
export interface EmailLogFields {
  documentType?: string
  documentId?: string
  organisationId?: string | null
  status: number
  responseTimeMs?: number
  pdfSizeBytes?: number
  errorCode?: string
}

export function logEnvoyerEmailEvent(event: string, fields: EmailLogFields): void {
  console.log(JSON.stringify({ event, fn: 'envoyer-email', ts: new Date().toISOString(), ...fields }))
}
