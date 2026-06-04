// src/pages/JournalPage.tsx
import { useState } from 'react'
import { useJournal, useDeleteJournalEntry, useDeleteAllJournal, useUpdateJournalEntry } from '@/lib/hooks'
import { useToastStore } from '@/lib/store'
import type { JournalEntry } from '@/types'

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
    f.client && `Client: ${f.client}`,
    f.statut && `Statut: ${f.statut}`,
    f.montant && `Montant: ${f.montant.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`,
    f.type && `Type: ${f.type}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : (obj ? JSON.stringify(obj).slice(0, 80) : '—')
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function JournalPage() {
  const { data: journal = [], isLoading } = useJournal()
  const delOne = useDeleteJournalEntry()
  const delAll = useDeleteAllJournal()
  const updDesc = useUpdateJournalEntry()
  const { add } = useToastStore()

  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('tous')
  const [filterTable, setFilterTable] = useState('tous')
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null)
  const [editDesc, setEditDesc] = useState('')

  const tables = [...new Set(journal.map(j => j.table_name))].sort()
  const actions = ['creation', 'modification', 'suppression', 'paiement']

  const filtered = journal.filter(j => {
    if (filterAction !== 'tous' && j.action !== filterAction) return false
    if (filterTable !== 'tous' && j.table_name !== filterTable) return false
    if (search && !JSON.stringify(j).toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette entrée du journal ?')) return
    try { await delOne.mutateAsync(id); add('Entrée supprimée') }
    catch (e: any) { add(e.message, 'error') }
  }

  async function handleDeleteAll() {
    if (!confirm(`Supprimer toutes les ${filtered.length} entrées affichées ?\nCette action est irréversible.`)) return
    try { await delAll.mutateAsync(); add('Journal effacé') }
    catch (e: any) { add(e.message, 'error') }
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

  function handleExport() {
    const headers = [
      'Date', 'Utilisateur', 'Action', 'Table',
      'N° Document', 'Statut', 'Client', 'Email', 'Téléphone',
      'Adresse', 'Montant TTC (€)', 'Type', 'Description', 'Note'
    ]
    const rows = filtered.map(j => {
      const nv = extractFields(j.new_value as any)
      const ov = extractFields(j.old_value as any)
      const numero = nv.numero || ov.numero
      const statut = nv.statut || ov.statut
      const client = nv.client || ov.client
      const email = nv.email || ov.email
      const telephone = nv.telephone || ov.telephone
      const adresse = nv.adresse || ov.adresse
      const montant = nv.montant || ov.montant
      const type = nv.type || ov.type
      const description = nv.description || ov.description
      return [
        fmtDate(j.created_at),
        j.user_nom || '',
        j.action,
        TABLE_LABELS[j.table_name] || j.table_name,
        numero,
        statut,
        client,
        email,
        telephone,
        adresse,
        montant ? montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '',
        type,
        description,
        j.description || ''
      ]
    })
    downloadCSV([headers, ...rows], `journal-${new Date().toISOString().split('T')[0]}.csv`)
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="page-title">Journal d'activité</h1>
          <p className="page-subtitle">{journal.length} entrées · Qui a fait quoi, quand</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleExport} disabled={filtered.length === 0}>
            📥 Exporter ({filtered.length})
          </button>
          <button className="btn btn-secondary" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
            onClick={handleDeleteAll} disabled={filtered.length === 0 || delAll.isPending}>
            🗑 Supprimer tout
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-bar" style={{ flex: 1, maxWidth: 260 }}>
          <span style={{ color: 'var(--t3)', fontSize: 15 }}>🔍</span>
          <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="btn btn-secondary btn-sm" style={{ padding: '5px 10px' }} value={filterAction} onChange={e => setFilterAction(e.target.value)}>
          <option value="tous">Toutes actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="btn btn-secondary btn-sm" style={{ padding: '5px 10px' }} value={filterTable} onChange={e => setFilterTable(e.target.value)}>
          <option value="tous">Toutes tables</option>
          {tables.map(t => <option key={t} value={t}>{TABLE_LABELS[t] || t}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th><th>Utilisateur</th><th>Action</th><th>Table</th>
              <th>Résumé</th><th>Note</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</td></tr>}
            {filtered.length === 0 && !isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Aucune entrée</td></tr>}
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

      {/* MODAL EDIT NOTE */}
      {editEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 480, padding: 28 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Modifier la note</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--t2)' }}>
              {TABLE_LABELS[editEntry.table_name] || editEntry.table_name} · {editEntry.action} · {fmtDate(editEntry.created_at)}
            </p>
            <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--t2)', marginBottom: 16 }}>
              {summarize(editEntry.new_value as any) || summarize(editEntry.old_value as any)}
            </div>
            <textarea
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Ajouter une note sur cet événement…"
              rows={4}
              style={{ width: '100%', resize: 'vertical', borderRadius: 6, border: '1px solid var(--bd)', padding: '10px 12px', fontSize: 13, background: 'var(--bg1)', color: 'var(--t0)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setEditEntry(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={updDesc.isPending}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
