// src/pages/DevisPage.tsx
import { useNavigate } from 'react-router-dom'
import { useDevis, useDeleteDevis, useDevisToFacture, useUpdateDevis, useParametres } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import { envoyerEmail } from '@/lib/supabase/auth'
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

  async function handleEmail(d: Devis) {
    const email = d.client?.email
    if (!email) { add('Ce client n\'a pas d\'adresse email', 'warning'); return }
    if (!params) { add('Configurez les infos entreprise dans Parametres', 'warning'); return }
    add('Preparation email...', 'info')
    try {
      const blob = await generateDevisPDF(d, params, d.modele_id || 0)
      const buf = await blob.arrayBuffer()
      const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1e3a5f">Devis ${d.numero}</h2>
        <p>Bonjour ${d.client?.prenom || ''} ${d.client?.nom || ''},</p>
        <p>Veuillez trouver ci-joint votre devis <strong>${d.numero}</strong> pour un montant de <strong>${(d.total_ttc||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</strong>.</p>
        ${d.valide_jusqu_au ? `<p>Ce devis est valable jusqu'au <strong>${new Date(d.valide_jusqu_au).toLocaleDateString('fr-FR')}</strong>.</p>` : ''}
        <p>N'hésitez pas à nous contacter pour toute question.</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
        <p style="font-size:12px;color:#6b7280">${params.raison_sociale} — ${params.telephone || ''} — ${params.email || ''}</p>
      </div>`
      const { error } = await envoyerEmail({ to: email, subject: `Devis ${d.numero} — ${params.raison_sociale}`, html, pdfBase64, pdfFilename: `${d.numero}.pdf` })
      if (error) add('Erreur: ' + error, 'error')
      else { add(`Devis envoyé à ${email}`); upd.mutateAsync({ id: d.id, statut: 'envoye', envoye_le: new Date().toISOString() }) }
    } catch (e: any) { add('Erreur: ' + e.message, 'error') }
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
                    {d.client?.email && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleEmail(d)} title={`Envoyer à ${d.client?.email}`}>✉ Email</button>
                    )}
                    {d.statut === 'brouillon' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleSend(d.id)}>Marquer envoyé</button>
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
