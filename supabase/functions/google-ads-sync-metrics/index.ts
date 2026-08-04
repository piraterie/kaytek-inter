// supabase/functions/google-ads-sync-metrics/index.ts — Phase 5
//
// Synchronisation des métriques Google Ads (GAQL, côté serveur uniquement).
// Deux chemins : admin authentifié (bouton "Synchroniser") ou interne
// (X-Internal-Secret, pg_cron quotidien, toutes les organisations avec un
// compte Ads sélectionné).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent } from '../_shared/google-oauth.ts'
import { syncGoogleAdsMetrics } from '../_shared/google-ads-metrics.ts'

async function getInternalSecret(svc: ReturnType<typeof serviceClient>): Promise<string | null> {
  const { data, error } = await svc.rpc('get_internal_push_secret')
  if (error) return null
  return (data as string) ?? null
}

const STATUS_BY_REASON: Record<string, number> = {
  not_connected: 409, needs_reconnect: 409, no_customer_selected: 409,
  developer_token_missing: 409, api_not_enabled: 409, insufficient_permission: 403, google_error: 502,
}

export async function handleSyncAdsMetrics(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const svc = serviceClient()
  const internalSecret = req.headers.get('x-internal-secret')

  if (internalSecret) {
    const expected = await getInternalSecret(svc)
    if (!expected || internalSecret !== expected) return respond({ error: 'Secret interne invalide' }, 401)

    const { data: orgs } = await svc.from('google_ads_connections').select('organisation_id').eq('status', 'connected').not('google_customer_id', 'is', null)
    let succeeded = 0
    let failed = 0
    for (const o of orgs ?? []) {
      // Isolation stricte entre organisations — voir google-gbp-sync-performance
      // pour la justification (une exception réseau sur une organisation ne
      // doit jamais interrompre le traitement des suivantes).
      try {
        const result = await syncGoogleAdsMetrics(svc, o.organisation_id)
        if (result.ok) succeeded++
        else failed++
      } catch {
        failed++
      }
    }
    return respond({ ok: true, organisationsSynced: succeeded, organisationsFailed: failed })
  }

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const result = await syncGoogleAdsMetrics(svc, auth.organisationId)
  if (!result.ok) return respond({ ok: false, reason: result.reason, detail: result.detail }, STATUS_BY_REASON[result.reason] ?? 502)

  await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'metrics_synced', `${result.rowsUpserted} ligne(s)`)
  return respond({ ok: true, rowsUpserted: result.rowsUpserted })
}

if (import.meta.main) serve(handleSyncAdsMetrics)
