// supabase/functions/_shared/google-ads-test-support.ts
//
// SUPPORT DE TEST UNIQUEMENT (importé par les fichiers *.test.ts, jamais par une
// Edge Function) : base Supabase en mémoire + API Google Ads simulée.
//
// La base en mémoire reproduit les CONTRAINTES D'UNICITÉ réelles des migrations :
// un upsert dont onConflict ne correspond pas exactement à une contrainte, ou dont
// un lot contient deux lignes de même clé, échoue comme dans PostgreSQL. Ces
// tests détectent donc un désaccord entre le code et le schéma SQL.

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>

/** Colonnes de chaque contrainte UNIQUE / clé primaire (miroir de 20260921120000_google_ads_intraday_tables.sql). */
export const UNIQUE_KEYS: Record<string, string> = {
  google_ads_metrics_hourly: 'organisation_id,customer_id,local_date,hour,campaign_id',
  google_ads_devices_daily: 'organisation_id,customer_id,local_date,device',
  google_ads_demographics_daily: 'organisation_id,customer_id,local_date,dimension,value',
  google_ads_geo_daily: 'organisation_id,customer_id,local_date,geo_level,presence_type,geo_target_id',
  google_ads_targeted_zones: 'organisation_id,customer_id,campaign_id,criterion_id',
  google_ads_campaigns: 'organisation_id,customer_id,campaign_id',
  google_geo_targets: 'geo_target_id',
  google_ads_sync_state: 'organisation_id,customer_id,dataset',
  google_ads_metrics_daily: 'organisation_id,date,campaign_id', // table historique (migration 20260728000004)
}

export function makeFakeDb(seed: Record<string, Row[]> = {}, opts: { failWrites?: string[] } = {}) {
  const tables: Record<string, Row[]> = { google_ads_connections: [], google_ads_sync_state: [], google_geo_targets: [], ...seed }
  for (const t of Object.keys(UNIQUE_KEYS)) tables[t] ??= []
  const events: Row[] = []
  const secrets: Record<string, string> = {}
  let writes = 0

  const svc = {
    from(name: string) {
      if (name === 'google_oauth_events') return { insert: (r: Row) => { events.push(r); return Promise.resolve({ error: null }) } }
      const rows = (tables[name] ??= [])
      const filters: ((r: Row) => boolean)[] = []
      const builder: Row = {
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return builder },
        neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return builder },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return builder },
        lt(c: string, v: string) { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return builder },
        not(c: string, op: string, v: unknown) { if (op === 'is' && v === null) filters.push((r) => r[c] != null); return builder },
        select(_cols?: string) { return builder },
        maybeSingle: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null }).then(res, rej)
        },
        update(patch: Row) {
          const b: Row = {
            eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b },
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
              rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch)); writes++
              return Promise.resolve({ error: null }).then(res, rej)
            },
          }
          return b
        },
        delete() {
          const b: Row = {
            eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b },
            lt(c: string, v: string) { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b },
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
              const keep = rows.filter((r) => !filters.every((f) => f(r))); rows.length = 0; rows.push(...keep); writes++
              return Promise.resolve({ error: null }).then(res, rej)
            },
          }
          return b
        },
        upsert(input: Row | Row[], o: { onConflict?: string } = {}) {
          const batch = Array.isArray(input) ? input : [input] // supabase-js accepte un objet ou un tableau
          if (opts.failWrites?.includes(name)) return Promise.resolve({ error: { message: `échec simulé d'écriture sur ${name}` } })
          const expected = UNIQUE_KEYS[name]
          if (!expected || o.onConflict !== expected) {
            return Promise.resolve({ error: { message: `no unique or exclusion constraint matching the ON CONFLICT specification (${name}: "${o.onConflict}" ≠ "${expected}")` } })
          }
          const cols = expected.split(',')
          const keyOf = (r: Row) => cols.map((c) => String(r[c])).join('\u0001')
          const seen = new Set<string>()
          for (const r of batch) {
            const k = keyOf(r)
            if (seen.has(k)) return Promise.resolve({ error: { message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } })
            seen.add(k)
          }
          for (const r of batch) {
            const existing = rows.find((x) => keyOf(x) === keyOf(r))
            if (existing) Object.assign(existing, r); else rows.push({ ...r })
          }
          writes++
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
    rpc(name: string, args: Row) {
      if (name === 'google_oauth_vault_read') return Promise.resolve({ data: secrets[args.p_secret_id] ?? null, error: null })
      if (name === 'get_internal_push_secret') return Promise.resolve({ data: 'internal-secret-for-tests', error: null })
      return Promise.resolve({ data: null, error: { message: `rpc non simulée : ${name}` } })
    },
  }
  return { svc, tables, events, secrets, get writes() { return writes } }
}

/** Connexion Ads active de test. */
export function adsConnection(org: string, overrides: Row = {}): Row {
  return {
    organisation_id: org, status: 'connected', google_customer_id: '7536669574', google_login_customer_id: null,
    time_zone: 'Europe/Paris', is_manager_account: false, access_token_secret_id: `sec-${org}`, refresh_token_secret_id: `ref-${org}`,
    token_expires_at: '2099-01-01T00:00:00Z', last_synced_at: null, metrics_synced_at: null, last_error: null, ...overrides,
  }
}

export interface GoogleCall { url: string; query: string; pageToken?: string; headers: Record<string, string> }

/**
 * API Google Ads simulée : chaque route associe un motif de requête GAQL à une
 * réponse (ou une fonction). Une requête sans route répond 500 : un appel
 * inattendu fait échouer le test qui l'attend inexistant (compteur `calls`).
 */
export function makeFakeGoogle(routes: { match: RegExp; respond: (call: GoogleCall) => { status?: number; body: unknown } }[]) {
  const calls: GoogleCall[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    const call: GoogleCall = { url: String(url), query: body.query ?? '', pageToken: body.pageToken, headers: (init?.headers ?? {}) as Record<string, string> }
    calls.push(call)
    const route = routes.find((r) => r.match.test(call.query))
    if (!route) return new Response(JSON.stringify({ error: { message: 'route non simulée' } }), { status: 500 })
    const out = route.respond(call)
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fetchFn, calls, queries: () => calls.map((c) => c.query) }
}

export const metricsOf = (impressions: number, clicks: number, costMicros: number, conversions = 0) =>
  ({ impressions: String(impressions), clicks: String(clicks), costMicros: String(costMicros), conversions, conversionsValue: 0 })
