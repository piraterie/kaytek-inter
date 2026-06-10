// src/pages/LoginPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { Profile } from '@/types'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login'|'reset'>('login')
  const [resetOk, setResetOk] = useState(false)
  const { setUser, user } = useAuthStore()
  const nav = useNavigate()

  useEffect(() => { if (user) nav('/dashboard') }, [user])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw })
      if (error) { setErr(error.message); setLoading(false); return }
      const { data: profile, error: pErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      if (pErr || !profile) { setErr('Profil introuvable'); setLoading(false); return }
      if (!profile.actif) {
        await supabase.auth.signOut()
        setErr('Compte desactive'); setLoading(false); return
      }
      setUser(profile as Profile)
      nav('/dashboard')
    } catch(e: any) { setErr(e.message) }
    setLoading(false)
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login'
    })
    setLoading(false)
    if (error) setErr(error.message); else setResetOk(true)
  }

  return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', padding:16 }}>
      <div style={{ width:'100%', maxWidth:380 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:54, height:54, background:'#2563eb', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, margin:'0 auto 12px' }}>🔐</div>
          <h1 style={{ fontSize:22, fontWeight:700, letterSpacing:'-.025em', marginBottom:4 }}>Kaytek Inter</h1>
          <p style={{ fontSize:12, color:'var(--t2)' }}>Gestion serrurerie et vitrerie</p>
        </div>
        <div className="card" style={{ padding:28 }}>
          {mode === 'login' ? (
            <>
              <h2 style={{ fontSize:16, fontWeight:600, marginBottom:20 }}>Connexion</h2>
              <form onSubmit={login}>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                    placeholder="vous@email.fr" required autoFocus autoComplete="email" />
                </div>
                <div className="form-group">
                  <label>Mot de passe</label>
                  <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
                    placeholder="••••••••••" required autoComplete="current-password" />
                </div>
                {err && (
                  <div style={{ color:'var(--rdTx)', fontSize:12, marginBottom:14, padding:'9px 12px', background:'var(--rdBg)', borderRadius:8, border:'1px solid var(--rdBd)' }}>
                    ⚠ {err}
                  </div>
                )}
                <button type="submit" className="btn btn-primary" style={{ width:'100%', justifyContent:'center', height:44, fontSize:14 }} disabled={loading}>
                  {loading ? 'Connexion...' : 'Se connecter'}
                </button>
              </form>
              <button onClick={()=>{ setMode('reset'); setErr('') }}
                style={{ background:'none', border:'none', color:'var(--blTx)', fontSize:12, cursor:'pointer', marginTop:16, display:'block', textAlign:'center', width:'100%' }}>
                Mot de passe oublie ?
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize:16, fontWeight:600, marginBottom:20 }}>Reinitialiser</h2>
              {resetOk ? (
                <div style={{ textAlign:'center', color:'var(--gnTx)', padding:'16px 0' }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>✓</div>
                  <p>Email envoye a <strong>{email}</strong></p>
                </div>
              ) : (
                <form onSubmit={reset}>
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus />
                  </div>
                  {err && <p style={{ color:'var(--rdTx)', fontSize:12, marginBottom:12 }}>⚠ {err}</p>}
                  <button type="submit" className="btn btn-primary" style={{ width:'100%', justifyContent:'center', height:44 }} disabled={loading}>
                    {loading ? 'Envoi...' : 'Envoyer le lien'}
                  </button>
                </form>
              )}
              <button onClick={()=>{ setMode('login'); setErr(''); setResetOk(false) }}
                style={{ background:'none', border:'none', color:'var(--blTx)', fontSize:12, cursor:'pointer', marginTop:16, display:'block', textAlign:'center', width:'100%' }}>
                Retour a la connexion
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
