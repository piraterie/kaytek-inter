// src/components/layout/AppLayout.tsx
import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, MessagesSquare, Wrench, CalendarDays, FileText, Receipt,
  Users, Package, DollarSign, Shield, Settings, ClipboardList, Handshake,
  ChevronLeft, ChevronRight, LogOut, Sun, Moon, BookOpen,
  MessageCircle, Bell, Menu, User, Smartphone, Monitor, X,
  CheckCheck, Trash2, ChevronUp, ChevronDown, AlertTriangle,
  CheckCircle2, XCircle, Info,
} from 'lucide-react'
import KaytekLogo from '@/components/KaytekLogo'
import WelcomeModal from '@/components/WelcomeModal'
import { useAuthStore, useUIStore, useToastStore, useParamsStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import { signOut } from '@/lib/supabase/auth'
import { useUnreadCount, useUpdateProfile, useIsMobile, useRequestNotificationPermission, usePushSubscription, useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useDeleteNotification, useDeleteAllReadNotifications, useParamsCompletion } from '@/lib/hooks'
import { getMyDevices, disconnectDevice, disconnectAllOtherDevices, isCurrentDevice, type DeviceRecord } from '@/lib/devices'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'
import OfflineBanner from '@/components/OfflineBanner'
import type { Role } from '@/types'

type NavIcon = React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>

const NAV: { path: string; label: string; icon: NavIcon; section: string; adminOnly?: boolean; allowedRoles?: Role[]; badge?: 'messages' | 'pending' | 'partnerRequests' }[] = [
  { path: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard, section: 'Pilotage' },
  { path: '/messagerie',    label: 'Messagerie',    icon: MessagesSquare,  section: 'Pilotage', badge: 'messages' },
  { path: '/interventions', label: 'Interventions', icon: Wrench,          section: 'Terrain',  badge: 'pending' },
  { path: '/planning',      label: 'Planning',      icon: CalendarDays,    section: 'Terrain' },
  { path: '/devis',         label: 'Devis',         icon: FileText,        section: 'Terrain', allowedRoles: ['admin','intervenant'] },
  { path: '/factures',      label: 'Factures',      icon: Receipt,         section: 'Terrain', allowedRoles: ['admin','intervenant'] },
  { path: '/clients',       label: 'Clients',       icon: Users,           section: 'Gestion', allowedRoles: ['admin','assistant'] },
  { path: '/catalogue',     label: 'Catalogue',     icon: Package,         section: 'Gestion', adminOnly: true },
  { path: '/commissions',   label: 'Commissions',   icon: DollarSign,      section: 'Gestion', allowedRoles: ['admin','intervenant'] },
  { path: '/guide',         label: 'Guide',         icon: BookOpen,        section: 'Gestion', allowedRoles: ['admin','intervenant'] },
  { path: '/partenaires',   label: 'Réseau partenaires', icon: Handshake,  section: 'Administration', adminOnly: true, badge: 'partnerRequests' },
  { path: '/utilisateurs',  label: 'Utilisateurs',  icon: Shield,          section: 'Administration', adminOnly: true },
  { path: '/parametres',    label: 'Paramètres',    icon: Settings,        section: 'Administration', adminOnly: true },
  { path: '/journal',       label: 'Journal',       icon: ClipboardList,   section: 'Administration', adminOnly: true },
]
const SECTIONS = ['Pilotage', 'Terrain', 'Gestion', 'Administration']

export default function AppLayout() {
  const { user, setUser } = useAuthStore()
  const { theme, sidebarOpen, toggleTheme, toggleSidebar, closeSidebar } = useUIStore()
  const { toasts, remove, add } = useToastStore()
  const { data: unread = 0 } = useUnreadCount()
  const updProfile = useUpdateProfile()
  const { isComplete: paramsComplete, missingFields: paramsMissing, isLoaded: paramsLoaded } = useParamsCompletion()
  const orgParams = useParamsStore(s => s.params)
  useRequestNotificationPermission()
  usePushSubscription()
  const nav = useNavigate()
  const loc = useLocation()
  const isAdmin = user?.role === 'admin'
  const items = NAV.filter(i => {
    if (i.allowedRoles) return !!user && i.allowedRoles.includes(user.role)
    return !i.adminOnly || isAdmin
  })
  const isMobile = useIsMobile()

  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('kaytek_nav_compact') === '1' } catch { return false }
  })
  const compactDesktop = compact && !isMobile

  function toggleCompact() {
    setCompact(c => {
      const next = !c
      try { localStorage.setItem('kaytek_nav_compact', next ? '1' : '0') } catch {}
      return next
    })
  }

  const { data: pendingInterventions = 0 } = useQuery({
    queryKey: ['interventions-pending-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('interventions')
        .select('*', { count: 'exact', head: true })
        .eq('statut', 'en_attente')
      return count || 0
    },
    staleTime: 2 * 60 * 1000,
  })

  const { data: pendingPartnerRequests = 0 } = useQuery({
    queryKey: ['partner-requests-pending-count', user?.organisation_id],
    queryFn: async () => {
      if (!user?.organisation_id) return 0
      const { count } = await supabase
        .from('partner_connections')
        .select('*', { count: 'exact', head: true })
        .eq('target_organisation_id', user.organisation_id)
        .eq('status', 'pending')
      return count || 0
    },
    enabled: isAdmin && !!user?.organisation_id,
    staleTime: 2 * 60 * 1000,
  })

  // Mobile : fermer la sidebar au premier chargement (sidebarOpen vaut true par défaut).
  // On utilise closeSidebar (idempotent) plutôt que toggleSidebar pour éviter le double-toggle
  // provoqué par React 18 StrictMode qui exécute les effets deux fois en développement.
  useEffect(() => {
    if (isMobile) closeSidebar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mobile : sidebar toujours position:fixed (hors flux), translateX gère l'affichage
  const sidebarW = isMobile ? 0 : (compact ? 72 : 280)

  const { data: notifications = [] } = useMyNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const deleteNotif = useDeleteNotification()
  const deleteAllRead = useDeleteAllReadNotifications()
  const unreadNotifs = (notifications as any[]).filter((n: any) => !n.lue).length
  const readNotifs = (notifications as any[]).filter((n: any) => n.lue)
  const [notifOpen, setNotifOpen] = useState(false)
  const [showReadNotifs, setShowReadNotifs] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)

  const [showWelcome, setShowWelcome] = useState(false)

  useEffect(() => {
    if (!user) return
    if (user.welcome_dismissed) return
    if (sessionStorage.getItem('kaytek-welcome-dismissed')) return
    setShowWelcome(true)
  }, [user?.id, user?.welcome_dismissed])

  function handleCloseWelcome() {
    sessionStorage.setItem('kaytek-welcome-dismissed', '1')
    setShowWelcome(false)
  }

  const [profilModal, setProfilModal] = useState(false)
  const [profilForm, setProfilForm] = useState({ prenom: '', nom: '' })
  const [profilTab, setProfilTab] = useState<'profil' | 'appareils'>('profil')
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)

  // Inactivité — déconnexion automatique après 30 minutes
  useEffect(() => {
    const TIMEOUT = 30 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        await signOut()
        sessionStorage.removeItem('kaytek-active')
        nav('/login')
      }, TIMEOUT)
    }
    const events = ['mousemove', 'keydown', 'click', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, resetTimer))
    resetTimer()
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [nav])

  async function handleSignOut() { await signOut(); nav('/login') }

  async function openProfil() {
    setProfilForm({ prenom: user?.prenom || '', nom: user?.nom || '' })
    setProfilTab('profil')
    setProfilModal(true)
    setDevicesLoading(true)
    const d = await getMyDevices()
    setDevices(d)
    setDevicesLoading(false)
  }

  async function handleDisconnectDevice(deviceDbId: string) {
    await disconnectDevice(deviceDbId)
    setDevices(prev => prev.map(d => d.id === deviceDbId ? { ...d, actif: false } : d))
    add('Appareil déconnecté')
  }

  async function handleDisconnectAll() {
    await disconnectAllOtherDevices()
    setDevices(prev => prev.map(d => isCurrentDevice(d.device_id) ? d : { ...d, actif: false }))
    add('Tous les autres appareils ont été déconnectés')
  }

  async function handleSaveProfil(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    try {
      await updProfile.mutateAsync({ id: user.id, prenom: profilForm.prenom, nom: profilForm.nom })
      setUser({ ...user, prenom: profilForm.prenom, nom: profilForm.nom })
      add('Profil mis à jour')
      setProfilModal(false)
    } catch (err: any) { add(err.message, 'error') }
  }

  function navTo(path: string) {
    nav(path)
    if (isMobile && sidebarOpen) toggleSidebar()
  }

  // Fermer le dropdown notif si clic en dehors
  useEffect(() => {
    if (!notifOpen) return
    const close = () => setNotifOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [notifOpen])

  const mainRef = useRef<HTMLElement>(null)

  // Remettre le scroll en haut à chaque changement de route
  // Messagerie exclue : la conversation doit rester sur le dernier message
  useEffect(() => {
    if (loc.pathname.startsWith('/messagerie')) return
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [loc.pathname])

  const currentPage = items.find(i => loc.pathname.startsWith(i.path))?.label || 'Kaytek'

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      {/* OVERLAY MOBILE — toujours dans le DOM, fade via opacity */}
      {isMobile && (
        <div
          onClick={sidebarOpen ? toggleSidebar : undefined}
          style={{
            position: 'fixed', inset: 0, zIndex: 99,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? 'auto' : 'none',
            transition: 'opacity 220ms cubic-bezier(0.32,0.72,0,1)',
          } as React.CSSProperties}
        />
      )}
      {/* SIDEBAR */}
      <aside style={{
        background: 'var(--nav)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: '1px solid var(--navBd)',
        flexShrink: 0,
        ...(isMobile ? {
          // Mobile : position:fixed + slide GPU via transform (pas de reflow)
          position: 'fixed', top: 0, left: 0,
          width: 280, minWidth: 280,
          height: '100dvh', zIndex: 100,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          // visibility passe à hidden seulement après la fin de l'animation de fermeture
          visibility: sidebarOpen ? 'visible' : 'hidden',
          transition: `transform 220ms cubic-bezier(0.32,0.72,0,1), visibility ${sidebarOpen ? '0ms' : '220ms'}`,
          willChange: 'transform',
        } : {
          // Desktop : compact toggle via width
          width: sidebarW,
          minWidth: sidebarW,
          transition: 'width 200ms cubic-bezier(0.32,0.72,0,1), min-width 200ms cubic-bezier(0.32,0.72,0,1)',
        }),
      }}>

        {/* ── LOGO / BRAND ── */}
        <div style={{
          padding: compactDesktop ? '16px 0' : '15px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--navBd)', flexShrink: 0,
          justifyContent: compactDesktop ? 'center' : 'flex-start'
        }}>
          <KaytekLogo size={36} style={{ filter: 'drop-shadow(0 2px 5px rgba(37,99,235,.35))' }} />
          {!compactDesktop && (
            <>
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <div style={{ color: 'var(--navTA)', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '-.02em' }}>Kaytek Inter</div>
                <div style={{ color: 'var(--navSec)', fontSize: 10, marginTop: 1 }}>Serrurerie · Vitrerie</div>
              </div>
              {!isMobile && (
                <button onClick={toggleCompact}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--navSec)', padding: 5, display: 'flex', alignItems: 'center', borderRadius: 6, flexShrink: 0, transition: 'color .2s, background .2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--navTA)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--navH)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--navSec)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  title="Réduire le menu">
                  <ChevronLeft size={15} />
                </button>
              )}
            </>
          )}
        </div>

        {/* ── NAV ── */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: compactDesktop ? '8px 6px' : '8px 8px', scrollbarWidth: 'none' }}>
          {SECTIONS.map(section => {
            const sItems = items.filter(i => i.section === section)
            if (!sItems.length) return null
            return (
              <div key={section}>
                {!compactDesktop && <div className="nav-section-label">{section}</div>}
                {compactDesktop && <div style={{ height: 10 }} />}
                {sItems.map(item => {
                  const active = loc.pathname.startsWith(item.path)
                  const Icon = item.icon
                  const badgeCount = item.badge === 'messages' ? unread : item.badge === 'pending' ? pendingInterventions : item.badge === 'partnerRequests' ? pendingPartnerRequests : 0
                  return (
                    <button
                      key={item.path}
                      onClick={() => navTo(item.path)}
                      className={`nav-item${active ? ' nav-active' : ''}`}
                      title={compactDesktop ? item.label : undefined}
                      style={compactDesktop ? { justifyContent: 'center', padding: '10px 0' } : undefined}
                    >
                      <Icon size={17} strokeWidth={active ? 2.2 : 1.6} style={{ flexShrink: 0 }} />
                      {!compactDesktop && (
                        <>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                          {badgeCount > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, background: active ? 'var(--bl)' : '#dc2626', color: '#fff', padding: '1px 7px', borderRadius: 20, flexShrink: 0, lineHeight: 1.6 }}>
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                          )}
                        </>
                      )}
                      {compactDesktop && badgeCount > 0 && (
                        <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, background: '#dc2626', borderRadius: '50%', border: '1.5px solid var(--nav)' }} />
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* ── CONFIDENTIALITÉ ── */}
        {!compactDesktop && (
          <div style={{ padding: '4px 16px 6px', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: 10 }}>
            <a href="/confidentialite" style={{ fontSize: 10, color: 'var(--navSec)', textDecoration: 'none', opacity: 0.7 }}>
              Confidentialité
            </a>
            <span style={{ fontSize: 10, color: 'var(--navSec)', opacity: 0.4 }}>·</span>
            <a href="/delete-account" style={{ fontSize: 10, color: 'var(--navSec)', textDecoration: 'none', opacity: 0.7 }}>
              Supprimer mon compte
            </a>
          </div>
        )}

        {/* ── USER AREA ── */}
        <div style={{ padding: compactDesktop ? '10px 6px' : '10px 10px', borderTop: '1px solid var(--navBd)', flexShrink: 0 }}>
          {!compactDesktop ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Profile row */}
              <button onClick={openProfil} style={{ background: 'transparent', border: 'none', cursor: 'pointer', width: '100%', padding: 0, textAlign: 'left', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8, transition: 'background .2s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--navH)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: '.5px', boxShadow: '0 2px 6px rgba(37,99,235,.3)' }}>
                    {(user?.prenom?.[0] || '').toUpperCase()}{(user?.nom?.[0] || '').toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--navTA)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.prenom} {user?.nom}</div>
                    <div style={{ color: 'var(--navSec)', fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user?.role === 'admin' ? 'Administrateur' : 'Intervenant'} · {orgParams?.raison_sociale || 'Kaytek Inter'}
                    </div>
                  </div>
                </div>
              </button>
              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={toggleTheme}
                  style={{ flex: 1, background: 'transparent', border: '1px solid var(--navBd)', borderRadius: 7, padding: '6px 0', cursor: 'pointer', color: 'var(--navT)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, fontFamily: 'inherit', transition: 'all .2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--navH)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navTA)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navT)' }}>
                  {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                  {theme === 'dark' ? 'Clair' : 'Sombre'}
                </button>
                <button onClick={handleSignOut}
                  style={{ flex: 1, background: 'transparent', border: '1px solid var(--navBd)', borderRadius: 7, padding: '6px 0', cursor: 'pointer', color: 'var(--rdTx)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, fontFamily: 'inherit', transition: 'all .2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--rdBg)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--rdBd)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--navBd)' }}>
                  <LogOut size={13} />
                  Quitter
                </button>
              </div>
            </div>
          ) : (
            /* Compact: stacked icon buttons */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <button onClick={openProfil}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--navH)'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                title={`${user?.prenom} ${user?.nom} — Modifier profil`}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {(user?.prenom?.[0] || '').toUpperCase()}{(user?.nom?.[0] || '').toUpperCase()}
                </div>
              </button>
              <button onClick={handleSignOut}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 7, borderRadius: 8, color: 'var(--navT)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--rdBg)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--rdTx)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navT)' }}
                title="Déconnexion">
                <LogOut size={15} />
              </button>
              <button onClick={toggleCompact}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 7, borderRadius: 8, color: 'var(--navSec)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--navH)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navTA)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navSec)' }}
                title="Élargir le menu">
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

      </aside>

      {/* MODAL PROFIL — hors de <aside> pour éviter que will-change:transform piège le position:fixed */}
      {profilModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: isMobile ? 'flex-end' : 'center',
            justifyContent: 'center',
          }}
          onClick={() => setProfilModal(false)}
        >
          <div
            className="card"
            style={{
              width: isMobile ? '100%' : 420,
              maxWidth: '100vw',
              padding: 0,
              borderRadius: isMobile ? '20px 20px 0 0' : 'var(--r3)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: isMobile
                ? 'calc(90dvh - env(safe-area-inset-bottom))'
                : 'calc(90dvh - 32px)',
              boxShadow: 'var(--sh3)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar mobile */}
            {isMobile && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b1)' }} />
              </div>
            )}

            {/* Onglets */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--b0)', flexShrink: 0 }}>
              {(['profil', 'appareils'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setProfilTab(t)}
                  style={{
                    flex: 1, padding: '13px 0', fontSize: 13,
                    fontWeight: profilTab === t ? 600 : 400,
                    background: 'none', border: 'none',
                    borderBottom: profilTab === t ? '2px solid var(--bl)' : '2px solid transparent',
                    color: profilTab === t ? 'var(--blTx)' : 'var(--t2)',
                    cursor: 'pointer', marginBottom: -1, fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {t === 'profil' ? <User size={14} /> : <Smartphone size={14} />}
                  {t === 'profil' ? 'Profil' : 'Appareils'}
                </button>
              ))}
            </div>

            {/* Contenu scrollable */}
            <div style={{
              overflowY: 'auto', flex: 1,
              padding: isMobile ? 16 : 24,
              paddingBottom: isMobile ? 'max(20px, env(safe-area-inset-bottom))' : 24,
            }}>
              {profilTab === 'profil' && (
                <form onSubmit={handleSaveProfil}>
                  <div className="form-group">
                    <label>Prénom</label>
                    <input value={profilForm.prenom} onChange={e => setProfilForm(f => ({ ...f, prenom: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Nom</label>
                    <input value={profilForm.nom} onChange={e => setProfilForm(f => ({ ...f, nom: e.target.value }))} required />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button type="button" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setProfilModal(false)}>Annuler</button>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={updProfile.isPending}>
                      {updProfile.isPending ? '…' : 'Enregistrer'}
                    </button>
                  </div>
                </form>
              )}

              {profilTab === 'appareils' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 14 }}>
                    Maximum 2 appareils actifs. Les appareils inactifs ne peuvent plus se connecter.
                  </p>
                  {devicesLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</div>
                  ) : devices.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Aucun appareil enregistré</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {devices.map(d => {
                        const isCurrent = isCurrentDevice(d.device_id)
                        return (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--b1)', background: isCurrent ? 'var(--blBg)' : 'transparent', minWidth: 0 }}>
                            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--s1)', color: 'var(--t2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {d.systeme_exploitation === 'iOS' || d.systeme_exploitation === 'Android' ? <Smartphone size={15} /> : <Monitor size={15} />}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {d.nom_appareil || 'Appareil inconnu'}
                                {isCurrent && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', background: 'var(--bl)', color: '#fff', borderRadius: 10 }}>Actuel</span>}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {new Date(d.date_derniere_connexion).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <span className={`pill ${d.actif ? 'pill-green' : 'pill-gray'}`} style={{ fontSize: 10 }}>
                                {d.actif ? 'Actif' : 'Inactif'}
                              </span>
                              {!isCurrent && d.actif && (
                                <button
                                  onClick={() => handleDisconnectDevice(d.id)}
                                  className="btn-icon sm"
                                  style={{ color: 'var(--rdTx)' }}
                                  title="Déconnecter"
                                ><X size={14} /></button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {devices.filter(d => d.actif && !isCurrentDevice(d.device_id)).length > 0 && (
                    <button
                      onClick={handleDisconnectAll}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'center', marginTop: 14, fontSize: 13 }}
                    >
                      Déconnecter tous les autres
                    </button>
                  )}
                  <button
                    onClick={() => setProfilModal(false)}
                    className="btn btn-secondary"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                  >Fermer</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg)', paddingTop: isMobile ? 'calc(56px + env(safe-area-inset-top))' : undefined }}>
        {/* Topbar */}
        <header className="app-topbar" style={{ height: 56, background: 'var(--s0)', borderBottom: '1px solid var(--b1)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0, overflow: 'hidden' }}>
          <button className="btn-icon" onClick={isMobile ? toggleSidebar : toggleCompact} aria-label="Menu" style={{ flexShrink: 0 }}><Menu size={18} strokeWidth={1.8} /></button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.02em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentPage}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => nav('/messagerie')} className="btn-icon" style={{ position: 'relative' }}>
              <MessageCircle size={18} strokeWidth={1.6} />
              {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: '#dc2626', borderRadius: '50%', border: '1.5px solid var(--s0)' }} />}
            </button>
            {/* Cloche notifications */}
            <div style={{ position: 'relative' }}>
              <button className="btn-icon" style={{ position: 'relative' }} onClick={() => setNotifOpen(o => !o)}>
                <Bell size={18} strokeWidth={1.6} />
                {unreadNotifs > 0 && (
                  <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, background: '#dc2626', color: '#fff', borderRadius: 8, border: '1.5px solid var(--s0)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                    {unreadNotifs > 9 ? '9+' : unreadNotifs}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div style={{ position: 'fixed', top: isMobile ? 'calc(56px + env(safe-area-inset-top))' : 56, right: isMobile ? 8 : 16, width: isMobile ? 'calc(100vw - 16px)' : 360, maxHeight: 500, background: 'var(--s0)', border: '1px solid var(--b1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.2)', zIndex: 500, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 10px', borderBottom: '1px solid var(--b0)', flexShrink: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bell size={14} strokeWidth={1.6} />
                      Notifications {unreadNotifs > 0 && <span style={{ fontSize: 11, background: '#2563eb', color: '#fff', padding: '1px 7px', borderRadius: 10 }}>{unreadNotifs}</span>}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {unreadNotifs > 0 && (
                        <button style={{ fontSize: 11, color: 'var(--blTx)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => {
                            console.log('[notif] MARK_ALL_READ CLICK — non-lues:', unreadNotifs)
                            markAllRead.mutate()
                          }}>
                          <CheckCheck size={13} /> Tout lu
                        </button>
                      )}
                      {readNotifs.length > 0 && (
                        <button style={{ fontSize: 11, color: 'var(--rdTx)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => {
                            console.log('[notif] DELETE_ALL_READ CLICK — lues:', readNotifs.length)
                            deleteAllRead.mutate()
                          }}>
                          <Trash2 size={13} /> Sup. lues
                        </button>
                      )}
                      <button className="btn-icon sm" onClick={() => setNotifOpen(false)}><X size={14} /></button>
                    </div>
                  </div>

                  {/* Corps */}
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {/* Non lues */}
                    {(notifications as any[]).filter((n: any) => !n.lue).length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 16px 8px', color: 'var(--t3)', fontSize: 13 }}>
                        Aucune notification non lue
                      </div>
                    )}
                    {(notifications as any[]).filter((n: any) => !n.lue).map((n: any) => (
                      <div key={n.id} style={{ display: 'flex', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--b0)', background: 'var(--blBg)', alignItems: 'flex-start' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0, cursor: n.lien ? 'pointer' : 'default' }}
                          onClick={() => {
                            markRead.mutate(n.id)
                            setNotifOpen(false)
                            if (n.lien) nav(n.lien)
                          }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)', marginBottom: 2 }}>{n.titre}</div>
                          {n.contenu && <div style={{ fontSize: 11, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.contenu}</div>}
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                            {new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {n.lien && <span style={{ marginLeft: 6, color: 'var(--blTx)', fontWeight: 600 }}>→ Ouvrir</span>}
                          </div>
                        </div>
                        <button onClick={() => {
                          console.log('[notif] DELETE_NOTIFICATION CLICK (non-lue) —', n.id)
                          deleteNotif.mutate(n.id)
                        }} className="btn-icon sm" style={{ color: 'var(--t3)', flexShrink: 0 }} title="Supprimer"><X size={14} /></button>
                      </div>
                    ))}

                    {/* Lues */}
                    {readNotifs.length > 0 && (
                      <>
                        <button style={{ width: '100%', padding: '8px 14px', fontSize: 11, color: 'var(--t3)', background: 'none', border: 'none', borderBottom: '1px solid var(--b0)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 5 }}
                          onClick={() => setShowReadNotifs(v => !v)}>
                          {showReadNotifs ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Lues ({readNotifs.length})
                        </button>
                        {showReadNotifs && readNotifs.map((n: any) => (
                          <div key={n.id} style={{ display: 'flex', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--b0)', opacity: 0.55, alignItems: 'flex-start' }}>
                            <div style={{ width: 8, height: 8, flexShrink: 0, marginTop: 5 }} />
                            <div style={{ flex: 1, minWidth: 0, cursor: n.lien ? 'pointer' : 'default' }}
                              onClick={() => { setNotifOpen(false); if (n.lien) nav(n.lien) }}>
                              <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 1 }}>{n.titre}</div>
                              <div style={{ fontSize: 10, color: 'var(--t3)' }}>
                                {new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <button onClick={() => {
                              console.log('[notif] DELETE_NOTIFICATION CLICK (lue) —', n.id)
                              deleteNotif.mutate(n.id)
                            }} className="btn-icon sm" style={{ color: 'var(--t3)', flexShrink: 0 }}><X size={14} /></button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            {(isAdmin || user?.can_create_documents) && <button className="btn btn-primary btn-sm hide-mobile" onClick={() => setNewMenuOpen(true)} style={{ gap: 4 }}>+ Nouveau</button>}
            <button onClick={toggleTheme} className="btn-icon">{theme === 'dark' ? <Sun size={17} strokeWidth={1.6} /> : <Moon size={17} strokeWidth={1.6} />}</button>
          </div>
        </header>
        {/* Bannière hors ligne / sync en attente */}
        <OfflineBanner />
        {/* Bannière paramètres incomplets — admin seulement */}
        {isAdmin && paramsLoaded && !paramsComplete && (
          <div style={{ background: 'var(--amBg)', borderBottom: '1px solid var(--amBd)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <AlertTriangle size={16} color="var(--amTx)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--amTx)', flex: 1, minWidth: 200 }}>
              <strong>Paramètres entreprise incomplets</strong>
              {paramsMissing.length > 0 && <> — manquants : {paramsMissing.map(f => f.label).join(', ')}</>}
              . Complétez-les pour envoyer des devis et factures.
            </span>
            <button
              onClick={() => nav('/parametres')}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--amTx)', background: 'rgba(0,0,0,0.08)', border: '1px solid var(--amBd)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
            >
              Ouvrir les Paramètres →
            </button>
          </div>
        )}
        {/* Content */}
        <main ref={mainRef} className="main-content" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 18, scrollbarWidth: 'thin', scrollbarColor: 'var(--s3) transparent' }}>
          <Outlet />
        </main>
      </div>

      {/* BOTTOM NAV — minimal mobile */}
      <nav className="bottom-nav-minimal">
        {(isAdmin || user?.can_create_documents) && (
          <button
            className="bnm-btn bnm-new"
            onClick={() => setNewMenuOpen(true)}
          >
            + Nouveau
          </button>
        )}
        <button className="bnm-btn bnm-menu" onClick={toggleSidebar}>
          <Menu size={15} strokeWidth={1.8} /> Menu
        </button>
      </nav>

      {/* MENU RAPIDE "+ Nouveau" */}
      {newMenuOpen && (
        <DocSheet title="Créer" subtitle="Choisissez le type de document" onClose={() => setNewMenuOpen(false)}>
          {isAdmin && (
            <SheetRow icon={<Wrench size={16} />} label="Nouvelle intervention" sublabel="Créer un nouveau chantier"
              onClick={() => { setNewMenuOpen(false); nav('/interventions', { state: { openCreate: true } }) }} />
          )}
          {isAdmin && (
            <SheetRow icon={<Users size={16} />} label="Nouveau client" sublabel="Ajouter un client"
              onClick={() => { setNewMenuOpen(false); nav('/clients', { state: { openCreate: true } }) }} />
          )}
          <SheetSection label="Documents" />
          {(isAdmin || user?.can_create_documents) && (
            <SheetRow icon={<FileText size={16} />} label="Nouveau devis" sublabel="Rédiger un devis client"
              onClick={() => { setNewMenuOpen(false); nav('/devis/nouveau') }} />
          )}
          {(isAdmin || user?.can_create_documents) && (
            <SheetRow icon={<Receipt size={16} />} label="Nouvelle facture" sublabel="Créer une facture"
              onClick={() => { setNewMenuOpen(false); add('Une facture se crée depuis un devis accepté.', 'info', { label: 'Voir les devis', fn: () => nav('/devis') }) }} />
          )}
        </DocSheet>
      )}

      {/* Modale de bienvenue */}
      {showWelcome && <WelcomeModal onClose={handleCloseWelcome} />}

      {/* TOASTS — max 2 mobile / 3 desktop, dédupliqués */}
      <div className="toast-container">
        {toasts.slice(isMobile ? -2 : -3).map(t => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}
            style={t.actionLabel ? { display: 'flex', alignItems: 'center', gap: 6 } : undefined}>
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              {t.type === 'success' ? <CheckCircle2 size={16} /> : t.type === 'error' ? <XCircle size={16} /> : t.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
            </span>
            {t.actionLabel
              ? <span style={{ flex: 1 }}>{t.message}{t.count > 1 ? ` ×${t.count}` : ''}</span>
              : <>{t.message}{t.count > 1 ? ` ×${t.count}` : ''}</>
            }
            {t.actionLabel && t.onAction && (
              <button
                onClick={e => { e.stopPropagation(); t.onAction!(); remove(t.id) }}
                style={{ background: 'rgba(255,255,255,0.22)', border: 'none', color: 'inherit', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: 'inherit' }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
