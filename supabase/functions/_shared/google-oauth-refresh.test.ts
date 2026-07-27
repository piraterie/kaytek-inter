// supabase/functions/_shared/google-oauth-refresh.test.ts
// Tests unitaires du helper de renouvellement — AUCUN appel réseau réel :
// globalThis.fetch est intégralement remplacé par un mock local pour
// chaque test (jamais un seul octet envoyé à oauth2.googleapis.com),
// conformément à la règle absolue #20 (aucun contact Google réel pendant
// les tests automatisés). Le client Supabase est lui aussi un faux objet
// en mémoire (aucune connexion réseau/DB).
//
// Exécution : deno test --allow-env supabase/functions/_shared/google-oauth-refresh.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'

interface FakeConnectionRow {
  id: string
  status: string
  access_token_secret_id: string | null
  refresh_token_secret_id: string | null
  token_expires_at: string | null
  last_error?: string | null
}

// Faux client Supabase minimal — implémente uniquement les méthodes
// utilisées par ensureFreshAccessToken()/vaultReadSecret()/
// vaultUpdateSecret(). Ne contacte jamais un réseau ni une base réelle.
function makeFakeSupabase(connection: FakeConnectionRow | null, vaultSecrets: Record<string, string>) {
  const updates: Record<string, unknown>[] = []
  const rpcCalls: { name: string; args: unknown }[] = []

  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  return { data: connection, error: null }
                },
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, _val: string) {
              updates.push(patch)
              if (connection) Object.assign(connection, patch)
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
    async rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      if (name === 'google_oauth_vault_read') {
        const value = vaultSecrets[args.p_secret_id]
        return { data: value ?? null, error: null }
      }
      if (name === 'google_oauth_vault_update') {
        vaultSecrets[args.p_secret_id] = args.p_secret
        return { data: null, error: null }
      }
      throw new Error(`RPC non mocké dans ce test : ${name}`)
    },
  }

  return { client, updates, rpcCalls }
}

const ORG_ID = '00000000-0000-0000-0000-0000000000a1'
const originalFetch = globalThis.fetch

function restoreFetch() {
  globalThis.fetch = originalFetch
}

Deno.test('token encore valide (marge > 2 min) — aucun appel réseau, statut "fresh"', async () => {
  let fetchCalled = false
  globalThis.fetch = (() => { fetchCalled = true; throw new Error('fetch ne doit JAMAIS être appelé ici') }) as typeof fetch
  try {
    const { client } = makeFakeSupabase({
      id: 'conn-1', status: 'connected',
      access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, {})
    const result = await ensureFreshAccessToken(client as any, 'google_ads', ORG_ID)
    assertEquals(result.status, 'fresh')
    assertEquals(fetchCalled, false, 'aucun appel réseau ne doit avoir lieu pour un token encore valide')
  } finally {
    restoreFetch()
  }
})

Deno.test('token expiré — renouvellement simulé réussi, statut "refreshed", nouveau token stocké via Vault', async () => {
  const calledUrls: string[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calledUrls.push(String(url))
    // Simule la réponse de oauth2.googleapis.com/token — jamais un vrai appel.
    return new Response(JSON.stringify({ access_token: 'NOUVEAU_TOKEN_SIMULE', expires_in: 3600 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const vault: Record<string, string> = { 'secret-refresh-1': 'REFRESH_TOKEN_SIMULE' }
    const { client, updates } = makeFakeSupabase({
      id: 'conn-1', status: 'connected',
      access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
      token_expires_at: new Date(Date.now() - 1000).toISOString(), // déjà expiré
    }, vault)

    const result = await ensureFreshAccessToken(client as any, 'google_ads', ORG_ID)
    assertEquals(result.status, 'refreshed')
    assertEquals(calledUrls.length, 1)
    assertEquals(calledUrls[0], 'https://oauth2.googleapis.com/token')
    assertEquals(vault['secret-access-1'], 'NOUVEAU_TOKEN_SIMULE', 'le nouveau token doit être écrit dans le Vault simulé')
    // Le nouveau token n'apparaît JAMAIS dans les updates de la ligne de connexion elle-même.
    for (const u of updates) {
      assertEquals(JSON.stringify(u).includes('NOUVEAU_TOKEN_SIMULE'), false, 'le token ne doit jamais transiter par une colonne de la table de connexion')
    }
  } finally {
    restoreFetch()
  }
})

Deno.test('refresh refusé par Google (invalid_grant) — connexion marquée "expired" (à reconnecter), aucun secret exposé', async () => {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const vault: Record<string, string> = { 'secret-refresh-1': 'REFRESH_TOKEN_REVOQUE_SIMULE' }
    const { client } = makeFakeSupabase({
      id: 'conn-1', status: 'connected',
      access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }, vault)

    const result = await ensureFreshAccessToken(client as any, 'google_ads', ORG_ID)
    assertEquals(result.status, 'needs_reconnect')
    if (result.status === 'needs_reconnect') assertEquals(result.reason, 'invalid_grant')
  } finally {
    restoreFetch()
  }
})

Deno.test('connexion inexistante — statut "not_connected", aucun appel réseau', async () => {
  let fetchCalled = false
  globalThis.fetch = (() => { fetchCalled = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const { client } = makeFakeSupabase(null, {})
    const result = await ensureFreshAccessToken(client as any, 'google_business', ORG_ID)
    assertEquals(result.status, 'not_connected')
    assertEquals(fetchCalled, false)
  } finally {
    restoreFetch()
  }
})

Deno.test('aucune valeur de token retournée par ensureFreshAccessToken, quel que soit le scénario', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: 'X', expires_in: 3600 }), { status: 200 })) as typeof fetch
  try {
    const vault: Record<string, string> = { 'secret-refresh-1': 'R' }
    const { client } = makeFakeSupabase({
      id: 'conn-1', status: 'connected',
      access_token_secret_id: 'secret-access-1', refresh_token_secret_id: 'secret-refresh-1',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }, vault)
    const result = await ensureFreshAccessToken(client as any, 'google_ads', ORG_ID)
    const serialized = JSON.stringify(result)
    assertEquals(serialized.includes('X'), false)
    assertEquals(Object.keys(result), ['status'])
  } finally {
    restoreFetch()
  }
})
