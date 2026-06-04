// src/pages/FacturesPage.tsx
import { useFactures, useUpdateFacture, useParametres } from '@/lib/hooks'
import { useToastStore, useParamsStore } from '@/lib/store'
import { generateFacturePDF, downloadBlob } from '@/lib/pdf/generator'
import { envoyerEmail } from '@/lib/supabase/auth'
import type { Facture } from '@/types'

const SC: Record<string, string> = { payee: 'pill-green', impayee: 'pill-red', acompte: 'pill-purple', partiel: 'pill-amber', annulee: 'pill-gray' }
const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export default function FacturesPage() {
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const { data: factures = [], isLoading, isError, error } = useFactures()
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

  async function handleEmail(f: Facture) {
    const email = f.client?.email
    if (!email) { add('Ce client n\'a pas d\'adresse email', 'warning'); return }
    if (!params) { add('Configurez les infos entreprise dans Parametres', 'warning'); return }
    add('Preparation email...', 'info')
    try {
      const blob = await generateFacturePDF(f, f.devis || null, params)
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const pdfBase64 = btoa(binary)
      const estPayee = f.statut_paiement === 'payee'
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#1e3a5f">Facture ${f.numero}</h2>
        <p>Bonjour ${f.client?.prenom || ''} ${f.client?.nom || ''},</p>
        <p>Veuillez trouver ci-joint votre facture <strong>${f.numero}</strong> d'un montant de <strong>${(f.montant_ttc||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</strong>.</p>
        ${!estPayee && f.date_echeance ? `<p>Date d'échéance : <strong>${new Date(f.date_echeance).toLocaleDateString('fr-FR')}</strong>.</p>` : ''}
        ${params.iban ? `<p>Virement bancaire :<br><strong>IBAN : ${params.iban}</strong>${params.bic ? ` — BIC : ${params.bic}` : ''}</p>` : ''}
        <p>Merci pour votre confiance.</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
        <p style="font-size:12px;color:#6b7280">${params.raison_sociale} — ${params.telephone || ''} — ${params.email || ''}</p>
      </div>`
      const { error } = await envoyerEmail({ to: email, subject: `Facture ${f.numero} — ${params.raison_sociale}`, html, pdfBase64, pdfFilename: `${f.numero}.pdf` })
      if (error) add('Erreur: ' + error, 'error')
      else add(`Facture envoyée à ${email}`)
    } catch (e: any) { add('Erreur: ' + e.message, 'error') }
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
      {isError && (
        <div style={{ padding:'10px 14px',background:'var(--rdBg)',border:'1px solid var(--rdBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:12,color:'var(--rdTx)' }}>
          ⚠ Erreur : {(error as Error)?.message} — Vérifiez les politiques RLS dans Supabase.
        </div>
      )}
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
                      {f.client?.email && <button className="btn btn-secondary btn-sm" onClick={() => handleEmail(f)} title={`Envoyer à ${f.client?.email}`}>✉ Email</button>}
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
