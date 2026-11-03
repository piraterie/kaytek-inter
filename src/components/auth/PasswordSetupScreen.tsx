// src/components/auth/PasswordSetupScreen.tsx
// Écran commun à /activation (invitation) et /reset-password (mot de passe
// oublié). Le rôle et l'organisation ne transitent jamais par ce formulaire
// ni par l'URL : ils sont fixés côté serveur par inviter-intervenant.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, initialAuthUrl } from '@/lib/supabase/client'
import { signIn } from '@/lib/supabase/auth'
import { useAuthStore } from '@/lib/store'
import {
  parseAuthLink, passwordProblem, authErrorMessage, LINK_INVALID_MESSAGE,
  MIN_PASSWORD_LENGTH, markAuthLinkHandled, type AuthLink,
} from '@/lib/authLinks'

type Mode = 'activation' | 'reset'
type Phase = 'checking' | 'form' | 'invalid' | 'done'

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; submitting: string; done: string; doneSub: string }> = {
  activation: {
    title: 'Activez votre compte',
    subtitle: 'Définissez votre mot de passe pour accéder à Kaytek Inter.',
    submit: 'Activer mon compte',
    submitting: 'Activation…',
    done: 'Compte activé !',
    doneSub: 'Ouverture de l’application…',
  },
  reset: {
    title: 'Nouveau mot de passe',
    subtitle: 'Choisissez un nouveau mot de passe pour votre compte Kaytek Inter.',
    submit: 'Enregistrer le mot de passe',
    submitting: 'Enregistrement…',
    done: 'Mot de passe modifié !',
    doneSub: 'Redirection vers la connexion…',
  },
}

function readLink(): AuthLink {
  const current = parseAuthLink(window.location.search, window.location.hash)
  if (current.kind !== 'none') return current
  // Hash déjà effacé par le SDK : on retombe sur l'URL capturée au chargement.
  return parseAuthLink(initialAuthUrl.search, initialAuthUrl.hash)
}

const errorBox: React.CSSProperties = {
  fontSize: 13, color: 'var(--rdTx)', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 6, padding: '10px 14px',
}

