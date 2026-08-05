// src/components/EcheancierSection.tsx
// Section "Échéancier de paiement" affichée sur la fiche devis.
import { useState } from 'react'
import type { Devis, Echeance } from '@/types'
import { useEcheancierByDevis, useGenerateFactureEcheance } from '@/lib/hooks/echeancier'
import { STATUT_ECHEANCE_LABELS, STATUT_ECHEANCE_COULEURS, STATUT_ECHEANCE_ICONES } from '@/lib/echeancier'
import { useToastStore } from '@/lib/store'
import EcheancierCreateModal from './EcheancierCreateModal'
import PaiementCreateModal from './PaiementCreateModal'

const PAYABLE_STATUTS = ['en_attente_paiement', 'paiement_partiel', 'en_retard', 'impaye']

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

interface Props {
  devis: Devis
  canManage: boolean
}

export default function EcheancierSection({ devis, canManage }: Props) {
  const { data: echeancier, isLoading, refetch } = useEcheancierByDevis(devis.id)
  const { add } = useToastStore()
  const generateFacture = useGenerateFactureEcheance(devis.id)
  const [showCreate, setShowCreate] = useState(false)
  const [paiementEcheance, setPaiementEcheance] = useState<Echeance | null>(null)

  async function handleGenerateFacture(echeanceId: string) {
    try {
      await generateFacture.mutateAsync(echeanceId)
      add('Facture générée avec succès')
      refetch()
    } catch (e: any) {
      add(e.message || 'Erreur lors de la génération de la facture', 'error')
    }
  }

  const eligible = canManage && !['refuse', 'expire'].includes(devis.statut)

  if (isLoading) return null
  if (!eligible && !echeancier) return null

  return (
    <div className="card card-body" data-testid="echeancier-section" style={{ maxWidth: 760, margin: '16px auto 0' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)', marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid var(--b1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📅 Échéancier de paiement</span>
        {!echeancier && canManage && (
          <button data-testid="echeancier-open-create" className="btn btn-primary sm" onClick={() => setShowCreate(true)}>
            Créer un échéancier / acompte
          </button>
        )}
      </div>

      {!echeancier ? (
        <div style={{ fontSize: 13, color: 'var(--t3)' }}>
          Aucun échéancier pour ce devis. Gérez un acompte et jusqu'à 4 paiements.
        </div>
      ) : (
        <>
          {/* Progression */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--t2)', marginBottom: 6 }}>
              <span data-testid="echeancier-pct-encaisse">{Math.round((echeancier.montant_paye / (echeancier.montant_ttc || 1)) * 100)}% encaissé</span>
              <span data-testid="echeancier-montant-restant">{eur(echeancier.montant_restant)} restant</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--s1)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, background: 'var(--gn, #16a34a)',
                width: `${Math.min(100, Math.max(0, (echeancier.montant_paye / (echeancier.montant_ttc || 1)) * 100))}%`,
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--t2)', marginBottom: 14, flexWrap: 'wrap' }}>
            <span>Total : <strong style={{ color: 'var(--t0)' }}>{eur(echeancier.montant_ttc)}</strong></span>
            <span>Payé : <strong style={{ color: 'var(--t0)' }}>{eur(echeancier.montant_paye)}</strong></span>
            <span>Statut : <span data-testid="echeancier-statut-global" className={STATUT_ECHEANCE_COULEURS[echeancier.statut]} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
              {STATUT_ECHEANCE_ICONES[echeancier.statut]} {STATUT_ECHEANCE_LABELS[echeancier.statut]}
            </span></span>
          </div>

          {/* Liste des échéances */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(echeancier.echeances || []).map(e => (
              <div key={e.id} data-testid={`echeance-row-${e.numero_ordre}`} style={{ padding: '10px 12px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{e.libelle}</div>
                    <div data-testid={`echeance-date-prevue-${e.numero_ordre}`} style={{ fontSize: 11, color: 'var(--t3)' }}>
                      Prévu le {new Date(e.date_prevue).toLocaleDateString('fr-FR')} · {e.pourcentage.toFixed(2)} %
                      {e.montant_paye > 0 && ` · ${eur(e.montant_paye)} payé`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span data-testid={`echeance-montant-${e.numero_ordre}`} style={{ fontSize: 13, fontWeight: 700 }}>{eur(e.montant_ttc)}</span>
                    <span data-testid={`echeance-statut-${e.numero_ordre}`} className={STATUT_ECHEANCE_COULEURS[e.statut]} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {STATUT_ECHEANCE_ICONES[e.statut]} {STATUT_ECHEANCE_LABELS[e.statut]}
                    </span>
                  </div>
                </div>
                {canManage && (e.statut === 'a_facturer' || PAYABLE_STATUTS.includes(e.statut)) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {e.statut === 'a_facturer' && (
                      <button
                        data-testid={`echeance-generer-facture-${e.numero_ordre}`}
                        className="btn btn-secondary sm"
                        style={{ fontSize: 12 }}
                        disabled={generateFacture.isPending}
                        onClick={() => handleGenerateFacture(e.id)}
                      >
                        {generateFacture.isPending ? 'Génération…' : '🧾 Générer la facture'}
                      </button>
                    )}
                    {PAYABLE_STATUTS.includes(e.statut) && (
                      <button data-testid={`echeance-enregistrer-paiement-${e.numero_ordre}`} className="btn btn-primary sm" style={{ fontSize: 12 }} onClick={() => setPaiementEcheance(e)}>
                        💳 Enregistrer un paiement
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {paiementEcheance && (
        <PaiementCreateModal
          echeance={paiementEcheance}
          onClose={() => setPaiementEcheance(null)}
          onSaved={() => { setPaiementEcheance(null); refetch() }}
        />
      )}

      {showCreate && (
        <EcheancierCreateModal
          devis={devis}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch() }}
        />
      )}
    </div>
  )
}
