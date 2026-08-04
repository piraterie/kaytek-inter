// supabase/functions/google-select-connection/index.ts — Phase 3
//
// Enregistre le compte Google Ads OU l'établissement Google Business
// Profile choisi par l'administrateur pour son organisation. N'écrit
// JAMAIS l'identifiant envoyé par le frontend sans l'avoir revérifié
// contre une liste fraîchement obtenue auprès de Google — un customer_id
// ou un location_resource_name reçu du client n'est jamais digne de
// confiance en soi (le frontend a pu afficher une liste périmée, ou un
// appel pourrait être forgé directement contre cette fonction).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent, sanitizeErrorDetail, isValidProvider } from '../_shared/google-oauth.ts'
import { listAccessibleAdsAccounts } from '../_shared/google-ads-api.ts'
import { listAccessibleGbpLocations } from '../_shared/google-business-api.ts'

interface SelectAdsBody { provider: 'google_ads'; customerId?: string }
interface SelectGbpBody { provider: 'google_business'; accountResourceName?: string; locationResourceName?: string }

// Exportée séparément de `serve()` uniquement pour permettre les tests
// unitaires (index.test.ts) d'invoquer le handler directement — aucun
// changement de comportement en production (voir google-oauth-callback
// pour le même pattern, introduit en premier).
export async function handleGoogleSelectConnection(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  let body: SelectAdsBody | SelectGbpBody
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }

  if (!isValidProvider(body.provider)) {
    return respond({ error: "provider invalide — attendu 'google_ads' ou 'google_business'" }, 400)
  }

  const svc = serviceClient()

  if (body.provider === 'google_ads') {
    const { customerId } = body as SelectAdsBody
    if (!customerId || !/^[0-9]{6,10}$/.test(customerId)) {
      return respond({ error: 'customerId invalide' }, 400)
    }

    let fresh
    try {
      fresh = await listAccessibleAdsAccounts(svc, auth.organisationId)
    } catch (e) {
      return respond({ error: sanitizeErrorDetail(e instanceof Error ? e.message : 'erreur_inconnue') }, 502)
    }
    if (!fresh.ok) {
      return respond({ error: 'Impossible de vérifier ce compte auprès de Google', reason: fresh.reason }, 409)
    }
    const match = fresh.accounts.find((a) => a.customerId === customerId)
    if (!match) {
      // Ne jamais faire confiance à un identifiant non retrouvé dans la
      // liste fraîche — même si le frontend l'avait affiché plus tôt.
      await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'ads_account_selection_rejected', 'customer_id_non_accessible')
      return respond({ error: 'Ce compte Google Ads n\'est plus accessible avec la connexion actuelle' }, 403)
    }

    const { error: updateErr } = await svc.from('google_ads_connections').update({
      google_customer_id: match.customerId,
      google_login_customer_id: match.managerCustomerId,
      customer_descriptive_name: match.descriptiveName,
      is_manager_account: match.isManager,
      currency_code: match.currencyCode,
      time_zone: match.timeZone,
      selected_at: new Date().toISOString(),
      selected_by: auth.userId,
    }).eq('organisation_id', auth.organisationId)

    if (updateErr) {
      console.error('[google-select-connection] Échec enregistrement sélection Ads:', updateErr.message)
      return respond({ error: 'Erreur serveur' }, 500)
    }

    await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'ads_account_selected', `customer_id se terminant par ${customerId.slice(-4)}`)
    return respond({ ok: true, selected: match })
  }

  // google_business
  const { accountResourceName, locationResourceName } = body as SelectGbpBody
  if (!accountResourceName?.startsWith('accounts/') || !locationResourceName?.startsWith('locations/')) {
    return respond({ error: 'accountResourceName/locationResourceName invalides' }, 400)
  }

  let fresh
  try {
    fresh = await listAccessibleGbpLocations(svc, auth.organisationId)
  } catch (e) {
    return respond({ error: sanitizeErrorDetail(e instanceof Error ? e.message : 'erreur_inconnue') }, 502)
  }
  if (!fresh.ok) {
    return respond({ error: 'Impossible de vérifier cet établissement auprès de Google', reason: fresh.reason }, 409)
  }
  const account = fresh.accounts.find((a) => a.accountResourceName === accountResourceName)
  const location = account?.locations.find((l) => l.locationResourceName === locationResourceName)
  if (!account || !location) {
    await logOAuthEvent(svc, auth.organisationId, 'google_business', 'gbp_location_selection_rejected', 'location_non_accessible')
    return respond({ error: 'Cet établissement n\'est plus accessible avec la connexion actuelle' }, 403)
  }

  const { error: updateErr } = await svc.from('gbp_connections').update({
    google_account_id: account.accountResourceName,
    account_name: account.accountName,
    google_location_id: location.locationResourceName,
    location_title: location.title,
    location_address: location.address,
    location_open_status: location.openStatus,
    place_id: location.placeId,
    location_phone: location.phone,
    location_website: location.websiteUri,
    selected_at: new Date().toISOString(),
    selected_by: auth.userId,
  }).eq('organisation_id', auth.organisationId)

  if (updateErr) {
    console.error('[google-select-connection] Échec enregistrement sélection GBP:', updateErr.message)
    return respond({ error: 'Erreur serveur' }, 500)
  }

  await logOAuthEvent(svc, auth.organisationId, 'google_business', 'gbp_location_selected', location.title ?? 'sans nom')
  return respond({ ok: true, selected: location })
}

// import.meta.main : voir google-oauth-callback/index.ts pour la
// justification (empêche `serve()` d'ouvrir un vrai listener réseau quand
// ce fichier est importé par index.test.ts).
if (import.meta.main) serve(handleGoogleSelectConnection)
