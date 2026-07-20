// src/lib/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile, ParametresEntreprisePublic } from '@/types'

export const useAuthStore = create<{
  user: Profile | null
  // true tant que la restauration de session Supabase (getSession + profil) n'est
  // pas terminée — aucune redirection (/login, /lock, /dashboard) ne doit avoir
  // lieu tant que ce flag est true, pour éviter tout flash ou course au démarrage.
  authInitializing: boolean
  error: string | null
  subscriptionBlocked: boolean
  // Séparé de la session Supabase : persisté pour survivre à F5 / réouverture
  // de l'app, mais remis à false par la déconnexion explicite, l'inactivité
  // prolongée (30 min) ou le passage en arrière-plan de l'app native.
  isAppUnlocked: boolean
  setUser: (u: Profile | null) => void
  setAuthInitializing: (v: boolean) => void
  setError: (e: string | null) => void
  setSubscriptionBlocked: (v: boolean) => void
  setAppUnlocked: (v: boolean) => void
  isAdmin: () => boolean
}>()(
  persist(
    (set, get) => ({
      user: null, authInitializing: true, error: null,
      subscriptionBlocked: false,
      isAppUnlocked: false,
      setUser: u => set({ user: u }),
      setAuthInitializing: v => set({ authInitializing: v }),
      setError: e => set({ error: e }),
      setSubscriptionBlocked: v => set({ subscriptionBlocked: v }),
      setAppUnlocked: v => set({ isAppUnlocked: v }),
      isAdmin: () => get().user?.role === 'admin'
    }),
    {
      name: 'kaytek-app-unlock',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      partialize: (s: any) => ({ isAppUnlocked: s.isAppUnlocked }),
    } as any
  )
)

export const useUIStore = create(persist<{
  theme: 'light'|'dark'; sidebarOpen: boolean
  // Masquage visuel des montants du dashboard — masqué par défaut (protège la
  // confidentialité dès la première utilisation), préférence conservée par appareil.
  hideAmounts: boolean
  toggleTheme: () => void; toggleSidebar: () => void; closeSidebar: () => void
  toggleHideAmounts: () => void
}>((set) => ({
  theme: 'dark', sidebarOpen: true, hideAmounts: true,
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleHideAmounts: () => set(s => ({ hideAmounts: !s.hideAmounts }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}), {
  name: 'kaytek-ui',
  // partialize omet hideAmounts pour les blobs déjà persistés avant cette version :
  // le merge par défaut de zustand ne réécrit que les clés présentes dans le
  // storage, donc hideAmounts retombe sur son défaut (true) sans erreur ni migration explicite.
  partialize: (s: any) => ({ theme: s.theme, hideAmounts: s.hideAmounts }),
} as any))

// Paramètres publics uniquement (jamais iban/bic) — branding/UI générale,
// accessible à tout rôle. Voir usePublicParametres()/useParametres().
export const useParamsStore = create<{
  params: ParametresEntreprisePublic | null; setParams: (p: ParametresEntreprisePublic) => void
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
