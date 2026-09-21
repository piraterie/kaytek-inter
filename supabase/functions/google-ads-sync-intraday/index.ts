// supabase/functions/google-ads-sync-intraday/index.ts
//
// Synchronisations Google Ads planifiées par pg_cron (voir la migration
// 20260921120100) : { "job": "hourly" } (données horaires) et
// { "job": "breakdowns" } (appareils, âge, sexe, ville, code postal).
//
// Chemin INTERNE uniquement (X-Internal-Secret, comme google-ads-sync-metrics) :
// aucun JWT utilisateur, aucun appel possible depuis un navigateur. Le filtrage
// par heure LOCALE du compte et l'éligibilité (connexion Ads active + compte
// sélectionné) sont appliqués organisation par organisation dans
// _shared/google-ads-intraday.ts : une organisation hors créneau ou sans
// connexion active ne déclenche AUCUN appel à l'API Google Ads.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, respond, serviceClient } from '../_shared/google-oauth.ts'
import { runIntradayJob } from '../_shared/google-ads-intraday.ts'
import { getInternalSecret, safeEqual } from '../_shared/internal-secret.ts'

export async function handleSyncAdsIntraday(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const provided = req.headers.get('x-internal-secret')
  if (!provided) return respond({ error: 'Secret interne requis' }, 401)
  const svc = serviceClient()
  const expected = await getInternalSecret(svc)
  if (!expected || !safeEqual(provided, expected)) return respond({ error: 'Secret interne invalide' }, 401)

  let body: { job?: string }
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }
  if (body.job !== 'hourly' && body.job !== 'breakdowns') {
    return respond({ error: "job invalide — attendu 'hourly' ou 'breakdowns'" }, 400)
  }

  const summary = await runIntradayJob({ svc }, body.job)
  return respond({ ok: true, job: body.job, ...summary })
}

if (import.meta.main) serve(handleSyncAdsIntraday)
