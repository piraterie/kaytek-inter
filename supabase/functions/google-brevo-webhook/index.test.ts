// supabase/functions/google-brevo-webhook/index.test.ts
//
// Tests unitaires de handleBrevoWebhook() — AUCUN appel réseau réel,
// globalThis.fetch entièrement remplacé par un routeur en mémoire simulant
// PostgREST (get_google_brevo_webhook_secret, review_requests, clients,
// google_review_suppressions). Vérifie en particulier : un secret erroné
// est rejeté (401) sans jamais toucher review_requests, et un hard bounce /
// une plainte spam créent bien une ligne de suppression pour bloquer les
// futurs envois à cette adresse dans CETTE organisation.
//
// Exécution :
//   SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-key deno test --allow-env supabase/functions/google-brevo-webhook/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handleBrevoWebhook } from './index.ts'

const originalFetch = globalThis.fetch
function restoreFetch() { globalThis.fetch = originalFetch }

const REAL_SECRET = 'FAKE_WEBHOOK_SECRET_NEVER_REAL'

interface Route {
  reviewRequest?: { id: string; organisation_id: string; client_id: string } | null
  clientEmail?: string | null
  suppressionInserts: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
}

function mockPostgrest(route: Route) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'

    if (u.includes('/rpc/get_google_brevo_webhook_secret')) {
      return new Response(JSON.stringify(REAL_SECRET), { status: 200 })
    }
    if (u.includes('/rest/v1/review_requests') && method === 'GET') {
      const rows = route.reviewRequest ? [route.reviewRequest] : []
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('/rest/v1/review_requests') && (method === 'PATCH')) {
      route.updates.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response('[]', { status: 200 })
    }
    if (u.includes('/rest/v1/clients') && method === 'GET') {
      return new Response(JSON.stringify(route.clientEmail ? [{ email: route.clientEmail }] : []), { status: 200 })
    }
    if (u.includes('/rest/v1/google_review_suppressions') && method === 'POST') {
      route.suppressionInserts.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response('[]', { status: 201 })
    }
    throw new Error(`Appel fetch non mocké dans ce test : ${method} ${u}`)
  }) as typeof fetch
}

function makeRequest(opts: { secret?: string; method?: string; body?: unknown }) {
  const url = new URL('https://example.local/google-brevo-webhook')
  if (opts.secret !== undefined) url.searchParams.set('secret', opts.secret)
  return new Request(url.toString(), {
    method: opts.method ?? 'POST',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

Deno.test('Secret webhook incorrect — 401, aucune écriture en base', async () => {
  const route: Route = { reviewRequest: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1' }, suppressionInserts: [], updates: [] }
  mockPostgrest(route)
  try {
    const res = await handleBrevoWebhook(makeRequest({ secret: 'WRONG_SECRET', body: { event: 'delivered', 'message-id': 'msg-1' } }))
    assertEquals(res.status, 401)
    assertEquals(route.updates.length, 0)
  } finally {
    restoreFetch()
  }
})

Deno.test('Secret webhook absent — 401', async () => {
  const route: Route = { reviewRequest: null, suppressionInserts: [], updates: [] }
  mockPostgrest(route)
  try {
    const res = await handleBrevoWebhook(makeRequest({ body: { event: 'delivered', 'message-id': 'msg-1' } }))
    assertEquals(res.status, 401)
  } finally {
    restoreFetch()
  }
})

Deno.test('message-id inconnu — toujours 200 (ignoré), jamais une erreur envers Brevo', async () => {
  const route: Route = { reviewRequest: null, suppressionInserts: [], updates: [] }
  mockPostgrest(route)
  try {
    const res = await handleBrevoWebhook(makeRequest({ secret: REAL_SECRET, body: { event: 'delivered', 'message-id': 'msg-inconnu' } }))
    assertEquals(res.status, 200)
    const json = await res.json()
    assertEquals(json.ignored, 'message_id_inconnu')
  } finally {
    restoreFetch()
  }
})

Deno.test('hard_bounce — met à jour delivery_status ET crée une suppression pour cette organisation', async () => {
  const route: Route = {
    reviewRequest: { id: 'rr-1', organisation_id: 'org-1', client_id: 'c-1' },
    clientEmail: 'client@example.com',
    suppressionInserts: [], updates: [],
  }
  mockPostgrest(route)
  try {
    const res = await handleBrevoWebhook(makeRequest({ secret: REAL_SECRET, body: { event: 'hard_bounce', 'message-id': 'msg-1', reason: 'mailbox does not exist' } }))
    assertEquals(res.status, 200)
    assertEquals(route.updates[0].delivery_status, 'bounced_hard')
    assertEquals(route.suppressionInserts.length, 1)
    assertEquals(route.suppressionInserts[0].organisation_id, 'org-1')
    assertEquals(route.suppressionInserts[0].email, 'client@example.com')
    assertEquals(route.suppressionInserts[0].reason, 'hard_bounce')
  } finally {
    restoreFetch()
  }
})

Deno.test('spam (plainte) — crée une suppression avec reason=complaint', async () => {
  const route: Route = {
    reviewRequest: { id: 'rr-2', organisation_id: 'org-2', client_id: 'c-2' },
    clientEmail: 'autre@example.com',
    suppressionInserts: [], updates: [],
  }
  mockPostgrest(route)
  try {
    await handleBrevoWebhook(makeRequest({ secret: REAL_SECRET, body: { event: 'spam', 'message-id': 'msg-2' } }))
    assertEquals(route.suppressionInserts[0].reason, 'complaint')
    assertEquals(route.suppressionInserts[0].organisation_id, 'org-2')
  } finally {
    restoreFetch()
  }
})

Deno.test('delivered — met à jour le statut mais ne crée jamais de suppression', async () => {
  const route: Route = {
    reviewRequest: { id: 'rr-3', organisation_id: 'org-1', client_id: 'c-1' },
    clientEmail: 'client@example.com',
    suppressionInserts: [], updates: [],
  }
  mockPostgrest(route)
  try {
    await handleBrevoWebhook(makeRequest({ secret: REAL_SECRET, body: { event: 'delivered', 'message-id': 'msg-3' } }))
    assertEquals(route.updates[0].delivery_status, 'delivered')
    assertEquals(route.suppressionInserts.length, 0)
  } finally {
    restoreFetch()
  }
})
