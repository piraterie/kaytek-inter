// supabase/functions/google-brevo-webhook/index.ts — Phase 3
//
// Reçoit les événements de livraison Brevo (transactional webhooks) pour
// les e-mails de demande d'avis. Authentification par secret partagé en
// paramètre de requête (?secret=...) — Brevo ne signe pas ses webhooks
// nativement (confirmé documentation Brevo), c'est le mécanisme officiel
// recommandé (à configurer côté Brevo lors de la création du webhook).
//
// RÈGLE ABSOLUE : ne journalise jamais le contenu complet d'un e-mail, ni
// aucun secret — uniquement l'événement, l'identifiant de corrélation
// (message-id) et la raison (bounce/plainte), déjà nettoyés.
//
// Corrélation : chaque e-mail envoyé stocke son messageId Brevo
// (review_requests.brevo_message_id, renseigné à l'envoi — voir
// google-send-review-requests). Un événement dont le message-id ne
// correspond à aucune ligne connue est ignoré silencieusement (200 OK,
// jamais d'erreur — Brevo retire un webhook en échec répété).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, serviceClient } from '../_shared/google-oauth.ts'

// Événements Brevo réels (confirmés documentation officielle) — mappés
// vers nos statuts internes. 'request'/'click'/'opened' etc. ne
// concernent pas la livraison, ignorés ici (pas d'action requise).
const STATUS_BY_EVENT: Record<string, string> = {
  delivered: 'delivered',
  deferred: 'deferred',
  soft_bounce: 'bounced_soft',
  hard_bounce: 'bounced_hard',
  blocked: 'blocked',
  invalid_email: 'blocked',
  spam: 'complained',
  unsubscribed: 'unsubscribed_brevo',
  error: 'failed',
}

interface BrevoWebhookPayload {
  event?: string
  email?: string
  'message-id'?: string
  reason?: string
}

async function getWebhookSecret(svc: ReturnType<typeof serviceClient>): Promise<string | null> {
  const { data, error } = await svc.rpc('get_google_brevo_webhook_secret')
  if (error) return null
  return (data as string) ?? null
}

export async function handleBrevoWebhook(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const svc = serviceClient()
  const providedSecret = new URL(req.url).searchParams.get('secret')
  const expectedSecret = await getWebhookSecret(svc)
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return respond({ error: 'Secret webhook invalide' }, 401)
  }

  let payload: BrevoWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }

  const event = payload.event
  const messageId = payload['message-id']
  if (!event || !messageId) return respond({ ok: true, ignored: 'champs_requis_absents' })

  const newStatus = STATUS_BY_EVENT[event]
  if (!newStatus) return respond({ ok: true, ignored: 'evenement_non_pertinent' })

  const { data: row } = await svc
    .from('review_requests')
    .select('id, organisation_id, client_id')
    .eq('brevo_message_id', messageId)
    .maybeSingle()

  // Aucune ligne connue pour ce message-id : toujours 200 (l'événement
  // peut concerner un autre type d'e-mail Kaytek — envoyer-email partage
  // le même compte Brevo — ce n'est jamais une erreur de notre côté).
  if (!row) return respond({ ok: true, ignored: 'message_id_inconnu' })

  await svc.from('review_requests').update({
    delivery_status: newStatus,
    webhook_last_event: event,
    webhook_last_event_at: new Date().toISOString(),
    ...(payload.reason ? { delivery_error: payload.reason.slice(0, 500) } : {}),
  }).eq('id', row.id)

  // Rebond définitif ou plainte spam : plus jamais d'envoi à cette adresse
  // pour CETTE organisation (jamais les autres — voir contrainte unique
  // organisation_id+email+reason, idempotent par construction).
  if (newStatus === 'bounced_hard' || newStatus === 'complained') {
    const { data: client } = await svc.from('clients').select('email').eq('id', row.client_id).maybeSingle()
    if (client?.email) {
      await svc.from('google_review_suppressions').insert({
        organisation_id: row.organisation_id,
        email: client.email,
        reason: newStatus === 'complained' ? 'complaint' : 'hard_bounce',
        source_review_request_id: row.id,
      }).then(({ error }) => {
        // Doublon (déjà supprimé pour cette raison) — normal, pas une erreur.
        if (error && !error.message.includes('duplicate')) {
          console.error('[google-brevo-webhook] échec enregistrement suppression:', error.message)
        }
      })
    }
  }

  return respond({ ok: true })
}

if (import.meta.main) serve(handleBrevoWebhook)
