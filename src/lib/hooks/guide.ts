// src/lib/hooks/guide.ts — Hooks React Query pour le centre d'aide
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { GuideVideo, GuideProgress, GuideNews, Role } from '@/types'

const uid  = () => useAuthStore.getState().user?.id
const role = () => useAuthStore.getState().user?.role as Role | undefined

// ── Vidéos ────────────────────────────────────────────────────────────────
export function useGuideVideos(forRole: Role) {
  return useQuery<GuideVideo[]>({
    queryKey: ['guide-videos', forRole],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('guide_videos')
        .select('*')
        .eq('role', forRole)
        .order('ordre')
      if (error) throw error
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })
}

/** Retourne une Map section_slug → vidéo pour un accès O(1) */
export function useGuideVideoMap(forRole: Role) {
  const { data: videos = [] } = useGuideVideos(forRole)
  const map = new Map<string, GuideVideo>()
  videos.forEach(v => map.set(v.section_slug, v))
  return map
}

/** URL signée (60 min) pour lire une vidéo depuis Supabase Storage */
export function useGuideVideoUrl(storagePath: string | undefined) {
  return useQuery<string | null>({
    queryKey: ['guide-video-url', storagePath],
    queryFn: async () => {
      if (!storagePath) return null
      const { data, error } = await supabase.storage
        .from('guide-videos')
        .createSignedUrl(storagePath, 3600)
      if (error) return null
      return data?.signedUrl ?? null
    },
    enabled: !!storagePath,
    staleTime: 50 * 60 * 1000, // 50 min (avant expiration des 60 min)
  })
}

// ── Progression ───────────────────────────────────────────────────────────
export function useGuideProgress() {
  const userId = uid()
  return useQuery<GuideProgress[]>({
    queryKey: ['guide-progress', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data, error } = await supabase
        .from('guide_progress')
        .select('*')
        .eq('user_id', userId)
      if (error) throw error
      return data || []
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Set de slugs complétés pour vérification rapide */
export function useCompletedSlugs(): Set<string> {
  const { data: progress = [] } = useGuideProgress()
  return new Set(progress.map(p => p.section_slug))
}

export function useMarkSectionComplete() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  return useMutation({
    mutationFn: async (sectionSlug: string) => {
      if (!user) return
      const { error } = await supabase.from('guide_progress').upsert({
        user_id:         user.id,
        organisation_id: user.organisation_id,
        section_slug:    sectionSlug,
        role:            user.role,
        completed_at:    new Date().toISOString(),
      }, { onConflict: 'user_id,section_slug' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guide-progress', uid()] })
    },
  })
}

// ── Nouveautés ────────────────────────────────────────────────────────────
export function useGuideNews() {
  const userRole = role()
  return useQuery<GuideNews[]>({
    queryKey: ['guide-news', userRole],
    queryFn: async () => {
      if (!userRole) return []
      const col = userRole === 'admin' ? 'visible_admin' : 'visible_intervenant'
      const { data, error } = await supabase
        .from('guide_news')
        .select('*')
        .eq(col, true)
        .eq('actif', true)
        .order('date_publication', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    },
    enabled: !!userRole,
    staleTime: 5 * 60 * 1000,
  })
}

// Mutations admin pour les Nouveautés
export function useCreateGuideNews() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    mutationFn: async (news: Omit<GuideNews, 'id' | 'organisation_id' | 'created_at' | 'updated_at'>) => {
      if (!user) throw new Error('Non authentifié')
      const { error } = await supabase.from('guide_news').insert({
        ...news, organisation_id: user.organisation_id,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guide-news'] }),
  })
}

export function useDeleteGuideNews() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('guide_news').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guide-news'] }),
  })
}

// ── Gestion vidéos (admin) ────────────────────────────────────────────────
export function useAllGuideVideos() {
  return useQuery<GuideVideo[]>({
    queryKey: ['guide-videos-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('guide_videos')
        .select('*')
        .order('role')
        .order('ordre')
      if (error) throw error
      return data || []
    },
    staleTime: 2 * 60 * 1000,
  })
}

export function useUpdateGuideVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<GuideVideo> & { id: string }) => {
      const { error } = await supabase.from('guide_videos').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guide-videos'] })
      qc.invalidateQueries({ queryKey: ['guide-videos-all'] })
    },
  })
}

export function useDeleteGuideVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      // Supprimer du Storage
      await supabase.storage.from('guide-videos').remove([storagePath])
      // Supprimer de la DB
      const { error } = await supabase.from('guide_videos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guide-videos'] })
      qc.invalidateQueries({ queryKey: ['guide-videos-all'] })
    },
  })
}

export function useUploadGuideVideo() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    mutationFn: async ({
      file, role: videoRole, sectionSlug, slug, titre, description, ordre,
    }: {
      file: File; role: Role; sectionSlug: string; slug: string
      titre: string; description?: string; ordre: number
    }) => {
      if (!user) throw new Error('Non authentifié')
      const storagePath = `${user.organisation_id}/${videoRole}/${slug}.webm`
      // Upload
      const { error: upErr } = await supabase.storage
        .from('guide-videos')
        .upload(storagePath, file, { contentType: file.type, upsert: true })
      if (upErr) throw upErr
      // Upsert metadata
      const { error: dbErr } = await supabase.from('guide_videos').upsert({
        organisation_id: user.organisation_id,
        slug: `${videoRole}-${slug}`,
        role: videoRole, section_slug: sectionSlug, titre, description,
        storage_path: storagePath, ordre, actif: true,
      }, { onConflict: 'organisation_id,slug' })
      if (dbErr) throw dbErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guide-videos'] })
      qc.invalidateQueries({ queryKey: ['guide-videos-all'] })
    },
  })
}

// ── Bienvenue ─────────────────────────────────────────────────────────────
export function useDismissWelcome() {
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  return useMutation({
    mutationFn: async () => {
      if (!user) return
      const { error } = await supabase
        .from('profiles')
        .update({ welcome_dismissed: true })
        .eq('id', user.id)
      if (error) throw error
    },
    onSuccess: () => {
      if (user) setUser({ ...user, welcome_dismissed: true })
    },
  })
}
