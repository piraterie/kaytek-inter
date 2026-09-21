// supabase/functions/google-ads-sync-metrics/index.ts — Phase 5
//
// Synchronisation des métriques Google Ads (GAQL, côté serveur uniquement).
// Deux chemins :
//  - interne (X-Internal-Secret, pg_cron quotidien) : métriques quotidiennes +
//    structure (statut réel des campagnes, zones ciblées, noms de zones) pour
//    toutes les organisations avec un compte Ads sélectionné ;
//  - admin authentifié (bouton "Synchroniser") : synchronisation COMPLÈTE
//    (quotidien, horaire, appareils, âge/sexe, géographie, structure), limitée à
//    1 fois toutes les 10 minutes par organisation.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, requireActiveAdmin, serviceClient, logOAuthEvent } from '../_shared/google-oauth.ts'
import { runDailyJob, runManualFull } from '../_shared/google-ads-intraday.ts'
import { getInternalSecret, safeEqual } from '../_shared/internal-secret.ts'

const STATUS_BY_REASON: Record<string, number> = {
  not_connected: 409, needs_reconnect: 409, no_customer_selected: 409,
  api_not_enabled: 409, insufficient_permission: 403, google_error: 502,
}

export async function handleSyncAdsMetrics(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const svc = serviceClient()
  const internalSecret = req.headers.get('x-internal-secret')

  if (internalSecret) {
    const expected = await getInternalSecret(svc)
    if (!expected || !safeEqual(internalSecret, expected)) return respond({ error: 'Secret interne invalide' }, 401)

    // Isolation stricte entre organisations dans runDailyJob (une exception
    // réseau sur une organisation ne doit jamais interrompre les suivantes).
    const r = await runDailyJob({ svc })
    return respond({ ok: true, organisationsSynced: r.synced, organisationsFailed: r.failed, eligible: r.eligible })
  }

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  const result = await runManualFull({ svc }, auth.organisationId)
  if (!result.ok) {
    const detail = result.daily && !result.daily.ok ? result.daily.detail : undefined
    return respond({ ok: false, reason: result.reason, detail }, STATUS_BY_REASON[result.reason] ?? 502)
  }
  // Limitation atteinte : aucun appel Google effectué. Réponse 200 (ce n'est pas une erreur).
  if (result.throttled) return respond({ ok: true, throttled: true, rowsUpserted: 0, next_allowed_at: result.nextAllowedAt })

  await logOAuthEvent(svc, auth.organisationId, 'google_ads', 'metrics_synced', `${result.daily.rowsUpserted} ligne(s)`)
  return respond({
    ok: true,
    rowsUpserted: result.daily.rowsUpserted,
    // Code d'erreur court par jeu de données (jamais de détail brut ni de jeton).
    datasets: result.datasets.map((d) => ({ dataset: d.dataset, ok: d.ok, rows: d.rows, error: d.error })),
  })
}

if (import.meta.main) serve(handleSyncAdsMetrics)
