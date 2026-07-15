// src/pages/LockScreen.tsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useParamsStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import { signIn } from '@/lib/supabase/auth'
import {
  isBiometricAvailable, hasBiometricRegistered,
  authenticateWithBiometric, clearBiometric,
} from '@/lib/biometric'
import KaytekLogo from '@/components/KaytekLogo'

export default function LockScreen() {
  const { user, setUser, setAppUnlocked } = useAuthStore()
  const { setParams } = useParamsStore()
  const nav = useNavigate()

  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioEnrolled] = useState(() => hasBiometricRegistered())
  const [bioLoading, setBioLoading] = useState(false)
  const [showPwForm, setShowPwForm] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  const pwInputRef = useRef<HTMLInputElement>(null)
  const triggeredRef = useRef(false)

  useEffect(() => {
    console.log('[LockScreen] monté — vérification biométrie...')
    isBiometricAvailable().then(avail => {
      console.log('[LockScreen] bioAvailable:', avail, 'bioEnrolled:', hasBiometricRegistered())
      setBioAvailable(avail)
      if (avail && hasBiometricRegistered() && !triggeredRef.current) {
        triggeredRef.current = true
        setTimeout(() => triggerBiometric(), 400)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (showPwForm) {
      setTimeout(() => pwInputRef.current?.focus(), 100)
    }
  }, [showPwForm])

  async function triggerBiometric() {
    setBioLoading(true)
    setErr('')
    console.log('[LockScreen] déclenchement biométrie...')
    try {
      const ok = await authenticateWithBiometric()
      console.log('[LockScreen] résultat biométrie:', ok)
      if (ok) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          console.log('[LockScreen] session expirée → demande mot de passe')
          clearBiometric()
          setErr('Session expirée. Saisissez votre mot de passe.')
          setShowPwForm(true)
          return
        }
        console.log('[LockScreen] biométrie OK + session valide → déverrouillage')
        setAppUnlocked(true)
        nav('/dashboard', { replace: true })
      } else {
        setErr('Empreinte non reconnue. Saisissez votre mot de passe.')
        setShowPwForm(true)
      }
    } catch (e: any) {
      console.log('[LockScreen] erreur biométrie:', e?.message)
      setErr('Biométrie indisponible.')
      setShowPwForm(true)
    } finally {
      setBioLoading(false)
    }
  }

  async function handlePasswordUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setErr('')
    setPwLoading(true)
    console.log('[LockScreen] tentative mot de passe pour', user.email)
    try {
      const result = await signIn(user.email, pw)
      if (result.error) {
        console.log('[LockScreen] erreur mot de passe:', result.error)
        setErr(result.error)
        return
      }
      if (!result.profile) {
        setErr('Profil introuvable.')
        return
      }
      // Recharger les paramètres entreprise au cas où
      const { data: params } = await supabase.from('parametres_entreprise').select('*').single()
      if (params) setParams(params)

      console.log('[LockScreen] mot de passe OK → déverrouillage')
      setUser(result.profile)
      setAppUnlocked(true)
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      console.log('[LockScreen] exception:', e?.message)
      setErr(e.message || 'Erreur de connexion.')
    } finally {
      setPwLoading(false)
    }
  }

  const initials = `${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase()
  const displayName = user ? `${user.prenom} ${user.nom}` : ''
  const showBioButton = bioAvailable && bioEnrolled && !showPwForm

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20, flexDirection: 'column', gap: 0,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <KaytekLogo size={64} style={{ filter: 'drop-shadow(0 4px 12px rgba(37,99,235,.30))' }} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.03em', marginBottom: 4 }}>
            <span style={{ color: '#3B82F6' }}>Kay</span><span style={{ color: 'var(--t0)' }}>tek</span>
            {' '}<span style={{ color: 'var(--t0)' }}>Inter</span>
          </h1>
          <p style={{ fontSize: 12, color: 'var(--t3)' }}>Application verrouillée</p>
        </div>

        {/* Avatar + Nom */}
        {user && (
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg,#2563eb,#7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, color: '#fff',
              margin: '0 auto 10px',
              boxShadow: '0 4px 16px rgba(37,99,235,.30)',
            }}>
              {initials}
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--t0)', marginBottom: 2 }}>{displayName}</p>
            <p style={{ fontSize: 12, color: 'var(--t3)' }}>{user.email}</p>
          </div>
        )}

        {/* Zone principale */}
        <div className="card" style={{ padding: 24 }}>
          {/* Bouton biométrie */}
          {showBioButton && (
            <div style={{ textAlign: 'center', marginBottom: err ? 16 : 0 }}>
              <button
                onClick={triggerBiometric}
                disabled={bioLoading}
                style={{
                  width: '100%', padding: '14px 0', fontSize: 15, fontWeight: 600,
                  background: 'var(--bl)', color: '#fff', border: 'none', borderRadius: 10,
                  cursor: bioLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  opacity: bioLoading ? 0.7 : 1, marginBottom: 14, transition: 'opacity .2s',
                }}
              >
                <span style={{ fontSize: 22 }}>👆</span>
                {bioLoading ? 'Vérification…' : 'Déverrouiller avec l\'empreinte'}
              </button>

              {err && (
                <div style={{
                  color: 'var(--rdTx)', fontSize: 12, marginBottom: 14,
                  padding: '8px 10px', background: 'var(--rdBg)',
                  borderRadius: 7, border: '1px solid var(--rdBd)', textAlign: 'left',
                }}>
                  ⚠ {err}
                </div>
              )}

              <button
                onClick={() => { setShowPwForm(true); setErr('') }}
                style={{ background: 'none', border: 'none', color: 'var(--blTx)', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}
              >
                Utiliser le mot de passe à la place
              </button>
            </div>
          )}

          {/* Formulaire mot de passe */}
          {(!showBioButton || showPwForm) && (
            <>
              {!showBioButton && !showPwForm && (
                <p style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', marginBottom: 16 }}>
                  Saisissez votre mot de passe pour continuer
                </p>
              )}
              <form onSubmit={handlePasswordUnlock}>
                {/* Email lecture seule */}
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    readOnly
                    style={{ opacity: 0.65, cursor: 'default', background: 'var(--s1)' }}
                    tabIndex={-1}
                  />
                </div>
                <div className="form-group">
                  <label>Mot de passe</label>
                  <input
                    ref={pwInputRef}
                    type="password"
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                  />
                </div>
                {err && (
                  <div style={{
                    color: 'var(--rdTx)', fontSize: 12, marginBottom: 12,
                    padding: '8px 10px', background: 'var(--rdBg)',
                    borderRadius: 7, border: '1px solid var(--rdBd)',
                  }}>
                    ⚠ {err}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                  disabled={pwLoading}
                >
                  {pwLoading ? 'Vérification…' : 'Déverrouiller'}
                </button>
              </form>

              {/* Retour biométrie si disponible */}
              {bioAvailable && bioEnrolled && showPwForm && (
                <button
                  onClick={() => { setShowPwForm(false); setErr(''); setPw('') }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--blTx)',
                    fontSize: 12, cursor: 'pointer', marginTop: 12,
                    display: 'block', textAlign: 'center', width: '100%',
                  }}
                >
                  ← Retour à l'empreinte
                </button>
              )}
            </>
          )}
        </div>

        {/* Pied de page : changer de compte */}
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: 'var(--t3)' }}>
          <button
            onClick={() => nav('/login')}
            style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', textDecoration: 'underline', fontSize: 12, padding: 0 }}
          >
            Changer de compte
          </button>
        </p>
      </div>
    </div>
  )
}
