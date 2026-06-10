// src/components/layout/AppLayout.tsx
import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore, useToastStore } from '@/lib/store'
import { signOut } from '@/lib/supabase/auth'
import { useUnreadCount, useUpdateProfile, useIsMobile, useRequestNotificationPermission, usePushSubscription, useMyNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useDeleteNotification, useDeleteAllReadNotifications, useParamsCompletion } from '@/lib/hooks'
import { getMyDevices, disconnectDevice, disconnectAllOtherDevices, isCurrentDevice, type DeviceRecord } from '@/lib/devices'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'

const NAV = [
  { path: '/dashboard',    label: 'Dashboard',     icon: '🏠', section: 'Accueil' },
  { path: '/messagerie',   label: 'Messagerie',    icon: '💬', section: 'Accueil', badge: true },
  { path: '/interventions',label: 'Interventions', icon: '🔧', section: 'Terrain' },
  { path: '/devis',        label: 'Devis',         icon: '📄', section: 'Terrain' },
  { path: '/factures',     label: 'Factures',      icon: '🧾', section: 'Terrain' },
  { path: '/clients',      label: 'Clients',       icon: '👥', section: 'Terrain', adminOnly: true },
  { path: '/catalogue',    label: 'Catalogue',     icon: '📋', section: 'Terrain', adminOnly: true },
  { path: '/commissions',  label: 'Commissions',   icon: '💰', section: 'Gestion' },
  { path: '/utilisateurs', label: 'Utilisateurs',  icon: '🛡', section: 'Gestion', adminOnly: true },
  { path: '/parametres',   label: 'Paramètres',    icon: '⚙', section: 'Gestion', adminOnly: true },
  { path: '/journal',      label: 'Journal',       icon: '📋', section: 'Gestion', adminOnly: true },
]
const SECTIONS = ['Accueil', 'Terrain', 'Gestion']

const NI_STYLE: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 10px', borderRadius: 10, cursor: 'pointer', border: 'none', background: 'transparent', color: 'rgba(255,255,255,.52)', marginBottom: 2, transition: 'all .15s', whiteSpace: 'nowrap', overflow: 'hidden', fontFamily: 'inherit', minHeight: 44 }

