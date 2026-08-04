// src/lib/hooks/googleReviewRequests.ts — Phase 3
// Demandes d'avis Google post-facture payée — création directe (RLS
// review_requests_insert revérifie tout côté serveur : facture payée,
// client réel, rôle autorisé, e-mail client présent via trigger), lecture,
// annulation, envoi immédiat (mode manuel).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import { invokeGoogleFunction } from './googleIntegrations'
import type { ParametresEntreprise } from '@/types'

const orgId = () => useAuthStore.getState().user?.organisation_id
const userId = () => useAuthStore.getState().user?.id

export type ReviewRequestDelai = NonNullable<ParametresEntreprise['avis_google_delai']>

const DELAY_MINUTES: Record<Exclude<ReviewRequestDelai, 'personnalise'>, number> = {
  immediat: 0, '1h': 60, '24h': 24 * 60, '48h': 48 * 60,
}

export function computeScheduledSendAt(delai: ReviewRequestDelai, delaiMinutesPersonnalise?: number | null): string {
  const minutes = delai === 'personnalise' ? (delaiMinutesPersonnalise ?? 0) : DELAY_MINUTES[delai]
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export interface ReviewRequestRow {
  id: string
  facture_id: string
  client_id: string
  status: string
  delivery_status: string
  scheduled_send_at: string | null
  sent_at: string | null
  cancelled_at: string | null
  delivery_error: string | null
  created_at: string
}

export function useReviewRequests() {
  const org = orgId()
  return useQuery<ReviewRequestRow[]>({
    queryKey: ['review-requests', org],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('review_requests')
        .select('id, facture_id, client_id, status, delivery_status, scheduled_send_at, sent_at, cancelled_at, delivery_error, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data ?? []
    },
    enabled: !!org,
    staleTime: 30_000,
  })
}

// Crée la demande d'avis (déclenchée juste après le passage d'une facture
// à 'payee'). Ne lève jamais si les réglages sont désactivés — l'appelant
// doit vérifier avis_google_actif AVANT d'appeler ceci.
export function useCreateReviewRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { factureId: string; clientId: string; delai: ReviewRequestDelai; delaiMinutes?: number | null }) => {
      const org = orgId()
      const uid = userId()
      if (!org || !uid) throw new Error('Session invalide')
      const { data, error } = await supabase.from('review_requests').insert({
        organisation_id: org,
        facture_id: params.factureId,
        client_id: params.clientId,
        created_by: uid,
        scheduled_send_at: computeScheduledSendAt(params.delai, params.delaiMinutes),
      }).select('id').single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-requests'] }),
  })
}

export function useCancelReviewRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const uid = userId()
      const { error } = await supabase.from('review_requests')
        .update({ cancelled_at: new Date().toISOString(), cancelled_by: uid, delivery_status: 'cancelled' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-requests'] }),
  })
}

// Mode manuel — "Envoyer maintenant" : force l'envoi immédiat (bypass
// scheduled_send_at) via l'Edge Function, plutôt que d'attendre le cron.
export function useSendReviewRequestNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (reviewRequestId: string) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; sent?: number; failed?: number }>(
        'google-send-review-requests', { reviewRequestId },
      )
      if (error) throw error
      if (!data?.ok || (data.failed ?? 0) > 0) throw new Error("Échec de l'envoi — voir l'historique pour le détail")
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-requests'] }),
  })
}
