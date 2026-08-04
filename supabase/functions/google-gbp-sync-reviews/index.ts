// supabase/functions/google-gbp-sync-reviews/index.ts — Phase 4
//
// Synchronisation manuelle (bouton "Synchroniser") des avis Google
// Business Profile de l'établissement connecté. Admin-only. Idempotent :
// upsert par (organisation_id, google_review_id), jamais de doublon.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent } from '../_shared/google-oauth.ts'
import { syncGbpReviews } from '../_shared/google-business-reviews.ts'

export async function handleSyncGbpReviews(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const svc = serviceClient()
  const result = await syncGbpReviews(svc, auth.organisationId)

  if (!result.ok) {
    const statusByReason: Record<string, number> = {
      not_connected: 409, needs_reconnect: 409, no_location_selected: 409,
      api_not_enabled: 409, insufficient_permission: 403, google_error: 502,
    }
    return respond({ ok: false, reason: result.reason, detail: result.detail }, statusByReason[result.reason] ?? 502)
  }

  await logOAuthEvent(svc, auth.organisationId, 'google_business', 'reviews_synced', `${result.synced} avis (${result.newReviews} nouveaux)`)
  return respond({ ok: true, synced: result.synced, newReviews: result.newReviews })
}

if (import.meta.main) serve(handleSyncGbpReviews)
