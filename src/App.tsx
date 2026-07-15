// src/App.tsx
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore, useUIStore, useParamsStore } from '@/lib/store'
import AppLayout from '@/components/layout/AppLayout'
import KaytekLogo from '@/components/KaytekLogo'

const LoginPage           = lazy(() => import('@/pages/LoginPage'))
const LockScreen          = lazy(() => import('@/pages/LockScreen'))
const ResetPasswordPage   = lazy(() => import('@/pages/ResetPasswordPage'))
const DashboardPage       = lazy(() => import('@/pages/DashboardPage'))
const InterventionsPage   = lazy(() => import('@/pages/InterventionsPage'))
const InterventionDetailPage = lazy(() => import('@/pages/InterventionDetailPage'))
const DevisPage           = lazy(() => import('@/pages/DevisPage'))
const DevisFormPage       = lazy(() => import('@/pages/DevisFormPage'))
const FacturesPage        = lazy(() => import('@/pages/FacturesPage'))
const ClientsPage         = lazy(() => import('@/pages/ClientsPage'))
const ClientDetailPage    = lazy(() => import('@/pages/ClientDetailPage'))
const MessagingPage       = lazy(() => import('@/pages/MessagingPage'))
const CommissionsPage     = lazy(() => import('@/pages/CommissionsPage'))
const UsersPage           = lazy(() => import('@/pages/UsersPage'))
const ParamsPage          = lazy(() => import('@/pages/ParamsPage'))
const JournalPage         = lazy(() => import('@/pages/JournalPage'))
const DevisApercuPage     = lazy(() => import('@/pages/DevisApercuPage'))
const CataloguePage       = lazy(() => import('@/pages/CataloguePage'))
const PlanningPage        = lazy(() => import('@/pages/PlanningPage'))
const GuidePage           = lazy(() => import('@/pages/guide/GuidePage'))
const GuideAdminPage      = lazy(() => import('@/pages/guide/GuideAdminPage'))
const GuideIntervenantPage= lazy(() => import('@/pages/guide/GuideIntervenantPage'))
const GuideFAQPage        = lazy(() => import('@/pages/guide/GuideFAQPage'))
const GuideAdminVideosPage= lazy(() => import('@/pages/guide/GuideAdminVideosPage'))
const PublicDocumentPage  = lazy(() => import('@/pages/PublicDocumentPage'))
const ConfidentialitePage = lazy(() => import('@/pages/ConfidentialitePage'))
const DeleteAccountPage   = lazy(() => import('@/pages/DeleteAccountPage'))

