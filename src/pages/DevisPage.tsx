// src/pages/DevisPage.tsx
import { useNavigate } from 'react-router-dom'
import { useDevis, useDeleteDevis, useDevisToFacture, useUpdateDevis, useParametres } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import type { Devis } from '@/types'

const SC: Record<string, string> = { brouillon: 'pill-gray', envoye: 'pill-amber', accepte: 'pill-green', refuse: 'pill-red', expire: 'pill-orange' }

export default function DevisPage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const { data: devis = [], isLoading, isError, error } = useDevis()
  const toFacture = useDevisToFacture()
  const del = useDeleteDevis()
  const upd = useUpdateDevis()

  async function handlePDF(d: Devis) {
    if (!params) { add('Allez dans Parametres et remplissez les infos entreprise', 'warning'); return }
    try {
      add('Generation PDF...', 'info')
      const blob = await generateDevisPDF(d, params, d.modele_id || 0)
      downloadBlob(blob, `${d.numero}.pdf`)
      add('PDF telecharge')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
  }

  async function handleToFacture(id: string) {
    if (!confirm('Convertir ce devis en facture ?')) return
    try { await toFacture.mutateAsync(id); add('Facture creee — visible dans l onglet Factures') }
    catch (e: any) { add(e.message, 'error') }
  }

  async function handleSend(id: string) {
    try { await upd.mutateAsync({ id, statut: 'envoye', envoye_le: new Date().toISOString() }); add('Devis marque comme envoye') }
    catch (e: any) { add(e.message, 'error') }
  }

  async function handleDel(id: string) {
    if (!confirm('Supprimer ce devis ?')) return
    try { await del.mutateAsync(id); add('Devis supprime') }
    catch (e: any) { add(e.message, 'error') }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title">Devis</h1>
          <p className="page-subtitle">{devis.length} devis</p>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/devis/nouveau')}>+ Nouveau devis</button>
      </div>
      {isError && (
        <div style={{ padding:'10px 14px',background:'var(--rdBg)',border:'1px solid var(--rdBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:12,color:'var(--rdTx)' }}>
          ⚠ Erreur : {(error as Error)?.message} — Vérifiez les politiques RLS dans Supabase.
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>N°</th><th>Client</th><th>Activite</th><th>Total TTC</th><th>Statut</th><th>Date</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement...</td></tr>}
            {!isLoading && devis.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>
                Aucun devis — <button className="btn btn-primary btn-sm" onClick={() => nav('/devis/nouveau')}>Creer le premier</button>
              </td></tr>
            )}
            {devis.map(d => (
              <tr key={d.id}>
                <td className="td-bold">{d.numero}</td>
                <td className="td-bold">{d.client?.nom} {d.client?.prenom}</td>
                <td>{d.activite ? <span className={`pill ${d.activite === 'serrurerie' ? 'pill-gray' : 'pill-blue'}`}>{d.activite}</span> : '—'}</td>
                <td className="td-bold">{d.total_ttc ? d.total_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}</td>
                <td><span className={`pill ${SC[d.statut] || 'pill-gray'}`}>{d.statut}</span></td>
                <td style={{ fontSize: 11 }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                <td>
                  <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => nav(`/devis/${d.id}/editer`)}>✏ Editer</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handlePDF(d)}>📄 PDF</button>
                    {d.statut === 'brouillon' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleSend(d.id)}>✉ Envoyer</button>
                    )}
                    {['accepte', 'envoye'].includes(d.statut) && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleToFacture(d.id)} disabled={toFacture.isPending}>→ Facture</button>
                    )}
                    {d.statut === 'brouillon' && isAdmin && (
                      <button className="btn-icon sm" style={{ color: 'var(--rdTx)' }} onClick={() => handleDel(d.id)}>🗑</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
