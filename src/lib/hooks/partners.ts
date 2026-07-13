// src/lib/hooks/partners.ts
// Réseau partenaires — Phase 1 (fondations + connexions).
// Ne touche à aucune table cœur (clients, devis, factures, interventions,
// messages) : uniquement partner_profiles / partner_connections /
// partner_connection_events, isolées par leurs propres policies RLS.
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { PartnerProfile, PartnerConnection, PartnerConnectionEvent, PartnerConnectionStatus, PartnerSearchResult, PartnerMessage, PartnerInterventionRequest, PartnerInterventionStatus, PartnerInterventionEvent, PartnerPhotoMeta } from '@/types'

const uid = () => useAuthStore.getState().user?.id
const orgId = () => useAuthStore.getState().user?.organisation_id
const isAdm = () => useAuthStore.getState().user?.role === 'admin'

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
    // Réseau partenaires réservé à l'admin — assistant/intervenant ne doivent
    // jamais charger ces données, même hors affichage (voir SEC-05).
    enabled: !!org && isAdm(),
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

// ── MESSAGERIE PARTENAIRE (Phase 2) ────────────────────────────────
export function usePartnerMessages(connectionId: string | null) {
  const qc = useQueryClient()
  const org = orgId()
  const query = useQuery<PartnerMessage[]>({
    queryKey: ['partner-messages', connectionId],
    queryFn: async () => {
      if (!connectionId) return []
      const { data, error } = await supabase
        .from('partner_messages').select('*')
        .eq('connection_id', connectionId)
        .order('created_at', { ascending: true })
      if (error) throw error
      const msgs = (data || []) as PartnerMessage[]
      // Marquer comme lus les messages reçus (envoyés par l'autre organisation)
      const unread = msgs.filter(m => m.sender_organisation_id !== org && !m.lu_at).map(m => m.id)
      if (unread.length) {
        await supabase.from('partner_messages').update({ lu_at: new Date().toISOString() }).in('id', unread)
        qc.invalidateQueries({ queryKey: ['partner-messages-unread'] })
      }
      return msgs
    },
    enabled: !!connectionId
  })

  useEffect(() => {
    if (!connectionId) return
    const ch = supabase.channel(`partner-chat-${connectionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_messages', filter: `connection_id=eq.${connectionId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['partner-messages', connectionId] })
          qc.invalidateQueries({ queryKey: ['partner-messages-unread'] })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [connectionId, qc])

  return query
}

export function useSendPartnerMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ connection_id, contenu }: { connection_id: string; contenu: string }) => {
      const org = orgId(); if (!org) throw new Error("Organisation introuvable — reconnectez-vous")
      const { error } = await supabase.from('partner_messages').insert({
        connection_id, sender_profile_id: uid(), sender_organisation_id: org, contenu
      })
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['partner-messages', vars.connection_id] })
    }
  })
}

// Compteur de messages non lus par connexion — pour le badge sur les cartes partenaires.
export function usePartnerUnreadCounts() {
  const org = orgId()
  return useQuery<Record<string, number>>({
    queryKey: ['partner-messages-unread', org],
    queryFn: async () => {
      if (!org) return {}
      const { data, error } = await supabase
        .from('partner_messages').select('connection_id')
        .is('lu_at', null)
        .neq('sender_organisation_id', org)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of (data || []) as { connection_id: string }[]) {
        counts[row.connection_id] = (counts[row.connection_id] || 0) + 1
      }
      return counts
    },
    enabled: !!org && isAdm(),
    refetchInterval: 30_000
  })
}

