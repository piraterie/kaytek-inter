// supabase/functions/_shared/google-business-api.ts — Phase 3 (découverte
// des comptes/établissements Google Business Profile)
//
// Lecture SEULE : aucun appel de ce module ne crée, modifie ou supprime un
// compte, un établissement, une fiche, une photo, un horaire ou un avis.
// Uniquement GET sur les APIs Account Management / Business Information.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import {
  vaultReadSecret, sanitizeErrorDetail,
  GBP_ACCOUNT_MANAGEMENT_BASE, GBP_BUSINESS_INFORMATION_BASE,
} from './google-oauth.ts'

export interface GbpLocationInfo {
  accountResourceName: string
  accountName: string | null
  accountType: string | null
  locationResourceName: string
  storeCode: string | null
  title: string | null
  address: string | null
  phone: string | null
  openStatus: string | null
  mapsUri: string | null
  // Non déterminé dans cette passe (Phase 3) : la vérification d'un
  // établissement nécessite un appel dédié (locations.getVoiceOfMerchantState)
  // non implémenté ici — limite documentée, pas une valeur devinée.
  verificationStatus: 'unknown'
}

export type GbpLocationsErrorReason =
  | 'not_connected'
  | 'needs_reconnect'
  | 'api_not_enabled'
  | 'insufficient_permission'
  | 'google_error'

export type GbpLocationsResult =
  | { ok: true; accounts: { accountResourceName: string; accountName: string | null; accountType: string | null; locations: GbpLocationInfo[] }[] }
  | { ok: false; reason: GbpLocationsErrorReason; detail?: string }

const MAX_PAGES = 10 // garde-fou anti-boucle infinie — pas de pagination illimitée

function classifyGbpError(status: number, bodyText: string): { reason: GbpLocationsErrorReason; detail: string } {
  const detail = sanitizeErrorDetail(bodyText)
  const low = bodyText.toLowerCase()
  if (low.includes('has not been used') || (status === 403 && low.includes('disabled'))) {
    return { reason: 'api_not_enabled', detail }
  }
  if (low.includes('permission_denied') || status === 403 || status === 401) {
    return { reason: 'insufficient_permission', detail }
  }
  return { reason: 'google_error', detail }
}

async function gbpFetch(url: string, accessToken: string): Promise<{ ok: true; json: any } | { ok: false; status: number; bodyText: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const bodyText = await res.text()
  if (!res.ok) return { ok: false, status: res.status, bodyText }
  try {
    return { ok: true, json: bodyText ? JSON.parse(bodyText) : {} }
  } catch {
    return { ok: false, status: res.status, bodyText: 'reponse_google_illisible' }
  }
}

function formatAddress(addr: any): string | null {
  if (!addr) return null
  const parts = [
    ...(Array.isArray(addr.addressLines) ? addr.addressLines : []),
    addr.postalCode, addr.locality, addr.administrativeArea, addr.regionCode,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export async function listAccessibleGbpLocations(svc: SupabaseClient, organisationId: string): Promise<GbpLocationsResult> {
  const refresh = await ensureFreshAccessToken(svc, 'google_business', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect', detail: refresh.reason }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const { data: connection } = await svc
    .from('gbp_connections')
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

  // ── 1. Comptes Business Profile accessibles (paginé) ──────────────────
  const accounts: { name: string; accountName?: string; type?: string }[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const url = new URL(`${GBP_ACCOUNT_MANAGEMENT_BASE}/accounts`)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await gbpFetch(url.toString(), accessToken)
    if (!res.ok) {
      const { reason, detail } = classifyGbpError(res.status, res.bodyText)
      return { ok: false, reason, detail }
    }
    accounts.push(...(res.json.accounts ?? []))
    pageToken = res.json.nextPageToken
    pages++
  } while (pageToken && pages < MAX_PAGES)

  if (accounts.length === 0) return { ok: true, accounts: [] }

  // ── 2. Établissements de chaque compte (paginé, readMask minimal) ─────
  const readMask = 'name,title,storeCode,storefrontAddress,phoneNumbers,openInfo,metadata'
  const result: { accountResourceName: string; accountName: string | null; accountType: string | null; locations: GbpLocationInfo[] }[] = []

  for (const account of accounts) {
    const locations: GbpLocationInfo[] = []
    let locPageToken: string | undefined
    let locPages = 0
    do {
      const url = new URL(`${GBP_BUSINESS_INFORMATION_BASE}/${account.name}/locations`)
      url.searchParams.set('readMask', readMask)
      if (locPageToken) url.searchParams.set('pageToken', locPageToken)
      const res = await gbpFetch(url.toString(), accessToken)
      if (!res.ok) {
        // Un compte partiellement inaccessible ne doit pas faire échouer
        // toute la réponse — on arrête simplement sa pagination.
        break
      }
      for (const loc of res.json.locations ?? []) {
        locations.push({
          accountResourceName: account.name,
          accountName: account.accountName ?? null,
          accountType: account.type ?? null,
          locationResourceName: loc.name,
          storeCode: loc.storeCode ?? null,
          title: loc.title ?? null,
          address: formatAddress(loc.storefrontAddress),
          phone: loc.phoneNumbers?.primaryPhone ?? null,
          openStatus: loc.openInfo?.status ?? null,
          mapsUri: loc.metadata?.mapsUri ?? null,
          verificationStatus: 'unknown',
        })
      }
      locPageToken = res.json.nextPageToken
      locPages++
    } while (locPageToken && locPages < MAX_PAGES)

    result.push({ accountResourceName: account.name, accountName: account.accountName ?? null, accountType: account.type ?? null, locations })
  }

  return { ok: true, accounts: result }
}
