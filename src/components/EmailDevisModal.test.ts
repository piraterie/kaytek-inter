// src/components/EmailDevisModal.test.ts
// Régression — bug "envoi devis par email" (2026-07-28) : validation
// e-mail et seuil de taille de pièce jointe utilisés par handleSend().
import { describe, it, expect } from 'vitest'
import { EMAIL_RE, MAX_PDF_BYTES } from './EmailDevisModal'

describe('EMAIL_RE — validation adresse destinataire', () => {
  it.each([
    'jean.dupont@example.fr',
    'contact+devis@kaytekinter.fr',
    'a@b.co',
  ])('accepte %s', email => {
    expect(EMAIL_RE.test(email)).toBe(true)
  })

  it.each([
    '',
    'pas-un-email',
    'jean@',
    '@example.fr',
    'jean dupont@example.fr',
    'jean@example',
  ])('rejette %s', email => {
    expect(EMAIL_RE.test(email)).toBe(false)
  })
})

describe('MAX_PDF_BYTES — seuil pièce jointe', () => {
  it('vaut 10 Mo', () => {
    expect(MAX_PDF_BYTES).toBe(10 * 1024 * 1024)
  })
})
