// supabase/functions/google-gbp-reply-review/index.ts — Phase 4
//
// Publie, modifie ou supprime la réponse de l'entreprise à un avis Google
// Business Profile. Admin-only. L'identifiant d'avis (google_review_id)
// envoyé par le frontend est TOUJOURS revérifié contre gbp_reviews (même
// organisation) avant tout appel à Google — jamais de resourceName construit
// à partir d'une entrée non vérifiée.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent } from '../_shared/google-oauth.ts'
import { replyToGbpReview, deleteGbpReviewReply } from '../_shared/google-business-reviews.ts'

interface ReplyBody { googleReviewId?: string; action?: 'reply' | 'delete'; text?: string }

export async function handleGbpReplyReview(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  let body: ReplyBody
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }

  const { googleReviewId, action, text } = body
  if (!googleReviewId || typeof googleReviewId !== 'string') {
    return respond({ error: 'googleReviewId requis' }, 400)
  }
  if (action !== 'reply' && action !== 'delete') {
    return respond({ error: "action invalide — attendu 'reply' ou 'delete'" }, 400)
  }
  if (action === 'reply' && (!text || !text.trim())) {
    return respond({ error: 'text requis pour une réponse' }, 400)
  }
  if (action === 'reply' && text!.length > 4096) {
    return respond({ error: 'Réponse trop longue (4096 caractères max, limite Google)' }, 400)
  }

  const svc = serviceClient()

  // Revérification : l'avis doit réellement appartenir à cette organisation.
  const { data: review } = await svc
    .from('gbp_reviews')
    .select('id')
    .eq('organisation_id', auth.organisationId)
    .eq('google_review_id', googleReviewId)
    .maybeSingle()
  if (!review) {
    return respond({ error: "Cet avis n'appartient pas à votre organisation" }, 403)
  }

  const statusByReason: Record<string, number> = {
    not_connected: 409, needs_reconnect: 409, no_location_selected: 409,
    api_not_enabled: 409, insufficient_permission: 403, google_error: 502,
  }

  if (action === 'delete') {
    const result = await deleteGbpReviewReply(svc, auth.organisationId, googleReviewId)
    if (!result.ok) return respond({ ok: false, reason: result.reason, detail: result.detail }, statusByReason[result.reason] ?? 502)
    await logOAuthEvent(svc, auth.organisationId, 'google_business', 'review_reply_deleted', `avis se terminant par ${googleReviewId.slice(-6)}`)
    return respond({ ok: true })
  }

  const result = await replyToGbpReview(svc, auth.organisationId, googleReviewId, text!.trim())
  if (!result.ok) return respond({ ok: false, reason: result.reason, detail: result.detail }, statusByReason[result.reason] ?? 502)
  await logOAuthEvent(svc, auth.organisationId, 'google_business', 'review_reply_published', `avis se terminant par ${googleReviewId.slice(-6)}`)
  return respond({ ok: true, replyText: result.replyText, updatedAt: result.updatedAt })
}

if (import.meta.main) serve(handleGbpReplyReview)
