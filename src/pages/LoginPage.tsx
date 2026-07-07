// src/pages/LoginPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/store'
import { signIn, resetPassword } from '@/lib/supabase/auth'
import { supabase } from '@/lib/supabase/client'
import {
  isBiometricAvailable, hasBiometricRegistered, getBiometricEmail,
  authenticateWithBiometric, registerBiometric, clearBiometric,
} from '@/lib/biometric'
import type { Profile } from '@/types'
import KaytekLogo from '@/components/KaytekLogo'

// Brute-force protection — 5 tentatives → blocage 15 minutes
const BF_KEY = 'kaytek-login-bf'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

function getBF(): { count: number; lockedUntil: number | null } {
  try { return { count: 0, lockedUntil: null, ...JSON.parse(localStorage.getItem(BF_KEY) || '{}') } }
  catch { return { count: 0, lockedUntil: null } }
}
function setBF(v: { count: number; lockedUntil: number | null }) {
  localStorage.setItem(BF_KEY, JSON.stringify(v))
}
function clearBF() { localStorage.removeItem(BF_KEY) }

export default function LoginPage() {
  const [email, setEmail]           = useState('')
  const [pw, setPw]                 = useState('')
  const [err, setErr]               = useState('')
  const [loading, setLoading]       = useState(false)
  const [bioLoading, setBioLoading] = useState(false)
  const [mode, setMode]             = useState<'login' | 'reset'>('login')
  const [resetOk, setResetOk]       = useState(false)
  const [offerBio, setOfferBio]     = useState(false)
  const [pendingProfile, setPendingProfile] = useState<Profile | null>(null)
  const [showPwForm, setShowPwForm] = useState(false)
  const [lockRemaining, setLockRemaining] = useState(0)

  // Décompte si verrouillé
  useEffect(() => {
    const bf = getBF()
    if (!bf.lockedUntil) return
    const remaining = bf.lockedUntil - Date.now()
    if (remaining <= 0) { clearBF(); return }
    setLockRemaining(Math.ceil(remaining / 1000))
    const interval = setInterval(() => {
      const r = bf.lockedUntil! - Date.now()
      if (r <= 0) { clearBF(); setLockRemaining(0); clearInterval(interval) }
      else setLockRemaining(Math.ceil(r / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const { setUser } = useAuthStore()
  const nav = useNavigate()

  const bioAvailable  = isBiometricAvailable()
  const bioRegistered = hasBiometricRegistered()
  const bioEmail      = getBiometricEmail()
  const showBioFirst  = bioAvailable && bioRegistered && !showPwForm

  function activateSession(profile: Profile) {
    sessionStorage.setItem('kaytek-active', '1')
    setUser(profile)
  }

  function redirectAfterLogin() {
    const redirect = sessionStorage.getItem('kaytek-push-redirect')
    if (redirect && redirect !== '/' && !redirect.startsWith('/login')) {
      sessionStorage.removeItem('kaytek-push-redirect')
      console.log('[Login] redirect post-push →', redirect)
      nav(redirect, { replace: true })
    } else {
      nav('/dashboard')
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErr('')

    // Vérification du verrouillage brute-force
    const bf = getBF()
    if (bf.lockedUntil && bf.lockedUntil > Date.now()) {
      const remaining = Math.ceil((bf.lockedUntil - Date.now()) / 1000)
      setErr(`Trop de tentatives. Réessayez dans ${Math.ceil(remaining / 60)} minute(s).`)
      return
    }

    setLoading(true)
    try {
      const result = await signIn(email, pw)
      if (!result) { setErr('Erreur de connexion inattendue'); setLoading(false); return }
      const { profile, error } = result
      if (error) {
        // Incrémenter le compteur d'échecs sauf pour l'erreur appareils
        const isDeviceLimit = error.includes("appareils autorisés")
        if (!isDeviceLimit) {
          const current = getBF()
          const newCount = (current.count || 0) + 1
          if (newCount >= MAX_ATTEMPTS) {
            setBF({ count: newCount, lockedUntil: Date.now() + LOCKOUT_MS })
          } else {
            setBF({ count: newCount, lockedUntil: null })
          }
        }
        setErr(error)
        setLoading(false)
        return
      }
      if (!profile) { setErr('Profil utilisateur introuvable'); setLoading(false); return }

      // Connexion réussie — réinitialiser le compteur
      clearBF()
      activateSession(profile)

      if (bioAvailable && !bioRegistered) {
        setPendingProfile(profile)
        setOfferBio(true)
      } else {
        redirectAfterLogin()
      }
    } catch (err: any) {
      setErr(err.message || 'Erreur de connexion')
      setLoading(false)
    }
  }

  async function handleBiometricLogin() {
    setErr('')
    setBioLoading(true)
    try {
      const ok = await authenticateWithBiometric()
      if (!ok) {
        setErr('Empreinte non reconnue. Utilisez votre mot de passe.')
        setShowPwForm(true)
        return
      }

      sessionStorage.setItem('kaytek-active', '1')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        sessionStorage.removeItem('kaytek-active')
        setErr('Session expirée. Reconnectez-vous avec votre mot de passe.')
        clearBiometric()
        setShowPwForm(true)
        return
      }

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single()
      if (!profile) {
        sessionStorage.removeItem('kaytek-active')
        setErr('Profil introuvable.')
        setShowPwForm(true)
        return
      }

      setUser(profile)
      redirectAfterLogin()
    } catch {
      setErr('Authentification échouée. Utilisez votre mot de passe.')
      setShowPwForm(true)
    } finally {
      setBioLoading(false)
    }
  }

  async function handleRegisterBiometric() {
    if (!pendingProfile) { redirectAfterLogin(); return }
    await registerBiometric(
      pendingProfile.id,
      `${pendingProfile.prenom} ${pendingProfile.nom}`,
      pendingProfile.email
    )
    redirectAfterLogin()
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const result = await resetPassword(email)
      if (!result) { setErr('Erreur lors de l\'envoi de l\'email'); setLoading(false); return }
      const { error } = result
      if (error) { setErr(error); setLoading(false) } else { setResetOk(true); setLoading(false) }
    } catch (err: any) {
      setErr(err.message || 'Erreur lors de l\'envoi')
      setLoading(false)
    }
  }

  // ── Offer biometric after password login ──────────────────────────────────
  if (offerBio) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👆</div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Connexion rapide</h2>
            <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 24 }}>
              Activer la connexion par empreinte digitale pour ne plus saisir votre mot de passe ?
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
              onClick={handleRegisterBiometric}
            >
              Activer l'empreinte
            </button>
            <button
              onClick={() => redirectAfterLogin()}
              style={{ background: 'none', border: 'none', color: 'var(--t2)', fontSize: 13, cursor: 'pointer', padding: 8 }}
            >
              Non merci, continuer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <KaytekLogo size={80} style={{ filter: 'drop-shadow(0 4px 12px rgba(37,99,235,.30))' }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.03em', marginBottom: 6 }}>
            <span style={{ color: '#3B82F6' }}>Kay</span><span style={{ color: '#1A2F5C' }}>tek</span>
            {' '}
            <span style={{ color: 'var(--t0)' }}>Inter</span>
          </h1>
          <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.4 }}>Devis · Factures · Interventions · Messagerie</p>
        </div>

        <div className="card" style={{ padding: 24 }}>
          {mode === 'login' ? (
            <>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>Connexion</h2>

              {/* ── Biometric login ──────────────────────────────────── */}
              {showBioFirst && (
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  {bioEmail && (
                    <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
                      {bioEmail}
                    </p>
                  )}
                  <button
                    onClick={handleBiometricLogin}
                    disabled={bioLoading}
                    style={{
                      width: '100%', padding: '14px 0', fontSize: 15, fontWeight: 600,
                      background: 'var(--bl)', color: '#fff', border: 'none', borderRadius: 10,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      opacity: bioLoading ? 0.7 : 1, marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>👆</span>
                    {bioLoading ? 'Vérification…' : 'Se connecter avec l\'empreinte'}
                  </button>
                  {err && (
                    <div style={{ color: 'var(--rdTx)', fontSize: 12, marginBottom: 12, padding: '8px 10px', background: 'var(--rdBg)', borderRadius: 7, border: '1px solid var(--rdBd)' }}>
                      ⚠ {err}
                    </div>
                  )}
                  <button
                    onClick={() => { setShowPwForm(true); setErr('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Utiliser le mot de passe
                  </button>
                </div>
              )}

              {/* ── Password form ─────────────────────────────────────── */}
              {!showBioFirst && (
                <>
                  {lockRemaining > 0 && (
                    <div style={{ color: 'var(--rdTx)', fontSize: 12, marginBottom: 14, padding: '10px 12px', background: 'var(--rdBg)', borderRadius: 7, border: '1px solid var(--rdBd)', textAlign: 'center' }}>
                      🔒 Compte temporairement bloqué<br />
                      <strong>Réessayez dans {Math.floor(lockRemaining / 60)}:{String(lockRemaining % 60).padStart(2, '0')}</strong>
                    </div>
                  )}
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
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={loading || lockRemaining > 0}>
                      {loading ? 'Connexion…' : lockRemaining > 0 ? `Bloqué (${Math.ceil(lockRemaining / 60)} min)` : 'Se connecter'}
                    </button>
                  </form>
                  {showPwForm && bioAvailable && bioRegistered && (
                    <button
                      onClick={() => { setShowPwForm(false); setErr('') }}
                      style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer', marginTop: 10, display: 'block', textAlign: 'center', width: '100%' }}
                    >
                      ← Retour à l'empreinte
                    </button>
                  )}
                  <button
                    onClick={() => { setMode('reset'); setErr('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer', marginTop: 14, display: 'block', textAlign: 'center', width: '100%' }}
                  >
                    Mot de passe oublié ?
                  </button>
                </>
              )}
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
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                    {loading ? 'Envoi…' : 'Envoyer le lien'}
                  </button>
                </form>
              )}
              <button
                onClick={() => { setMode('login'); setErr(''); setResetOk(false) }}
                style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 12, cursor: 'pointer', marginTop: 14, display: 'block', textAlign: 'center', width: '100%' }}
              >
                ← Retour
              </button>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--t3)', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href="/confidentialite" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Confidentialité</a>
          <span style={{ color: 'var(--t3)', opacity: 0.4 }}>·</span>
          <a href="/delete-account" style={{ color: 'var(--t3)', textDecoration: 'none' }}>Suppression de compte</a>
        </div>
      </div>
    </div>
  )
}
