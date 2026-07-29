// supabase/functions/google-business-list-locations/index.ts — Phase 3
//
// Liste les comptes et établissements Google Business Profile accessibles
// à la connexion OAuth de l'organisation de l'administrateur appelant.
// Lecture SEULE côté Google (GET uniquement) — aucune fiche, avis, photo
// ou horaire n'est créé/modifié/supprimé. Ne journalise et ne retourne
// jamais un token.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent, sanitizeErrorDetail } from '../_shared/google-oauth.ts'
import { listAccessibleGbpLocations } from '../_shared/google-business-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const svc = serviceClient()

  let result
  try {
    result = await listAccessibleGbpLocations(svc, auth.organisationId)
  } catch (e) {
    const detail = sanitizeErrorDetail(e instanceof Error ? e.message : 'erreur_inconnue')
    console.error('[google-business-list-locations] Erreur inattendue:', detail)
    await logOAuthEvent(svc, auth.organisationId, 'google_business', 'gbp_locations_list_failed', detail)
    return respond({ ok: false, reason: 'google_error', detail }, 502)
  }

  if (!result.ok) {
    await logOAuthEvent(svc, auth.organisationId, 'google_business', 'gbp_locations_list_failed', result.detail ?? result.reason)
    const status = result.reason === 'not_connected' ? 409 : result.reason === 'needs_reconnect' ? 409 : 502
    return respond(result, status)
  }

  const totalLocations = result.accounts.reduce((n, a) => n + a.locations.length, 0)
  await logOAuthEvent(svc, auth.organisationId, 'google_business', 'gbp_accounts_list_success', `${result.accounts.length} compte(s), ${totalLocations} établissement(s)`)
  return respond(result)
})
