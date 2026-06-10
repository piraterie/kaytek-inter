// src/components/ConfirmModal.tsx
interface Props {
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}

export default function ConfirmModal({ message, onConfirm, onCancel, confirmLabel = 'Confirmer', danger = true, loading = false }: Props) {
  return (
    <div className="modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div className="modal-body" style={{ paddingTop: 22, paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--t0)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>Annuler</button>
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
