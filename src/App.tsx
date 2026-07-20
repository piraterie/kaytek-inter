// src/App.tsx
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore, useUIStore, useParamsStore } from '@/lib/store'
import { fetchSubscriptionBlocked } from '@/lib/subscription'
import AppLayout from '@/components/layout/AppLayout'
import KaytekLogo from '@/components/KaytekLogo'
import type { Role } from '@/types'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const LockScreen = lazy(() => import('@/pages/LockScreen'))
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

// ── Guard : session Supabase + app déverrouillée + abonnement actif ─────────
function Guard({ children, adminOnly = false, requireCanCreateDocs = false, allowedRoles }: {
  children: React.ReactNode; adminOnly?: boolean; requireCanCreateDocs?: boolean; allowedRoles?: Role[]
}) {
  const { user, authInitializing, error, isAppUnlocked, subscriptionBlocked } = useAuthStore()
  const location = useLocation()
  // Capturé une seule fois, au tout premier rendu (avant que le SDK Supabase ne
  // traite/nettoie le hash de façon asynchrone) — lire window.location.hash plus
  // tard dans le rendu (ex. après résolution de `authInitializing`) le trouverait déjà vidé.
  const [initialAuthHash] = useState(() => window.location.hash)

  if (authInitializing) return <Loader />
  if (error)   return <ErrorDisplay error={error} />

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

  if (subscriptionBlocked) return <SubscriptionBlockedScreen role={user.role} />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/dashboard" replace />
  if (requireCanCreateDocs && user.role !== 'admin' && !user.can_create_documents) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// ── LockGuard : redirige si pas de user, ou si déjà déverrouillé ─────────────
function LockGuard({ children }: { children: React.ReactNode }) {
  const { user, authInitializing, isAppUnlocked } = useAuthStore()
  if (authInitializing) return <Loader />
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
  const { setUser, setAuthInitializing, setError, setAppUnlocked, setSubscriptionBlocked } = useAuthStore()
  const { theme } = useUIStore()
  const { setParams } = useParamsStore()
  const qc = useQueryClient()
  const nav = useNavigate()

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

  useEffect(() => {
    let isMounted = true
    let timeoutId: ReturnType<typeof setTimeout>

    const initAuth = async () => {
      setAuthInitializing(true)
      setError(null)

      // Démarrage natif : toujours repartir verrouillé, indépendamment de la
      // valeur persistée d'isAppUnlocked — couvre le cas où le process Android
      // a été tué sans passer par l'arrière-plan (force-stop, crash). Le passage
      // normal en arrière-plan verrouille déjà via appStateChange ; ceci garantit
      // qu'un nouveau process JS démarre toujours verrouillé, comme une app bancaire.
      if (Capacitor.isNativePlatform()) {
        setAppUnlocked(false)
      }

      // Ouverture depuis une notification push (push_open=1 ajouté par push-sw.js)
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

        if (sessionError) {
          throw new Error(`Erreur de session: ${sessionError.message}`)
        }

        if (session?.user) {
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
            // isAppUnlocked est persisté (localStorage) : un F5 / une réouverture
            // de l'app (process JS non tué) ne reverrouille pas tant que l'utilisateur
            // ne s'est pas déconnecté, n'a pas été inactif 30 min, ou (natif) n'a pas mis
            // l'app en arrière-plan — voir useAuthStore et AppLayout. Un démarrage natif
            // à froid est en revanche toujours reverrouillé ci-dessus, quel que soit
            // isAppUnlocked : Guard enverra donc vers /lock (biométrie), pas /login.
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
          setAuthInitializing(false)
        }
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return

      // Ce handler ne touche jamais isAppUnlocked, volontairement : SIGNED_IN
      // peut être émis par le SDK pour une resynchronisation entre onglets ou
      // au rattachement du listener, pas seulement pour une vraie connexion
      // interactive — seuls LoginPage (activateSession/handleBiometricLogin)
      // et LockScreen déverrouillent, sur une action utilisateur explicite.
      // Le rafraîchissement automatique du token émet TOKEN_REFRESHED, non
      // géré ici, et ne déverrouille donc jamais l'app tout seul.
      if (event === 'SIGNED_IN' && session?.user) {
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
        console.log('[App] SIGNED_OUT → reset store')
        setAppUnlocked(false)
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
        {/* Pages publiques */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activation" element={<ActivationPage />} />
        <Route path="/d/:token" element={<PublicDocumentPage />} />
        <Route path="/confidentialite" element={<ConfidentialitePage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />

        {/* Écran de verrouillage (app native) */}
        <Route path="/lock" element={<LockGuard><LockScreen /></LockGuard>} />

        {/* App protégée : session + isAppUnlocked + abonnement actif */}
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