// ── DEMANDES D'INTERVENTION PARTENAIRE (Phase 3 v1) ────────────────
// Snapshot uniquement — jamais de lecture directe de `interventions`,
// `clients` etc. d'une autre organisation. source_intervention_id
// n'est jamais exposé au partenaire par l'UI (voir composants).
//
// Masquage par statut (RLS, cf. migrations 20260714000002 /
// 20260715000009) : la RLS de `partner_intervention_requests` ne
// laisse la CIBLE lire la ligne brute (donc les colonnes
// confidentielles) que lorsque status IN ('accepted','in_progress',
// 'completed'). Tant que status = 'pending' ou 'refused', une
// sélection brute de la cible sur ces lignes renvoie 0 ligne — c'est
// voulu, pas un bug. Pour que la cible voie quand même qu'une demande
// existe (et puisse décider), on complète avec un APERÇU explicitement
// non-confidentiel via la RPC get_partner_requests_preview (jamais
// d'adresse/téléphone/nom client/photos/consignes/source_intervention_id
// dans ces lignes-là — vérifié côté DB, pas seulement côté UI).
// La source garde toujours l'accès complet à ses propres demandes,
// quel que soit le statut (RLS : current_org_id() = source_organisation_id).
export function usePartnerInterventionRequests() {
  const org = orgId()
  const qc = useQueryClient()

  useEffect(() => {
    if (!org) return
    const ch = supabase.channel(`partner-intervention-requests-${org}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_intervention_requests' },
        () => qc.invalidateQueries({ queryKey: ['partner-intervention-requests', org] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [org, qc])

  return useQuery<PartnerInterventionRequest[]>({
    queryKey: ['partner-intervention-requests', org],
    queryFn: async () => {
      if (!org) return []

      // 1. Lignes visibles en brut par la RLS : toutes nos propres
      //    demandes envoyées (quel que soit leur statut) + les demandes
      //    reçues déjà acceptées/en cours/terminées.
      const { data: fullRows, error: fullErr } = await supabase
        .from('partner_intervention_requests')
        .select('*')
        .or(`source_organisation_id.eq.${org},target_organisation_id.eq.${org}`)
        .order('updated_at', { ascending: false })
      if (fullErr) throw fullErr

      // 2. Aperçu masqué pour nos demandes reçues encore pending/refused
      //    (la RLS bloque leur lecture brute tant qu'elles ne sont pas
      //    acceptées — voir commentaire ci-dessus).
      const [{ data: pendingPreview, error: pendingErr }, { data: refusedPreview, error: refusedErr }] = await Promise.all([
        supabase.rpc('get_partner_requests_preview', { p_status: 'pending' }),
        supabase.rpc('get_partner_requests_preview', { p_status: 'refused' }),
      ])
      if (pendingErr) throw pendingErr
      if (refusedErr) throw refusedErr

      const fullIds = new Set((fullRows || []).map((r: any) => r.id))
      const previewRows = [...(pendingPreview || []), ...(refusedPreview || [])]
        .filter((r: any) => !fullIds.has(r.id))
        .map((r: any): PartnerInterventionRequest => ({
          id: r.id,
          connection_id: r.connection_id,
          source_organisation_id: r.source_organisation_id,
          source_profile_id: '',
          target_organisation_id: org,
          status: r.status,
          type_intervention: r.type_intervention ?? undefined,
          urgence: r.urgence,
          date_souhaitee: r.date_souhaitee ?? undefined,
          ville: r.ville ?? undefined,
          description_partagee: r.description_partagee ?? undefined,
          montant_partage: r.montant_partage ?? undefined,
          note_refus: r.note_refus ?? undefined,
          created_at: r.created_at,
          updated_at: r.updated_at ?? r.created_at,
          // Explicitement absentes de l'aperçu — jamais transmises par la
          // RPC tant que la demande n'est pas acceptée.
          share_adresse: false, share_telephone: false, share_nom_client: false,
          share_description: r.description_partagee != null, share_montant: r.montant_partage != null, share_photos: false,
        }))

      const rows = [...(fullRows || []), ...previewRows] as PartnerInterventionRequest[]
      rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))

      const otherOrgIds = Array.from(new Set(rows.map(r =>
        r.source_organisation_id === org ? r.target_organisation_id : r.source_organisation_id
      ).filter(Boolean)))
      if (otherOrgIds.length === 0) return rows
      const { data: profiles } = await supabase.from('partner_profiles').select('*').in('organisation_id', otherOrgIds)
      const byOrg = new Map((profiles || []).map((p: any) => [p.organisation_id, p as PartnerProfile]))
      return rows.map(r => ({
        ...r,
        partner_profile: byOrg.get(r.source_organisation_id === org ? r.target_organisation_id : r.source_organisation_id) || null
      }))
    },
    enabled: !!org,
    refetchInterval: 30_000
  })
}

export interface SendPartnerInterventionPayload {
  connection_id: string
  target_organisation_id: string
  target_profile_id?: string
  source_intervention_id?: string
  type_intervention?: string
  urgence: boolean
  date_souhaitee?: string
  ville?: string
  share_adresse: boolean; adresse_partagee?: string
  share_telephone: boolean; telephone_client_partage?: string
  share_nom_client: boolean; nom_client_partage?: string
  share_description: boolean; description_partagee?: string
  share_montant: boolean; montant_partage?: number
  share_photos: boolean; photos_partagees?: PartnerPhotoMeta[]
  consignes_partagees?: string
}

export function useSendPartnerInterventionRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: SendPartnerInterventionPayload) => {
      const org = orgId(); if (!org) throw new Error("Organisation introuvable — reconnectez-vous")
      const { error } = await supabase.from('partner_intervention_requests').insert({
        connection_id: payload.connection_id,
        source_organisation_id: org,
        source_profile_id: uid(),
        target_organisation_id: payload.target_organisation_id,
        target_profile_id: payload.target_profile_id || null,
        source_intervention_id: payload.source_intervention_id || null,
        type_intervention: payload.type_intervention || null,
        urgence: payload.urgence,
        date_souhaitee: payload.date_souhaitee || null,
        ville: payload.ville || null,
        share_adresse: payload.share_adresse,
        adresse_partagee: payload.share_adresse ? (payload.adresse_partagee || null) : null,
        share_telephone: payload.share_telephone,
        telephone_client_partage: payload.share_telephone ? (payload.telephone_client_partage || null) : null,
        share_nom_client: payload.share_nom_client,
        nom_client_partage: payload.share_nom_client ? (payload.nom_client_partage || null) : null,
        share_description: payload.share_description,
        description_partagee: payload.share_description ? (payload.description_partagee || null) : null,
        share_montant: payload.share_montant,
        montant_partage: payload.share_montant ? (payload.montant_partage ?? null) : null,
        share_photos: payload.share_photos,
        photos_partagees: payload.share_photos ? (payload.photos_partagees || null) : null,
        consignes_partagees: payload.consignes_partagees || null
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-intervention-requests'] })
  })
}

// Transitions accessibles directement via RLS (pir_update) : la CIBLE
// accepted → in_progress / in_progress → completed (elle a alors déjà
// accès en lecture, donc aussi en écriture), et la SOURCE pour toute
// annulation (elle a toujours accès complet, quel que soit le statut).
// Ne PAS utiliser pour pending → accepted/refused : voir
// useRespondToPartnerInterventionRequest ci-dessous.
export function useUpdatePartnerInterventionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status, note_refus, compte_rendu }: { id: string; status: PartnerInterventionStatus; note_refus?: string; compte_rendu?: string }) => {
      const payload: Record<string, unknown> = { status }
      if (note_refus !== undefined) payload.note_refus = note_refus
      if (compte_rendu !== undefined) payload.compte_rendu = compte_rendu
      const { error } = await supabase.from('partner_intervention_requests').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-intervention-requests'] })
      qc.invalidateQueries({ queryKey: ['partner-intervention-events'] })
    }
  })
}

// Réponse (accepter/refuser) à une demande PENDING par l'organisation
// CIBLE — la seule transition que la RLS ne peut pas gérer en direct :
// Postgres exige qu'une ligne soit lisible via la policy SELECT pour
// être modifiable par UPDATE, or la cible n'a délibérément PAS accès
// en lecture brute à une ligne pending/refused (c'est le masquage —
// voir usePartnerInterventionRequests ci-dessus). La RPC
// respond_to_partner_intervention_request (SECURITY DEFINER) revalide
// donc elle-même, côté DB : appelant = admin de son organisation,
// organisation appelante = target_organisation_id de la ligne (jamais
// la source), statut actuel = 'pending' (une demande déjà tranchée ne
// peut pas être re-répondue), motif de refus obligatoire si refusée.
// Le trigger d'état existant (partner_intervention_requests_before_update)
// s'exécute quand même en plus (défense en profondeur).
export function useRespondToPartnerInterventionRequest() {
  const qc = useQueryClient()
  const org = orgId()
  return useMutation({
    mutationFn: async ({ id, response, note_refus }: { id: string; response: 'accepted' | 'refused'; note_refus?: string }) => {
      const { data, error } = await supabase.rpc('respond_to_partner_intervention_request', {
        p_id: id,
        p_response: response,
        p_note_refus: note_refus ?? null,
      })
      if (error) throw error
      return (Array.isArray(data) ? data[0] : data) as PartnerInterventionRequest | undefined
    },
    onSuccess: (row) => {
      // Écrase immédiatement l'entrée en cache avec la ligne renvoyée par
      // la RPC (déjà masquée côté DB si refusée) — évite d'attendre le
      // refetch réseau pour qu'un statut 'refused' cesse d'exposer des
      // champs confidentiels résiduels dans le cache local.
      if (row) {
        qc.setQueriesData<PartnerInterventionRequest[]>({ queryKey: ['partner-intervention-requests', org] }, (old) =>
          (old || []).map(r => r.id === row.id ? { ...r, ...row } : r)
        )
      }
      qc.invalidateQueries({ queryKey: ['partner-intervention-requests'] })
      qc.invalidateQueries({ queryKey: ['partner-intervention-events'] })
    }
  })
}

// Lie une intervention interne (déjà créée dans MON organisation) à la
// demande partenaire reçue. Le trigger DB revalide que l'intervention
// appartient bien à mon organisation et que ce champ n'a pas déjà été
// renseigné (pas de doublon possible, même via un appel concurrent).
export function useLinkResultingIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, resulting_intervention_id }: { id: string; resulting_intervention_id: string }) => {
      const { error } = await supabase.from('partner_intervention_requests')
        .update({ resulting_intervention_id }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-intervention-requests'] })
      qc.invalidateQueries({ queryKey: ['partner-intervention-events'] })
    }
  })
}

// Recherche un client existant de MON organisation par téléphone exact —
// jamais de lecture cross-org, la RLS clients scope déjà à mon organisation.
export function useFindClientByPhone(telephone: string | undefined) {
  return useQuery<{ id: string; nom: string; prenom?: string; telephone?: string } | null>({
    queryKey: ['client-by-phone', telephone],
    queryFn: async () => {
      if (!telephone) return null
      const { data, error } = await supabase.from('clients').select('id,nom,prenom,telephone')
        .eq('telephone', telephone).eq('archive', false).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!telephone
  })
}

export function usePartnerInterventionEvents(requestId: string | null) {
  return useQuery<PartnerInterventionEvent[]>({
    queryKey: ['partner-intervention-events', requestId],
    queryFn: async () => {
      if (!requestId) return []
      const { data, error } = await supabase
        .from('partner_intervention_events').select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!requestId
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
