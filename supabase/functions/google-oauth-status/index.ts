// supabase/functions/google-oauth-status/index.ts — Phase 2
//
// Retourne le statut des connexions Google Ads / Google Business Profile
// pour l'organisation de l'administrateur appelant. Ne retourne JAMAIS un
// token ni une référence Vault (access_token_secret_id/
// refresh_token_secret_id sont explicitement exclus du SELECT — pas
// seulement omis de la réponse). Déclenche un renouvellement best-effort
// de l'access token si nécessaire (helper centralisé), sans jamais
// exposer sa valeur.
//
// Note d'architecture : les vues google_ads_connection_status /
// gbp_connection_status (Phase 1) exposent déjà exactement les mêmes
// métadonnées non sensibles et pourraient être interrogées directement
// par le frontend via supabase-js (RLS-équivalent déjà en place, admin-
// only + org-scoped). Cette Edge Function reste néanmoins l'unique point
// d'entrée utilisé par le frontend (cohérence de l'API, formatage
// serveur du customer_id, et déclenchement du renouvellement à la
// demande) — le frontend n'accède donc jamais aux tables/vues en direct.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, type GoogleProvider } from '../_shared/google-oauth.ts'
import { ensureFreshAccessToken } from '../_shared/google-oauth-refresh.ts'

function maskCustomerId(id: string | null): string | null {
  if (!id) return null
  const digits = id.replace(/[^0-9]/g, '')
  if (digits.length < 4) return '••••'
  return `••• ••• ${digits.slice(-4)}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const svc = serviceClient()

  // Renouvellement best-effort — n'empêche jamais de répondre même en
  // cas d'échec (le statut reflètera alors 'expired' si nécessaire).
  await Promise.allSettled([
    ensureFreshAccessToken(svc, 'google_ads', auth.organisationId),
    ensureFreshAccessToken(svc, 'google_business', auth.organisationId),
  ])

  // SELECT explicite — access_token_secret_id / refresh_token_secret_id
  // ne sont JAMAIS demandées ici, même pour les exclure après coup.
  const [adsRes, gbpRes] = await Promise.all([
    svc.from('google_ads_connections')
      .select('google_customer_id, google_login_customer_id, google_account_email, status, connected_at, last_synced_at, last_error, updated_at, customer_descriptive_name, is_manager_account, currency_code, time_zone, selected_at')
      .eq('organisation_id', auth.organisationId)
      .maybeSingle(),
    svc.from('gbp_connections')
      .select('google_location_id, google_account_id, account_name, google_account_email, status, connected_at, last_synced_at, last_error, updated_at, location_title, location_address, location_open_status, selected_at, place_id, location_phone, location_website')
      .eq('organisation_id', auth.organisationId)
      .maybeSingle(),
  ])

  const googleAds = adsRes.data
    ? { ...adsRes.data, google_customer_id: maskCustomerId(adsRes.data.google_customer_id) }
    : { status: 'disconnected' as const }

  const googleBusiness = gbpRes.data ?? { status: 'disconnected' as const }

  return respond({ google_ads: googleAds, google_business: googleBusiness })
})
