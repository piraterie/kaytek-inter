// src/lib/hooks/partners.ts
// Réseau partenaires — Phase 1 (fondations + connexions).
// Ne touche à aucune table cœur (clients, devis, factures, interventions,
// messages) : uniquement partner_profiles / partner_connections /
// partner_connection_events, isolées par leurs propres policies RLS.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { PartnerProfile, PartnerConnection, PartnerConnectionEvent, PartnerConnectionStatus, PartnerSearchResult } from '@/types'

const uid = () => useAuthStore.getState().user?.id
const orgId = () => useAuthStore.getState().user?.organisation_id

// ── MON PROFIL PARTENAIRE ────────────────────────────────────────
export function useMyPartnerProfile() {
  const org = orgId()
  return useQuery<PartnerProfile | null>({
    queryKey: ['partner-profile-mine', org],
    queryFn: async () => {
      if (!org) return null
      const { data, error } = await supabase
        .from('partner_profiles').select('*')
        .eq('organisation_id', org)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!org
  })
}

export function useUpsertPartnerProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { nom_public: string; metier?: string; ville?: string; bio?: string; visible_reseau: boolean }) => {
      const org = orgId(); if (!org) throw new Error("Organisation introuvable — reconnectez-vous")
      const { data: existing } = await supabase.from('partner_profiles').select('id').eq('organisation_id', org).maybeSingle()
      if (existing) {
        const { error } = await supabase.from('partner_profiles').update(data).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('partner_profiles').insert({ ...data, organisation_id: org, created_by_profile_id: uid() })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-profile-mine'] })
  })
}

// ── RECHERCHE ─────────────────────────────────────────────────────
export function usePartnerSearch(query: string) {
  const q = query.trim()
  return useQuery<PartnerSearchResult[]>({
    queryKey: ['partner-search', q],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_partner_profiles', { query: q })
      if (error) throw error
      return (data || []) as PartnerSearchResult[]
    },
    enabled: q.length >= 2,
    staleTime: 10_000
  })
}

// ── CONNEXIONS ────────────────────────────────────────────────────
export function usePartnerConnections() {
  const org = orgId()
  return useQuery<PartnerConnection[]>({
    queryKey: ['partner-connections', org],
    queryFn: async () => {
      if (!org) return []
      const { data, error } = await supabase
        .from('partner_connections')
        .select('*')
        .or(`requester_organisation_id.eq.${org},target_organisation_id.eq.${org}`)
        .order('updated_at', { ascending: false })
      if (error) throw error
      const rows = (data || []) as PartnerConnection[]
      const otherOrgIds = Array.from(new Set(rows.map(r =>
        r.requester_organisation_id === org ? r.target_organisation_id : r.requester_organisation_id
      )))
      if (otherOrgIds.length === 0) return rows
      const { data: profiles } = await supabase.from('partner_profiles').select('*').in('organisation_id', otherOrgIds)
      const byOrg = new Map((profiles || []).map((p: any) => [p.organisation_id, p as PartnerProfile]))
      return rows.map(r => ({
        ...r,
        partner_profile: byOrg.get(r.requester_organisation_id === org ? r.target_organisation_id : r.requester_organisation_id) || null
      }))
    },
    enabled: !!org,
    refetchInterval: 30_000
  })
}

export function useSendPartnerRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ target_organisation_id, target_profile_id, message }: { target_organisation_id: string; target_profile_id?: string; message?: string }) => {
      const org = orgId(); if (!org) throw new Error("Organisation introuvable — reconnectez-vous")
      const { error } = await supabase.from('partner_connections').insert({
        requester_organisation_id: org,
        requester_profile_id: uid(),
        target_organisation_id,
        target_profile_id: target_profile_id || null,
        message: message || null
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-connections'] })
      qc.invalidateQueries({ queryKey: ['partner-search'] })
    }
  })
}

export function useUpdatePartnerConnectionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PartnerConnectionStatus }) => {
      const { error } = await supabase.from('partner_connections').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-connections'] })
      qc.invalidateQueries({ queryKey: ['partner-connection-events'] })
    }
  })
}

// ── HISTORIQUE ────────────────────────────────────────────────────
export function usePartnerConnectionEvents(connectionId: string | null) {
  return useQuery<PartnerConnectionEvent[]>({
    queryKey: ['partner-connection-events', connectionId],
    queryFn: async () => {
      if (!connectionId) return []
      const { data, error } = await supabase
        .from('partner_connection_events').select('*')
        .eq('connection_id', connectionId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!connectionId
  })
}
