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
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const pdfBase64 = btoa(binary)
      const logoHtml = params.logo_url
        ? `<img src="${params.logo_url}" alt="Logo" style="height:56px;margin-bottom:10px;"/>`
        : `<div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px;">K</div>`
      const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- HEADER -->
        <div style="background:#1e3a5f;padding:32px 40px;text-align:center;">
          ${logoHtml}
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;margin-top:6px;">${params.raison_sociale || 'KAYTEK SERRURE'}</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div>
        </div>
        <div style="background:#e85d04;height:4px;"></div>

        <!-- BADGE DEVIS -->
        <div style="background:#f8fafc;padding:24px 40px 0;text-align:center;">
          <div style="display:inline-block;background:#1e3a5f;color:#fff;font-size:13px;font-weight:700;padding:6px 20px;border-radius:20px;letter-spacing:1px;">DEVIS ${d.numero}</div>
        </div>

        <!-- BODY -->
        <div style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">Bonjour <strong>${d.client?.prenom || ''} ${d.client?.nom || ''}</strong>,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            Nous avons le plaisir de vous adresser votre devis pour nos prestations de <strong>${d.activite || 'serrurerie'}</strong>.
            Veuillez trouver ci-joint le document correspondant.
          </p>

          <!-- MONTANT -->
          <div style="background:#f8fafc;border-left:4px solid #e85d04;border-radius:6px;padding:20px 24px;margin:24px 0;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Montant total TTC</div>
            <div style="font-size:28px;font-weight:700;color:#1e3a5f;">${(d.total_ttc||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</div>
            ${d.valide_jusqu_au ? `<div style="font-size:12px;color:#e85d04;margin-top:8px;">⏳ Devis valable jusqu'au <strong>${new Date(d.valide_jusqu_au).toLocaleDateString('fr-FR')}</strong></div>` : ''}
          </div>

          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            Pour accepter ce devis, il vous suffit de nous le retourner signé avec la mention <em>« Bon pour accord »</em>,
            ou de nous contacter directement.
          </p>
          <p style="margin:0;font-size:15px;color:#374151;">
            Nous restons à votre disposition pour toute question ou information complémentaire.
          </p>
          <p style="margin:16px 0 0;font-size:15px;color:#374151;">Cordialement,</p>
          <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#1e3a5f;">${params.raison_sociale || 'Kaytek Serrure'}</p>
        </div>

        <!-- FOOTER -->
        <div style="background:#1e3a5f;padding:20px 40px;text-align:center;">
          <div style="color:rgba(255,255,255,0.85);font-size:12px;line-height:1.8;">
            ${params.adresse ? `📍 ${params.adresse}${params.code_postal ? ', ' + params.code_postal : ''}${params.ville ? ' ' + params.ville : ''}<br/>` : ''}
            ${params.telephone ? `📞 ${params.telephone}` : ''}${params.telephone && params.email ? '  ·  ' : ''}${params.email ? `✉ ${params.email}` : ''}
            ${params.siret ? `<br/><span style="color:rgba(255,255,255,0.5);font-size:11px;">SIRET : ${params.siret}</span>` : ''}
          </div>
        </div>
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
