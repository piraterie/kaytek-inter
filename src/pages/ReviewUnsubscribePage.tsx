// src/pages/ReviewUnsubscribePage.tsx
// Page publique de désinscription aux demandes d'avis Google — accessible
// sans connexion via le lien inclus dans chaque e-mail (token opaque,
// aucune donnée personnelle lisible dedans). GET pour l'aperçu (n'inscrit
// rien), POST pour confirmer — évite qu'un pré-chargement automatique de
// lien (antivirus, scanner d'e-mail) ne désinscrive un client par erreur.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import KaytekLogo from '@/components/KaytekLogo'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-review-unsubscribe`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type State =
  | { step: 'loading' }
  | { step: 'invalid' }
  | { step: 'expired' }
  | { step: 'preview'; raisonSociale: string | null; emailMasked: string }
  | { step: 'confirming' }
  | { step: 'done' }
  | { step: 'error' }

export default function ReviewUnsubscribePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [state, setState] = useState<State>({ step: 'loading' })

  useEffect(() => {
    if (!token) { setState({ step: 'invalid' }); return }
    fetch(`${EDGE_URL}?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (r.status === 410 || json?.reason === 'expired_token') { setState({ step: 'expired' }); return }
        if (!r.ok || !json?.ok) { setState({ step: 'invalid' }); return }
        setState({ step: 'preview', raisonSociale: json.raisonSociale, emailMasked: json.emailMasked })
      })
      .catch(() => setState({ step: 'invalid' }))
  }, [token])

  async function confirm() {
    if (!token) return
    setState({ step: 'confirming' })
    try {
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) { setState({ step: 'error' }); return }
      setState({ step: 'done' })
    } catch {
      setState({ step: 'error' })
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #f8fafc)', padding: 20 }}>
      <div style={{ maxWidth: 420, width: '100%', background: 'var(--s0, #fff)', borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <KaytekLogo size={40} style={{ margin: '0 auto 16px' }} />

        {state.step === 'loading' && <Loader2 size={28} className="spin" />}

        {state.step === 'invalid' && (
          <>
            <XCircle size={32} color="#dc2626" style={{ marginBottom: 8 }} />
            <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Lien invalide</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Ce lien de désinscription n'est pas reconnu.</p>
          </>
        )}

        {state.step === 'expired' && (
          <>
            <XCircle size={32} color="#d97706" style={{ marginBottom: 8 }} />
            <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Lien expiré</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Ce lien de désinscription n'est plus valable. Contactez directement l'entreprise concernée pour ne plus recevoir ces e-mails.</p>
          </>
        )}

        {state.step === 'preview' && (
          <>
            <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Se désinscrire des demandes d'avis</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              {state.emailMasked} ne recevra plus de demande d'avis de la part de {state.raisonSociale || 'cette entreprise'}.
            </p>
            <button className="btn-primary" onClick={confirm} style={{ width: '100%' }}>Confirmer la désinscription</button>
          </>
        )}

        {state.step === 'confirming' && <Loader2 size={28} className="spin" />}

        {state.step === 'done' && (
          <>
            <CheckCircle2 size={32} color="#16a34a" style={{ marginBottom: 8 }} />
            <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Désinscription confirmée</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Vous ne recevrez plus de demande d'avis de cette entreprise.</p>
          </>
        )}

        {state.step === 'error' && (
          <>
            <XCircle size={32} color="#dc2626" style={{ marginBottom: 8 }} />
            <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Erreur</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Une erreur est survenue. Réessayez dans un instant.</p>
          </>
        )}
      </div>
    </div>
  )
}
