// supabase/functions/_shared/google-business-reviews.ts — Phase 4
//
// Synchronisation et réponse aux avis Google Business Profile.
// API utilisée : mybusiness.googleapis.com/v4 (endpoints Reviews —
// confirmés actifs/à jour, distincts des endpoints Account Management /
// Business Information déjà migrés vers les APIs modernes dans
// google-business-api.ts ; Google n'a pas encore déplacé la gestion des
// avis hors de v4 à ce jour).
//
// Lecture + réponse UNIQUEMENT : aucune suppression d'avis (impossible
// côté propriétaire de toute façon), suppression de réponse prise en
// charge (DELETE .../reply) car explicitly demandée par le produit.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import { vaultReadSecret, sanitizeErrorDetail } from './google-oauth.ts'

const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4'
const MAX_PAGES = 20 // garde-fou anti-boucle infinie

export type GbpReviewSyncErrorReason =
  | 'not_connected'
  | 'needs_reconnect'
  | 'no_location_selected'
  | 'api_not_enabled'
  | 'insufficient_permission'
  | 'google_error'

interface GoogleReviewApi {
  reviewId: string
  reviewer?: { displayName?: string }
  starRating?: string // 'ONE'..'FIVE'
  comment?: string
  createTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

async function getConnectionContext(svc: SupabaseClient, organisationId: string) {
  const { data: connection } = await svc
    .from('gbp_connections')
    .select('access_token_secret_id, google_account_id, google_location_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()
  return connection
}

async function gbpV4Fetch(
  url: string, accessToken: string, init?: RequestInit,
): Promise<{ ok: true; json: any } | { ok: false; status: number; bodyText: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const bodyText = await res.text()
  if (!res.ok) return { ok: false, status: res.status, bodyText }
  try {
    return { ok: true, json: bodyText ? JSON.parse(bodyText) : {} }
  } catch {
    return { ok: false, status: res.status, bodyText: 'reponse_google_illisible' }
  }
}

function classifyError(status: number, bodyText: string): { reason: GbpReviewSyncErrorReason; detail: string } {
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

export type SyncReviewsResult =
  | { ok: true; synced: number; newReviews: number }
  | { ok: false; reason: GbpReviewSyncErrorReason; detail?: string }

// Récupère TOUTES les pages d'avis auprès de Google et upsert dans
// gbp_reviews (organisation_id, google_review_id) — jamais d'écrasement
// des colonnes de rapprochement client (matched_client_id/match_confidence/
// confirmed_by/confirmed_at), uniquement les champs propres à Google.
export async function syncGbpReviews(svc: SupabaseClient, organisationId: string): Promise<SyncReviewsResult> {
  const refresh = await ensureFreshAccessToken(svc, 'google_business', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const connection = await getConnectionContext(svc, organisationId)
  if (!connection?.access_token_secret_id) return { ok: false, reason: 'not_connected' }
  if (!connection.google_account_id || !connection.google_location_id) return { ok: false, reason: 'no_location_selected' }

  let accessToken: string | null
  try {
    accessToken = await vaultReadSecret(svc, connection.access_token_secret_id)
  } catch (e) {
    return { ok: false, reason: 'google_error', detail: sanitizeErrorDetail(e instanceof Error ? e.message : 'lecture_vault_echouee') }
  }
  if (!accessToken) return { ok: false, reason: 'not_connected' }

  const reviews: GoogleReviewApi[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const url = new URL(`${MYBUSINESS_V4_BASE}/${connection.google_account_id}/${connection.google_location_id}/reviews`)
    url.searchParams.set('pageSize', '50')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await gbpV4Fetch(url.toString(), accessToken)
    if (!res.ok) {
      const { reason, detail } = classifyError(res.status, res.bodyText)
      return { ok: false, reason, detail }
    }
    reviews.push(...(res.json.reviews ?? []))
    pageToken = res.json.nextPageToken
    pages++
  } while (pageToken && pages < MAX_PAGES)

  let newReviews = 0
  for (const r of reviews) {
    const { data: existing } = await svc
      .from('gbp_reviews')
      .select('id')
      .eq('organisation_id', organisationId)
      .eq('google_review_id', r.reviewId)
      .maybeSingle()

    const row = {
      organisation_id: organisationId,
      google_review_id: r.reviewId,
      reviewer_display_name: r.reviewer?.displayName ?? null,
      star_rating: r.starRating ? (STAR_MAP[r.starRating] ?? null) : null,
      comment: r.comment ?? null,
      review_created_at: r.createTime ?? null,
      response_text: r.reviewReply?.comment ?? null,
      response_updated_at: r.reviewReply?.updateTime ?? null,
      response_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await svc.from('gbp_reviews').update(row).eq('id', existing.id)
    } else {
      await svc.from('gbp_reviews').insert(row)
      newReviews++
    }
  }

  await svc.from('gbp_connections').update({ last_synced_at: new Date().toISOString() }).eq('organisation_id', organisationId)

  return { ok: true, synced: reviews.length, newReviews }
}

export type ReplyResult =
  | { ok: true; replyText: string; updatedAt: string | null }
  | { ok: false; reason: GbpReviewSyncErrorReason; detail?: string }

async function replyRequest(
  svc: SupabaseClient, organisationId: string, googleReviewId: string, method: 'PUT' | 'DELETE', body?: string,
): Promise<{ ok: true; json: any } | { ok: false; reason: GbpReviewSyncErrorReason; detail?: string }> {
  const refresh = await ensureFreshAccessToken(svc, 'google_business', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const connection = await getConnectionContext(svc, organisationId)
  if (!connection?.access_token_secret_id) return { ok: false, reason: 'not_connected' }
  if (!connection.google_account_id || !connection.google_location_id) return { ok: false, reason: 'no_location_selected' }

  let accessToken: string | null
  try {
    accessToken = await vaultReadSecret(svc, connection.access_token_secret_id)
  } catch (e) {
    return { ok: false, reason: 'google_error', detail: sanitizeErrorDetail(e instanceof Error ? e.message : 'lecture_vault_echouee') }
  }
  if (!accessToken) return { ok: false, reason: 'not_connected' }

  const url = `${MYBUSINESS_V4_BASE}/${connection.google_account_id}/${connection.google_location_id}/reviews/${googleReviewId}/reply`
  const res = await gbpV4Fetch(url, accessToken, { method, body })
  if (!res.ok) {
    const { reason, detail } = classifyError(res.status, res.bodyText)
    return { ok: false, reason, detail }
  }
  return { ok: true, json: res.json }
}

// Publie ou modifie la réponse à un avis (PUT — Google fait l'upsert
// lui-même : crée si absente, remplace si déjà présente).
export async function replyToGbpReview(svc: SupabaseClient, organisationId: string, googleReviewId: string, replyText: string): Promise<ReplyResult> {
  const result = await replyRequest(svc, organisationId, googleReviewId, 'PUT', JSON.stringify({ comment: replyText }))
  if (!result.ok) return result
  const updatedAt = result.json.updateTime ?? new Date().toISOString()
  await svc.from('gbp_reviews')
    .update({ response_text: replyText, response_updated_at: updatedAt, response_synced_at: new Date().toISOString() })
    .eq('organisation_id', organisationId)
    .eq('google_review_id', googleReviewId)
  return { ok: true, replyText, updatedAt }
}

// Supprime la réponse existante — l'API Google le permet (DELETE .../reply).
export async function deleteGbpReviewReply(svc: SupabaseClient, organisationId: string, googleReviewId: string): Promise<{ ok: true } | { ok: false; reason: GbpReviewSyncErrorReason; detail?: string }> {
  const result = await replyRequest(svc, organisationId, googleReviewId, 'DELETE')
  if (!result.ok) return result
  await svc.from('gbp_reviews')
    .update({ response_text: null, response_updated_at: null, response_synced_at: new Date().toISOString() })
    .eq('organisation_id', organisationId)
    .eq('google_review_id', googleReviewId)
  return { ok: true }
}
