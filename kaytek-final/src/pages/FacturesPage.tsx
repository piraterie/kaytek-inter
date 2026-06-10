// src/pages/FacturesPage.tsx
import { useFactures, useUpdateFacture, useParametres } from '@/lib/hooks'
import { useToastStore, useParamsStore } from '@/lib/store'
import { generateFacturePDF, downloadBlob } from '@/lib/pdf/generator'
import type { Facture } from '@/types'

const SC: Record<string, string> = { payee: 'pill-green', impayee: 'pill-red', acompte: 'pill-purple', partiel: 'pill-amber', annulee: 'pill-gray' }
const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export default function FacturesPage() {
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const { data: factures = [], isLoading } = useFactures()
  const upd = useUpdateFacture()

  async function markPaid(id: string, mode: string) {
    try {
      await upd.mutateAsync({ id, statut_paiement: 'payee', mode_paiement: mode as any, date_paiement: new Date().toISOString() })
      add('Facture marquee payee')
    } catch (e: any) { add(e.message, 'error') }
  }

  async function dlPDF(f: Facture) {
    if (!params) { add('Parametres entreprise manquants — allez dans Parametres', 'warning'); return }
    try {
      add('Generation PDF...', 'info')
      const blob = await generateFacturePDF(f, f.devis || null, params)
      downloadBlob(blob, `${f.numero}.pdf`)
      add('PDF telecharge')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
  }

  const impaye = factures.filter(f => f.statut_paiement === 'impayee').reduce((s, f) => s + f.montant_ttc, 0)
  const paye = factures.filter(f => f.statut_paiement === 'payee').reduce((s, f) => s + f.montant_ttc, 0)

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title">Factures</h1>
        <p className="page-subtitle">{factures.length} facture{factures.length > 1 ? 's' : ''}</p>
      </div>
      <div className="grid-3 mb-4">
        <div className="stat-card"><div className="stat-icon green">💶</div><div className="stat-value">{eur(paye)}</div><div className="stat-label">Encaisse</div></div>
        <div className="stat-card"><div className="stat-icon red">⚠</div><div className="stat-value">{eur(impaye)}</div><div className="stat-label">Impaye</div></div>
        <div className="stat-card"><div className="stat-icon blue">📄</div><div className="stat-value">{factures.length}</div><div className="stat-label">Total factures</div></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>N°</th><th>Client</th><th>Date</th><th>Echeance</th><th>Montant TTC</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement...</td></tr>}
            {!isLoading && factures.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Aucune facture</td></tr>}
            {factures.map(f => {
              const enRetard = f.date_echeance && new Date(f.date_echeance) < new Date() && f.statut_paiement !== 'payee'
              return (
                <tr key={f.id}>
                  <td className="td-bold">{f.numero}</td>
                  <td className="td-bold">{f.client?.nom} {f.client?.prenom}</td>
                  <td style={{ fontSize: 11 }}>{new Date(f.date_emission).toLocaleDateString('fr-FR')}</td>
                  <td style={{ fontSize: 11, color: enRetard ? 'var(--rdTx)' : 'inherit', fontWeight: enRetard ? 600 : 400 }}>
                    {f.date_echeance ? new Date(f.date_echeance).toLocaleDateString('fr-FR') : '—'}
                    {enRetard && ' ⚠'}
                  </td>
                  <td className="td-bold">{eur(f.montant_ttc)}</td>
                  <td><span className={`pill ${SC[f.statut_paiement] || 'pill-gray'}`}>{f.statut_paiement}</span></td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      <button className="btn btn-secondary btn-sm" onClick={() => dlPDF(f)}>📄 PDF</button>
                      {f.statut_paiement !== 'payee' && (
                        <select style={{ fontSize: 11, padding: '4px 8px', width: 'auto', minHeight: 'auto' }}
                          defaultValue="" onChange={e => { if (e.target.value) markPaid(f.id, e.target.value) }}>
                          <option value="">Marquer payee...</option>
                          <option value="especes">Especes</option>
                          <option value="cb">CB</option>
                          <option value="virement">Virement</option>
                          <option value="cheque">Cheque</option>
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
