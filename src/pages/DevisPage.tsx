// src/pages/DevisPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDevis, useDeleteDevis, useDeleteAllDevis, useDevisToFacture, useUpdateDevis, useParametres, notifyUser } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import EmailDevisModal from '@/components/EmailDevisModal'
import type { Devis } from '@/types'

const SC: Record<string, string> = { en_attente_validation: 'pill-amber', brouillon: 'pill-gray', envoye: 'pill-blue', accepte: 'pill-green', refuse: 'pill-red', expire: 'pill-orange' }
const SL: Record<string, string> = { en_attente_validation: '⏳ Validation', brouillon: 'Brouillon', envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré' }

export default function DevisPage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const canCreateDocs = isAdmin || user?.can_create_documents === true
  const { data: devis = [], isLoading, isError, error } = useDevis()
  const toFacture = useDevisToFacture()
  const del = useDeleteDevis()
  const delAll = useDeleteAllDevis()
  const upd = useUpdateDevis()
  const [filterStatut, setFilterStatut] = useState('tous')
  const [emailDevis, setEmailDevis] = useState<Devis | null>(null)

  async function handlePDF(d: Devis) {
    if (!params) { add('Allez dans Parametres et remplissez les infos entreprise', 'warning'); return }
    try {
      add('Generation PDF...', 'info')
      const blob = await generateDevisPDF(d, params, d.modele_id || 0)
      downloadBlob(blob, `${d.numero}.pdf`)
      add('PDF telecharge')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
  }

  function handleEmail(d: Devis) {
    if (!d.client?.email) { add('Ce client n\'a pas d\'adresse email', 'warning'); return }
    if (!params) { add('Configurez les infos entreprise dans Parametres', 'warning'); return }
    setEmailDevis(d)
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
    try { await del.mutateAsync(id); add('Devis supprimé') }
    catch (e: any) { add(e.message, 'error') }
  }

  async function handleDelAll() {
    const ids = filtered.map(d => d.id)
    if (!confirm(`Supprimer les ${ids.length} devis affichés ?\nCette action est irréversible.`)) return
    try { await delAll.mutateAsync(ids); add(`${ids.length} devis supprimés`) }
    catch (e: any) { add(e.message, 'error') }
  }

  const STATUTS = ['tous', 'en_attente_validation', 'brouillon', 'envoye', 'accepte', 'refuse', 'expire']
  const filtered = filterStatut === 'tous' ? devis : devis.filter(d => d.statut === filterStatut)
  const pendingCount = devis.filter(d => d.statut === 'en_attente_validation').length

  async function handleValidate(d: Devis) {
    try {
      await upd.mutateAsync({ id: d.id, statut: 'brouillon' })
      add('Devis validé — maintenant visible dans la liste')
      const intervenantId = (d as any).intervenant_id || d.intervenant?.id || d.created_by
      if (intervenantId) {
        notifyUser(
          intervenantId,
          '✅ Devis validé',
          `Votre devis ${d.numero} a été validé. Vous pouvez le présenter au client pour signature.`,
          `/devis/${d.id}/apercu`
        ).catch(() => {})
      }
    } catch (e: any) { add(e.message, 'error') }
  }
  async function handleReject(d: Devis) {
    try {
      await upd.mutateAsync({ id: d.id, statut: 'refuse' })
      add('Devis refusé')
      const intervenantId = (d as any).intervenant_id || d.intervenant?.id || d.created_by
      if (intervenantId) {
        notifyUser(
          intervenantId,
          '❌ Devis refusé',
          `Votre devis ${d.numero} a été refusé par l'administrateur.`,
          `/devis/${d.id}/apercu`
        ).catch(() => {})
      }
    } catch (e: any) { add(e.message, 'error') }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title">Devis</h1>
          <p className="page-subtitle">{devis.length} devis</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreateDocs && <button className="btn btn-primary" onClick={() => nav('/devis/nouveau')}>+ Nouveau devis</button>}
          {!isAdmin && <button className="btn btn-secondary" onClick={() => nav('/interventions')}>← Mes interventions</button>}
          {isAdmin && pendingCount > 0 && (
            <button className="btn btn-secondary" style={{ color:'var(--amTx)',borderColor:'var(--amBd)',background:'var(--amBg)' }}
              onClick={() => setFilterStatut('en_attente_validation')}>
              ⏳ {pendingCount} devis à valider
            </button>
          )}
          {isAdmin && filtered.length > 0 && (
            <button className="btn btn-secondary" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleDelAll} disabled={delAll.isPending}>
              🗑 Supprimer tout ({filtered.length})
            </button>
          )}
        </div>
      </div>
      <div className="filter-bar" style={{ marginBottom: 12 }}>
        <select className="btn btn-secondary btn-sm" style={{ padding: '5px 10px' }} value={filterStatut} onChange={e => setFilterStatut(e.target.value)}>
          {STATUTS.map(s => <option key={s} value={s}>{s === 'tous' ? 'Tous les statuts' : s}</option>)}
        </select>
      </div>
      {isError && (
        <div style={{ padding:'10px 14px',background:'var(--rdBg)',border:'1px solid var(--rdBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:12,color:'var(--rdTx)' }}>
          ⚠ Erreur : {(error as Error)?.message} — Vérifiez les politiques RLS dans Supabase.
        </div>
      )}
      {/* MOBILE : cards — visible uniquement sur mobile via CSS */}
      <div className="show-mobile">
        {isLoading && <div style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement...</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign:'center',padding:32,color:'var(--t3)' }}>
            {canCreateDocs
              ? <>Aucun devis — <button className="btn btn-primary btn-sm" onClick={() => nav('/devis/nouveau')}>Créer le premier</button></>
              : 'Aucun devis'}
          </div>
        )}
        {filtered.map(d => (
          <div key={d.id} className="mobile-card">
            <div className="mobile-card-row">
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700,fontSize:15,color:'var(--t0)' }}>{d.numero}</div>
                <div style={{ fontSize:13,color:'var(--t1)',marginTop:3 }}>{d.client?.nom} {d.client?.prenom}</div>
                {isAdmin && d.intervenant && (
                  <div style={{ fontSize:12,color:'var(--t2)',marginTop:2 }}>👤 {d.intervenant.prenom} {d.intervenant.nom}</div>
                )}
                <div style={{ fontSize:12,color:'var(--t3)',marginTop:2 }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</div>
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontWeight:700,fontSize:15,color:'var(--t0)',marginBottom:6 }}>{d.total_ttc ? d.total_ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}) : '—'}</div>
                <span className={`pill ${SC[d.statut]||'pill-gray'}`}>{SL[d.statut]||d.statut}</span>
              </div>
            </div>
            <div className="mobile-card-actions">
              {isAdmin && d.statut==='en_attente_validation' && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => handleValidate(d)} disabled={upd.isPending}>✓ Valider</button>
                  <button className="btn btn-secondary btn-sm" style={{ color:'var(--rdTx)' }} onClick={() => handleReject(d)} disabled={upd.isPending}>✕ Refuser</button>
                </>
              )}
              {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => nav(`/devis/${d.id}/editer`)}>✏ Éditer</button>}
              {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => handlePDF(d)}>📄 PDF</button>}
              {!isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => nav(`/devis/${d.id}/apercu`)}>👁 Aperçu</button>}
              {isAdmin && d.client?.email && <button className="btn btn-secondary btn-sm" onClick={() => handleEmail(d)}>✉</button>}
              {isAdmin && d.statut==='brouillon' && <button className="btn btn-secondary btn-sm" onClick={() => handleSend(d.id)}>Envoyé</button>}
              {isAdmin && ['accepte','envoye'].includes(d.statut) && <button className="btn btn-primary btn-sm" onClick={() => handleToFacture(d.id)} disabled={toFacture.isPending}>→ Facture</button>}
              {isAdmin && <button className="btn-icon sm" style={{ color:'var(--rdTx)' }} onClick={() => handleDel(d.id)}>🗑</button>}
            </div>
          </div>
        ))}
      </div>
      {/* DESKTOP : table — cachée sur mobile via CSS */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>N°</th><th>Client</th><th>Activité</th><th>Total TTC</th><th>Statut</th><th>Intervenant</th><th>Date</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement...</td></tr>}
            {!isLoading && filtered.length===0 && (
              <tr><td colSpan={8} style={{ textAlign:'center',padding:32,color:'var(--t3)' }}>
                {canCreateDocs
                  ? <>Aucun devis — <button className="btn btn-primary btn-sm" onClick={() => nav('/devis/nouveau')}>Créer le premier</button></>
                  : 'Aucun devis'}
              </td></tr>
            )}
            {filtered.map(d => (
              <tr key={d.id} style={d.statut==='en_attente_validation'?{background:'var(--amBg)'}:{}}>
                <td className="td-bold">{d.numero}</td>
                <td className="td-bold">{d.client?.nom} {d.client?.prenom}</td>
                <td>{d.activite ? <span className={`pill ${d.activite==='serrurerie'?'pill-gray':'pill-blue'}`}>{d.activite}</span> : '—'}</td>
                <td className="td-bold">{d.total_ttc ? d.total_ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}) : '—'}</td>
                <td><span className={`pill ${SC[d.statut]||'pill-gray'}`}>{SL[d.statut]||d.statut}</span></td>
                <td style={{ fontSize:12 }}>{d.intervenant?.nom ? `${d.intervenant.prenom} ${d.intervenant.nom}` : '—'}</td>
                <td style={{ fontSize:12 }}>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                <td>
                  <div className="flex gap-1" style={{ flexWrap:'wrap' }}>
                    {isAdmin && d.statut==='en_attente_validation' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => handleValidate(d)} disabled={upd.isPending}>✓ Valider</button>
                        <button className="btn btn-secondary btn-sm" style={{ color:'var(--rdTx)' }} onClick={() => handleReject(d)} disabled={upd.isPending}>✕ Refuser</button>
                      </>
                    )}
                    {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => nav(`/devis/${d.id}/editer`)}>✏ Éditer</button>}
                    {isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => handlePDF(d)}>📄 PDF</button>}
                    {!isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => nav(`/devis/${d.id}/apercu`)}>👁 Aperçu</button>}
                    {isAdmin && d.client?.email && <button className="btn btn-secondary btn-sm" onClick={() => handleEmail(d)}>✉ Email</button>}
                    {isAdmin && d.statut==='brouillon' && <button className="btn btn-secondary btn-sm" onClick={() => handleSend(d.id)}>Marquer envoyé</button>}
                    {isAdmin && ['accepte','envoye'].includes(d.statut) && <button className="btn btn-primary btn-sm" onClick={() => handleToFacture(d.id)} disabled={toFacture.isPending}>→ Facture</button>}
                    {isAdmin && <button className="btn-icon sm" style={{ color:'var(--rdTx)' }} onClick={() => handleDel(d.id)}>🗑</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {emailDevis && params && (
        <EmailDevisModal
          devis={emailDevis}
          params={params}
          onClose={() => setEmailDevis(null)}
          onSent={() => {
            add(`Devis envoyé à ${emailDevis.client?.email}`)
            upd.mutateAsync({ id: emailDevis.id, statut: 'envoye', envoye_le: new Date().toISOString() })
              .then(() => {
                const intervenantId = (emailDevis as any).intervenant_id || emailDevis.intervenant?.id || emailDevis.created_by
                if (intervenantId) {
                  notifyUser(
                    intervenantId,
                    '✉ Devis envoyé au client',
                    `Le devis ${emailDevis.numero} a été envoyé au client, en attente de signature.`,
                    `/devis/${emailDevis.id}/apercu`
                  ).catch(() => {})
                }
              })
            setEmailDevis(null)
          }}
        />
      )}
    </>
  )
}
