// src/components/PaiementCreateModal.tsx
import { useState } from 'react'
import type { Echeance, ModePaiementEcheance } from '@/types'
import { MODES_PAIEMENT_LABELS } from '@/lib/echeancier'
import { useCreatePaiement } from '@/lib/hooks/echeancier'
import { useToastStore } from '@/lib/store'

interface Props {
  echeance: Echeance
  onClose: () => void
  onSaved: () => void
}

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function PaiementCreateModal({ echeance, onClose, onSaved }: Props) {
  const { add } = useToastStore()
  const create = useCreatePaiement(echeance.devis_id)
  const [montant, setMontant] = useState(echeance.montant_restant || echeance.montant_ttc)
  const [datePaiement, setDatePaiement] = useState(todayISO())
  const [modePaiement, setModePaiement] = useState<ModePaiementEcheance>('virement')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  const trouble = montant <= 0
    ? 'Le montant doit être positif'
    : montant > echeance.montant_restant + 0.01
      ? `Ce montant dépasse le reste à payer de cette échéance (${eur(echeance.montant_restant)}) — un trop-perçu doit être traité manuellement.`
      : null

  async function handleSubmit() {
    if (trouble) return
    try {
      await create.mutateAsync({
        echeance_id: echeance.id,
        echeancier_id: echeance.echeancier_id,
        devis_id: echeance.devis_id,
        client_id: echeance.client_id,
        facture_id: echeance.facture_id,
        montant,
        date_paiement: datePaiement,
        mode_paiement: modePaiement,
        reference: reference || undefined,
        note: note || undefined,
      })
      add('Paiement enregistré')
      onSaved()
    } catch (e: any) {
      add(e.message || "Erreur lors de l'enregistrement du paiement", 'error')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" data-testid="paiement-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Enregistrer un paiement</span>
          <button className="btn-icon sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 14 }}>
            {echeance.libelle} · Reste à payer : <strong style={{ color: 'var(--t0)' }}>{eur(echeance.montant_restant)}</strong>
          </div>

          <div className="form-group">
            <label>Montant reçu</label>
            <input data-testid="paiement-montant" type="number" min={0} step={0.01} value={montant} onChange={e => setMontant(Number(e.target.value))} />
          </div>

          <div className="form-group">
            <label>Date réelle du paiement</label>
            <input data-testid="paiement-date" type="date" value={datePaiement} onChange={e => setDatePaiement(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Mode de paiement</label>
            <select data-testid="paiement-mode" value={modePaiement} onChange={e => setModePaiement(e.target.value as ModePaiementEcheance)}>
              {Object.entries(MODES_PAIEMENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Référence (facultatif)</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="N° de chèque, référence de virement…" />
          </div>

          <div className="form-group">
            <label>Commentaire (facultatif)</label>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </div>

          {trouble && (
            <div data-testid="paiement-trouble" style={{ padding: '10px 14px', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 8, fontSize: 12, color: 'var(--rdTx)' }}>
              {trouble}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" data-testid="paiement-submit" className="btn btn-primary" disabled={!!trouble || create.isPending} onClick={handleSubmit}>
            {create.isPending ? 'Enregistrement…' : 'Enregistrer le paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}