// ── Guard : session Supabase + app déverrouillée ─────────────────────────────
function Guard({ children, adminOnly = false, requireCanCreateDocs = false }: {
  children: React.ReactNode; adminOnly?: boolean; requireCanCreateDocs?: boolean
}) {
  const { user, loading, error, isAppUnlocked } = useAuthStore()
  const location = useLocation()

  if (loading) return <Loader />
  if (error)   return <ErrorDisplay error={error} />

  if (!user) {
    // Sauvegarder la destination pour redirection post-push
    const target = location.pathname + location.search
    if (target && target !== '/' && !target.startsWith('/login') && !target.startsWith('/lock')) {
      sessionStorage.setItem('kaytek-push-redirect', target)
    }
    console.log('[Guard] no user → /login')
    return <Navigate to="/login" replace />
  }

  if (!isAppUnlocked) {
    console.log('[Guard] user exists but app locked → /lock')
    return <Navigate to="/lock" replace />
  }

  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  if (requireCanCreateDocs && user.role !== 'admin' && !user.can_create_documents) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// ── LockGuard : redirige si pas de user, ou si déjà déverrouillé ─────────────
function LockGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAppUnlocked } = useAuthStore()
  if (loading) return <Loader />
  if (!user) {
    console.log('[LockGuard] no user → /login')
    return <Navigate to="/login" replace />
  }
  if (isAppUnlocked) {
    console.log('[LockGuard] already unlocked → /dashboard')
    return <Navigate to="/dashboard" replace />
  }
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
  const { setUser, setLoading, setError, setAppUnlocked } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [initDone, setInitDone] = useState(false)

  // Thème
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

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

  // Capacitor : verrouiller l'app quand elle passe en arrière-plan
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cleanup: (() => void) | undefined

    import('@capacitor/app').then(({ App: CapApp }) => {
      const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          console.log('[App] arrière-plan → verrouillage')
          setAppUnlocked(false)
        } else {
          console.log('[App] premier plan → app verrouillée, attente authentification')
        }
      })
      cleanup = () => { handle.then(h => h.remove()) }
    })

    return () => { cleanup?.() }
  }, [setAppUnlocked])

  // Initialisation auth : trouve la session → charge le profil → reste VERROUILLÉ
  useEffect(() => {
    if (initDone) return

    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const initAuth = async () => {
      setLoading(true)
      setError(null)

      // Nettoyage push_open (URL propre)
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('push_open') === '1') {
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
        if (sessionError) throw new Error(`Erreur de session: ${sessionError.message}`)

        if (session?.user) {
          console.log('[App] session trouvée pour', session.user.email, '→ chargement profil')

          const { data: profile, error: profileError } = await supabase
            .from('profiles').select('*').eq('id', session.user.id).single()

          if (profileError) throw new Error(`Profil inaccessible: ${profileError.message}`)

          if (profile && isMounted) {
            setUser(profile)
            // isAppUnlocked est persisté (localStorage) : un F5 / une réouverture
            // de l'app ne reverrouille pas tant que l'utilisateur ne s'est pas
            // déconnecté, n'a pas été inactif 30 min, ou (natif) n'a pas mis
            // l'app en arrière-plan — voir useAuthStore et AppLayout.
          }

          const { data: params, error: paramsError } = await supabase
            .from('parametres_entreprise').select('*').single()
          if (!paramsError && params && isMounted) setParams(params)

        } else {
          console.log('[App] aucune session → affichage login')
        }

      } catch (err: any) {
        console.error('[App] erreur initialisation:', err)
        if (isMounted) setError(err.message || 'Erreur de chargement')
      } finally {
        clearTimeout(timeoutId)
        if (isMounted) { setLoading(false); setInitDone(true) }
      }
    }

    initAuth()

    // Seul SIGNED_OUT est géré ici — les logins/unlocks sont gérés par LoginPage et LockScreen
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return
      if (event === 'SIGNED_OUT') {
        console.log('[App] SIGNED_OUT → reset store')
        setAppUnlocked(false)
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
  }, [initDone, setUser, setLoading, setError, setParams, setAppUnlocked, qc])

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Pages publiques */}
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/d/:token"       element={<PublicDocumentPage />} />
        <Route path="/confidentialite"element={<ConfidentialitePage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />

        {/* Écran de verrouillage */}
        <Route path="/lock" element={<LockGuard><LockScreen /></LockGuard>} />

        {/* App protégée : session + isAppUnlocked */}
        <Route path="/" element={<Guard><AppLayout /></Guard>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"      element={<DashboardPage />} />
          <Route path="interventions"  element={<InterventionsPage />} />
          <Route path="planning"       element={<PlanningPage />} />
          <Route path="interventions/:id" element={<InterventionDetailPage />} />
          <Route path="devis"          element={<Guard><DevisPage /></Guard>} />
          <Route path="devis/nouveau"  element={<Guard requireCanCreateDocs><DevisFormPage /></Guard>} />
          <Route path="devis/:id/editer" element={<Guard adminOnly><DevisFormPage /></Guard>} />
          <Route path="devis/:id/apercu" element={<Guard><DevisApercuPage /></Guard>} />
          <Route path="factures"       element={<Guard><FacturesPage /></Guard>} />
          <Route path="clients"        element={<Guard adminOnly><ClientsPage /></Guard>} />
          <Route path="clients/:id"    element={<Guard adminOnly><ClientDetailPage /></Guard>} />
          <Route path="catalogue"      element={<Guard adminOnly><CataloguePage /></Guard>} />
          <Route path="messagerie"     element={<MessagingPage />} />
          <Route path="messagerie/:userId" element={<MessagingPage />} />
          <Route path="commissions"    element={<CommissionsPage />} />
          <Route path="utilisateurs"   element={<Guard adminOnly><UsersPage /></Guard>} />
          <Route path="parametres"     element={<Guard adminOnly><ParamsPage /></Guard>} />
          <Route path="journal"        element={<Guard adminOnly><JournalPage /></Guard>} />
          <Route path="guide"          element={<Guard><GuidePage /></Guard>} />
          <Route path="guide/admin/videos" element={<Guard adminOnly><GuideAdminVideosPage /></Guard>} />
          <Route path="guide/admin/:section?" element={<Guard adminOnly><GuideAdminPage /></Guard>} />
          <Route path="guide/intervenant/:section?" element={<Guard><GuideIntervenantPage /></Guard>} />
          <Route path="guide/faq"      element={<Guard><GuideFAQPage /></Guard>} />
          <Route path="*"              element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
