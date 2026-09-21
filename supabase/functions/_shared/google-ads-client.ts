// supabase/functions/_shared/google-ads-client.ts
//
// Client de LECTURE Google Ads (googleAds:search) avec pagination. Lecture seule :
// aucune mutation, uniquement des requêtes GAQL SELECT.
//
// Sécurité : ni le jeton d'accès ni le corps brut d'une erreur ne sont jamais
// renvoyés ou journalisés tels quels — le détail est nettoyé
// (sanitizeErrorDetail) puis tronqué, et la valeur exacte du jeton en est
// retirée même si Google la renvoyait.
import { sanitizeErrorDetail, GOOGLE_ADS_API_BASE, GOOGLE_ADS_DEVELOPER_TOKEN } from './google-oauth.ts'

export interface AdsContext {
  accessToken: string
  customerId: string
  loginCustomerId: string | null
  fetchFn?: typeof fetch
}

export type AdsErrorReason = 'unauthorized' | 'api_not_enabled' | 'insufficient_permission' | 'rate_limited' | 'google_error' | 'network' | 'too_many_pages'

export type AdsSearchResult =
  // deno-lint-ignore no-explicit-any
  | { ok: true; rows: any[]; pages: number }
  | { ok: false; status: number; reason: AdsErrorReason; detail: string }

/** Garde-fou : Google renvoie 10 000 lignes par page ; au-delà de 50 pages, on s'arrête. */
export const MAX_PAGES = 50

function classify(status: number, body: string): AdsErrorReason {
  const low = body.toLowerCase()
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (low.includes('has not been used') || (status === 403 && low.includes('disabled'))) return 'api_not_enabled'
  if (status === 403) return 'insufficient_permission'
  return 'google_error'
}

export async function adsSearchAll(ctx: AdsContext, gaql: string, opts: { maxPages?: number } = {}): Promise<AdsSearchResult> {
  const doFetch = ctx.fetchFn ?? fetch
  const maxPages = opts.maxPages ?? MAX_PAGES
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' }
  if (GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = GOOGLE_ADS_DEVELOPER_TOKEN
  if (ctx.loginCustomerId) headers['login-customer-id'] = ctx.loginCustomerId
  const url = `${GOOGLE_ADS_API_BASE}/customers/${ctx.customerId}/googleAds:search`
  const scrub = (s: string) => sanitizeErrorDetail(s.split(ctx.accessToken).join('[REDACTED]'), 300)

  // deno-lint-ignore no-explicit-any
  const rows: any[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    let res: Response
    let text: string
    try {
      res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(pageToken ? { query: gaql, pageToken } : { query: gaql }) })
      text = await res.text()
    } catch (e) {
      // Le message d'une erreur réseau peut contenir l'URL, jamais le jeton — nettoyé quand même.
      return { ok: false, status: 0, reason: 'network', detail: scrub(e instanceof Error ? e.message : 'reseau_indisponible') }
    }
    if (!res.ok) return { ok: false, status: res.status, reason: classify(res.status, text), detail: scrub(text) }
    // deno-lint-ignore no-explicit-any
    let json: any
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      return { ok: false, status: res.status, reason: 'google_error', detail: 'reponse_google_illisible' }
    }
    rows.push(...(json.results ?? []))
    pages++
    pageToken = json.nextPageToken || undefined
    if (pageToken && pages >= maxPages) return { ok: false, status: res.status, reason: 'too_many_pages', detail: `plus de ${maxPages} pages` }
  } while (pageToken)

  return { ok: true, rows, pages }
}
