// supabase/functions/google-gbp-sync-performance/index.ts — Phase 4
//
// Synchronisation des statistiques Business Profile Performance API.
// Deux chemins : admin authentifié (bouton "Synchroniser", une seule org)
// ou interne (X-Internal-Secret, pg_cron quotidien, balaie toutes les
// organisations avec un établissement GBP connecté).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent } from '../_shared/google-oauth.ts'
import { syncGbpPerformanceMetrics } from '../_shared/google-business-performance.ts'

async function getInternalSecret(svc: ReturnType<typeof serviceClient>): Promise<string | null> {
  const { data, error } = await svc.rpc('get_internal_push_secret')
  if (error) return null
  return (data as string) ?? null
}

const STATUS_BY_REASON: Record<string, number> = {
  not_connected: 409, needs_reconnect: 409, no_location_selected: 409,
  api_not_enabled: 409, insufficient_permission: 403, google_error: 502,
}

export async function handleSyncGbpPerformance(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const svc = serviceClient()
  const internalSecret = req.headers.get('x-internal-secret')

  if (internalSecret) {
    const expected = await getInternalSecret(svc)
    if (!expected || internalSecret !== expected) return respond({ error: 'Secret interne invalide' }, 401)

    const { data: orgs } = await svc.from('gbp_connections').select('organisation_id').eq('status', 'connected').not('google_location_id', 'is', null)
    let succeeded = 0
    let failed = 0
    for (const o of orgs ?? []) {
      // Isolation stricte entre organisations : une exception réseau/
      // inattendue sur UNE organisation (fetch qui rejette, timeout...) ne
      // doit jamais interrompre le traitement des autres organisations du
      // même passage cron.
      try {
        const result = await syncGbpPerformanceMetrics(svc, o.organisation_id)
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

  const result = await syncGbpPerformanceMetrics(svc, auth.organisationId)
  if (!result.ok) return respond({ ok: false, reason: result.reason, detail: result.detail }, STATUS_BY_REASON[result.reason] ?? 502)

  await logOAuthEvent(svc, auth.organisationId, 'google_business', 'performance_synced', `${result.daysUpserted} jour(s)`)
  return respond({ ok: true, daysUpserted: result.daysUpserted })
}

if (import.meta.main) serve(handleSyncGbpPerformance)
