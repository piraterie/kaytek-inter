// src/components/layout/AppLayout.tsx
import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore, useToastStore } from '@/lib/store'
import { signOut } from '@/lib/supabase/auth'
import { useUnreadCount, useUpdateProfile } from '@/lib/hooks'

const NAV = [
  { path: '/dashboard',    label: 'Dashboard',     icon: '◉', section: 'Accueil' },
  { path: '/messagerie',   label: 'Messagerie',    icon: '✉', section: 'Accueil', badge: true },
  { path: '/interventions',label: 'Interventions', icon: '🔧', section: 'Terrain' },
  { path: '/devis',        label: 'Devis',         icon: '📄', section: 'Terrain' },
  { path: '/factures',     label: 'Factures',      icon: '🧾', section: 'Terrain' },
  { path: '/clients',      label: 'Clients',       icon: '👥', section: 'Terrain' },
  { path: '/commissions',  label: 'Commissions',   icon: '💰', section: 'Gestion' },
  { path: '/utilisateurs', label: 'Utilisateurs',  icon: '🛡', section: 'Gestion', adminOnly: true },
  { path: '/parametres',   label: 'Paramètres',    icon: '⚙', section: 'Gestion', adminOnly: true },
  { path: '/journal',      label: 'Journal',       icon: '📋', section: 'Gestion', adminOnly: true },
]
const SECTIONS = ['Accueil', 'Terrain', 'Gestion']

const NI_STYLE: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 7, cursor: 'pointer', border: 'none', background: 'transparent', color: 'rgba(255,255,255,.52)', marginBottom: 1, transition: 'all .12s', whiteSpace: 'nowrap', overflow: 'hidden', fontFamily: 'inherit' }

export default function AppLayout() {
  const { user, setUser } = useAuthStore()
  const { theme, sidebarOpen, toggleTheme, toggleSidebar } = useUIStore()
  const { toasts, remove, add } = useToastStore()
  const { data: unread = 0 } = useUnreadCount()
  const updProfile = useUpdateProfile()
  const nav = useNavigate()
  const loc = useLocation()
  const isAdmin = user?.role === 'admin'
  const items = NAV.filter(i => !i.adminOnly || isAdmin)

  const [profilModal, setProfilModal] = useState(false)
  const [profilForm, setProfilForm] = useState({ prenom: '', nom: '' })

  async function handleSignOut() { await signOut(); nav('/login') }

  function openProfil() {
    setProfilForm({ prenom: user?.prenom || '', nom: user?.nom || '' })
    setProfilModal(true)
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

  const currentPage = items.find(i => loc.pathname.startsWith(i.path))?.label || 'Kaytek'

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      {/* SIDEBAR */}
      <aside style={{ width: sidebarOpen ? 218 : 50, minWidth: sidebarOpen ? 218 : 50, background: 'var(--nav)', display: 'flex', flexDirection: 'column', transition: 'width .22s ease', overflow: 'hidden' }}>
        {/* Logo */}
        <div style={{ padding: '16px 13px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
          <div style={{ width: 26, height: 26, background: '#2563eb', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>🔐</div>
          {sidebarOpen && <div style={{ overflow: 'hidden' }}>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Kaytek Inter</div>
            <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 10 }}>Serrurerie · Vitrerie</div>
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
                    <button key={item.path} onClick={() => nav(item.path)}
                      style={{ ...NI_STYLE, background: active ? 'rgba(255,255,255,.13)' : 'transparent', color: active ? '#fff' : 'rgba(255,255,255,.52)' }}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,.52)' }}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                      {sidebarOpen && <>
                        <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                        {badgeCount > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: '#2563eb', color: '#fff', padding: '1px 5px', borderRadius: 20, flexShrink: 0 }}>{badgeCount}</span>}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, overflow: 'hidden' }}>
            <button onClick={openProfil} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }} title="Modifier mon profil">
              <div className="avatar" style={{ width: 24, height: 24, fontSize: 8 }}>
                {(user?.prenom?.[0] || '') + (user?.nom?.[0] || '')}
              </div>
            </button>
            {sidebarOpen && <>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#fff', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.prenom} {user?.nom}</div>
                <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 10 }}>{user?.role}</div>
              </div>
              <button onClick={openProfil} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 12, flexShrink: 0, padding: 3 }} title="Modifier mon profil">✏</button>
              <button onClick={handleSignOut} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 15, flexShrink: 0, padding: 3 }} title="Déconnexion">⏻</button>
            </>}
          </div>
        </div>

        {/* MODAL PROFIL */}
        {profilModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ width: 380, padding: 28 }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 18px', fontSize: 15 }}>Mon profil</h3>
              <form onSubmit={handleSaveProfil}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Prénom</label>
                    <input value={profilForm.prenom} onChange={e => setProfilForm(f => ({ ...f, prenom: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Nom</label>
                    <input value={profilForm.nom} onChange={e => setProfilForm(f => ({ ...f, nom: e.target.value }))} required />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setProfilModal(false)}>Annuler</button>
                  <button type="submit" className="btn btn-primary" disabled={updProfile.isPending}>Enregistrer</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Topbar */}
        <header style={{ height: 50, background: 'var(--s0)', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
          <button className="btn-icon sm" onClick={toggleSidebar} aria-label="Menu" style={{ fontSize: 16 }}>☰</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{currentPage}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => nav('/messagerie')} className="btn-icon sm" style={{ position: 'relative', fontSize: 15 }}>
              ✉
              {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7, background: '#dc2626', borderRadius: '50%', border: '1.5px solid var(--s0)' }} />}
            </button>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => nav('/interventions')} style={{ gap: 4 }}>+ Nouveau</button>}
            <button onClick={toggleTheme} className="btn-icon" style={{ fontSize: 15 }}>{theme === 'dark' ? '☀' : '🌙'}</button>
          </div>
        </header>
        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 18, scrollbarWidth: 'thin', scrollbarColor: 'var(--s3) transparent' }}>
          <Outlet />
        </main>
      </div>

      {/* TOASTS */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warning' ? '⚠' : 'ℹ'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
