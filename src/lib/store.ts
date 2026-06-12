// src/lib/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile, ParametresEntreprise } from '@/types'

export const useAuthStore = create<{
  user: Profile | null; loading: boolean; error: string | null
  setUser: (u: Profile | null) => void; setLoading: (v: boolean) => void; setError: (e: string | null) => void
  isAdmin: () => boolean
}>((set, get) => ({
  user: null, loading: true, error: null,
  setUser: u => set({ user: u }),
  setLoading: v => set({ loading: v }),
  setError: e => set({ error: e }),
  isAdmin: () => get().user?.role === 'admin'
}))

export const useUIStore = create(persist<{
  theme: 'light'|'dark'; sidebarOpen: boolean
  toggleTheme: () => void; toggleSidebar: () => void
}>((set) => ({
  theme: 'dark', sidebarOpen: true,
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}), { name: 'kaytek-ui', partialize: (s: any) => ({ theme: s.theme }) } as any))

export const useParamsStore = create<{
  params: ParametresEntreprise | null; setParams: (p: ParametresEntreprise) => void
}>((set) => ({ params: null, setParams: p => set({ params: p }) }))

export type ToastType = 'success'|'error'|'info'|'warning'
export interface Toast {
  id: string; message: string; type: ToastType
  count: number; dedupeKey: string
  actionLabel?: string; onAction?: () => void
}

// Registry de timers hors state Zustand pour annulation propre lors de la déduplication
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToastStore = create<{
  toasts: Toast[]
  add: (message: string, type?: ToastType, action?: { label: string; fn: () => void }) => void
  remove: (id: string) => void
}>((set, get) => ({
  toasts: [],
  add: (message, type = 'success', action) => {
    const duration = type === 'error' ? 3500 : type === 'warning' ? 2500 : 1800
    const dedupeKey = `${type}:${message}`
    const existing = get().toasts.find(t => t.dedupeKey === dedupeKey)

    if (existing) {
      // Même message déjà visible : incrémenter le compteur + réinitialiser le timer
      set(s => ({
        toasts: s.toasts.map(t =>
          t.dedupeKey === dedupeKey ? { ...t, count: t.count + 1 } : t
        )
      }))
      const old = toastTimers.get(existing.id)
      if (old) clearTimeout(old)
      const timer = setTimeout(() => {
        set(s => ({ toasts: s.toasts.filter(t => t.id !== existing.id) }))
        toastTimers.delete(existing.id)
      }, duration)
      toastTimers.set(existing.id, timer)
      return
    }

    const id = crypto.randomUUID()
    const toast: Toast = { id, message, type, dedupeKey, count: 1 }
    if (action) { toast.actionLabel = action.label; toast.onAction = action.fn }

    set(s => {
      const next = [...s.toasts, toast]
      if (next.length <= 3) return { toasts: next }

      // Éviction par priorité : error/warning évinces d'abord les success/info,
      // success/info s'évincent entre eux — les erreurs restent toujours visibles
      const evictOrder: ToastType[][] =
        (type === 'error')    ? [['success','info'], ['warning']] :
        (type === 'warning')  ? [['success','info']] :
                                [['success','info']]

      for (const candidates of evictOrder) {
        const idx = next.findIndex(t => candidates.includes(t.type))
        if (idx !== -1) {
          const evicted = next[idx]
          const old = toastTimers.get(evicted.id)
          if (old) clearTimeout(old)
          toastTimers.delete(evicted.id)
          return { toasts: next.filter((_, i) => i !== idx) }
        }
      }
      // Fallback : supprimer le plus ancien (cas 3 erreurs empilées)
      const evicted = next[0]
      const old = toastTimers.get(evicted.id)
      if (old) clearTimeout(old)
      toastTimers.delete(evicted.id)
      return { toasts: next.slice(1) }
    })

    const timer = setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
      toastTimers.delete(id)
    }, duration)
    toastTimers.set(id, timer)
  },
  remove: id => {
    const old = toastTimers.get(id)
    if (old) clearTimeout(old)
    toastTimers.delete(id)
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  }
}))
