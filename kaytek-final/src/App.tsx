// src/App.tsx
import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore, useUIStore, useParamsStore } from '@/lib/store'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import InterventionsPage from '@/pages/InterventionsPage'
import InterventionDetailPage from '@/pages/InterventionDetailPage'
import DevisPage from '@/pages/DevisPage'
import DevisFormPage from '@/pages/DevisFormPage'
import FacturesPage from '@/pages/FacturesPage'
import ClientsPage from '@/pages/ClientsPage'
import MessagingPage from '@/pages/MessagingPage'
import CommissionsPage from '@/pages/CommissionsPage'
import UsersPage from '@/pages/UsersPage'
import ParamsPage from '@/pages/ParamsPage'
import JournalPage from '@/pages/JournalPage'

function Loader() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', background:'#1e1e22', flexDirection:'column', gap:16 }}>
      <div style={{ width:48, height:48, background:'#2563eb', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontSize:26 }}>🔐</div>
      <p style={{ color:'#78787f', fontSize:13, fontWeight:500 }}>Chargement...</p>
    </div>
  )
}

function Guard({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuthStore()
  if (loading) return <Loader />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const { setUser, setLoading } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  // Évite double init
  const initialized = useRef(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    async function loadProfile(userId: string) {
      try {
        const [{ data: profile }, { data: params }] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).single(),
          supabase.from('parametres_entreprise').select('*').single()
        ])
        if (profile) setUser(profile)
        if (params) setParams(params)
      } catch (e) {
        console.error('loadProfile:', e)
      }
    }

    // 1. Vérifier session existante
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await loadProfile(session.user.id)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    // 2. Écouter changements auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await loadProfile(session.user.id)
        setLoading(false)
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        qc.clear()
        setLoading(false)
      }
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        await loadProfile(session.user.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Guard><AppLayout /></Guard>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="interventions" element={<InterventionsPage />} />
        <Route path="interventions/:id" element={<InterventionDetailPage />} />
        <Route path="devis" element={<DevisPage />} />
        <Route path="devis/nouveau" element={<DevisFormPage />} />
        <Route path="devis/:id/editer" element={<DevisFormPage />} />
        <Route path="factures" element={<FacturesPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="messagerie" element={<MessagingPage />} />
        <Route path="messagerie/:userId" element={<MessagingPage />} />
        <Route path="commissions" element={<CommissionsPage />} />
        <Route path="utilisateurs" element={<Guard adminOnly><UsersPage /></Guard>} />
        <Route path="parametres" element={<Guard adminOnly><ParamsPage /></Guard>} />
        <Route path="journal" element={<Guard adminOnly><JournalPage /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
