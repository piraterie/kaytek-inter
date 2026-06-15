// src/components/WelcomeModal.tsx — Popup de bienvenue première connexion
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/store'
import { useDismissWelcome } from '@/lib/hooks/guide'

interface Props {
  onClose: () => void
}

export default function WelcomeModal({ onClose }: Props) {
  const nav            = useNavigate()
  const { user }       = useAuthStore()
  const dismiss        = useDismissWelcome()
  const [hiding, setHiding] = useState(false)

  function close(cb?: () => void) {
    setHiding(true)
    setTimeout(() => { onClose(); cb?.() }, 220)
  }

  function handleViewGuide() {
    close(() => nav('/guide'))
  }

  function handleLater() {
    close()
  }

  function handleNeverAgain() {
    dismiss.mutate()
    close()
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={handleLater}
        style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          opacity: hiding ? 0 : 1,
          transition: 'opacity 220ms ease',
        } as React.CSSProperties}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1201,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--card)', borderRadius: 18,
          padding: '32px 28px', maxWidth: 380, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          textAlign: 'center', pointerEvents: 'auto',
          transform: hiding ? 'scale(.95)' : 'scale(1)',
          opacity: hiding ? 0 : 1,
          transition: 'transform 220ms ease, opacity 220ms ease',
        }}>
          {/* Icône */}
          <div style={{
            width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px',
            background: 'linear-gradient(135deg,#2563eb,#7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
          }}>
            📚
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t0)', marginBottom: 8, letterSpacing: '-.02em' }}>
            Bienvenue sur Kaytek Inter
          </h2>
          <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 24, lineHeight: 1.6 }}>
            {user?.prenom ? `Bonjour ${user.prenom} ! ` : ''}
            Souhaitez-vous découvrir le guide d'utilisation ?
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={handleViewGuide}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '11px 0' }}
            >
              📖 Voir le guide
            </button>
            <button
              onClick={handleLater}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '11px 0' }}
            >
              Plus tard
            </button>
            <button
              onClick={handleNeverAgain}
              style={{
                background: 'none', border: 'none', color: 'var(--t3)',
                fontSize: 12, cursor: 'pointer', padding: '6px 0',
                fontFamily: 'inherit',
              }}
            >
              Ne plus afficher
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