export default function AppLayout() {
  const { user, setUser } = useAuthStore()
  const { theme, sidebarOpen, toggleTheme, toggleSidebar } = useUIStore()
  const { toasts, remove, add } = useToastStore()
  const { data: unread = 0 } = useUnreadCount()
  const updProfile = useUpdateProfile()
  const { isComplete: paramsComplete, missingFields: paramsMissing, isLoaded: paramsLoaded } = useParamsCompletion()
  useRequestNotificationPermission()
  usePushSubscription()
  const nav = useNavigate()
  const loc = useLocation()
  const isAdmin = user?.role === 'admin'
  const items = NAV.filter(i => !i.adminOnly || isAdmin)
  const isMobile = useIsMobile()

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

  const currentPage = items.find(i => loc.pathname.startsWith(i.path))?.label || 'Kaytek'

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      {/* OVERLAY MOBILE */}
      {isMobile && sidebarOpen && (
        <div onClick={toggleSidebar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99 }} />
      )}
      {/* SIDEBAR */}
      <aside style={{
        width: sidebarOpen ? 218 : (isMobile ? 0 : 50),
        minWidth: sidebarOpen ? 218 : (isMobile ? 0 : 50),
        background: 'var(--nav)', display: 'flex', flexDirection: 'column',
        transition: 'width .22s ease', overflow: 'hidden',
        ...(isMobile && sidebarOpen ? { position: 'fixed', top: 0, left: 0, height: '100dvh', zIndex: 100 } : {})
      }}>
        {/* Logo */}
        <div style={{ padding: '18px 14px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, boxShadow: '0 2px 8px rgba(37,99,235,.4)' }}>🔐</div>
          {sidebarOpen && <div style={{ overflow: 'hidden' }}>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '-.02em' }}>Kaytek Inter</div>
            <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 10, marginTop: 1, letterSpacing: '.02em' }}>Serrurerie · Plomberie · Vitrerie</div>
          </div>}
        </div>
        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 5px', scrollbarWidth: 'none' }}>
          {SECTIONS.map(section => {
            const sItems = items.filter(i => i.section === section)
            if (!sItems.length) return null
            return (
              <div key={section}>
                {sidebarOpen && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', padding: '10px 8px 3px' }}>{section}</div>}
                {sItems.map(item => {
                  const active = loc.pathname.startsWith(item.path)
                  const badgeCount = item.badge ? unread : 0
                  return (
                    <button key={item.path} onClick={() => navTo(item.path)}
                      style={{ ...NI_STYLE, background: active ? 'rgba(255,255,255,.13)' : 'transparent', color: active ? '#fff' : 'rgba(255,255,255,.52)' }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,.52)' }}>
                      <span style={{ fontSize: 17, width: 20, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                      {sidebarOpen && <>
                        <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                        {badgeCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#2563eb', color: '#fff', padding: '1px 6px', borderRadius: 20, flexShrink: 0 }}>{badgeCount}</span>}
                      </>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        {/* User */}
        <div style={{ padding: '10px 5px', borderTop: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderRadius: 7, overflow: 'hidden' }}>
            <button onClick={openProfil} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }} title="Modifier mon profil">
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 9 }}>
                {(user?.prenom?.[0] || '') + (user?.nom?.[0] || '')}
              </div>
            </button>
            {sidebarOpen && <>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#fff', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.prenom} {user?.nom}</div>
                <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 11 }}>{user?.role}</div>
              </div>
              <button onClick={openProfil} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: 4 }} title="Modifier mon profil">✏</button>
              <button onClick={handleSignOut} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 17, flexShrink: 0, padding: 4 }} title="Déconnexion">⏻</button>
            </>}
          </div>
        </div>

        {/* MODAL PROFIL */}
        {profilModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }} onClick={() => setProfilModal(false)}>
            <div className="card" style={{ width: isMobile ? '100%' : 420, padding: 0, borderRadius: isMobile ? '12px 12px 0 0' : undefined, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--b0)' }}>
                {(['profil', 'appareils'] as const).map(t => (
                  <button key={t} onClick={() => setProfilTab(t)} style={{ flex: 1, padding: '14px 0', fontSize: 13, fontWeight: profilTab === t ? 600 : 400, background: 'none', border: 'none', borderBottom: profilTab === t ? '2px solid var(--bl)' : '2px solid transparent', color: profilTab === t ? 'var(--blTx)' : 'var(--t2)', cursor: 'pointer', marginBottom: -1 }}>
                    {t === 'profil' ? '👤 Profil' : '📱 Appareils'}
                  </button>
                ))}
              </div>
              <div style={{ padding: 24 }}>
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
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                      <button type="button" className="btn btn-secondary" onClick={() => setProfilModal(false)}>Annuler</button>
                      <button type="submit" className="btn btn-primary" disabled={updProfile.isPending}>Enregistrer</button>
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
                            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--b1)', background: isCurrent ? 'var(--blBg)' : 'transparent' }}>
                              <span style={{ fontSize: 22, flexShrink: 0 }}>{d.systeme_exploitation === 'iOS' || d.systeme_exploitation === 'Android' ? '📱' : '💻'}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d.nom_appareil || 'Appareil inconnu'}
                                  {isCurrent && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', background: 'var(--bl)', color: '#fff', borderRadius: 10 }}>Actuel</span>}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>
                                  Dernière activité : {new Date(d.date_derniere_connexion).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                              <span className={`pill ${d.actif ? 'pill-green' : 'pill-gray'}`} style={{ fontSize: 10 }}>{d.actif ? 'Actif' : 'Inactif'}</span>
                              {!isCurrent && d.actif && (
                                <button onClick={() => handleDisconnectDevice(d.id)} className="btn-icon sm" style={{ color: 'var(--rdTx)', flexShrink: 0 }} title="Déconnecter">✕</button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {devices.filter(d => d.actif && !isCurrentDevice(d.device_id)).length > 0 && (
                      <button onClick={handleDisconnectAll} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>
                        Déconnecter tous les autres appareils
                      </button>
                    )}
                    <button onClick={() => setProfilModal(false)} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>Fermer</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Topbar */}
        <header className="app-topbar" style={{ height: 56, background: 'var(--s0)', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0, overflow: 'hidden' }}>
          <button className="btn-icon" onClick={toggleSidebar} aria-label="Menu" style={{ fontSize: 18, flexShrink: 0 }}>☰</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.02em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentPage}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => nav('/messagerie')} className="btn-icon" style={{ position: 'relative', fontSize: 17 }}>
              💬
              {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: '#dc2626', borderRadius: '50%', border: '1.5px solid var(--s0)' }} />}
            </button>
            {/* Cloche notifications */}
            <div style={{ position: 'relative' }}>
              <button className="btn-icon" style={{ position: 'relative', fontSize: 17 }} onClick={() => setNotifOpen(o => !o)}>
                🔔
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
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t0)' }}>
                      🔔 Notifications {unreadNotifs > 0 && <span style={{ marginLeft: 6, fontSize: 11, background: '#2563eb', color: '#fff', padding: '1px 7px', borderRadius: 10 }}>{unreadNotifs}</span>}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {unreadNotifs > 0 && (
                        <button style={{ fontSize: 11, color: 'var(--blTx)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}
                          onClick={() => {
                            console.log('[notif] MARK_ALL_READ CLICK — non-lues:', unreadNotifs)
                            markAllRead.mutate()
                          }}>
                          ✓ Tout lu
                        </button>
                      )}
                      {readNotifs.length > 0 && (
                        <button style={{ fontSize: 11, color: 'var(--rdTx)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}
                          onClick={() => {
                            console.log('[notif] DELETE_ALL_READ CLICK — lues:', readNotifs.length)
                            deleteAllRead.mutate()
                          }}>
                          🗑 Sup. lues
                        </button>
                      )}
                      <button className="btn-icon sm" onClick={() => setNotifOpen(false)} style={{ fontSize: 13 }}>✕</button>
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
                        }} className="btn-icon sm" style={{ color: 'var(--t3)', flexShrink: 0, fontSize: 12 }} title="Supprimer">✕</button>
                      </div>
                    ))}

                    {/* Lues */}
                    {readNotifs.length > 0 && (
                      <>
                        <button style={{ width: '100%', padding: '8px 14px', fontSize: 11, color: 'var(--t3)', background: 'none', border: 'none', borderBottom: '1px solid var(--b0)', cursor: 'pointer', textAlign: 'left' }}
                          onClick={() => setShowReadNotifs(v => !v)}>
                          {showReadNotifs ? '▲' : '▼'} Lues ({readNotifs.length})
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
                            }} className="btn-icon sm" style={{ color: 'var(--t3)', flexShrink: 0, fontSize: 12 }}>✕</button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            {(isAdmin || user?.can_create_documents) && <button className="btn btn-primary btn-sm hide-mobile" onClick={() => setNewMenuOpen(true)} style={{ gap: 4 }}>+ Nouveau</button>}
            <button onClick={toggleTheme} className="btn-icon" style={{ fontSize: 17 }}>{theme === 'dark' ? '☀' : '🌙'}</button>
          </div>
        </header>
        {/* Bannière paramètres incomplets — admin seulement */}
        {isAdmin && paramsLoaded && !paramsComplete && (
          <div style={{ background: 'var(--amBg)', borderBottom: '1px solid var(--amBd)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}>⚠</span>
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
        <main className="main-content" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : 18, scrollbarWidth: 'thin', scrollbarColor: 'var(--s3) transparent' }}>
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
          ☰ Menu
        </button>
      </nav>

      {/* MENU RAPIDE "+ Nouveau" */}
      {newMenuOpen && (
        <DocSheet title="Créer" subtitle="Choisissez le type de document" onClose={() => setNewMenuOpen(false)}>
          {isAdmin && (
            <SheetRow icon="🔧" label="Nouvelle intervention" sublabel="Créer un nouveau chantier"
              onClick={() => { setNewMenuOpen(false); nav('/interventions') }} />
          )}
          {isAdmin && (
            <SheetRow icon="👥" label="Nouveau client" sublabel="Ajouter un client"
              onClick={() => { setNewMenuOpen(false); nav('/clients') }} />
          )}
          <SheetSection label="Documents" />
          {(isAdmin || user?.can_create_documents) && (
            <SheetRow icon="📄" label="Nouveau devis" sublabel="Rédiger un devis client"
              onClick={() => { setNewMenuOpen(false); nav('/devis/nouveau') }} />
          )}
          {(isAdmin || user?.can_create_documents) && (
            <SheetRow icon="🧾" label="Nouvelle facture" sublabel="Créer une facture"
              onClick={() => { setNewMenuOpen(false); nav('/factures') }} />
          )}
        </DocSheet>
      )}

      {/* TOASTS */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}
            style={t.actionLabel ? { display: 'flex', alignItems: 'center', gap: 6 } : undefined}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warning' ? '⚠' : 'ℹ'}</span>
            {t.actionLabel ? <span style={{ flex: 1 }}>{t.message}</span> : t.message}
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
