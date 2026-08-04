// src/components/ReviewRequestPromptModal.tsx — Phase 3
// Proposition d'envoi d'une demande d'avis Google juste après le passage
// d'une facture au statut payée (mode manuel des réglages "Demandes
// d'avis"). N'apparaît que si les réglages de l'organisation l'activent —
// la décision d'afficher ou non ce modal revient à l'appelant.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useCreateReviewRequest, useSendReviewRequestNow, type ReviewRequestDelai } from '@/lib/hooks/googleReviewRequests'

interface Props {
  factureId: string
  clientId: string
  defaultDelai: ReviewRequestDelai
  defaultDelaiMinutes?: number | null
  onClose: () => void
}

// Traduit les préfixes machine-lisibles du trigger DB
// (trg_review_requests_guard) en messages clairs pour l'admin — jamais un
// message d'erreur Postgres brut affiché tel quel.
function friendlyErrorMessage(raw: string): string {
  if (raw.includes('FREQUENCE_BLOQUEE')) return 'Ce client a déjà reçu une demande d\'avis récemment (réglage de fréquence de l\'organisation) — aucun nouvel envoi possible pour l\'instant.'
  if (raw.includes('CLIENT_DESABONNE')) return 'Ce client s\'est désinscrit des demandes d\'avis — aucun envoi possible.'
  if (raw.includes('CLIENT_SANS_EMAIL')) return 'Ce client n\'a pas d\'adresse e-mail — aucun envoi possible.'
  return raw
}

export default function ReviewRequestPromptModal({ factureId, clientId, defaultDelai, defaultDelaiMinutes, onClose }: Props) {
  const { add } = useToastStore()
  const createMut = useCreateReviewRequest()
  const sendNowMut = useSendReviewRequestNow()
  const [closing, setClosing] = useState(false)
  const [pending, setPending] = useState<'now' | 'schedule' | null>(null)

  function close() {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 150)
  }

  async function handleSendNow() {
    setPending('now')
    try {
      const reviewRequestId = await createMut.mutateAsync({ factureId, clientId, delai: 'immediat' })
      await sendNowMut.mutateAsync(reviewRequestId)
      add('Demande d\'avis envoyée')
      close()
    } catch (e: any) {
      add(friendlyErrorMessage(String(e?.message || '')), 'error')
      close()
    } finally {
      setPending(null)
    }
  }

  async function handleSchedule() {
    setPending('schedule')
    try {
      await createMut.mutateAsync({ factureId, clientId, delai: defaultDelai, delaiMinutes: defaultDelaiMinutes })
      add('Demande d\'avis programmée')
      close()
    } catch (e: any) {
      add(friendlyErrorMessage(String(e?.message || '')), 'error')
      close()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={`modal-overlay${closing ? ' is-closing' : ''}`} onClick={close}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body" style={{ paddingTop: 22, paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--t0)', lineHeight: 1.65, margin: 0, fontWeight: 600 }}>
            Souhaitez-vous envoyer une demande d'avis à ce client ?
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 8 }}>
            Un e-mail lui sera envoyé avec un lien direct vers votre fiche Google.
          </p>
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={close} disabled={pending !== null}>Ne pas envoyer</button>
          <button className="btn btn-secondary" onClick={handleSchedule} disabled={pending !== null}>
            {pending === 'schedule' ? <Loader2 size={14} className="spin" /> : null} Programmer
          </button>
          <button className="btn btn-primary" onClick={handleSendNow} disabled={pending !== null}>
            {pending === 'now' ? <Loader2 size={14} className="spin" /> : null} Envoyer maintenant
          </button>
        </div>
      </div>
    </div>
  )
}
