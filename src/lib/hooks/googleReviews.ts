// src/lib/hooks/googleReviews.ts — Phase 4
// Avis Google Business Profile : lecture directe (RLS gbp_reviews_select,
// admin/assistant de l'org) + synchronisation/réponse via Edge Functions
// (jamais d'accès direct à l'API Google depuis le frontend).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import { invokeGoogleFunction } from './googleIntegrations'

const orgId = () => useAuthStore.getState().user?.organisation_id

export interface GbpReview {
  id: string
  google_review_id: string
  reviewer_display_name: string | null
  star_rating: number | null
  comment: string | null
  review_created_at: string | null
  response_text: string | null
  response_updated_at: string | null
  matched_client_id: string | null
  match_confidence: 'none' | 'suggested' | 'confirmed'
}

export function useGbpReviews() {
  const org = orgId()
  return useQuery<GbpReview[]>({
    queryKey: ['gbp-reviews', org],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gbp_reviews')
        .select('id, google_review_id, reviewer_display_name, star_rating, comment, review_created_at, response_text, response_updated_at, matched_client_id, match_confidence')
        .order('review_created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!org,
    staleTime: 60_000,
  })
}

export function useSyncGbpReviews() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; synced?: number; newReviews?: number; error?: string; reason?: string }>('google-gbp-sync-reviews')
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.reason || 'Synchronisation impossible')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gbp-reviews'] }),
  })
}

export function useReplyToGbpReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { googleReviewId: string; text: string }) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; error?: string; reason?: string }>(
        'google-gbp-reply-review', { googleReviewId: params.googleReviewId, action: 'reply', text: params.text },
      )
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.reason || 'Réponse impossible')
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gbp-reviews'] }),
  })
}

export function useDeleteGbpReviewReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (googleReviewId: string) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; error?: string; reason?: string }>(
        'google-gbp-reply-review', { googleReviewId, action: 'delete' },
      )
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || data?.reason || 'Suppression impossible')
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gbp-reviews'] }),
  })
}
