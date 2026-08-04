// supabase/functions/google-send-review-requests/index.ts — Phase 3
//
// Distribue par e-mail les demandes d'avis Google dont l'heure programmée
// est atteinte (scheduled_send_at <= now()). Deux chemins d'appel :
//   1. Interne (pg_cron via pg_net) — header X-Internal-Secret, balaie
//      TOUTES les organisations (chaque ligne reste strictement scopée à
//      SA PROPRE organisation, jamais de mélange).
//   2. Admin authentifié (bouton "Envoyer maintenant" / import.meta test) —
//      Authorization Bearer, traite UNIQUEMENT une ligne précise
//      (reviewRequestId), et uniquement si elle appartient à l'organisation
//      de l'appelant.
// Idempotent : une ligne déjà 'sent'/'cancelled' n'est jamais retraitée
// (WHERE delivery_status='pending' AND sent_at IS NULL).
//
// Réutilise le secret interne déjà provisionné pour send-push
// (get_internal_push_secret, Vault) plutôt que d'en créer un nouveau —
// c'est un jeton de confiance Supabase↔Supabase générique, pas spécifique
// aux push notifications malgré son nom historique.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, sanitizeErrorDetail, GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL } from '../_shared/google-oauth.ts'
import { sendTransactionalEmail } from '../_shared/brevo-email.ts'
import { buildGoogleReviewLink, buildUnsubscribeLink, renderReviewRequestMessage } from '../_shared/google-review-link.ts'

async function getInternalSecret(svc: ReturnType<typeof serviceClient>): Promise<string | null> {
  const { data, error } = await svc.rpc('get_internal_push_secret')
  if (error) return null
  return (data as string) ?? null
}

interface DueRow {
  id: string
  organisation_id: string
  facture_id: string
  client_id: string
  unsubscribe_token: string | null
  clients: { prenom: string | null; nom: string; email: string | null } | null
}

