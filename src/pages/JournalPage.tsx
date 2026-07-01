// src/pages/JournalPage.tsx
import { useState, useMemo } from 'react'
import { useJournal, useDeleteJournalEntry, useDeleteAllJournal, useUpdateJournalEntry, useInterventions, useDevis, useFactures, useCommissionsData, useClients } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { exportJournalPremium, exportRapportComplet } from '@/lib/exportPremium'
import ConfirmModal from '@/components/ConfirmModal'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'
import type { JournalEntry } from '@/types'

const ns = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const ACTION_CLS: Record<string, string> = {
  creation: 'pill-blue', modification: 'pill-amber', suppression: 'pill-red', paiement: 'pill-green'
}

const TABLE_LABELS: Record<string, string> = {
  devis: 'Devis', factures: 'Factures', interventions: 'Interventions',
  clients: 'Clients', utilisateurs: 'Utilisateurs', commissions: 'Commissions'
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function fmtDateShort(iso: string) {
  try { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function extractFields(obj: Record<string, unknown> | null | undefined) {
  if (!obj) return {}
  return {
    numero: obj.numero as string || '',
    statut: (obj.statut || obj.statut_paiement) as string || '',
    client: [obj.nom, obj.prenom].filter(Boolean).join(' ') || obj.client_nom as string || '',
    email: obj.email as string || '',
    telephone: obj.telephone as string || '',
    adresse: (obj.adresse_intervention || obj.adresse) as string || '',
    montant: (obj.total_ttc || obj.montant_ttc || obj.montant) as number || 0,
    type: obj.type as string || '',
    description: obj.description as string || '',
    date: obj.created_at as string || obj.date_emission as string || '',
    iban: obj.iban as string || '',
  }
}

function summarize(obj: Record<string, unknown> | null | undefined): string {
  const f = extractFields(obj)
  const parts = [
    f.numero && `N° ${f.numero}`,
    f.client && `${f.client}`,
    f.statut && `${f.statut}`,
    f.montant && `${f.montant.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`,
    f.type && `${f.type}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : (obj ? JSON.stringify(obj).slice(0, 60) : '—')
}

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function getPeriodStart(period: string): Date | null {
  const now = new Date()
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'week') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

const PERIOD_LABELS: Record<string, string> = {
  today: "Aujourd'hui", week: 'Cette semaine', month: 'Ce mois', all: 'Tout'
}

export default function JournalPage() {
  const { user } = useAuthStore()
  const { data: journal = [], isLoading } = useJournal()
  const delOne = useDeleteJournalEntry()
  const delAll = useDeleteAllJournal()
  const updDesc = useUpdateJournalEntry()
  const { add } = useToastStore()

  // Data for rapport export and stats
  const { data: interventions = [] } = useInterventions()
  const { data: devis = [] } = useDevis()
  const { data: factures = [] } = useFactures()
  const { data: clients = [] } = useClients()
  const { data: commissionsData } = useCommissionsData()
  const commItems = commissionsData?.items ?? []

  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('tous')
  const [filterTable, setFilterTable] = useState('tous')
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [showMobileActions, setShowMobileActions] = useState(false)

  const periodStart = useMemo(() => getPeriodStart(filterPeriod), [filterPeriod])

  const tables = [...new Set(journal.map(j => j.table_name))].sort()
  const actions = ['creation', 'modification', 'suppression', 'paiement']

  const filtered = journal.filter(j => {
    if (periodStart && new Date(j.created_at) < periodStart) return false
    if (filterAction !== 'tous' && j.action !== filterAction) return false
    if (filterTable !== 'tous' && j.table_name !== filterTable) return false
    if (search && !ns(JSON.stringify(j)).includes(ns(search))) return false
    return true
  })

  // Stats responsive au filtre de période
  const statsStart = periodStart || new Date(0)
  const statsInter = interventions.filter(i => new Date(i.created_at) >= statsStart).length
  const statsDevis = devis.filter(d => new Date(d.created_at) >= statsStart).length
  const statsFact = factures.filter(f => new Date(f.created_at) >= statsStart).length
  const statsCA = factures
    .filter(f => f.statut_paiement === 'payee' && f.date_paiement && new Date(f.date_paiement) >= statsStart)
    .reduce((s, f) => s + (f.montant_ttc || 0), 0)

  function handleDelete(id: string) {
    setConfirmDialog({
      message: 'Supprimer cette entrée du journal ?',
      action: async () => {
        try { await delOne.mutateAsync(id); add('Entrée supprimée') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleDeleteAll() {
    if (!journal.length) { add('Aucune entrée à supprimer', 'warning'); return }
    setConfirmDialog({
      message: `Supprimer toutes les ${journal.length} entrée${journal.length > 1 ? 's' : ''} du journal ?\nCette action est irréversible.`,
      action: async () => {
        try { await delAll.mutateAsync(); add('Journal vidé') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function openEdit(j: JournalEntry) {
    setEditEntry(j)
    setEditDesc(j.description || '')
  }

  async function handleSaveEdit() {
    if (!editEntry) return
    try {
      await updDesc.mutateAsync({ id: editEntry.id, description: editDesc })
      add('Note sauvegardée')
      setEditEntry(null)
    } catch (e: any) { add(e.message, 'error') }
  }

  async function handleExport() {
    try {
      const ctx = { user: user ? { nom: user.nom, prenom: user.prenom } : null }
      await exportJournalPremium(filtered, ctx)
    } catch (e: any) { add('Erreur export : ' + e.message, 'error') }
  }

  async function handleExportRapport() {
    setIsExporting(true)
    try {
      const ctx = { user: user ? { nom: user.nom, prenom: user.prenom } : null }
      await exportRapportComplet({
        devis, factures, clients, commissions: commItems, interventions, journal,
      }, ctx)
      add('📊 Rapport complet exporté')
    } catch (e: any) {
      add(e.message || 'Erreur export rapport', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div>
      {/* En-tête */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal d'activité</h1>
          <p className="page-subtitle">{journal.length} entrées · Qui a fait quoi, quand</p>
        </div>
        {/* Desktop : inchangé */}
        <div className="page-actions hide-mobile">
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filtered.length === 0}>
            📊 Journal ({filtered.length})
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportRapport} disabled={isExporting}>
            {isExporting ? '⏳ Export…' : '📊 Rapport complet'}
          </button>
          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
            onClick={handleDeleteAll} disabled={journal.length === 0 || delAll.isPending}>
            🗑 Vider
          </button>
        </div>
        {/* Mobile : ligne compacte sous le titre */}
        <div className="show-mobile" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setShowMobileActions(true)}
            >
              ··· Actions
            </button>
          </div>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-value">{statsInter}</div>
          <div className="stat-label">Interventions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{statsDevis}</div>
          <div className="stat-label">Devis</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{statsFact}</div>
          <div className="stat-label">Factures</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: 16 }}>{eur(statsCA)} €</div>
          <div className="stat-label">CA TTC payé</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['today', 'week', 'month', 'all'] as const).map(p => (
            <button
              key={p}
              className={`btn btn-sm ${filterPeriod === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterPeriod(p)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="search-bar" style={{ flex: 1, minWidth: 150, maxWidth: 260 }}>
          <span style={{ color: 'var(--t3)', fontSize: 15 }}>🔍</span>
          <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} style={{ border:'none',background:'none',color:'var(--t3)',cursor:'pointer',padding:'0 2px',fontSize:16,lineHeight:1,flexShrink:0 }}>✕</button>
          )}
        </div>
        <select className="btn btn-secondary btn-sm" style={{ padding: '5px 10px', width: 'auto' }} value={filterAction} onChange={e => setFilterAction(e.target.value)}>
          <option value="tous">Toutes actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="btn btn-secondary btn-sm" style={{ padding: '5px 10px', width: 'auto' }} value={filterTable} onChange={e => setFilterTable(e.target.value)}>
          <option value="tous">Toutes tables</option>
          {tables.map(t => <option key={t} value={t}>{TABLE_LABELS[t] || t}</option>)}
        </select>
      </div>

      {/* MOBILE : cards */}
      <div className="show-mobile">
        {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom: 12 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : 'Aucune entrée'}
          </div>
        )}
        {filtered.map(j => {
          const resume = summarize(j.new_value as any) || summarize(j.old_value as any)
          return (
            <div key={j.id} className="mobile-card">
              <div className="mobile-card-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span className={`pill ${ACTION_CLS[j.action] || 'pill-gray'}`}>{j.action}</span>
                    <span style={{ fontSize: 12, color: 'var(--blTx)', fontWeight: 500 }}>{TABLE_LABELS[j.table_name] || j.table_name}</span>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--t0)', fontWeight: 500, marginBottom: 4 }}>{resume}</div>
                  {j.description && <div style={{ fontSize: 12, color: 'var(--am)', marginTop: 2 }}>📝 {j.description}</div>}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--t2)' }}>{fmtDateShort(j.created_at)}</div>
                  {j.user_nom && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{j.user_nom}</div>}
                </div>
              </div>
              <div className="mobile-card-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(j)}>✏ Note</button>
                <button className="btn-icon sm" style={{ color: 'var(--rdTx)' }} onClick={() => handleDelete(j.id)}>🗑</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* DESKTOP : table */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th><th>Utilisateur</th><th>Action</th><th>Table</th>
              <th>Résumé</th><th>Note</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</td></tr>}
            {filtered.length === 0 && !isLoading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                {search.trim() ? <><span>Aucun résultat — </span><button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button></> : 'Aucune entrée'}
              </td></tr>
            )}
            {filtered.map(j => (
              <tr key={j.id}>
                <td style={{ fontSize: 11, color: 'var(--t2)', whiteSpace: 'nowrap' }}>{fmtDate(j.created_at)}</td>
                <td style={{ fontSize: 12 }}>{j.user_nom || '—'}</td>
                <td><span className={`pill ${ACTION_CLS[j.action] || 'pill-gray'}`}>{j.action}</span></td>
                <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--blTx)' }}>{TABLE_LABELS[j.table_name] || j.table_name}</td>
                <td style={{ fontSize: 11, color: 'var(--t1)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summarize(j.new_value as any) || summarize(j.old_value as any)}
                </td>
                <td style={{ fontSize: 11, color: 'var(--t2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {j.description || <span style={{ color: 'var(--t3)' }}>—</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(j)} title="Ajouter une note">✏</button>
                    <button className="btn-icon sm" style={{ color: 'var(--rdTx)' }} onClick={() => handleDelete(j.id)} title="Supprimer">🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Actions globales mobile ─────────────────────── */}
      {showMobileActions && (
        <DocSheet title="Actions" onClose={() => setShowMobileActions(false)}>
          <SheetRow
            icon="📊"
            label={`Journal Excel (${filtered.length})`}
            sublabel={filtered.length === 0 ? 'Aucune entrée' : `${filtered.length} entrée${filtered.length > 1 ? 's' : ''}`}
            onClick={() => { setShowMobileActions(false); handleExport() }}
            disabled={filtered.length === 0}
          />
          <SheetRow
            icon="📊"
            label="Rapport complet"
            sublabel="Dashboard + toutes les données"
            onClick={() => { setShowMobileActions(false); handleExportRapport() }}
            disabled={isExporting}
          />
          {journal.length > 0 && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon="🗑️"
                label="Vider le journal"
                sublabel={`Supprimer les ${journal.length} entrée${journal.length > 1 ? 's' : ''}`}
                danger
                onClick={() => { setShowMobileActions(false); handleDeleteAll() }}
                disabled={delAll.isPending}
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
        />
      )}

      {/* MODAL NOTE */}
      {editEntry && (
        <div className="modal-overlay" onClick={() => setEditEntry(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Modifier la note</span>
              <button className="btn-icon sm" onClick={() => setEditEntry(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12 }}>
                {TABLE_LABELS[editEntry.table_name] || editEntry.table_name} · {editEntry.action} · {fmtDate(editEntry.created_at)}
              </p>
              <div style={{ background: 'var(--s2)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--t2)', marginBottom: 14 }}>
                {summarize(editEntry.new_value as any) || summarize(editEntry.old_value as any)}
              </div>
              <div className="form-group">
                <label>Note</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                  placeholder="Ajouter une note sur cet événement…" rows={4} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditEntry(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={updDesc.isPending}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
