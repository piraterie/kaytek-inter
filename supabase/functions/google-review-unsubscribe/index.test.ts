// supabase/functions/google-review-unsubscribe/index.test.ts
//
// Tests unitaires de handleReviewUnsubscribe() — AUCUN appel réseau réel,
// globalThis.fetch entièrement remplacé par un routeur en mémoire. Vérifie
// que le token opaque ne révèle jamais l'organisation/e-mail autrement que
// dérivés côté serveur, qu'un token invalide/expiré est rejeté proprement,
// et qu'un GET (aperçu) ne modifie jamais la base — seul un POST confirmé
// enregistre la désinscription, de façon idempotente.
//
// Exécution :
//   SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-key deno test --allow-env supabase/functions/google-review-unsubscribe/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handleReviewUnsubscribe } from './index.ts'

const originalFetch = globalThis.fetch
function restoreFetch() { globalThis.fetch = originalFetch }

interface Row {
  id: string; organisation_id: string; client_id: string
  sent_at: string | null; email: string | null
}

function mockPostgrest(opts: { row: Row | null; suppressionInsertShouldConflict?: boolean }) {
  const suppressionInserts: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'

    if (u.includes('/rest/v1/review_requests') && method === 'GET') {
      const rows = opts.row ? [{
        id: opts.row.id, organisation_id: opts.row.organisation_id, client_id: opts.row.client_id,
        sent_at: opts.row.sent_at, clients: opts.row.email ? { email: opts.row.email } : null,
      }] : []
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('/rest/v1/parametres_entreprise') && method === 'GET') {
      return new Response(JSON.stringify([{ raison_sociale: 'Kaytek Test' }]), { status: 200 })
    }
    if (u.includes('/rest/v1/google_review_suppressions') && method === 'POST') {
      suppressionInserts.push(JSON.parse(String(init?.body ?? '{}')))
      if (opts.suppressionInsertShouldConflict) {
        return new Response(JSON.stringify({ message: 'duplicate key value violates unique constraint' }), { status: 409 })
      }
      return new Response('[]', { status: 201 })
    }
    throw new Error(`Appel fetch non mocké dans ce test : ${method} ${u}`)
  }) as typeof fetch
  return suppressionInserts
}

function makeRequest(opts: { method: 'GET' | 'POST'; token?: string }) {
  if (opts.method === 'GET') {
    const url = new URL('https://example.local/google-review-unsubscribe')
    if (opts.token !== undefined) url.searchParams.set('token', opts.token)
    return new Request(url.toString(), { method: 'GET' })
  }
  return new Request('https://example.local/google-review-unsubscribe', {
    method: 'POST',
    body: JSON.stringify(opts.token !== undefined ? { token: opts.token } : {}),
  })
}

Deno.test('GET token invalide/inexistant — invalid_token, 404, aucune écriture', async () => {
  const inserts = mockPostgrest({ row: null })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'GET', token: 'token-inexistant' }))
    assertEquals(res.status, 404)
    const json = await res.json()
    assertEquals(json.ok, false)
    assertEquals(json.reason, 'invalid_token')
    assertEquals(inserts.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('GET token expiré (envoyé il y a plus de 90 jours) — expired_token, 410', async () => {
  const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  mockPostgrest({ row: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1', sent_at: oldDate, email: 'client@example.com' } })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'GET', token: 'token-expire' }))
    assertEquals(res.status, 410)
    const json = await res.json()
    assertEquals(json.reason, 'expired_token')
  } finally {
    restoreFetch()
  }
})

Deno.test('GET token valide — aperçu avec e-mail masqué, aucune désinscription enregistrée', async () => {
  const recent = new Date().toISOString()
  const inserts = mockPostgrest({ row: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1', sent_at: recent, email: 'client@example.com' } })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'GET', token: 'token-valide' }))
    assertEquals(res.status, 200)
    const json = await res.json()
    assertEquals(json.ok, true)
    assertEquals(json.emailMasked, 'cl***@example.com')
    assertEquals(inserts.length, 0) // un GET ne doit jamais créer la suppression
  } finally {
    restoreFetch()
  }
})

Deno.test('POST token valide — enregistre la désinscription pour la SEULE organisation du token', async () => {
  const recent = new Date().toISOString()
  const inserts = mockPostgrest({ row: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1', sent_at: recent, email: 'client@example.com' } })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'POST', token: 'token-valide' }))
    assertEquals(res.status, 200)
    assertEquals(inserts.length, 1)
    assertEquals(inserts[0].organisation_id, 'org-1')
    assertEquals(inserts[0].email, 'client@example.com')
    assertEquals(inserts[0].reason, 'opt_out')
  } finally {
    restoreFetch()
  }
})

Deno.test('POST répété avec le même token — idempotent, ne renvoie pas d\'erreur', async () => {
  const recent = new Date().toISOString()
  mockPostgrest({ row: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1', sent_at: recent, email: 'client@example.com' }, suppressionInsertShouldConflict: true })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'POST', token: 'token-valide' }))
    assertEquals(res.status, 200)
    const json = await res.json()
    assertEquals(json.ok, true)
  } finally {
    restoreFetch()
  }
})

Deno.test('POST sans token — 400', async () => {
  mockPostgrest({ row: null })
  try {
    const res = await handleReviewUnsubscribe(makeRequest({ method: 'POST' }))
    assertEquals(res.status, 400)
  } finally {
    restoreFetch()
  }
})
