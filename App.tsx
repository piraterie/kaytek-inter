// src/App.tsx
import { useEffect, useState } from 'react'
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

function Guard({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuthStore()
  if (loading) return <Loader />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function Loader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
      <div style={{ width: 40, height: 40, background: 'var(--bl)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🔐</div>
      <p style={{ color: 'var(--t2)', fontSize: 13 }}>Chargement…</p>
    </div>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
      <div style={{ width: 40, height: 40, background: '#ef4444', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>⚠️</div>
      <p style={{ color: 'var(--t1)', fontSize: 13 }}>Erreur : {message}</p>
      <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--bl)', color: '#fff', border: 'none', cursor: 'pointer' }}>
        Réessayer
      </button>
    </div>
  )
}

export default function App() {
  const { setUser, setLoading } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    let isMounted = true

    // Timeout de 10 secondes
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        setLoading(false)
        setLoadError('Le chargement a pris trop de temps. Vérifiez votre connexion.')
      }
    }, 10000)

    const loadSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError) throw new Error(sessionError.message)

        if (session?.user) {
          try {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single()

            if (profileError) throw new Error(profileError.message)
            if (isMounted && profile) setUser(profile)
          } catch (e: any) {
            console.error('Erreur profil:', e.message)
          }

          try {
            const { data: params } = await supabase
              .from('parametres_entreprise')
              .select('*')
              .single()
            if (isMounted && params) setParams(params)
          } catch (e: any) {
            console.error('Erreur params:', e.message)
          }
        }
      } catch (e: any) {
        if (isMounted) setLoadError(e.message)
      } finally {
        clearTimeout(timeoutId)
        if (isMounted) setLoading(false)
      }
    }

    loadSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          if (isMounted && profile) setUser(profile)

          const { data: params } = await supabase
            .from('parametres_entreprise')
            .select('*')
            .single()
          if (isMounted && params) setParams(params)
        } catch (e: any) {
          console.error('Erreur auth change:', e.message)
        }
      }
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setUser(null)
          qc.clear()
        }
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [setUser, setLoading, setParams, qc])

  if (loadError) return <LoadError message={loadError} />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Guard><AppLayout /></Guard>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="interventions" element={<InterventionsPage />} />
        <Route path="interventions/:id" element={<InterventionDetailPage />} />
        <Route path="devis" element={<DevisPage />} />
        <Route path="devis/nouveau" element={<Guard><DevisFormPage /></Guard>} />
        <Route path="devis/:id/editer" element={<Guard><DevisFormPage /></Guard>} />
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
