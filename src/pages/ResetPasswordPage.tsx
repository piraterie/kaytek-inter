// src/pages/ResetPasswordPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [ready, setReady] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    // Supabase met le token dans le hash : #access_token=...&type=recovery|invite
    const hash = window.location.hash
    if (hash.includes('access_token')) {
      // type=recovery (reset) ou type=invite (invitation)
      setReady(true)
    } else {
      // Parfois le token est dans les paramètres de recherche (nouveau format Supabase)
      const params = new URLSearchParams(window.location.search)
      if (params.get('code') || params.get('access_token')) {
        setReady(true)
      } else {
        setErr('Lien invalide ou expiré. Utilisez "Mot de passe oublié ?" sur la page de connexion.')
      }
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setErr('Les mots de passe ne correspondent pas'); return }
    if (password.length < 6) { setErr('Le mot de passe doit contenir au moins 6 caractères'); return }
    setLoading(true); setErr('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setErr(error.message); return }
    setOk(true)
    setTimeout(() => nav('/dashboard'), 2500)
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: '#1e3a5f', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>🔐</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t0)' }}>Kaytek Inter</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>Définir mon mot de passe</div>
        </div>

        <div className="card" style={{ padding: 28 }}>
          {ok ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t0)', marginBottom: 8 }}>Mot de passe défini !</div>
              <div style={{ fontSize: 13, color: 'var(--t2)' }}>Redirection vers l'application…</div>
            </div>
          ) : !ready ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 13, color: 'var(--rdTx)', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 6, padding: '10px 14px' }}>{err}</div>
              <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => nav('/login')}>Retour à la connexion</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Nouveau mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6 caractères minimum" required autoFocus />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label>Confirmer le mot de passe</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Répétez le mot de passe" required />
              </div>
              {err && <div style={{ fontSize: 13, color: 'var(--rdTx)', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>{err}</div>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Enregistrement…' : 'Définir mon mot de passe'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