export default function PasswordSetupScreen({ mode }: { mode: Mode }) {
  const copy = COPY[mode]
  const nav = useNavigate()
  const { setUser, setSubscriptionBlocked } = useAuthStore()
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const linkRef = useRef<AuthLink>({ kind: 'none' })
  // Une fois le jeton consommé (verifyOtp), on ne le revérifie plus : une
  // erreur sur updateUser (mot de passe refusé) se corrige sans nouveau lien.
  const verifiedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    markAuthLinkHandled()
    const link = readLink()
    linkRef.current = link

    async function check() {
      try {
        if (link.kind === 'token_hash') {
          // Pas de vérification au chargement : un scanner de liens (messagerie,
          // antivirus) qui ouvre la page ne doit pas consommer le jeton.
          if (mounted) setPhase('form')
          return
        }
        if (link.kind === 'code') {
          const { data, error } = await supabase.auth.exchangeCodeForSession(link.code)
          if (error) throw error
          verifiedRef.current = true
          if (mounted) { setEmail(data.user?.email ?? null); setPhase('form') }
          return
        }
        if (link.kind === 'implicit') {
          // Ancien format : le SDK (detectSessionInUrl) pose la session lui-même ;
          // getSession() attend la fin de ce traitement.
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            verifiedRef.current = true
            if (mounted) { setEmail(session.user.email ?? null); setPhase('form') }
            return
          }
        }
        if (link.kind === 'error') console.warn('[auth-link] lien refusé:', link.code)
        if (mounted) { setErr(LINK_INVALID_MESSAGE); setPhase('invalid') }
      } catch (e: any) {
        console.warn('[auth-link] vérification échouée:', e?.code || e?.message)
        if (mounted) { setErr(authErrorMessage(e)); setPhase('invalid') }
      }
    }
    check()
    return () => { mounted = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    const problem = passwordProblem(password, confirm)
    if (problem) { setErr(problem); return }
    setErr('')
    setLoading(true)

    try {
      let userEmail = email
      const link = linkRef.current
      if (!verifiedRef.current && link.kind === 'token_hash') {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
        if (error || !data.session) {
          console.warn('[auth-link] verifyOtp refusé:', error?.code || error?.message)
          setErr(authErrorMessage(error ?? { code: 'otp_expired' }))
          setPhase('invalid')
          return
        }
        verifiedRef.current = true
        userEmail = data.user?.email ?? null
        setEmail(userEmail)
      }

      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) {
        console.warn('[auth-link] updateUser refusé:', updErr.code || updErr.message)
        setErr(authErrorMessage(updErr))
        return
      }

      setPhase('done')

      if (mode === 'reset') {
        // Révoque aussi les autres sessions ouvertes avec l'ancien mot de passe.
        await supabase.auth.signOut({ scope: 'global' })
        setTimeout(() => nav('/login', { replace: true, state: { notice: 'Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.', email: userEmail } }), 1200)
        return
      }

      // Activation : connexion par le parcours habituel (profil, appareil,
      // abonnement) avec le mot de passe tout juste choisi.
      if (userEmail) {
        const result = await signIn(userEmail, password)
        if (result.profile && !result.error) {
          setSubscriptionBlocked(!!(result as { subscriptionBlocked?: boolean }).subscriptionBlocked)
          setUser(result.profile)
          setTimeout(() => nav('/dashboard', { replace: true }), 800)
          return
        }
        console.warn('[auth-link] connexion après activation impossible:', result.error)
      }
      await supabase.auth.signOut({ scope: 'local' })
      setTimeout(() => nav('/login', { replace: true, state: { notice: 'Compte activé. Connectez-vous avec votre nouveau mot de passe.', email: userEmail } }), 1200)
    } catch (e: any) {
      console.error('[auth-link] erreur inattendue:', e?.message)
      setErr(authErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: '#1e3a5f', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--t0)' }}>{copy.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>{copy.subtitle}</div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          {phase === 'checking' ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--t2)', fontSize: 13 }}>Vérification du lien…</div>
          ) : phase === 'done' ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }} role="status">
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t0)', marginBottom: 8 }}>{copy.done}</div>
              <div style={{ fontSize: 13, color: 'var(--t2)' }}>{copy.doneSub}</div>
            </div>
          ) : phase === 'invalid' ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={errorBox} role="alert">{err || LINK_INVALID_MESSAGE}</div>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginTop: 14, lineHeight: 1.5 }}>
                {mode === 'activation'
                  ? 'Demandez à votre administrateur de vous renvoyer une invitation. Si vous avez déjà activé votre compte, connectez-vous ou utilisez « Mot de passe oublié ? ».'
                  : 'Demandez un nouveau lien de réinitialisation.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => nav('/login?mode=reset', { replace: true })}>
                  {mode === 'activation' ? 'Mot de passe oublié ?' : 'Demander un nouveau lien'}
                </button>
                <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => nav('/login', { replace: true })}>
                  Retour à la connexion
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {/* Champ identifiant pour les gestionnaires de mots de passe (trousseau iOS, navigateurs). */}
              {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label htmlFor="new-password">{mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}</label>
                <input
                  id="new-password" name="new-password" type={show ? 'text' : 'password'}
                  autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`} required autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label htmlFor="confirm-password">Confirmer le mot de passe</label>
                <input
                  id="confirm-password" name="confirm-password" type={show ? 'text' : 'password'}
                  autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="Répétez le mot de passe" required
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t2)', marginBottom: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} style={{ width: 16, height: 16, minHeight: 'auto', padding: 0 }} />
                Afficher les mots de passe
              </label>
              <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Au moins {MIN_PASSWORD_LENGTH} caractères, avec au moins une lettre et un chiffre.</p>
              {err && <div style={{ ...errorBox, padding: '8px 12px', marginBottom: 16 }} role="alert">{err}</div>}
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                {loading ? copy.submitting : copy.submit}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
