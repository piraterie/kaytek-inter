// src/lib/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile, ParametresEntreprise } from '@/types'

export const useAuthStore = create<{
  user: Profile | null; loading: boolean
  setUser: (u: Profile | null) => void; setLoading: (v: boolean) => void
  isAdmin: () => boolean
}>((set, get) => ({
  user: null, loading: true,
  setUser: u => set({ user: u }),
  setLoading: v => set({ loading: v }),
  isAdmin: () => get().user?.role === 'admin'
}))

export const useUIStore = create(persist<{
  theme: 'light'|'dark'; sidebarOpen: boolean
  toggleTheme: () => void; toggleSidebar: () => void
}>((set) => ({
  theme: 'dark', sidebarOpen: true,
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen }))
}), { name: 'kaytek-ui', partialize: (s: any) => ({ theme: s.theme }) }))

export const useParamsStore = create<{
  params: ParametresEntreprise | null; setParams: (p: ParametresEntreprise) => void
}>((set) => ({ params: null, setParams: p => set({ params: p }) }))

export type ToastType = 'success'|'error'|'info'|'warning'
export interface Toast { id: string; message: string; type: ToastType }

export const useToastStore = create<{
  toasts: Toast[]
  add: (message: string, type?: ToastType) => void
  remove: (id: string) => void
}>((set) => ({
  toasts: [],
  add: (message, type = 'success') => {
    const id = crypto.randomUUID()
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3500)
  },
  remove: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
}))
