// supabase/functions/_shared/google-ads-api.ts — Phase 3 (découverte de
// comptes Google Ads)
//
// Lecture SEULE : aucun appel de ce module ne crée, modifie ou supprime
// une ressource Google Ads (campagne, budget, mot-clé...). Uniquement
// listAccessibleCustomers + requêtes GAQL en SELECT.
//
// Ne journalise et ne retourne JAMAIS un access_token/refresh_token — la
// valeur du token n'existe que dans la portée de listAccessibleAdsAccounts,
// jamais renvoyée à l'appelant de ce module.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import {
  vaultReadSecret, sanitizeErrorDetail,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_API_BASE,
} from './google-oauth.ts'

export interface AdsAccountInfo {
  customerId: string // "1234567890", sans tirets
  resourceName: string // "customers/1234567890"
  descriptiveName: string | null
  status: string | null // ENABLED, SUSPENDED, CANCELED, CLOSED, UNKNOWN
  currencyCode: string | null
  timeZone: string | null
  isManager: boolean
  managerCustomerId: string | null // MCC parent si découvert via customer_client, sinon null
  infoIncomplete: boolean // true si la requête GAQL descriptive a échoué (seul l'id est fiable)
}

export type AdsAccountsErrorReason =
  | 'not_connected'
  | 'needs_reconnect'
  | 'developer_token_missing'
  | 'developer_token_unapproved'
  | 'api_not_enabled'
  | 'insufficient_scope'
  | 'insufficient_permission'
  | 'google_error'

export type AdsAccountsResult =
  | { ok: true; accounts: AdsAccountInfo[] }
  | { ok: false; reason: AdsAccountsErrorReason; detail?: string }

function classifyGoogleAdsError(status: number, bodyText: string): { reason: AdsAccountsErrorReason; detail: string } {
  const detail = sanitizeErrorDetail(bodyText)
  const low = bodyText.toLowerCase()
  if (low.includes('developer_token_not_approved') || low.includes('developer token is not approved')) {
    return { reason: 'developer_token_unapproved', detail }
  }
  if (low.includes('developer_token_prohibited') || low.includes('invalid developer token')) {
    return { reason: 'developer_token_unapproved', detail }
  }
  if (low.includes('has not been used') || (status === 403 && low.includes('disabled'))) {
    return { reason: 'api_not_enabled', detail }
  }
  // Voir commentaire équivalent dans _shared/google-business-api.ts — jeton
  // émis sans le scope adwords, correctif côté utilisateur (révoquer
  // depuis myaccount.google.com/permissions puis reconnecter).
  if (low.includes('access_token_scope_insufficient') || low.includes('insufficient authentication scopes')) {
    return { reason: 'insufficient_scope', detail }
  }
  if (low.includes('user_permission_denied') || low.includes('permission_denied') || status === 403) {
    return { reason: 'insufficient_permission', detail }
  }
  return { reason: 'google_error', detail }
}