async function dispatchOne(svc: ReturnType<typeof serviceClient>, row: DueRow): Promise<{ ok: boolean; error?: string }> {
  const client = row.clients
  if (!client?.email) {
    await svc.from('review_requests').update({
      delivery_status: 'failed', delivery_error: 'client_sans_email',
    }).eq('id', row.id)
    return { ok: false, error: 'client_sans_email' }
  }

  // Re-vérifié AU MOMENT DE L'ENVOI (pas seulement à la création de la
  // demande) : un client a pu se désinscrire, ou recevoir entre-temps une
  // suppression (bounce/plainte) pendant la fenêtre de programmation
  // ("Programmer" peut différer l'envoi de plusieurs heures/jours).
  const { data: suppression } = await svc
    .from('google_review_suppressions')
    .select('reason')
    .eq('organisation_id', row.organisation_id)
    .ilike('email', client.email)
    .maybeSingle()
  if (suppression) {
    await svc.from('review_requests').update({
      delivery_status: 'cancelled', cancelled_at: new Date().toISOString(),
      delivery_error: `supprime_${suppression.reason}`,
    }).eq('id', row.id)
    return { ok: false, error: `supprime_${suppression.reason}` }
  }

  const { data: gbp } = await svc
    .from('gbp_connections')
    .select('place_id, status')
    .eq('organisation_id', row.organisation_id)
    .maybeSingle()
  if (!gbp?.place_id || gbp.status !== 'connected') {
    await svc.from('review_requests').update({
      delivery_status: 'failed', delivery_error: 'etablissement_gbp_non_selectionne',
    }).eq('id', row.id)
    return { ok: false, error: 'etablissement_gbp_non_selectionne' }
  }

  const { data: params } = await svc
    .from('parametres_entreprise')
    .select('avis_google_actif, avis_google_message_template, raison_sociale, email')
    .eq('organisation_id', row.organisation_id)
    .maybeSingle()
  if (!params?.avis_google_actif) {
    await svc.from('review_requests').update({
      delivery_status: 'cancelled', cancelled_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { ok: false, error: 'demandes_avis_desactivees_depuis' }
  }

  const reviewLink = buildGoogleReviewLink(gbp.place_id)
  const bodyHtml = renderReviewRequestMessage(
    params.avis_google_message_template || 'Merci pour votre confiance ! {{lien_avis}}',
    { prenom: client.prenom || client.nom, lienAvis: reviewLink },
  ).replace(/\n/g, '<br>')

  // Lien de désinscription toujours ajouté, même si le modèle de l'admin
  // ne le mentionne pas explicitement — jamais optionnel.
  const unsubscribeHtml = row.unsubscribe_token && GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL
    ? `<p style="font-size:11px;color:#94a3b8;margin-top:24px">Vous ne souhaitez plus recevoir ces e-mails ? <a href="${buildUnsubscribeLink(GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL, row.unsubscribe_token)}">Se désinscrire</a>.</p>`
    : ''
  const html = bodyHtml + unsubscribeHtml

  const sendResult = await sendTransactionalEmail({
    to: client.email,
    subject: `${params.raison_sociale || 'Votre avis compte'} — donnez-nous votre avis`,
    html,
    replyToEmail: params.email,
    replyToName: params.raison_sociale,
  })

  if (!sendResult.ok) {
    await svc.from('review_requests').update({
      delivery_status: 'failed', delivery_error: sanitizeErrorDetail(sendResult.error || 'erreur_inconnue'),
    }).eq('id', row.id)
    return { ok: false, error: sendResult.error }
  }

  await svc.from('review_requests').update({
    delivery_status: 'sent', sent_at: new Date().toISOString(), delivery_error: null,
    brevo_message_id: sendResult.messageId ?? null,
  }).eq('id', row.id)
  return { ok: true }
}

export async function handleSendReviewRequests(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const svc = serviceClient()
  const internalSecret = req.headers.get('x-internal-secret')

  let organisationScope: string | null = null // null = balayage global (interne uniquement)
  let singleRequestId: string | null = null

  if (internalSecret) {
    const expected = await getInternalSecret(svc)
    if (!expected || internalSecret !== expected) return respond({ error: 'Secret interne invalide' }, 401)
  } else {
    const auth = await requireActiveAdmin(req)
    if (!auth.ok) return respond({ error: auth.error }, auth.status)
    organisationScope = auth.organisationId

    let body: { reviewRequestId?: string } = {}
    try { body = await req.json() } catch { /* corps optionnel */ }
    singleRequestId = body.reviewRequestId ?? null
  }

  let query = svc
    .from('review_requests')
    .select('id, organisation_id, facture_id, client_id, unsubscribe_token, clients(prenom, nom, email)')
    .eq('delivery_status', 'pending')
    .is('sent_at', null)
    .is('cancelled_at', null)

  if (organisationScope) query = query.eq('organisation_id', organisationScope)
  if (singleRequestId) {
    query = query.eq('id', singleRequestId)
  } else {
    query = query.lte('scheduled_send_at', new Date().toISOString())
  }

  const { data: due, error } = await query.limit(200)
  if (error) return respond({ error: 'Erreur de lecture des demandes en attente' }, 500)
  if (!due || due.length === 0) return respond({ ok: true, processed: 0, sent: 0, failed: 0 })

  let sent = 0
  let failed = 0
  for (const row of due as unknown as DueRow[]) {
    // Isolation stricte entre lignes/organisations : une exception
    // inattendue sur une demande (réseau, DB) ne doit jamais interrompre
    // le traitement des demandes suivantes du même passage.
    try {
      const result = await dispatchOne(svc, row)
      if (result.ok) sent++
      else failed++
    } catch {
      failed++
    }
  }

  return respond({ ok: true, processed: due.length, sent, failed })
}

if (import.meta.main) serve(handleSendReviewRequests)
