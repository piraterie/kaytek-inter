// src/App.tsx
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore, useUIStore, useParamsStore } from '@/lib/store'
import AppLayout from '@/components/layout/AppLayout'
import KaytekLogo from '@/components/KaytekLogo'
import type { Role } from '@/types'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))
const ActivationPage = lazy(() => import('@/pages/ActivationPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const InterventionsPage = lazy(() => import('@/pages/InterventionsPage'))
const InterventionDetailPage = lazy(() => import('@/pages/InterventionDetailPage'))
const DevisPage = lazy(() => import('@/pages/DevisPage'))
const DevisFormPage = lazy(() => import('@/pages/DevisFormPage'))
const FacturesPage = lazy(() => import('@/pages/FacturesPage'))
const ClientsPage = lazy(() => import('@/pages/ClientsPage'))
const ClientDetailPage = lazy(() => import('@/pages/ClientDetailPage'))
const MessagingPage = lazy(() => import('@/pages/MessagingPage'))
const CommissionsPage = lazy(() => import('@/pages/CommissionsPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const ParamsPage = lazy(() => import('@/pages/ParamsPage'))
const JournalPage = lazy(() => import('@/pages/JournalPage'))
const DevisApercuPage = lazy(() => import('@/pages/DevisApercuPage'))
const CataloguePage = lazy(() => import('@/pages/CataloguePage'))
const PlanningPage = lazy(() => import('@/pages/PlanningPage'))
const GuidePage = lazy(() => import('@/pages/guide/GuidePage'))
const GuideAdminPage = lazy(() => import('@/pages/guide/GuideAdminPage'))
const GuideIntervenantPage = lazy(() => import('@/pages/guide/GuideIntervenantPage'))
const GuideFAQPage = lazy(() => import('@/pages/guide/GuideFAQPage'))
const GuideAdminVideosPage = lazy(() => import('@/pages/guide/GuideAdminVideosPage'))
const PartenairesPage = lazy(() => import('@/pages/PartenairesPage'))
const PublicDocumentPage = lazy(() => import('@/pages/PublicDocumentPage'))
const ConfidentialitePage = lazy(() => import('@/pages/ConfidentialitePage'))
const DeleteAccountPage = lazy(() => import('@/pages/DeleteAccountPage'))

function Guard({ children, adminOnly = false, requireCanCreateDocs = false, allowedRoles }: {
  children: React.ReactNode; adminOnly?: boolean; requireCanCreateDocs?: boolean; allowedRoles?: Role[]
}) {
  const { user, loading, error } = useAuthStore()
  const location = useLocation()

  if (loading) return <Loader />
  if (error) return <ErrorDisplay error={error} />
  if (!user) {
    // Filet de sécurité : un lien d'invitation/réinitialisation Supabase peut atterrir
    // ici avec le token dans le hash si la redirection configurée côté Supabase (Site URL /
    // Redirect URLs) ne pointe pas vers le bon chemin — on route vers /activation plutôt
    // que de perdre le token en renvoyant vers /login.
    const hash = window.location.hash
    if (hash.includes('access_token') && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
      return <Navigate to={`/activation${hash}`} replace />
    }
    // Sauvegarder la destination pour redirection post-login (cas push notification)
    const target = location.pathname + location.search
    if (target && target !== '/' && !target.startsWith('/login')) {
      sessionStorage.setItem('kaytek-push-redirect', target)
    }
    return <Navigate to="/login" replace />
  }
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/dashboard" replace />
  if (requireCanCreateDocs && user.role !== 'admin' && !user.can_create_documents) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function Loader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', flexDirection: 'column', gap: 16 }}>
      <KaytekLogo size={56} style={{ filter: 'drop-shadow(0 3px 8px rgba(37,99,235,.30))' }} />
      <p style={{ color: 'var(--t2)', fontSize: 13 }}>Chargement…</p>
    </div>
  )
}

function ErrorDisplay({ error }: { error: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
      <div style={{ width: 40, height: 40, background: '#ef4444', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>⚠️</div>
      <p style={{ color: 'var(--t1)', fontSize: 14, fontWeight: 600 }}>Erreur de chargement</p>
      <p style={{ color: 'var(--t2)', fontSize: 13, maxWidth: 400, textAlign: 'center' }}>{error}</p>
      <button 
        onClick={() => window.location.reload()} 
        style={{ marginTop: 10, padding: '8px 16px', background: 'var(--bl)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
      >
        Réessayer
      </button>
    </div>
  )
}

export default function App() {
  const { setUser, setLoading, setError } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [initDone, setInitDone] = useState(false)

  // Listener SW — reçoit NAVIGATE depuis push-sw.js quand l'app est déjà ouverte
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'NAVIGATE' && event.data.url) {
        nav(event.data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [nav])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (initDone) return

    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const initAuth = async () => {
      setLoading(true)
      setError(null)

      // Ouverture depuis une notification push (push_open=1 ajouté par push-sw.js)
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('push_open') === '1') {
        sessionStorage.setItem('kaytek-active', '1')
        const cleanUrl = window.location.pathname + window.location.hash
        window.history.replaceState({}, '', cleanUrl)
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Délai d\'attente dépassé (10s). Vérifiez votre connexion internet.'))
        }, 10000)
      })

      try {
        const { data: { session }, error: sessionError } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise
        ])

        if (!isMounted) return

        if (sessionError) {
          throw new Error(`Erreur de session: ${sessionError.message}`)
        }

        if (session?.user && sessionStorage.getItem('kaytek-active')) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (profileError) {
            console.error('Erreur profil:', profileError)
            throw new Error(`Impossible de charger le profil utilisateur: ${profileError.message}`)
          }

          if (profile && isMounted) {
            setUser(profile)
          }

          const { data: params, error: paramsError } = await supabase
            .from('parametres_entreprise')
            .select('*')
            .single()

          if (!paramsError && params && isMounted) {
            setParams(params)
          }
        }

      } catch (err: any) {
        console.error('Erreur d\'initialisation:', err)
        if (isMounted) {
          setError(err.message || 'Une erreur est survenue lors du chargement')
        }
      } finally {
        clearTimeout(timeoutId)
        if (isMounted) {
          setLoading(false)
          setInitDone(true)
        }
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return

      if (event === 'SIGNED_IN' && session?.user && sessionStorage.getItem('kaytek-active')) {
        try {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (profileError) {
            console.error('Erreur profil après connexion:', profileError)
            return
          }

          if (profile) setUser(profile)

          const { data: params, error: paramsError } = await supabase
            .from('parametres_entreprise')
            .select('*')
            .single()

          if (!paramsError && params) setParams(params)

        } catch (err) {
          console.error('Erreur lors du changement d\'état auth:', err)
        }
      }

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setParams(null)
        qc.clear()
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [initDone, setUser, setLoading, setError, setParams, qc])

  return (
    <Suspense fallback={<Loader />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/activation" element={<ActivationPage />} />
      <Route path="/d/:token" element={<PublicDocumentPage />} />
      <Route path="/confidentialite" element={<ConfidentialitePage />} />
      <Route path="/delete-account" element={<DeleteAccountPage />} />
      <Route path="/" element={<Guard><AppLayout /></Guard>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="interventions" element={<InterventionsPage />} />
        <Route path="planning" element={<PlanningPage />} />
        <Route path="interventions/:id" element={<InterventionDetailPage />} />
        <Route path="devis" element={<Guard allowedRoles={['admin','intervenant']}><DevisPage /></Guard>} />
        <Route path="devis/nouveau" element={<Guard requireCanCreateDocs allowedRoles={['admin','intervenant']}><DevisFormPage /></Guard>} />
        <Route path="devis/:id/editer" element={<Guard adminOnly><DevisFormPage /></Guard>} />
        <Route path="devis/:id/apercu" element={<Guard allowedRoles={['admin','intervenant']}><DevisApercuPage /></Guard>} />
        <Route path="factures" element={<Guard allowedRoles={['admin','intervenant']}><FacturesPage /></Guard>} />
        <Route path="clients" element={<Guard allowedRoles={['admin','assistant']}><ClientsPage /></Guard>} />
        <Route path="clients/:id" element={<Guard allowedRoles={['admin','assistant']}><ClientDetailPage /></Guard>} />
        <Route path="catalogue" element={<Guard adminOnly><CataloguePage /></Guard>} />
        <Route path="messagerie" element={<MessagingPage />} />
        <Route path="messagerie/:userId" element={<MessagingPage />} />
        <Route path="commissions" element={<Guard allowedRoles={['admin','intervenant']}><CommissionsPage /></Guard>} />
        <Route path="partenaires" element={<Guard adminOnly><PartenairesPage /></Guard>} />
        <Route path="utilisateurs" element={<Guard adminOnly><UsersPage /></Guard>} />
        <Route path="parametres" element={<Guard adminOnly><ParamsPage /></Guard>} />
        <Route path="journal" element={<Guard adminOnly><JournalPage /></Guard>} />
        {/* ── Guide d'utilisation ─────────────────────────────────────── */}
        <Route path="guide" element={<Guard allowedRoles={['admin','intervenant']}><GuidePage /></Guard>} />
        <Route path="guide/admin/videos" element={<Guard adminOnly><GuideAdminVideosPage /></Guard>} />
        <Route path="guide/admin/:section?" element={<Guard adminOnly><GuideAdminPage /></Guard>} />
        <Route path="guide/intervenant/:section?" element={<Guard><GuideIntervenantPage /></Guard>} />
        <Route path="guide/faq" element={<Guard><GuideFAQPage /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
