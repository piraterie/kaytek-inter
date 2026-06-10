// src/components/layout/AppLayout.tsx
// Layout adaptatif : sidebar desktop + bottom nav mobile
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore, useToastStore } from '@/lib/store'
import { signOut } from '@/lib/supabase/auth'
import { useUnreadCount } from '@/lib/hooks'

const NAV = [
  { path:'/dashboard',     label:'Dashboard',    icon:'◉', section:'Accueil' },
  { path:'/messagerie',    label:'Messagerie',   icon:'✉', section:'Accueil', badge:true },
  { path:'/interventions', label:'Interventions',icon:'🔧', section:'Terrain' },
  { path:'/devis',         label:'Devis',        icon:'📄', section:'Terrain' },
  { path:'/factures',      label:'Factures',     icon:'🧾', section:'Terrain' },
  { path:'/clients',       label:'Clients',      icon:'👥', section:'Terrain' },
  { path:'/commissions',   label:'Commissions',  icon:'💰', section:'Gestion' },
  { path:'/utilisateurs',  label:'Utilisateurs', icon:'🛡', section:'Gestion', adminOnly:true },
  { path:'/parametres',    label:'Parametres',   icon:'⚙', section:'Gestion', adminOnly:true },
  { path:'/journal',       label:'Journal',      icon:'📋', section:'Gestion', adminOnly:true },
]

// Bottom nav mobile — 5 items principaux
const BOTTOM_NAV = [
  { path:'/dashboard',     label:'Accueil', icon:'◉' },
  { path:'/interventions', label:'Terrain', icon:'🔧' },
  { path:'/devis',         label:'Devis',   icon:'📄' },
  { path:'/messagerie',    label:'Chat',    icon:'✉', badge:true },
  { path:'/clients',       label:'Clients', icon:'👥' },
]

