// src/pages/LoginPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/store'
import { signIn, resetPassword } from '@/lib/supabase/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login'|'reset'>('login')
  const [resetOk, setResetOk] = useState(false)
  const { setUser } = useAuthStore()
  const nav = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)

    try {
      const result = await signIn(email, pw)

      if (!result) {
        setErr('Erreur de connexion inattendue')
        setLoading(false)
        return
      }

      const { profile, error } = result

      if (error) {
        setErr(error)
        setLoading(false)
        return
      }

      if (profile) {
        setUser(profile)
        nav('/dashboard')
      } else {
        setErr('Profil utilisateur introuvable')
        setLoading(false)
      }
    } catch (err: any) {
      console.error('Erreur handleLogin:', err)
      setErr(err.message || 'Erreur de connexion')
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)

    try {
      const result = await resetPassword(email)

      if (!result) {
        setErr('Erreur lors de l\'envoi de l\'email')
        setLoading(false)
        return
      }

      const { error } = result

      if (error) {
        setErr(error)
        setLoading(false)
      } else {
        setResetOk(true)
        setLoading(false)
      }
    } catch (err: any) {
      console.error('Erreur handleReset:', err)
      setErr(err.message || 'Erreur lors de l\'envoi')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, background: '#2563eb', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 12px' }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--t0)', letterSpacing: '-.025em', marginBottom: 4 }}>Kaytek Inter</h1>
          <p style={{ fontSize: 12, color: 'var(--t2)' }}>Gestion serrurerie · vitrerie</p>
        </div>
        <div className="card" style={{ padding: 24 }}>
          {mode === 'login' ? (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Connexion</h2>
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@email.fr" required autoFocus autoComplete="email" />
                </div>
                <div className="form-group">
                  <label>Mot de passe</label>
                  <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••••••" required autoComplete="current-password" />
                </div>
                {err && <div style={{ color: 'var(--rdTx)', fontSize: 12, marginBottom: 12, padding: '8px 10px', background: 'var(--rdBg)', borderRadius: 7, border: '1px solid var(--rdBd)' }}>⚠ {err}</div>}
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button>
              </form>
              <button onClick={() => { setMode('reset'); setErr('') }} style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer', marginTop: 14, display: 'block', textAlign: 'center', width: '100%' }}>Mot de passe oublié ?</button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Réinitialiser</h2>
              {resetOk ? (
                <div style={{ textAlign: 'center', color: 'var(--gnTx)', padding: '12px 0' }}>
                  <div style={{ fontSize: 26, marginBottom: 8 }}>✓</div>
                  <p>Email envoyé à <strong>{email}</strong></p>
                </div>
              ) : (
                <form onSubmit={handleReset}>
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
                  </div>
                  {err && <div style={{ color: 'var(--rdTx)', fontSize: 12, marginBottom: 12 }}>⚠ {err}</div>}
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>{loading ? 'Envoi…' : 'Envoyer le lien'}</button>
                </form>
              )}
              <button onClick={() => { setMode('login'); setErr(''); setResetOk(false) }} style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer', marginTop: 14, display: 'block', textAlign: 'center', width: '100%' }}>← Retour</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
