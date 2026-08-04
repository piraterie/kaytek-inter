// src/pages/GoogleReviewRequestsPage.tsx — Phase 3
// Historique des demandes d'avis envoyées/programmées/annulées — statut,
// annulation avant envoi, lien vers les réglages.
import { useNavigate } from 'react-router-dom'
import { Loader2, X, Settings, Mail } from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useReviewRequests, useCancelReviewRequest } from '@/lib/hooks/googleReviewRequests'
import { useFactures } from '@/lib/hooks'

const STATUS_LABEL: Record<string, { label: string; pill: string }> = {
  pending: { label: 'Programmée', pill: 'pill-amber' },
  sent: { label: 'Envoyée', pill: 'pill-green' },
  delivered: { label: 'Livrée', pill: 'pill-green' },
  failed: { label: 'Échec', pill: 'pill-red' },
  cancelled: { label: 'Annulée', pill: 'pill-gray' },
}

export default function GoogleReviewRequestsPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: requests, isLoading, isError, error } = useReviewRequests()
  const { data: factures = [] } = useFactures()
  const cancelMut = useCancelReviewRequest()

  const facturesById = new Map(factures.map((f) => [f.id, f]))

  async function handleCancel(id: string) {
    try {
      await cancelMut.mutateAsync(id)
      add('Demande annulée')
    } catch (e: any) { add(e.message, 'error') }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Demandes d'avis</h1>
        <div className="page-actions">
          <button className="btn-secondary btn-sm" onClick={() => nav('/parametres')}><Settings size={13} /> Réglages</button>
        </div>
      </div>

      {isError && <div className="card" style={{ padding: 16, color: 'var(--rdTx)', marginBottom: 16 }}>{(error as Error)?.message}</div>}
      {isLoading && <Loader2 className="spin" />}

      {!isLoading && (!requests || requests.length === 0) && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>
          <Mail size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>Aucune demande d'avis pour l'instant — elles sont proposées automatiquement après le paiement d'une facture (si activé dans les réglages).</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(requests ?? []).map((r) => {
          const facture = facturesById.get(r.facture_id)
          const st = STATUS_LABEL[r.delivery_status] ?? { label: r.delivery_status, pill: 'pill-gray' }
          return (
            <div key={r.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {facture ? `Facture ${facture.numero} — ${facture.client?.nom || ''} ${facture.client?.prenom || ''}` : `Facture ${r.facture_id.slice(0, 8)}…`}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--t3)', marginTop: 2 }}>
                  {r.sent_at
                    ? `Envoyée le ${new Date(r.sent_at).toLocaleString('fr-FR')}`
                    : r.scheduled_send_at
                      ? `Programmée pour le ${new Date(r.scheduled_send_at).toLocaleString('fr-FR')}`
                      : `Créée le ${new Date(r.created_at).toLocaleString('fr-FR')}`}
                  {r.delivery_error && ` — ${r.delivery_error}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`pill ${st.pill}`}>{st.label}</span>
                {r.delivery_status === 'pending' && !r.cancelled_at && (
                  <button className="btn-icon sm" title="Annuler" disabled={cancelMut.isPending} onClick={() => handleCancel(r.id)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
