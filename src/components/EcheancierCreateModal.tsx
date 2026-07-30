// src/components/EcheancierCreateModal.tsx
import { useEffect, useMemo, useState } from 'react'
import type { Devis, ModeRepartition } from '@/types'
import {
  calculerEcheances, validerEcheances, dateDecalage, LIBELLES_PAR_DEFAUT,
  POURCENTAGES_ACOMPTE_RAPIDES, type EcheanceCalculee,
} from '@/lib/echeancier'
import { useCreateEcheancier } from '@/lib/hooks/echeancier'
import { useToastStore } from '@/lib/store'

interface Props {
  devis: Devis
  onClose: () => void
  onCreated: () => void
}

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export default function EcheancierCreateModal({ devis, onClose, onCreated }: Props) {
  const { add } = useToastStore()
  const create = useCreateEcheancier()

  const devisMontants = { montant_ht: devis.total_ht, tva_montant: devis.tva_montant, montant_ttc: devis.total_ttc }

  const [nombreEcheances, setNombreEcheances] = useState(2)
  const [mode, setMode] = useState<ModeRepartition>('egale')
  // Valeurs éditables — pour n échéances, seules les n-1 premières sont
  // saisies ; la dernière (solde) absorbe toujours le reste automatiquement.
  const [pourcentagesEdit, setPourcentagesEdit] = useState<number[]>([])
  const [montantsEdit, setMontantsEdit] = useState<number[]>([])
  const [libelles, setLibelles] = useState<string[]>(LIBELLES_PAR_DEFAUT[2])
  const [dates, setDates] = useState<string[]>(['', ''])
  const [rappelsClient, setRappelsClient] = useState<boolean[]>([true, true])
  const [noteInterne, setNoteInterne] = useState('')
  const [noteVisibleClient, setNoteVisibleClient] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Réinitialise les tableaux dépendants quand le nombre d'échéances change.
  useEffect(() => {
    const pctBase = Math.round((100 / nombreEcheances) * 100) / 100
    setPourcentagesEdit(Array(Math.max(nombreEcheances - 1, 0)).fill(pctBase))
    setMontantsEdit(Array(Math.max(nombreEcheances - 1, 0)).fill(Math.round((devis.total_ttc / nombreEcheances) * 100) / 100))
    setLibelles(LIBELLES_PAR_DEFAUT[nombreEcheances])
    setDates(Array.from({ length: nombreEcheances }, (_, i) => dateDecalage(i === 0 ? 0 : 30 * i)))
    setRappelsClient(Array(nombreEcheances).fill(true))
  }, [nombreEcheances]) // eslint-disable-line react-hooks/exhaustive-deps

  const lignesCalculees: EcheanceCalculee[] | null = useMemo(() => {
    try {
      setError(null)
      if (mode === 'egale') return calculerEcheances(devisMontants, nombreEcheances, 'egale', {})
      if (mode === 'pourcentages') {
        const dernier = 100 - pourcentagesEdit.reduce((a, b) => a + b, 0)
        return calculerEcheances(devisMontants, nombreEcheances, 'pourcentages', { pourcentages: [...pourcentagesEdit, dernier] })
      }
      return calculerEcheances(devisMontants, nombreEcheances, 'montants', { montantsSaufDernier: montantsEdit })
    } catch (e: any) {
      setError(e.message)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nombreEcheances, pourcentagesEdit, montantsEdit, devis.total_ttc])

  function applyAcompteRapide(pct: number) {
    if (mode !== 'pourcentages') setMode('pourcentages')
    setPourcentagesEdit(prev => {
      const next = [...prev]
      next[0] = pct
      return next
    })
  }

  const validation = lignesCalculees
    ? validerEcheances(devis.total_ttc, lignesCalculees.map((l, i) => ({
        numero_ordre: l.numero_ordre, pourcentage: l.pourcentage, montant_ht: l.montant_ht,
        tva_montant: l.tva_montant, montant_ttc: l.montant_ttc, date_prevue: dates[i] || null,
      })))
    : null

  async function handleSubmit() {
    if (!lignesCalculees || !validation?.valide) return
    try {
      await create.mutateAsync({
        devis_id: devis.id,
        nombre_echeances: nombreEcheances,
        mode_repartition: mode,
        note_interne: noteInterne || undefined,
        note_visible_client: noteVisibleClient,
        echeances: lignesCalculees.map((l, i) => ({
          numero_ordre: l.numero_ordre,
          libelle: libelles[i] || l.libelle,
          pourcentage: l.pourcentage,
          montant_ht: l.montant_ht,
          tva_montant: l.tva_montant,
          montant_ttc: l.montant_ttc,
          date_prevue: dates[i],
          rappel_actif: true,
          rappel_client_email: rappelsClient[i],
        })),
      })
      add('Échéancier créé avec succès')
      onCreated()
    } catch (e: any) {
      add(e.message || "Erreur lors de la création de l'échéancier", 'error')
    }
  }

  const canSubmit = !!validation?.valide && dates.every(Boolean) && !create.isPending

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Créer un échéancier de paiement</span>
          <button className="btn-icon sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Récapitulatif devis */}
          <div style={{ padding: '14px 16px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)', marginBottom: 18, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--t2)' }}>Devis</span>
              <strong>{devis.numero}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--t2)' }}>Client</span>
              <strong>{[devis.client?.nom, devis.client?.prenom].filter(Boolean).join(' ')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--t2)' }}>Montant HT / TVA</span>
              <span>{eur(devis.total_ht)} / {eur(devis.tva_montant)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--b0)', marginTop: 4 }}>
              <span style={{ fontWeight: 700 }}>Total TTC</span>
              <strong>{eur(devis.total_ttc)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t2)', fontSize: 12, marginTop: 2 }}>
              <span>Déjà payé / Reste à payer</span>
              <span>{eur(0)} / {eur(devis.total_ttc)}</span>
            </div>
          </div>

          {/* Nombre de paiements */}
          <div className="form-group">
            <label>Nombre de paiements</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  type="button"
                  className={n === nombreEcheances ? 'btn btn-primary' : 'btn btn-secondary'}
                  style={{ flex: 1 }}
                  onClick={() => setNombreEcheances(n)}
                >
                  {n} {n === 1 ? 'paiement' : 'paiements'}
                </button>
              ))}
            </div>
          </div>

          {/* Mode de répartition */}
          <div className="form-group">
            <label>Mode de répartition</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={mode === 'egale' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setMode('egale')}>Répartition égale</button>
              <button type="button" className={mode === 'pourcentages' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setMode('pourcentages')}>Pourcentages personnalisés</button>
              <button type="button" className={mode === 'montants' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setMode('montants')}>Montants personnalisés</button>
            </div>
          </div>

          {/* Acompte rapide */}
          {nombreEcheances >= 2 && (
            <div className="form-group">
              <label>Pourcentage de l'acompte</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {POURCENTAGES_ACOMPTE_RAPIDES.map(p => (
                  <button key={p} type="button" className="btn btn-secondary" style={{ flex: '0 0 auto' }} onClick={() => applyAcompteRapide(p)}>
                    {p} %
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Détail des échéances */}
          <div className="form-group">
            <label>Échéances</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: nombreEcheances }).map((_, i) => {
                const dernier = i === nombreEcheances - 1
                const ligne = lignesCalculees?.[i]
                return (
                  <div key={i} style={{ padding: 12, background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <input
                        data-testid={`echeance-libelle-${i}`}
                        value={libelles[i] || ''}
                        onChange={e => setLibelles(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                        style={{ flex: 1, fontWeight: 700 }}
                        placeholder={LIBELLES_PAR_DEFAUT[nombreEcheances][i]}
                      />
                      <span data-testid={`echeance-montant-preview-${i}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', minWidth: 90, textAlign: 'right' }}>
                        {ligne ? eur(ligne.montant_ttc) : '—'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {mode === 'pourcentages' && (
                        dernier ? (
                          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{ligne?.pourcentage.toFixed(2)} % (solde, calculé automatiquement)</span>
                        ) : (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)' }}>
                            %
                            <input
                              data-testid={`echeance-pct-${i}`}
                              type="number" min={0} max={100} step={0.01}
                              value={pourcentagesEdit[i] ?? 0}
                              onChange={e => setPourcentagesEdit(prev => { const n = [...prev]; n[i] = Number(e.target.value); return n })}
                              style={{ width: 80 }}
                            />
                          </label>
                        )
                      )}
                      {mode === 'montants' && (
                        dernier ? (
                          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{eur(ligne?.montant_ttc || 0)} (solde, calculé automatiquement)</span>
                        ) : (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)' }}>
                            €
                            <input
                              data-testid={`echeance-montant-input-${i}`}
                              type="number" min={0} step={0.01}
                              value={montantsEdit[i] ?? 0}
                              onChange={e => setMontantsEdit(prev => { const n = [...prev]; n[i] = Number(e.target.value); return n })}
                              style={{ width: 100 }}
                            />
                          </label>
                        )
                      )}
                      {mode === 'egale' && (
                        <span style={{ fontSize: 12, color: 'var(--t3)' }}>{ligne?.pourcentage.toFixed(2)} %</span>
                      )}

                      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {[[0, "Aujourd'hui"], [7, '+7j'], [15, '+15j'], [30, '+30j']].map(([offset, lbl]) => (
                          <button
                            key={lbl as string}
                            type="button"
                            className="btn btn-secondary sm"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            onClick={() => setDates(prev => { const n = [...prev]; n[i] = dateDecalage(offset as number); return n })}
                          >
                            {lbl}
                          </button>
                        ))}
                        <input
                          data-testid={`echeance-date-${i}`}
                          type="date"
                          value={dates[i] || ''}
                          onChange={e => setDates(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                          style={{ width: 140 }}
                        />
                      </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)', marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={rappelsClient[i] ?? true}
                        onChange={e => setRappelsClient(prev => { const n = [...prev]; n[i] = e.target.checked; return n })}
                      />
                      Rappel client par e-mail activé
                    </label>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Note interne */}
          <div className="form-group">
            <label>Note interne sur le paiement</label>
            <textarea rows={2} value={noteInterne} onChange={e => setNoteInterne(e.target.value)} placeholder="Visible uniquement en interne, sauf si coché ci-dessous" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)', marginTop: 6 }}>
              <input type="checkbox" checked={noteVisibleClient} onChange={e => setNoteVisibleClient(e.target.checked)} />
              Rendre cette note visible sur les documents envoyés au client
            </label>
          </div>

          {(error || (validation && !validation.valide)) && (
            <div data-testid="echeancier-validation-errors" style={{ padding: '10px 14px', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 8, fontSize: 12, color: 'var(--rdTx)' }}>
              {error ? <div>{error}</div> : validation?.erreurs.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" data-testid="echeancier-submit" className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            {create.isPending ? 'Création…' : "Créer l'échéancier"}
          </button>
        </div>
      </div>
    </div>
  )
}
