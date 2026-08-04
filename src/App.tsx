// src/App.tsx
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore, useUIStore, useParamsStore } from '@/lib/store'
import { fetchSubscriptionBlocked } from '@/lib/subscription'
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
const IntegrationsGooglePage = lazy(() => import('@/pages/IntegrationsGooglePage'))
const GoogleAdsPage = lazy(() => import('@/pages/GoogleAdsPage'))
const GoogleReviewsPage = lazy(() => import('@/pages/GoogleReviewsPage'))
const GooglePerformancePage = lazy(() => import('@/pages/GooglePerformancePage'))
const GoogleReviewRequestsPage = lazy(() => import('@/pages/GoogleReviewRequestsPage'))
const PublicDocumentPage = lazy(() => import('@/pages/PublicDocumentPage'))
const ConfidentialitePage = lazy(() => import('@/pages/ConfidentialitePage'))
const ReviewUnsubscribePage = lazy(() => import('@/pages/ReviewUnsubscribePage'))
const DeleteAccountPage = lazy(() => import('@/pages/DeleteAccountPage'))

function Guard({ children, adminOnly = false, requireCanCreateDocs = false, allowedRoles }: {
  children: React.ReactNode; adminOnly?: boolean; requireCanCreateDocs?: boolean; allowedRoles?: Role[]
}) {
  const { user, loading, error, subscriptionBlocked } = useAuthStore()
  const location = useLocation()
  // Capturé une seule fois, au tout premier rendu (avant que le SDK Supabase ne
  // traite/nettoie le hash de façon asynchrone) — lire window.location.hash plus
  // tard dans le rendu (ex. après résolution de `loading`) le trouverait déjà vidé.
  const [initialAuthHash] = useState(() => window.location.hash)

  if (loading) return <Loader />
  if (error) return <ErrorDisplay error={error} />
  if (!user) {
    // Filet de sécurité : un lien d'invitation/réinitialisation Supabase peut atterrir
    // ici avec le token dans le hash si la redirection configurée côté Supabase (Site URL /
    // Redirect URLs) ne pointe pas vers le bon chemin — on route vers /activation plutôt
    // que de perdre le token en renvoyant vers /login.
    if (initialAuthHash.includes('access_token') && (initialAuthHash.includes('type=invite') || initialAuthHash.includes('type=recovery'))) {
      return <Navigate to={`/activation${initialAuthHash}`} replace />
    }
    // Sauvegarder la destination pour redirection post-login (cas push notification)
    const target = location.pathname + location.search
    if (target && target !== '/' && !target.startsWith('/login')) {
      sessionStorage.setItem('kaytek-push-redirect', target)
    }
    return <Navigate to="/login" replace />
  }
  if (subscriptionBlocked) return <SubscriptionBlockedScreen role={user.role} />
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

function SubscriptionBlockedScreen({ role }: { role: string }) {
  const nav = useNavigate()
  const { setUser, setSubscriptionBlocked } = useAuthStore()
  const message = role === 'admin'
    ? "L'abonnement de votre organisation est inactif ou a expiré. Merci de le régulariser pour continuer à utiliser Kaytek Inter."
    : "L'abonnement de votre organisation n'est plus actif. Merci de contacter votre administrateur pour régulariser la situation."

  async function handleSignOut() {
    await supabase.auth.signOut()
    // Navigation explicite plutôt que de compter sur onAuthStateChange (même
    // pattern que AppLayout.handleSignOut) — évite de dépendre du listener.
    setUser(null)
    setSubscriptionBlocked(false)
    nav('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg)', flexDirection: 'column', gap: 14, padding: 24 }}>
      <div style={{ width: 40, height: 40, background: '#f59e0b', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🔒</div>
      <p style={{ color: 'var(--t1)', fontSize: 14, fontWeight: 600 }}>Abonnement inactif</p>
      <p style={{ color: 'var(--t2)', fontSize: 13, maxWidth: 400, textAlign: 'center' }}>{message}</p>
      <button
        onClick={handleSignOut}
        style={{ marginTop: 10, padding: '8px 16px', background: 'var(--bl)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
      >
        Se déconnecter
      </button>
    </div>
  )
}

export default function App() {
  const { setUser, setLoading, setError, setSubscriptionBlocked } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  const nav = useNavigate()

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
    let isMounted = true
    let timeoutId: ReturnType<typeof setTimeout>

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

          if (isMounted) {
            setSubscriptionBlocked(await fetchSubscriptionBlocked())
          }

          const { data: params, error: paramsError } = await supabase
            .from('parametres_entreprise_public')
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

          setSubscriptionBlocked(await fetchSubscriptionBlocked())

          const { data: params, error: paramsError } = await supabase
            .from('parametres_entreprise_public')
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
        setSubscriptionBlocked(false)
        qc.clear()
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  return (
    <Suspense fallback={<Loader />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/activation" element={<ActivationPage />} />
      <Route path="/d/:token" element={<PublicDocumentPage />} />
      <Route path="/confidentialite" element={<ConfidentialitePage />} />
      <Route path="/desinscription-avis" element={<ReviewUnsubscribePage />} />
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
        <Route path="parametres/integrations" element={<Guard adminOnly><IntegrationsGooglePage /></Guard>} />
        <Route path="google-ads" element={<Guard adminOnly><GoogleAdsPage /></Guard>} />
        <Route path="avis-google" element={<Guard adminOnly><GoogleReviewsPage /></Guard>} />
        <Route path="performances-google" element={<Guard adminOnly><GooglePerformancePage /></Guard>} />
        <Route path="demandes-avis" element={<Guard adminOnly><GoogleReviewRequestsPage /></Guard>} />
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