async function googleAdsFetch(
  path: string, accessToken: string, loginCustomerId: string | null, init?: RequestInit,
): Promise<{ ok: true; json: any } | { ok: false; status: number; bodyText: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  }
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId

  const res = await fetch(`${GOOGLE_ADS_API_BASE}/${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  const bodyText = await res.text()
  if (!res.ok) return { ok: false, status: res.status, bodyText }
  try {
    return { ok: true, json: bodyText ? JSON.parse(bodyText) : {} }
  } catch {
    return { ok: false, status: res.status, bodyText: 'reponse_google_illisible' }
  }
}

async function fetchCustomerSelfInfo(customerId: string, accessToken: string): Promise<Partial<AdsAccountInfo> | null> {
  const query = 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer LIMIT 1'
  const res = await googleAdsFetch(`customers/${customerId}/googleAds:search`, accessToken, customerId, {
    method: 'POST', body: JSON.stringify({ query }),
  })
  if (!res.ok) return null
  const row = res.json.results?.[0]?.customer
  if (!row) return null
  return {
    descriptiveName: row.descriptiveName ?? null,
    currencyCode: row.currencyCode ?? null,
    timeZone: row.timeZone ?? null,
    isManager: row.manager === true,
    status: row.status ?? null,
  }
}

// Un seul niveau de hiérarchie MCC pris en charge (comptes clients
// directement rattachés au manager) — pas de récursion multi-niveaux
// (limite documentée dans le rapport Phase 3, pas un choix silencieux).
async function fetchManagerChildren(managerId: string, accessToken: string): Promise<AdsAccountInfo[]> {
  const query = `SELECT customer_client.client_customer, customer_client.descriptive_name,
    customer_client.currency_code, customer_client.time_zone, customer_client.manager,
    customer_client.status, customer_client.level
    FROM customer_client WHERE customer_client.level <= 1`
  const res = await googleAdsFetch(`customers/${managerId}/googleAds:search`, accessToken, managerId, {
    method: 'POST', body: JSON.stringify({ query }),
  })
  if (!res.ok) return []
  const rows = res.json.results ?? []
  const children: AdsAccountInfo[] = []
  for (const row of rows) {
    const cc = row.customerClient
    if (!cc || cc.level === 0) continue // level 0 = le manager lui-même, déjà listé ailleurs
    const childId = String(cc.clientCustomer ?? '').replace('customers/', '')
    if (!childId) continue
    children.push({
      customerId: childId,
      resourceName: `customers/${childId}`,
      descriptiveName: cc.descriptiveName ?? null,
      status: cc.status ?? null,
      currencyCode: cc.currencyCode ?? null,
      timeZone: cc.timeZone ?? null,
      isManager: cc.manager === true,
      managerCustomerId: managerId,
      infoIncomplete: false,
    })
  }
  return children
}

export async function listAccessibleAdsAccounts(svc: SupabaseClient, organisationId: string): Promise<AdsAccountsResult> {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) {
    return { ok: false, reason: 'developer_token_missing' }
  }
  if (!GOOGLE_OAUTH_CLIENT_ID) {
    return { ok: false, reason: 'google_error', detail: 'configuration_oauth_incomplete' }
  }

  const refresh = await ensureFreshAccessToken(svc, 'google_ads', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect', detail: refresh.reason }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const { data: connection } = await svc
    .from('google_ads_connections')
    .select('access_token_secret_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()
  if (!connection?.access_token_secret_id) return { ok: false, reason: 'not_connected' }

  let accessToken: string | null
  try {
    accessToken = await vaultReadSecret(svc, connection.access_token_secret_id)
  } catch (e) {
    return { ok: false, reason: 'google_error', detail: sanitizeErrorDetail(e instanceof Error ? e.message : 'lecture_vault_echouee') }
  }
  if (!accessToken) return { ok: false, reason: 'not_connected' }

  // ── 1. Comptes directement accessibles (top-level) ────────────────────
  const listRes = await googleAdsFetch('customers:listAccessibleCustomers', accessToken, null)
  if (!listRes.ok) {
    const { reason, detail } = classifyGoogleAdsError(listRes.status, listRes.bodyText)
    return { ok: false, reason, detail }
  }
  const resourceNames: string[] = listRes.json.resourceNames ?? []
  if (resourceNames.length === 0) return { ok: true, accounts: [] }

  const topLevelIds = resourceNames.map((rn) => rn.replace('customers/', ''))

  // ── 2. Détail (descriptive_name, devise, fuseau, manager) par compte,
  // en parallèle, sans faire échouer toute la réponse si un seul appel
  // échoue (compte suspendu, droits partiels...). ────────────────────────
  const detailsSettled = await Promise.allSettled(topLevelIds.map((id) => fetchCustomerSelfInfo(id, accessToken!)))

  const topLevel: AdsAccountInfo[] = topLevelIds.map((id, i) => {
    const settled = detailsSettled[i]
    const info = settled.status === 'fulfilled' ? settled.value : null
    return {
      customerId: id,
      resourceName: `customers/${id}`,
      descriptiveName: info?.descriptiveName ?? null,
      status: info?.status ?? null,
      currencyCode: info?.currencyCode ?? null,
      timeZone: info?.timeZone ?? null,
      isManager: info?.isManager ?? false,
      managerCustomerId: null,
      infoIncomplete: info === null,
    }
  })

  // ── 3. Comptes clients rattachés à chaque manager top-level (1 niveau) ─
  const managerIds = topLevel.filter((a) => a.isManager).map((a) => a.customerId)
  const childrenLists = await Promise.allSettled(managerIds.map((id) => fetchManagerChildren(id, accessToken!)))
  const allChildren: AdsAccountInfo[] = childrenLists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))

  const known = new Set(topLevel.map((a) => a.customerId))
  const merged = [...topLevel, ...allChildren.filter((c) => !known.has(c.customerId))]

  return { ok: true, accounts: merged }
}
