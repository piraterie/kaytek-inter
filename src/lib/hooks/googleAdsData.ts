// src/lib/hooks/googleAdsData.ts
// Lecture (SELECT uniquement, RLS admin d'organisation) des tables Google Ads « intraday » :
// horaire, appareils, démographie, géographie, zones ciblées, statut réel des campagnes,
// noms de zones et état de synchronisation. Aucune écriture, aucun appel Edge Function.
//
// PostgREST plafonne chaque réponse à 1000 lignes (max_rows) : toutes les lectures
// potentiellement volumineuses (géographie, horaire) sont paginées avec .range().
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { HourlyDbRow } from '@/lib/googleAdsToday'
import type { DeviceDbRow, DemographicDbRow, GeoDbRow, GeoTargetInfo } from '@/lib/googleAdsBreakdowns'

const orgId = () => useAuthStore.getState().user?.organisation_id

export const PAGE_SIZE = 1000
const MAX_PAGES = 50 // garde-fou : 50 000 lignes max par lecture

type PageFetcher<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Lit toutes les pages d'une requête (range 0-999, 1000-1999…) jusqu'à une page incomplète. */
export async function fetchAllPages<T>(fetchPage: PageFetcher<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

interface RangeArgs { customerId: string | null | undefined; from: string; to: string }

// ── Horaire : hier + aujourd'hui (dates locales du compte) ───────────────
const HOURLY_COLS = 'campaign_id, campaign_name, local_date, hour, impressions, clicks, cost_micros, conversions, conversions_value'

export function useGoogleAdsHourly({ customerId, from, to, enabled = true }: RangeArgs & { enabled?: boolean }) {
  const org = orgId()
  return useQuery<HourlyDbRow[]>({
    queryKey: ['google-ads-hourly', org, customerId, from, to],
    queryFn: () => fetchAllPages<HourlyDbRow>((a, b) =>
      supabase.from('google_ads_metrics_hourly').select(HOURLY_COLS)
        .eq('customer_id', customerId!).gte('local_date', from).lte('local_date', to)
        .order('local_date', { ascending: true }).order('hour', { ascending: true }).order('campaign_id', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<HourlyDbRow>>),
    enabled: !!org && !!customerId && enabled,
    staleTime: 60_000,
  })
}

// ── Appareils ─────────────────────────────────────────────────────────────
export function useGoogleAdsDevices({ customerId, from, to }: RangeArgs) {
  const org = orgId()
  return useQuery<DeviceDbRow[]>({
    queryKey: ['google-ads-devices', org, customerId, from, to],
    queryFn: () => fetchAllPages<DeviceDbRow>((a, b) =>
      supabase.from('google_ads_devices_daily').select('device, impressions, clicks, cost_micros, conversions')
        .eq('customer_id', customerId!).gte('local_date', from).lte('local_date', to)
        .order('local_date', { ascending: true }).order('device', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<DeviceDbRow>>),
    enabled: !!org && !!customerId,
    staleTime: 60_000,
  })
}

// ── Démographie ───────────────────────────────────────────────────────────
export function useGoogleAdsDemographics({ customerId, from, to }: RangeArgs) {
  const org = orgId()
  return useQuery<DemographicDbRow[]>({
    queryKey: ['google-ads-demographics', org, customerId, from, to],
    queryFn: () => fetchAllPages<DemographicDbRow>((a, b) =>
      supabase.from('google_ads_demographics_daily').select('dimension, value, impressions, clicks, cost_micros, conversions')
        .eq('customer_id', customerId!).gte('local_date', from).lte('local_date', to)
        .order('local_date', { ascending: true }).order('dimension', { ascending: true }).order('value', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<DemographicDbRow>>),
    enabled: !!org && !!customerId,
    staleTime: 60_000,
  })
}

// ── Géographie (présence réelle) — volumineux : paginé ───────────────────
export function useGoogleAdsGeo({ customerId, from, to }: RangeArgs) {
  const org = orgId()
  return useQuery<GeoDbRow[]>({
    queryKey: ['google-ads-geo', org, customerId, from, to],
    queryFn: () => fetchAllPages<GeoDbRow>((a, b) =>
      supabase.from('google_ads_geo_daily')
        .select('geo_level, presence_type, geo_target_id, impressions, clicks, cost_micros, conversions')
        .eq('customer_id', customerId!).gte('local_date', from).lte('local_date', to)
        .order('local_date', { ascending: true }).order('geo_level', { ascending: true })
        .order('presence_type', { ascending: true }).order('geo_target_id', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<GeoDbRow>>),
    enabled: !!org && !!customerId,
    staleTime: 60_000,
  })
}

/** Noms des zones (référentiel public Google), lus par lots d'identifiants. */
export function useGoogleGeoNames(ids: number[]) {
  const key = [...new Set(ids)].sort((a, b) => a - b)
  return useQuery<Map<number, GeoTargetInfo>>({
    queryKey: ['google-ads-geo-names', key.join(',')],
    queryFn: async () => {
      const out = new Map<number, GeoTargetInfo>()
      const CHUNK = 200
      for (let i = 0; i < key.length; i += CHUNK) {
        const chunk = key.slice(i, i + CHUNK)
        const { data, error } = await supabase.from('google_geo_targets')
          .select('geo_target_id, name, canonical_name, target_type, region_name').in('geo_target_id', chunk)
        if (error) throw new Error(error.message)
        for (const r of (data ?? []) as GeoTargetInfo[]) out.set(Number(r.geo_target_id), r)
      }
      return out
    },
    enabled: key.length > 0,
    staleTime: 10 * 60_000,
  })
}

// ── Zones ciblées (rayons / zones nommées) ────────────────────────────────
export interface TargetedZoneRow {
  campaign_id: string
  campaign_name: string | null
  campaign_status: string | null
  criterion_id: number
  zone_type: 'PROXIMITY' | 'LOCATION'
  latitude: number | null
  longitude: number | null
  radius: number | null
  radius_unit: 'KILOMETERS' | 'MILES' | null
  geo_target_id: number | null
  label: string | null
}

export function useGoogleAdsZones(customerId: string | null | undefined) {
  const org = orgId()
  return useQuery<TargetedZoneRow[]>({
    queryKey: ['google-ads-zones', org, customerId],
    queryFn: () => fetchAllPages<TargetedZoneRow>((a, b) =>
      supabase.from('google_ads_targeted_zones')
        .select('campaign_id, campaign_name, campaign_status, criterion_id, zone_type, latitude, longitude, radius, radius_unit, geo_target_id, label')
        .eq('customer_id', customerId!)
        .order('campaign_id', { ascending: true }).order('criterion_id', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<TargetedZoneRow>>),
    enabled: !!org && !!customerId,
    staleTime: 60_000,
  })
}

// ── Campagnes : statut RÉEL ───────────────────────────────────────────────
export interface CampaignInfoRow { campaign_id: string; name: string | null; status: string; advertising_channel_type: string | null }

export function useGoogleAdsCampaigns(customerId: string | null | undefined) {
  const org = orgId()
  return useQuery<CampaignInfoRow[]>({
    queryKey: ['google-ads-campaigns', org, customerId],
    queryFn: () => fetchAllPages<CampaignInfoRow>((a, b) =>
      supabase.from('google_ads_campaigns').select('campaign_id, name, status, advertising_channel_type')
        .eq('customer_id', customerId!).order('campaign_id', { ascending: true })
        .range(a, b) as unknown as ReturnType<PageFetcher<CampaignInfoRow>>),
    enabled: !!org && !!customerId,
    staleTime: 60_000,
  })
}

/** campaign_id → statut Google réel. */
export const campaignStatusMap = (rows: CampaignInfoRow[] | undefined): Map<string, string> =>
  new Map((rows ?? []).map((r) => [String(r.campaign_id), r.status]))

// ── État de synchronisation par jeu de données ────────────────────────────
export interface SyncStateRow { dataset: string; synced_at: string | null; attempted_at: string | null; backfilled_at: string | null; last_error: string | null }

export function useGoogleAdsSyncState(customerId: string | null | undefined) {
  const org = orgId()
  return useQuery<SyncStateRow[]>({
    queryKey: ['google-ads-sync-state', org, customerId],
    queryFn: async () => {
      const { data, error } = await supabase.from('google_ads_sync_state')
        .select('dataset, synced_at, attempted_at, backfilled_at, last_error').eq('customer_id', customerId!)
      if (error) throw new Error(error.message)
      return (data ?? []) as SyncStateRow[]
    },
    enabled: !!org && !!customerId,
    staleTime: 30_000,
  })
}
