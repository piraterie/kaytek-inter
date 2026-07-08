// src/pages/ActivationPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'

export default function ActivationPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const nav = useNavigate()

  useEffect(() => {
    let isMounted = true

    async function detectSession() {
      // Supabase place le token soit dans le hash (#access_token=...&type=invite|recovery),
      // soit dans les paramètres de recherche (?code=... — flux PKCE).
      const hash = window.location.hash
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
          if (isMounted) setReady(true)
          return
        }

        if (hash.includes('access_token')) {
          // Le client Supabase (detectSessionInUrl: true) traite le hash de façon
          // asynchrone au chargement — on attend qu'une session soit effectivement posée.
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            if (isMounted) setReady(true)
            return
          }
          // Laisser une seconde chance après le traitement interne du SDK
          await new Promise(r => setTimeout(r, 500))
          const { data: { session: retrySession } } = await supabase.auth.getSession()
          if (retrySession) {
            if (isMounted) setReady(true)
            return
          }
        }

        if (isMounted) setErr('Lien invalide, expiré ou déjà utilisé. Demandez une nouvelle invitation à votre administrateur.')
      } catch (e: any) {
        if (isMounted) setErr(e.message || 'Lien invalide ou expiré. Demandez une nouvelle invitation à votre administrateur.')
      } finally {
        if (isMounted) setChecking(false)
      }
    }

    detectSession()
    return () => { isMounted = false }
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
    // On repart d'une connexion propre plutôt que de compter sur la session issue
    // du lien d'activation — plus fiable pour tous les rôles (admin/intervenant/assistant).
    await supabase.auth.signOut()
    setTimeout(() => nav('/login'), 2500)
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: '#1e3a5f', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>🔐</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t0)' }}>Activez votre compte</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>Définissez votre mot de passe pour accéder à Kaytek Inter.</div>
        </div>

        <div className="card" style={{ padding: 28 }}>
          {checking ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--t2)', fontSize: 13 }}>Vérification du lien…</div>
          ) : ok ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t0)', marginBottom: 8 }}>Compte activé !</div>
              <div style={{ fontSize: 13, color: 'var(--t2)' }}>Redirection vers la connexion…</div>
            </div>
          ) : !ready ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 13, color: 'var(--rdTx)', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 6, padding: '10px 14px' }}>{err}</div>
              <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => nav('/login')}>Retour à la connexion</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="6 caractères minimum" required autoFocus />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label>Confirmer le mot de passe</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Répétez le mot de passe" required />
              </div>
              {err && <div style={{ fontSize: 13, color: 'var(--rdTx)', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>{err}</div>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Activation…' : 'Activer mon compte'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
