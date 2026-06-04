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
      const logoHtml = params.logo_url
        ? `<img src="${params.logo_url}" alt="Logo" style="height:56px;margin-bottom:10px;"/>`
        : `<div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px;">K</div>`
      const accentColor = estPayee ? '#16a34a' : '#e85d04'
      const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- HEADER -->
        <div style="background:#1e3a5f;padding:32px 40px;text-align:center;">
          ${logoHtml}
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;margin-top:6px;">${params.raison_sociale || 'KAYTEK SERRURE'}</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div>
        </div>
        <div style="background:${accentColor};height:4px;"></div>

        <!-- BADGE FACTURE -->
        <div style="background:#f8fafc;padding:24px 40px 0;text-align:center;">
          <div style="display:inline-block;background:#1e3a5f;color:#fff;font-size:13px;font-weight:700;padding:6px 20px;border-radius:20px;letter-spacing:1px;">FACTURE ${f.numero}</div>
          ${estPayee ? `<div style="display:inline-block;margin-left:10px;background:#dcfce7;color:#16a34a;font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;">✓ PAYÉE</div>` : ''}
        </div>

        <!-- BODY -->
        <div style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">Bonjour <strong>${f.client?.prenom || ''} ${f.client?.nom || ''}</strong>,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            Veuillez trouver ci-joint votre facture pour nos prestations de serrurerie.
            ${estPayee ? 'Nous vous confirmons que cette facture a bien été réglée. Merci pour votre paiement.' : 'Merci de procéder au règlement avant la date d\'échéance indiquée.'}
          </p>

          <!-- MONTANT -->
          <div style="background:#f8fafc;border-left:4px solid ${accentColor};border-radius:6px;padding:20px 24px;margin:24px 0;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Montant total TTC</div>
            <div style="font-size:28px;font-weight:700;color:#1e3a5f;">${(f.montant_ttc||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</div>
            ${!estPayee && f.date_echeance ? `<div style="font-size:12px;color:#e85d04;margin-top:8px;">⏳ À régler avant le <strong>${new Date(f.date_echeance).toLocaleDateString('fr-FR')}</strong></div>` : ''}
            ${estPayee && f.date_paiement ? `<div style="font-size:12px;color:#16a34a;margin-top:8px;">✓ Réglée le ${new Date(f.date_paiement).toLocaleDateString('fr-FR')}</div>` : ''}
          </div>

          ${!estPayee && params.iban ? `
          <!-- COORDONNEES BANCAIRES -->
          <div style="background:#eff6ff;border-left:4px solid #1e3a5f;border-radius:6px;padding:16px 20px;margin:0 0 24px;">
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Coordonnées bancaires</div>
            <div style="font-size:14px;color:#1e3a5f;font-weight:600;">IBAN : ${params.iban}</div>
            ${params.bic ? `<div style="font-size:13px;color:#374151;margin-top:4px;">BIC : ${params.bic}</div>` : ''}
          </div>` : ''}

          <p style="margin:0 0 4px;font-size:15px;color:#374151;">Nous vous remercions de votre confiance et restons disponibles pour toute question.</p>
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
