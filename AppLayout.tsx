 // src/components/layout/AppLayout.tsx
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

export default function AppLayout() {
  const { user } = useAuthStore()
  const { theme, sidebarOpen, toggleTheme, toggleSidebar } = useUIStore()
  const { toasts, remove } = useToastStore()
  const { data: unread = 0 } = useUnreadCount()
  const nav = useNavigate()
  const loc = useLocation()
  const isAdmin = user?.role === 'admin'
  const items = NAV.filter(i => !i.adminOnly || isAdmin)
  const currentLabel = items.find(i => loc.pathname.startsWith(i.path))?.label || 'Kaytek'

  async function handleSignOut() {
    await signOut()
    nav('/login')
  }

  return (
    <div style={{ display:'flex', height:'100dvh', overflow:'hidden' }}>
      {/* SIDEBAR */}
      <aside style={{ width:sidebarOpen?218:52, minWidth:sidebarOpen?218:52, background:'#1a1a1e', display:'flex', flexDirection:'column', transition:'width .2s', overflow:'hidden', flexShrink:0 }}>
        <div style={{ padding:'14px 12px', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
          <div style={{ width:28, height:28, background:'#2563eb', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🔐</div>
          {sidebarOpen && <div><div style={{ color:'#fff', fontSize:13, fontWeight:600, whiteSpace:'nowrap' }}>Kaytek Inter</div><div style={{ color:'rgba(255,255,255,.4)', fontSize:10 }}>Serrurerie · Vitrerie</div></div>}
        </div>
        <nav style={{ flex:1, overflowY:'auto', padding:'6px 4px', scrollbarWidth:'none' }}>
          {['Accueil','Terrain','Gestion'].map(section => {
            const si = items.filter(i => i.section === section)
            if (!si.length) return null
            return (
              <div key={section}>
                {sidebarOpen && <div style={{ fontSize:9, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'rgba(255,255,255,.25)', padding:'10px 8px 3px' }}>{section}</div>}
                {si.map(item => {
                  const active = loc.pathname === item.path || loc.pathname.startsWith(item.path + '/')
                  return (
                    <button key={item.path} onClick={() => nav(item.path)} style={{
                      width:'100%', display:'flex', alignItems:'center', gap:8, padding:'8px 8px', borderRadius:7,
                      border:'none', background:active?'rgba(255,255,255,.12)':'transparent',
                      color:active?'#fff':'rgba(255,255,255,.5)', marginBottom:2,
                      transition:'all .12s', whiteSpace:'nowrap', overflow:'hidden',
                      fontFamily:'inherit', fontSize:12, cursor:'pointer'
                    }}>
                      <span style={{ fontSize:16, width:20, textAlign:'center', flexShrink:0 }}>{item.icon}</span>
                      {sidebarOpen && <>
                        <span style={{ flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</span>
                        {item.badge && unread > 0 && <span style={{ fontSize:9, fontWeight:700, background:'#2563eb', color:'#fff', padding:'1px 5px', borderRadius:20 }}>{unread}</span>}
                      </>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div style={{ padding:'8px 4px', borderTop:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px', borderRadius:7 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9, fontWeight:700, flexShrink:0, textTransform:'uppercase' }}>
              {(user?.prenom?.[0]||'')+(user?.nom?.[0]||'')}
            </div>
            {sidebarOpen && <>
              <div style={{ flex:1, overflow:'hidden' }}>
                <div style={{ color:'#fff', fontSize:11, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user?.prenom} {user?.nom}</div>
                <div style={{ color:'rgba(255,255,255,.4)', fontSize:10 }}>{user?.role}</div>
              </div>
              <button onClick={handleSignOut} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', cursor:'pointer', fontSize:18, padding:2, flexShrink:0 }} title="Deconnexion">⏻</button>
            </>}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
        <header style={{ height:50, background:'var(--s0)', borderBottom:'1px solid var(--b0)', display:'flex', alignItems:'center', padding:'0 16px', gap:10, flexShrink:0 }}>
          <button className="btn-icon sm" onClick={toggleSidebar} style={{ fontSize:18 }}>☰</button>
          <span style={{ fontSize:13, fontWeight:600 }}>{currentLabel}</span>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={()=>nav('/messagerie')} className="btn-icon sm" style={{ position:'relative', fontSize:16 }}>
              ✉
              {unread > 0 && <span style={{ position:'absolute', top:-2, right:-2, width:8, height:8, background:'#dc2626', borderRadius:'50%', border:'2px solid var(--s0)' }} />}
            </button>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={()=>nav('/interventions')}>+ Nouveau</button>}
            <button onClick={toggleTheme} className="btn-icon" style={{ fontSize:16 }}>{theme==='dark'?'☀':'🌙'}</button>
          </div>
        </header>
        <main style={{ flex:1, overflowY:'auto', padding:18 }}>
          <Outlet />
        </main>
      </div>

      {/* TOASTS */}
      <div style={{ position:'fixed', bottom:20, right:20, display:'flex', flexDirection:'column', gap:8, zIndex:1000 }}>
        {toasts.map(t => (
          <div key={t.id} onClick={()=>remove(t.id)} style={{
            background:'#1a1a1e', color:'#f2f2f4', padding:'10px 16px', borderRadius:10,
            fontSize:12, fontWeight:500, display:'flex', alignItems:'center', gap:8,
            cursor:'pointer', maxWidth:320, border:'1px solid rgba(255,255,255,.1)',
            borderLeft:`3px solid ${t.type==='success'?'#4ade80':t.type==='error'?'#f87171':t.type==='warning'?'#fbbf24':'#93c5fd'}`,
            animation:'slideIn .2s ease'
          }}>
            {t.type==='success'?'✓':t.type==='error'?'✗':t.type==='warning'?'⚠':'ℹ'} {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
