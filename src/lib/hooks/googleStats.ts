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

export function useSyncGoogleAdsMetrics() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; rowsUpserted?: number; error?: string; reason?: string }>('google-ads-sync-metrics')
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.reason || 'Synchronisation impossible')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-ads-metrics'] }),
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
