// src/lib/supabase/auth.test.ts
// Régression — bug "envoi devis par email" (2026-07-28, round 2) : quand
// l'Edge Function envoyer-email renvoie un statut HTTP non-2xx (400/403/404/
// 422), supabase-js le remonte comme FunctionsHttpError dont .message est un
// texte générique fixe ("Edge Function returned a non-2xx status code") — le
// vrai message métier n'est disponible qu'en relisant error.context (Response)
// en JSON. extractFunctionErrorMessage() doit lire ce corps une seule fois et
// retomber proprement sur le fallback si le corps n'est pas lisible.
import { describe, it, expect } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { extractFunctionErrorMessage } from './auth'

function httpErrorWithBody(body: unknown, status = 400): FunctionsHttpError {
  const response = new Response(JSON.stringify(body), { status })
  return new FunctionsHttpError(response)
}

describe('extractFunctionErrorMessage', () => {
  it('extrait le message métier réel du corps JSON (ex: documentType/documentId manquants)', async () => {
    const error = httpErrorWithBody({ error: 'documentType (devis|facture) et documentId sont obligatoires' }, 400)
    const message = await extractFunctionErrorMessage(error, 'fallback')
    expect(message).toBe('documentType (devis|facture) et documentId sont obligatoires')
  })

  it('extrait le message pour un 422 (Reply-To entreprise invalide)', async () => {
    const error = httpErrorWithBody({ error: "Renseignez une adresse email professionnelle valide" }, 422)
    const message = await extractFunctionErrorMessage(error, 'fallback')
    expect(message).toBe('Renseignez une adresse email professionnelle valide')
  })

  it('retombe sur le message générique FunctionsHttpError si le corps JSON ne contient pas de champ error', async () => {
    const error = httpErrorWithBody({ ok: false }, 400)
    const message = await extractFunctionErrorMessage(error, 'fallback générique')
    expect(message).toBe('Edge Function returned a non-2xx status code')
  })

  it('retombe sur le message générique FunctionsHttpError si le corps n\'est pas du JSON valide', async () => {
    const response = new Response('<html>500</html>', { status: 500 })
    const error = new FunctionsHttpError(response)
    const message = await extractFunctionErrorMessage(error, 'fallback générique')
    expect(message).toBe('Edge Function returned a non-2xx status code')
  })

  it("n'affecte pas une erreur générique non-FunctionsHttpError (réseau, etc.)", async () => {
    const message = await extractFunctionErrorMessage(new Error('network down'), 'fallback')
    expect(message).toBe('network down')
  })
})
