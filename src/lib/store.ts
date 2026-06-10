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
  actionLabel?: string; onAction?: () => void
}
export const useToastStore = create<{
  toasts: Toast[]
  add: (message: string, type?: ToastType, action?: { label: string; fn: () => void }) => void
  remove: (id: string) => void
}>((set) => ({
  toasts: [],
  add: (message, type = 'success', action) => {
    const id = crypto.randomUUID()
    const toast: Toast = { id, message, type }
    if (action) { toast.actionLabel = action.label; toast.onAction = action.fn }
    set(s => ({ toasts: [...s.toasts, toast] }))
    const duration = type === 'error' ? 7000 : 3500
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), duration)
  },
  remove: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
}))
