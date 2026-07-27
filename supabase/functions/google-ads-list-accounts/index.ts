// supabase/functions/google-ads-list-accounts/index.ts — Phase 3
//
// Liste les comptes Google Ads accessibles à la connexion OAuth de
// l'organisation de l'administrateur appelant. Lecture SEULE côté Google
// (listAccessibleCustomers + GAQL SELECT) — aucune campagne, budget, mot-
// clé ou compte n'est créé/modifié/supprimé. Ne journalise et ne retourne
// jamais un token.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent, sanitizeErrorDetail } from '../_shared/google-oauth.ts'
import { listAccessibleAdsAccounts } from '../_shared/google-ads-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const svc = serviceClient()

  let result
  try {
    result = await listAccessibleAdsAccounts(svc, auth.organisationId)
  } catch (e) {
    const detail = sanitizeErrorDetail(e instanceof Error ? e.message : 'erreur_inconnue')
    console.error('[google-ads-list-accounts] Erreur inattendue:', detail)
    await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'ads_accounts_list_failed', detail)
    return respond({ ok: false, reason: 'google_error', detail }, 502)
  }

  if (!result.ok) {
    await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'ads_accounts_list_failed', result.detail ?? result.reason)
    const status = result.reason === 'not_connected' ? 409 : result.reason === 'needs_reconnect' ? 409 : 502
    return respond(result, status)
  }

  await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'ads_accounts_list_success', `${result.accounts.length} compte(s)`)
  return respond(result)
})
