// supabase/functions/google-review-unsubscribe/index.ts — Phase 3
//
// Résout un token de désinscription OPAQUE (review_requests.unsubscribe_token
// — aléatoire, aucune donnée personnelle encodée dedans) et enregistre la
// désinscription de l'e-mail concerné pour SA SEULE organisation d'origine.
// Endpoint PUBLIC (aucun JWT — accessible depuis un lien d'e-mail), mais
// l'organisation_id/e-mail sont TOUJOURS dérivés du token côté serveur,
// jamais acceptés depuis la requête — impossible de désinscrire un tiers
// ou de modifier les préférences d'une autre organisation.
//
// GET  ?token=xxx  → résout le token, ne modifie rien (utilisé par la page
//                     publique pour afficher "confirmer la désinscription").
// POST { token }   → confirme et enregistre la désinscription (idempotent).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, serviceClient } from '../_shared/google-oauth.ts'

// Un lien de désinscription reste valable un temps raisonnable après
// l'envoi de l'e-mail auquel il appartient — au-delà, il est traité comme
// expiré plutôt qu'indéfiniment valide (limite l'exposition si un e-mail
// ancien refait surface). Ne bloque jamais la désinscription elle-même :
// si le lien est expiré, l'utilisateur est invité à contacter le support.
const TOKEN_VALIDITY_DAYS = 90

interface ResolvedToken {
  id: string
  organisation_id: string
  client_id: string
  sent_at: string | null
  email: string
  raison_sociale: string | null
}

async function resolveToken(svc: ReturnType<typeof serviceClient>, token: string): Promise<
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'ok'; data: ResolvedToken }
> {
  const { data: row } = await svc
    .from('review_requests')
    .select('id, organisation_id, client_id, sent_at, clients(email)')
    .eq('unsubscribe_token', token)
    .maybeSingle()

  if (!row) return { status: 'not_found' }

  if (!row.sent_at || new Date(row.sent_at).getTime() < Date.now() - TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000) {
    return { status: 'expired' }
  }

  const email = (row as any).clients?.email as string | null
  if (!email) return { status: 'not_found' }

  const { data: params } = await svc
    .from('parametres_entreprise')
    .select('raison_sociale')
    .eq('organisation_id', row.organisation_id)
    .maybeSingle()

  return {
    status: 'ok',
    data: {
      id: row.id, organisation_id: row.organisation_id, client_id: row.client_id,
      sent_at: row.sent_at, email,
      raison_sociale: params?.raison_sociale ?? null,
    },
  }
}

export async function handleReviewUnsubscribe(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const svc = serviceClient()
  let token: string | null = null

  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('token')
  } else if (req.method === 'POST') {
    try {
      const body = await req.json()
      token = body.token ?? null
    } catch {
      return respond({ error: 'JSON invalide' }, 400)
    }
  } else {
    return respond({ error: 'Méthode non autorisée' }, 405)
  }

  if (!token || typeof token !== 'string') return respond({ error: 'token requis' }, 400)

  const resolved = await resolveToken(svc, token)
  if (resolved.status === 'not_found') return respond({ ok: false, reason: 'invalid_token' }, 404)
  if (resolved.status === 'expired') return respond({ ok: false, reason: 'expired_token' }, 410)

  if (req.method === 'GET') {
    // Aperçu uniquement — ne crée jamais la suppression sur un simple GET
    // (évite qu'un scanner d'e-mail/antivirus qui pré-charge les liens ne
    // désinscrive des clients par accident).
    return respond({
      ok: true,
      raisonSociale: resolved.data.raison_sociale,
      emailMasked: resolved.data.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
    })
  }

  // POST confirmé — idempotent (index unique organisation_id+email+reason,
  // ON CONFLICT DO NOTHING : redemander la désinscription plusieurs fois
  // ne crée jamais de doublon dans l'historique).
  const { error } = await svc.from('google_review_suppressions').insert({
    organisation_id: resolved.data.organisation_id,
    email: resolved.data.email,
    reason: 'opt_out',
    source_review_request_id: resolved.data.id,
  })
  if (error && !error.message.includes('duplicate')) {
    return respond({ error: 'Erreur serveur' }, 500)
  }

  return respond({ ok: true })
}

if (import.meta.main) serve(handleReviewUnsubscribe)