export default function AppLayout() {
  const { user } = useAuthStore()
  const { theme, sidebarOpen, toggleTheme, toggleSidebar } = useUIStore()
  const { toasts, remove } = useToastStore()
  const { data: unread = 0 } = useUnreadCount()
  const nav = useNavigate()
  const loc = useLocation()
  const isAdmin = user?.role === 'admin'
  const items = NAV.filter(i => !i.adminOnly || isAdmin)
  const currentLabel = items.find(i => loc.pathname === i.path || loc.pathname.startsWith(i.path + '/'))?.label || 'Kaytek'

  async function handleSignOut() { await signOut(); nav('/login') }

  return (
    <div style={{ display:'flex', height:'100dvh', overflow:'hidden' }}>

      {/* ── SIDEBAR DESKTOP uniquement ── */}
      <aside className="sidebar-desktop" style={{
        width:sidebarOpen?220:54, minWidth:sidebarOpen?220:54,
        background:'#1a1a1e', display:'flex', flexDirection:'column',
        transition:'width .2s ease', overflow:'hidden', flexShrink:0
      }}>
        {/* Logo */}
        <div style={{ padding:'14px 12px', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid rgba(255,255,255,.08)', flexShrink:0 }}>
          <div style={{ width:30, height:30, background:'#2563eb', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, flexShrink:0 }}>🔐</div>
          {sidebarOpen && <div>
            <div style={{ color:'#fff', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>Kaytek Inter</div>
            <div style={{ color:'rgba(255,255,255,.38)', fontSize:10 }}>Serrurerie · Vitrerie</div>
          </div>}
        </div>
        {/* Nav */}
        <nav style={{ flex:1, overflowY:'auto', padding:'6px 5px', scrollbarWidth:'none' }}>
          {['Accueil','Terrain','Gestion'].map(section => {
            const si = items.filter(i => i.section === section)
            if (!si.length) return null
            return (
              <div key={section}>
                {sidebarOpen && <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'rgba(255,255,255,.22)', padding:'10px 8px 3px' }}>{section}</div>}
                {si.map(item => {
                  const active = loc.pathname === item.path || loc.pathname.startsWith(item.path + '/')
                  return (
                    <button key={item.path} onClick={() => nav(item.path)} style={{
                      width:'100%', display:'flex', alignItems:'center', gap:9, padding:'9px 8px',
                      borderRadius:8, border:'none', background:active?'rgba(37,99,235,.25)':'transparent',
                      color:active?'#fff':'rgba(255,255,255,.48)', marginBottom:2,
                      transition:'all .12s', whiteSpace:'nowrap', overflow:'hidden',
                      fontFamily:'inherit', fontSize:12.5, cursor:'pointer',
                      borderLeft:active?'2px solid #2563eb':'2px solid transparent'
                    }}>
                      <span style={{ fontSize:17, width:22, textAlign:'center', flexShrink:0 }}>{item.icon}</span>
                      {sidebarOpen && <>
                        <span style={{ flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</span>
                        {item.badge && unread > 0 && <span style={{ fontSize:9, fontWeight:700, background:'#2563eb', color:'#fff', padding:'2px 6px', borderRadius:20 }}>{unread}</span>}
                      </>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        {/* User */}
        <div style={{ padding:'8px 5px', borderTop:'1px solid rgba(255,255,255,.08)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 8px', borderRadius:8 }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background:'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:700, flexShrink:0, textTransform:'uppercase' }}>
              {(user?.prenom?.[0]||'')+(user?.nom?.[0]||'')}
            </div>
            {sidebarOpen && <>
              <div style={{ flex:1, overflow:'hidden' }}>
                <div style={{ color:'#fff', fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user?.prenom} {user?.nom}</div>
                <div style={{ color:'rgba(255,255,255,.38)', fontSize:10 }}>{user?.role}</div>
              </div>
              <button onClick={handleSignOut} style={{ background:'none', border:'none', color:'rgba(255,255,255,.38)', cursor:'pointer', fontSize:20, padding:2, flexShrink:0, lineHeight:1 }} title="Deconnexion">⏻</button>
            </>}
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
        {/* Topbar */}
        <header style={{ height:52, background:'var(--s0)', borderBottom:'1px solid var(--b0)', display:'flex', alignItems:'center', padding:'0 16px', gap:10, flexShrink:0, zIndex:10 }}>
          <button className="btn-icon sm sidebar-toggle-btn" onClick={toggleSidebar} style={{ fontSize:18 }}>☰</button>
          <span style={{ fontSize:14, fontWeight:600, letterSpacing:'-.02em' }}>{currentLabel}</span>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={()=>nav('/messagerie')} className="btn-icon sm" style={{ position:'relative', fontSize:17 }}>
              ✉
              {unread > 0 && <span style={{ position:'absolute', top:-1, right:-1, width:9, height:9, background:'#dc2626', borderRadius:'50%', border:'2px solid var(--s0)' }} />}
            </button>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={()=>nav('/interventions')}>+ Nouveau</button>}
            <button onClick={toggleTheme} className="btn-icon" style={{ fontSize:17 }}>{theme==='dark'?'☀':'🌙'}</button>
          </div>
        </header>

        {/* Content — padding-bottom sur mobile pour la bottom nav */}
        <main style={{ flex:1, overflowY:'auto', padding:'16px 16px', paddingBottom:'calc(16px + var(--bottom-nav-h, 0px))', WebkitOverflowScrolling:'touch' }}>
          <Outlet />
        </main>
      </div>

      {/* ── BOTTOM NAV MOBILE ── */}
      <nav className="bottom-nav-mobile" style={{
        position:'fixed', bottom:0, left:0, right:0, height:60,
        background:'var(--s0)', borderTop:'1px solid var(--b0)',
        display:'none', alignItems:'center', justifyContent:'space-around',
        zIndex:100, paddingBottom:'env(safe-area-inset-bottom)'
      }}>
        {BOTTOM_NAV.map(item => {
          const active = loc.pathname === item.path || loc.pathname.startsWith(item.path + '/')
          return (
            <button key={item.path} onClick={()=>nav(item.path)} style={{
              display:'flex', flexDirection:'column', alignItems:'center', gap:2,
              background:'none', border:'none', cursor:'pointer', padding:'6px 12px',
              color:active?'var(--bl)':'var(--t3)', flex:1, transition:'color .12s'
            }}>
              <span style={{ fontSize:22, lineHeight:1, position:'relative' }}>
                {item.icon}
                {item.badge && unread > 0 && <span style={{ position:'absolute', top:-2, right:-4, width:8, height:8, background:'#dc2626', borderRadius:'50%' }} />}
              </span>
              <span style={{ fontSize:10, fontWeight:active?600:400 }}>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* ── TOASTS ── */}
      <div style={{ position:'fixed', bottom:'calc(20px + var(--bottom-nav-h, 0px))', right:16, display:'flex', flexDirection:'column', gap:8, zIndex:1000, maxWidth:'calc(100vw - 32px)' }}>
        {toasts.map(t => (
          <div key={t.id} onClick={()=>remove(t.id)} style={{
            background:'#1a1a1e', color:'#f2f2f4', padding:'10px 14px', borderRadius:10,
            fontSize:13, fontWeight:500, display:'flex', alignItems:'center', gap:8,
            cursor:'pointer', border:'1px solid rgba(255,255,255,.1)',
            borderLeft:`3px solid ${t.type==='success'?'#4ade80':t.type==='error'?'#f87171':t.type==='warning'?'#fbbf24':'#93c5fd'}`,
            boxShadow:'0 4px 20px rgba(0,0,0,.3)'
          }}>
            <span style={{ flexShrink:0 }}>{t.type==='success'?'✓':t.type==='error'?'✗':t.type==='warning'?'⚠':'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
