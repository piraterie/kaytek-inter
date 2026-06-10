// src/pages/DevisPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDevis, useDeleteDevis, useDeleteAllDevis, useDevisToFacture, useUpdateDevis, useParametres, notifyUser } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import ConfirmModal from '@/components/ConfirmModal'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import EmailDevisModal from '@/components/EmailDevisModal'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'
import type { Devis } from '@/types'

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

const SC: Record<string, string> = {
  en_attente_validation: 'pill-amber', brouillon: 'pill-gray', envoye: 'pill-blue',
  accepte: 'pill-green', refuse: 'pill-red', expire: 'pill-orange'
}
const SL: Record<string, string> = {
  en_attente_validation: 'À valider', brouillon: 'Brouillon', envoye: 'Envoyé',
  accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré'
}
const chkStyle: React.CSSProperties = { width: 18, height: 18, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--bl)' }

const STATUTS = ['tous', 'en_attente_validation', 'brouillon', 'envoye', 'accepte', 'refuse', 'expire']

export default function DevisPage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const canCreateDocs = isAdmin || user?.can_create_documents === true
  const canSendEmail = isAdmin || (user?.can_create_documents === true && user?.can_bypass_validation === true)

  const { data: devis = [], isLoading, isError, error } = useDevis()
  const toFacture = useDevisToFacture()
  const del = useDeleteDevis()
  const delAll = useDeleteAllDevis()
  const upd = useUpdateDevis()

  const [filterStatut, setFilterStatut] = useState('tous')
  const [emailDevis, setEmailDevis] = useState<Devis | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [activeSheet, setActiveSheet] = useState<Devis | null>(null)

  const filtered = filterStatut === 'tous' ? devis : devis.filter(d => d.statut === filterStatut)
  const pendingCount = devis.filter(d => d.statut === 'en_attente_validation').length

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(d => d.id)))
  }
  function exitSelection() { setSelected(new Set()); setSelectionMode(false) }

  async function handlePDF(d: Devis) {
    if (!params) { add('Allez dans Parametres et remplissez les infos entreprise', 'warning'); return }
    try {
      add('Generation PDF...', 'info')
      const blob = await generateDevisPDF(d, params, d.modele_id || params?.modele_pdf_defaut || 0)
      downloadBlob(blob, `${d.numero}.pdf`)
      add('PDF telecharge')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
  }

  function handleEmail(d: Devis) {
    if (!d.client?.email) { add('Ce client n\'a pas d\'adresse email', 'warning'); return }
    if (!params) { add('Configurez les infos entreprise dans Parametres', 'warning'); return }
    setEmailDevis(d)
  }

  function handleToFacture(devisId: string) {
    setConfirmDialog({
      message: 'Convertir ce devis en facture ?',
      action: async () => {
        try { await toFacture.mutateAsync(devisId); add('Facture créée — visible dans l\'onglet Factures') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  async function handleSend(id: string) {
    try { await upd.mutateAsync({ id, statut: 'envoye', envoye_le: new Date().toISOString() }); add('Devis marque comme envoye') }
    catch (e: any) { add(e.message, 'error') }
  }

  function handleDel(id: string) {
    setConfirmDialog({
      message: 'Supprimer ce devis ?',
      action: async () => {
        try { await del.mutateAsync(id); add('Devis supprimé') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleDeleteSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment supprimer les devis sélectionnés ?\n${ids.length} devis seront supprimés. Cette action est irréversible.`,
      action: async () => {
        try { await delAll.mutateAsync(ids); add(`${ids.length} devis supprimé${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleVider() {
    if (!devis.length) { add('Aucun devis à supprimer', 'warning'); return }
    setConfirmDialog({
      message: 'Voulez-vous vraiment supprimer tous les devis ?\nCette action est irréversible.',
      action: async () => {
        try { await delAll.mutateAsync(devis.map(d => d.id)); add('Tous les devis ont été supprimés') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleExportCSV() {
    const rows = [
      ['Numéro', 'Client', 'Activité', 'Total HT', 'Total TTC', 'Statut', 'Date'],
      ...filtered.map(d => [
        d.numero,
        `${d.client?.nom || ''} ${d.client?.prenom || ''}`.trim(),
        d.activite || '—',
        String(d.total_ht || 0),
        String(d.total_ttc || 0),
        d.statut,
        new Date(d.created_at).toLocaleDateString('fr-FR')
      ])
    ]
    downloadCSV(rows, `devis-${new Date().toISOString().split('T')[0]}.csv`)
  }

  async function handleValidate(d: Devis) {
    try {
      await upd.mutateAsync({ id: d.id, statut: 'brouillon' })
      add('Devis validé — maintenant visible dans la liste')
      const intervenantId = (d as any).intervenant_id || d.intervenant?.id || d.created_by
      if (intervenantId) {
        notifyUser(intervenantId, '✅ Devis validé', `Votre devis ${d.numero} a été validé. Vous pouvez le présenter au client pour signature.`, `/devis/${d.id}/apercu`).catch(() => {})
      }
    } catch (e: any) { add(e.message, 'error') }
  }

  async function handleReject(d: Devis) {
    try {
      await upd.mutateAsync({ id: d.id, statut: 'refuse' })
      add('Devis refusé')
      const intervenantId = (d as any).intervenant_id || d.intervenant?.id || d.created_by
      if (intervenantId) {
        notifyUser(intervenantId, '❌ Devis refusé', `Votre devis ${d.numero} a été refusé par l'administrateur.`, `/devis/${d.id}/apercu`).catch(() => {})
      }
    } catch (e: any) { add(e.message, 'error') }
  }

  const eur = (n?: number | null) => n ? n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR')

  return (
    <>
      {/* ── En-tête ─────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Devis</h1>
            <p className="page-subtitle">
              {devis.length} devis
              {pendingCount > 0 && <span style={{ color: 'var(--amTx)', fontWeight: 600 }}> · {pendingCount} à valider</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn btn-secondary btn-sm hide-mobile" onClick={handleExportCSV} disabled={filtered.length === 0}>📥 CSV</button>
            {isAdmin && !selectionMode && filtered.length > 0 && (
              <button className="btn btn-secondary btn-sm hide-mobile" onClick={() => setSelectionMode(true)}>☑ Sélectionner</button>
            )}
            {isAdmin && devis.length > 0 && (
              <button className="btn btn-secondary btn-sm hide-mobile" style={{ color: 'var(--rdTx)' }} onClick={handleVider} disabled={delAll.isPending}>
                🗑 Vider
              </button>
            )}
            {!isAdmin && (
              <button className="btn btn-secondary btn-sm" onClick={() => nav('/interventions')}>← Interventions</button>
            )}
            {canCreateDocs && (
              <button className="btn btn-primary" onClick={() => nav('/devis/nouveau')}>+ Nouveau</button>
            )}
          </div>
        </div>

        {/* Bannière : devis à valider */}
        {isAdmin && pendingCount > 0 && (
          <button
            onClick={() => setFilterStatut('en_attente_validation')}
            style={{
              marginTop: 14, display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '13px 18px',
              background: 'var(--amBg)', border: '1px solid var(--amBd)',
              borderRadius: 'var(--r2)', cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ fontSize: 20 }}>⏳</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--amTx)' }}>
                {pendingCount} devis en attente de validation
              </div>
              <div style={{ fontSize: 12, color: 'var(--amTx)', opacity: 0.75, marginTop: 1 }}>
                Appuyer pour filtrer
              </div>
            </div>
          </button>
        )}
      </div>

      {/* ── Barre de sélection ──────────────────────────── */}
      {selectionMode && (
        <div style={{
          background: 'var(--blBg)', border: '1px solid var(--blBd)',
          borderRadius: 'var(--r2)', padding: '10px 16px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
        }}>
          <input type="checkbox" style={chkStyle} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blTx)', flex: 1 }}>
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          {selected.size > 0 && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleDeleteSelected} disabled={delAll.isPending}>
              🗑 Supprimer la sélection
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exitSelection}>✕ Annuler</button>
        </div>
      )}

      {/* ── Filtres ─────────────────────────────────────── */}
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        {STATUTS.map(s => (
          <button key={s}
            onClick={() => { setFilterStatut(s); setSelected(new Set()) }}
            className={`btn btn-sm ${filterStatut === s ? 'btn-primary' : 'btn-secondary'}`}>
            {s === 'tous' ? 'Tous' : SL[s] || s}
          </button>
        ))}
      </div>

      {isError && (
        <div style={{ padding: '10px 14px', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 'var(--r2)', marginBottom: 12, fontSize: 12, color: 'var(--rdTx)' }}>
          ⚠ Erreur : {(error as Error)?.message}
        </div>
      )}

      {/* ── MOBILE : cartes épurées ──────────────────────── */}
      <div className="show-mobile">
        {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t3)' }}>
            {canCreateDocs
              ? <><p style={{ marginBottom: 16 }}>Aucun devis</p><button className="btn btn-primary" onClick={() => nav('/devis/nouveau')}>Créer le premier</button></>
              : 'Aucun devis'}
          </div>
        )}
        {filtered.map(d => (
          <div
            key={d.id}
            onClick={() => selectionMode ? toggleSelect(d.id) : setActiveSheet(d)}
            style={{
              background: selected.has(d.id) ? 'var(--blBg)' : 'var(--s0)',
              borderRadius: 20,
              padding: '16px 18px',
              marginBottom: 10,
              boxShadow: selected.has(d.id) ? '0 0 0 2px var(--bl)' : 'var(--sh0)',
              cursor: 'pointer',
              transition: 'box-shadow .15s, transform .12s',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {selectionMode && (
              <div style={{ marginBottom: 10 }}>
                <input type="checkbox" style={chkStyle} checked={selected.has(d.id)}
                  onChange={() => toggleSelect(d.id)} onClick={e => e.stopPropagation()} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>{d.numero}</span>
                  {d.statut === 'en_attente_validation' && (
                    <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--amBg)', color: 'var(--amTx)', borderRadius: 100, fontWeight: 700 }}>
                      À valider
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: 'var(--t1)' }}>{d.client?.nom} {d.client?.prenom}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>{fmtDate(d.created_at)}</div>
                {isAdmin && d.intervenant && (
                  <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>👤 {d.intervenant.prenom} {d.intervenant.nom}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t0)', marginBottom: 6 }}>{eur(d.total_ttc)}</div>
                <span className={`pill ${SC[d.statut] || 'pill-gray'}`}>{SL[d.statut] || d.statut}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── DESKTOP : table ──────────────────────────────── */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectionMode && <th style={{ width: 40, paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} /></th>}
              <th>N°</th><th>Client</th><th>Activité</th><th>Total TTC</th><th>Statut</th>
              {isAdmin && <th>Intervenant</th>}
              <th>Date</th><th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={selectionMode ? 9 : 8} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={selectionMode ? 9 : 8} style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>
                {canCreateDocs
                  ? <><span>Aucun devis — </span><button className="btn btn-primary btn-sm" onClick={() => nav('/devis/nouveau')}>Créer le premier</button></>
                  : 'Aucun devis'}
              </td></tr>
            )}
            {filtered.map(d => (
              <tr key={d.id} style={{
                ...(d.statut === 'en_attente_validation' ? { background: 'var(--amBg)' } : {}),
                ...(selected.has(d.id) ? { background: 'var(--blBg)' } : {}),
              }}>
                {selectionMode && (
                  <td style={{ paddingRight: 0 }}>
                    <input type="checkbox" style={chkStyle} checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                  </td>
                )}
                <td className="td-bold">{d.numero}</td>
                <td className="td-bold">{d.client?.nom} {d.client?.prenom}</td>
                <td>{d.activite ? <span className={`pill ${d.activite === 'serrurerie' ? 'pill-gray' : 'pill-blue'}`}>{d.activite}</span> : '—'}</td>
                <td className="td-bold">{eur(d.total_ttc)}</td>
                <td><span className={`pill ${SC[d.statut] || 'pill-gray'}`}>{SL[d.statut] || d.statut}</span></td>
                {isAdmin && <td style={{ fontSize: 12 }}>{d.intervenant?.nom ? `${d.intervenant.prenom} ${d.intervenant.nom}` : '—'}</td>}
                <td style={{ fontSize: 12 }}>{fmtDate(d.created_at)}</td>
                <td>
                  <button
                    className="btn-icon sm"
                    onClick={() => setActiveSheet(d)}
                    title="Actions"
                    style={{ fontSize: 18, letterSpacing: 1 }}
                  >
                    ···
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Bottom sheet actions ─────────────────────────── */}
      {activeSheet && (
        <DocSheet
          title={activeSheet.numero}
          subtitle={[activeSheet.client?.nom, activeSheet.client?.prenom].filter(Boolean).join(' ')}
          onClose={() => setActiveSheet(null)}
        >
          {/* Navigation */}
          <SheetRow
            icon="👁"
            label="Voir le devis"
            sublabel="Aperçu et signature client"
            onClick={() => { nav(`/devis/${activeSheet.id}/apercu`); setActiveSheet(null) }}
          />

          {/* Édition — admin */}
          {isAdmin && (
            <SheetRow
              icon="✏️"
              label="Modifier"
              onClick={() => { nav(`/devis/${activeSheet.id}/editer`); setActiveSheet(null) }}
            />
          )}

          {/* Validation admin — si en attente */}
          {isAdmin && activeSheet.statut === 'en_attente_validation' && (
            <>
              <SheetSection label="Validation" />
              <SheetRow
                icon="✅"
                label="Valider ce devis"
                sublabel="Le devis sera transmis pour signature"
                onClick={() => { setActiveSheet(null); handleValidate(activeSheet) }}
                disabled={upd.isPending}
              />
              <SheetRow
                icon="❌"
                label="Refuser ce devis"
                danger
                onClick={() => { setActiveSheet(null); handleReject(activeSheet) }}
                disabled={upd.isPending}
              />
            </>
          )}

          {/* Conversion en facture */}
          {isAdmin && ['accepte', 'envoye'].includes(activeSheet.statut) && (
            <>
              <SheetSection label="Conversion" />
              <SheetRow
                icon="🧾"
                label="Transformer en facture"
                sublabel="Crée une facture liée à ce devis"
                onClick={() => { setActiveSheet(null); handleToFacture(activeSheet.id) }}
                disabled={toFacture.isPending}
              />
            </>
          )}

          {/* Marquer envoyé */}
          {isAdmin && activeSheet.statut === 'brouillon' && (
            <SheetRow
              icon="✉️"
              label="Marquer comme envoyé"
              onClick={() => { setActiveSheet(null); handleSend(activeSheet.id) }}
              disabled={upd.isPending}
            />
          )}

          {/* Document */}
          <SheetSection label="Document" />
          {isAdmin && (
            <SheetRow
              icon="📄"
              label="Exporter PDF"
              onClick={() => { setActiveSheet(null); handlePDF(activeSheet) }}
            />
          )}
          {canSendEmail && activeSheet.client?.email && (
            <SheetRow
              icon="📧"
              label="Envoyer par email"
              sublabel={activeSheet.client.email}
              onClick={() => { setActiveSheet(null); handleEmail(activeSheet) }}
            />
          )}

          {/* Danger */}
          {isAdmin && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon="🗑️"
                label="Supprimer ce devis"
                danger
                onClick={() => { setActiveSheet(null); handleDel(activeSheet.id) }}
              />
            </>
          )}
        </DocSheet>
      )}

      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          onConfirm={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
          loading={toFacture.isPending}
        />
      )}

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
