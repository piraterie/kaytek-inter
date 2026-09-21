// src/lib/hooks/googleStats.ts — Phases 4/5
// Statistiques Google Ads (google_ads_metrics_daily) et Google Business
// Profile Performance (gbp_performance_metrics_daily) : lecture directe
// (RLS admin/assistant), synchronisation via Edge Functions dédiées.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import { invokeGoogleFunction } from './googleIntegrations'

const orgId = () => useAuthStore.getState().user?.organisation_id

export interface AdsMetricRow {
  date: string
  campaign_id: string
  campaign_name: string | null
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversions_value: number
  phone_calls: number
}

export function useGoogleAdsMetrics(fromDate: string, toDate: string) {
  const org = orgId()
  return useQuery<AdsMetricRow[]>({
    queryKey: ['google-ads-metrics', org, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('google_ads_metrics_daily')
        .select('date, campaign_id, campaign_name, impressions, clicks, cost_micros, conversions, conversions_value, phone_calls')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!org,
    staleTime: 60_000,
  })
}

// Erreur de synchronisation Ads structurée : conserve la raison catégorisée et
// le détail (déjà nettoyé de tout jeton côté serveur) pour que l'UI affiche un
// message lisible au lieu du code brut (ex. "google_error").
export class AdsSyncError extends Error {
  constructor(public reason: string, public detail?: string, message?: string) {
    super(message ?? reason)
    this.name = 'AdsSyncError'
  }
}

export interface AdsSyncDataset { dataset: string; ok: boolean; rows?: number; error?: string | null }
export interface AdsSyncResult {
  ok: boolean
  rowsUpserted: number
  /** true = le serveur a ignoré la demande (synchronisation déjà faite il y a moins de 10 min) : ce n'est pas une erreur. */
  throttled: boolean
  nextAllowedAt: string | null
  datasets: AdsSyncDataset[]
}

/** Clés de cache des données Google Ads à rafraîchir après une synchronisation. */
export const ADS_DATA_QUERY_KEYS = [
  'google-ads-metrics', 'google-ads-hourly', 'google-ads-devices', 'google-ads-demographics',
  'google-ads-geo', 'google-ads-geo-names', 'google-ads-zones', 'google-ads-campaigns', 'google-ads-sync-state',
] as const

export function useSyncGoogleAdsMetrics() {
  const qc = useQueryClient()
  return useMutation<AdsSyncResult>({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<{
        ok?: boolean; rowsUpserted?: number; throttled?: boolean; next_allowed_at?: string
        datasets?: AdsSyncDataset[]; error?: string; reason?: string; detail?: string
      }>('google-ads-sync-metrics')
      if (error) throw error
      if (!data?.ok) throw new AdsSyncError(data?.reason ?? 'unknown', data?.detail, data?.error || data?.reason || 'Synchronisation impossible')
      return {
        ok: true,
        rowsUpserted: Number(data.rowsUpserted ?? 0),
        throttled: data.throttled === true,
        nextAllowedAt: data.next_allowed_at ?? null,
        datasets: Array.isArray(data.datasets) ? data.datasets : [],
      }
    },
    onSuccess: () => {
      for (const k of ADS_DATA_QUERY_KEYS) qc.invalidateQueries({ queryKey: [k] })
      // last_synced_at / metrics_synced_at / last_error sont portés par le statut de connexion.
      qc.invalidateQueries({ queryKey: ['google-oauth-status'] })
    },
    // Un échec peut aussi avoir mis à jour last_error côté serveur.
    onError: () => { qc.invalidateQueries({ queryKey: ['google-oauth-status'] }) },
  })
}

export interface GbpPerfMetricRow {
  date: string
  calls: number
  website_clicks: number
  direction_requests: number
  business_impressions_maps: number
  business_impressions_search: number
}

export function useGbpPerformanceMetrics(fromDate: string, toDate: string) {
  const org = orgId()
  return useQuery<GbpPerfMetricRow[]>({
    queryKey: ['gbp-performance-metrics', org, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gbp_performance_metrics_daily')
        .select('date, calls, website_clicks, direction_requests, business_impressions_maps, business_impressions_search')
        .gte('date', fromDate)
        .lte('date', toDate)
        .order('date', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!org,
    staleTime: 60_000,
  })
}

export function useSyncGbpPerformance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; daysUpserted?: number; error?: string; reason?: string }>('google-gbp-sync-performance')
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.reason || 'Synchronisation impossible')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gbp-performance-metrics'] }),
  })
}
