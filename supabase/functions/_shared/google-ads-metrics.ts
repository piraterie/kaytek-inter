// supabase/functions/_shared/google-ads-metrics.ts — Phase 5
//
// Synchronisation quotidienne des métriques Google Ads (GAQL, lecture
// seule) — impressions, clics, coût, conversions, valeur de conversion —
// par campagne et par jour, stockées dans google_ads_metrics_daily.
//
// LIMITE DOCUMENTÉE (pas une valeur devinée) : le nombre d'appels
// téléphoniques (`phone_calls`) n'est PAS synchronisé par ce module. La
// ressource GAQL `call_view` existe (rapports d'appels), mais ses champs
// exacts (date, campagne associée) n'ont pas pu être vérifiés avec
// certitude au moment de l'écriture — plutôt que de deviner un nom de
// champ et risquer une requête silencieusement fausse ou en erreur, la
// colonne google_ads_metrics_daily.phone_calls reste à 0 (valeur par
// défaut) jusqu'à vérification explicite contre
// https://developers.google.com/google-ads/api/fields/<version>/call_view
// et implémentation dédiée. Cela suppose aussi que le compte utilise des
// extensions d'appel/numéros de suivi — sans cela, Google Ads ne peut de
// toute façon pas compter les appels.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureFreshAccessToken } from './google-oauth-refresh.ts'
import {
  vaultReadSecret, sanitizeErrorDetail,
  GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_API_BASE,
} from './google-oauth.ts'

export type AdsMetricsSyncErrorReason =
  | 'not_connected' | 'needs_reconnect' | 'no_customer_selected'
  | 'developer_token_missing' | 'api_not_enabled' | 'insufficient_permission' | 'google_error'

export type AdsMetricsSyncResult =
  | { ok: true; rowsUpserted: number }
  | { ok: false; reason: AdsMetricsSyncErrorReason; detail?: string }

function classifyError(status: number, bodyText: string): { reason: AdsMetricsSyncErrorReason; detail: string } {
  const detail = sanitizeErrorDetail(bodyText)
  const low = bodyText.toLowerCase()
  if (low.includes('has not been used') || (status === 403 && low.includes('disabled'))) return { reason: 'api_not_enabled', detail }
  if (low.includes('user_permission_denied') || low.includes('permission_denied') || status === 403) return { reason: 'insufficient_permission', detail }
  return { reason: 'google_error', detail }
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export async function syncGoogleAdsMetrics(svc: SupabaseClient, organisationId: string, daysBack = 30): Promise<AdsMetricsSyncResult> {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) return { ok: false, reason: 'developer_token_missing' }

  const refresh = await ensureFreshAccessToken(svc, 'google_ads', organisationId)
  if (refresh.status === 'not_connected') return { ok: false, reason: 'not_connected' }
  if (refresh.status === 'needs_reconnect') return { ok: false, reason: 'needs_reconnect' }
  if (refresh.status === 'error') return { ok: false, reason: 'google_error', detail: refresh.reason }

  const { data: connection } = await svc
    .from('google_ads_connections')
    .select('access_token_secret_id, google_customer_id, google_login_customer_id')
    .eq('organisation_id', organisationId)
    .maybeSingle()
  if (!connection?.access_token_secret_id) return { ok: false, reason: 'not_connected' }
  if (!connection.google_customer_id) return { ok: false, reason: 'no_customer_selected' }

  let accessToken: string | null
  try {
    accessToken = await vaultReadSecret(svc, connection.access_token_secret_id)
  } catch (e) {
    return { ok: false, reason: 'google_error', detail: sanitizeErrorDetail(e instanceof Error ? e.message : 'lecture_vault_echouee') }
  }
  if (!accessToken) return { ok: false, reason: 'not_connected' }

  const end = new Date()
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000)

  const query = `
    SELECT campaign.id, campaign.name, segments.date,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${isoDate(start)}' AND '${isoDate(end)}'
    ORDER BY segments.date ASC
  `.trim()

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  }
  if (connection.google_login_customer_id) headers['login-customer-id'] = connection.google_login_customer_id

  const res = await fetch(`${GOOGLE_ADS_API_BASE}/customers/${connection.google_customer_id}/googleAds:search`, {
    method: 'POST', headers, body: JSON.stringify({ query, pageSize: 10000 }),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    const { reason, detail } = classifyError(res.status, bodyText)
    return { ok: false, reason, detail }
  }
  let json: any
  try {
    json = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    return { ok: false, reason: 'google_error', detail: 'reponse_google_illisible' }
  }

  const rows: any[] = json.results ?? []
  let rowsUpserted = 0
  for (const r of rows) {
    const { error } = await svc.from('google_ads_metrics_daily').upsert({
      organisation_id: organisationId,
      date: r.segments?.date,
      campaign_id: String(r.campaign?.id ?? ''),
      campaign_name: r.campaign?.name ?? null,
      impressions: parseInt(r.metrics?.impressions ?? '0', 10),
      clicks: parseInt(r.metrics?.clicks ?? '0', 10),
      cost_micros: parseInt(r.metrics?.costMicros ?? '0', 10),
      conversions: parseFloat(r.metrics?.conversions ?? '0'),
      conversions_value: parseFloat(r.metrics?.conversionsValue ?? '0'),
    }, { onConflict: 'organisation_id,date,campaign_id' })
    if (!error) rowsUpserted++
  }

  await svc.from('google_ads_connections').update({ last_synced_at: new Date().toISOString() }).eq('organisation_id', organisationId)

  return { ok: true, rowsUpserted }
}
