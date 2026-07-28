// src/lib/email/contract.test.ts
import { describe, it, expect } from 'vitest'
import * as reExported from './contract'
import * as canonical from '../../../supabase/functions/_shared/emailContract.ts'
import {
  MAX_PDF_BYTES,
  estimatePdfBytes,
  validateEnvoyerEmailPayload,
  validateRecipient,
  firstValidationMessage,
  type EnvoyerEmailPayload,
} from './contract'

// PDF minuscule valide en base64 ("%PDF-1.4\n...") — suffisant, le contrat
// ne vérifie que la taille décodée, pas le contenu du PDF.
const TINY_PDF_BASE64 = Buffer.from('%PDF-1.4 minimal test content').toString('base64')

function validDevisPayload(): EnvoyerEmailPayload {
  return {
    documentType: 'devis',
    documentId: 'devis-123',
    to: 'client@example.fr',
    subject: 'Devis DEV-0001',
    html: '<p>Bonjour</p>',
    pdfBase64: TINY_PDF_BASE64,
    pdfFilename: 'DEV-0001.pdf',
  }
}

// ── Source unique de vérité ──────────────────────────────────────────
// Il n'y a plus deux contrats comparés — il n'y en a qu'UN. Ces tests
// prouvent que src/lib/email/contract.ts ne redéfinit RIEN, il réexporte
// littéralement les mêmes objets que supabase/functions/_shared/
// emailContract.ts. Si un jour quelqu'un réintroduit une redéfinition
// locale (copier-coller au lieu de réexporter), ce test échoue : les
// références ne seraient plus identiques.
describe('Source unique de vérité — src/lib/email/contract.ts réexporte le fichier canonique', () => {
  it('EnvoyerEmailPayloadSchema est littéralement le même objet des deux côtés', () => {
    expect(reExported.EnvoyerEmailPayloadSchema).toBe(canonical.EnvoyerEmailPayloadSchema)
  })

  it('validateEnvoyerEmailBody (revalidation backend) est exportée et réutilisable côté frontend', () => {
    expect(reExported.validateEnvoyerEmailBody).toBe(canonical.validateEnvoyerEmailBody)
  })

  it('MAX_PDF_BYTES est la même valeur exportée (pas une copie)', () => {
    expect(reExported.MAX_PDF_BYTES).toBe(canonical.MAX_PDF_BYTES)
  })

  it("callBrevo (logique backend) est accessible depuis le même module — aucune deuxième implémentation n'existe", () => {
    expect(reExported.callBrevo).toBe(canonical.callBrevo)
  })
})

describe('EnvoyerEmailPayloadSchema — cas valides', () => {
  it('accepte un payload devis complet', () => {
    expect(validateEnvoyerEmailPayload(validDevisPayload())).toEqual([])
  })

  it('accepte un payload facture complet', () => {
    const payload = { ...validDevisPayload(), documentType: 'facture' as const, documentId: 'facture-456' }
    expect(validateEnvoyerEmailPayload(payload)).toEqual([])
  })
})

describe('EnvoyerEmailPayloadSchema — cas invalides', () => {
  it('rejette documentType absent', () => {
    const { documentType: _documentType, ...rest } = validDevisPayload()
    const errors = validateEnvoyerEmailPayload(rest as Partial<EnvoyerEmailPayload>)
    expect(errors.some(e => e.field === 'documentType')).toBe(true)
  })

  it('rejette documentId absent', () => {
    const { documentId: _documentId, ...rest } = validDevisPayload()
    const errors = validateEnvoyerEmailPayload(rest as Partial<EnvoyerEmailPayload>)
    expect(errors.some(e => e.field === 'documentId')).toBe(true)
  })

  it('rejette une adresse email absente', () => {
    const errors = validateEnvoyerEmailPayload({ ...validDevisPayload(), to: '' })
    expect(firstValidationMessage(errors)).toMatch(/manquante/i)
  })

  it('rejette une adresse email invalide', () => {
    const errors = validateEnvoyerEmailPayload({ ...validDevisPayload(), to: 'pas-un-email' })
    expect(firstValidationMessage(errors)).toMatch(/invalide/i)
  })

  it('rejette un PDF vide', () => {
    const errors = validateEnvoyerEmailPayload({ ...validDevisPayload(), pdfBase64: '' })
    expect(errors.some(e => e.field === 'pdfBase64')).toBe(true)
  })

  it('rejette un PDF dépassant MAX_PDF_BYTES', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_PDF_BYTES + 1024) / 3) * 4)
    const errors = validateEnvoyerEmailPayload({ ...validDevisPayload(), pdfBase64: oversized })
    expect(errors.some(e => e.field === 'pdfBase64' && /volumineux/i.test(e.message))).toBe(true)
  })

  it('rejette un nom de fichier qui ne finit pas par .pdf', () => {
    const errors = validateEnvoyerEmailPayload({ ...validDevisPayload(), pdfFilename: 'devis.txt' })
    expect(errors.some(e => e.field === 'pdfFilename')).toBe(true)
  })
})

describe('validateRecipient — vérification rapide avant génération du PDF', () => {
  it('accepte un destinataire/document valides sans exiger le PDF', () => {
    expect(validateRecipient({ to: 'client@example.fr', documentType: 'devis', documentId: 'd1' })).toEqual([])
  })

  it('rejette une adresse invalide sans avoir besoin du PDF', () => {
    const errors = validateRecipient({ to: 'invalide', documentType: 'devis', documentId: 'd1' })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('estimatePdfBytes', () => {
  it('retourne 0 pour une chaîne vide', () => {
    expect(estimatePdfBytes('')).toBe(0)
  })

  it('estime correctement la taille décodée (approx. 3/4 de la longueur base64)', () => {
    const original = 'x'.repeat(300)
    const base64 = Buffer.from(original).toString('base64')
    expect(estimatePdfBytes(base64)).toBe(300)
  })
})

// ── Revalidation backend (validateEnvoyerEmailBody) — exercée ici aussi
// côté frontend puisque c'est littéralement la même fonction que celle
// utilisée par envoyer-email/index.ts (voir describe ci-dessus).
describe('validateEnvoyerEmailBody — revalidation serveur avec statuts HTTP', () => {
  it('accepte un body valide', () => {
    const result = validateEnvoyerEmailPayload(validDevisPayload())
    expect(result).toEqual([])
  })

  it('associe 413 à un PDF trop volumineux (et pas 400)', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_PDF_BYTES + 1024) / 3) * 4)
    const result = canonical.validateEnvoyerEmailBody({ ...validDevisPayload(), pdfBase64: oversized })
    expect(result.error?.status).toBe(413)
  })

  it('associe 400 à une adresse email invalide', () => {
    const result = canonical.validateEnvoyerEmailBody({ ...validDevisPayload(), to: 'invalide' })
    expect(result.error?.status).toBe(400)
  })

  it('renvoie data typée quand le body est valide', () => {
    const result = canonical.validateEnvoyerEmailBody(validDevisPayload())
    expect(result.error).toBeNull()
    expect(result.data?.to).toBe('client@example.fr')
  })
})
