// src/components/ConfirmModal.tsx
import { useState } from 'react'

interface Props {
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  // Action alternative optionnelle (ex. "Archiver à la place") affichée entre
  // Annuler et l'action principale — utilisée pour proposer une solution plus
  // sûre qu'une suppression physique quand l'enregistrement a des liens.
  secondaryLabel?: string
  onSecondary?: () => void
}

export default function ConfirmModal({ message, onConfirm, onCancel, confirmLabel = 'Confirmer', danger = true, loading = false, secondaryLabel, onSecondary }: Props) {
  const [closing, setClosing] = useState(false)

  function handleCancel() {
    if (closing || loading) return
    setClosing(true)
    setTimeout(onCancel, 150)
  }

  return (
    <div className={`modal-overlay${closing ? ' is-closing' : ''}`} onClick={handleCancel}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div className="modal-body" style={{ paddingTop: 22, paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--t0)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel} disabled={loading}>Annuler</button>
          {secondaryLabel && onSecondary && (
            <button
              className="btn btn-secondary"
              onClick={() => { onCancel(); onSecondary() }}
              disabled={loading}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            className="btn btn-primary"
            style={danger ? { background: '#dc2626', borderColor: '#dc2626' } : {}}
            onClick={() => { onCancel(); onConfirm() }}
            disabled={loading}
          >
            {loading ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
