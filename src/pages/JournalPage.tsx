// src/pages/JournalPage.tsx
import { useState } from 'react'
import { useJournal } from '@/lib/hooks'

const ACTION_CLS: Record<string,string> = {
  creation:'pill-blue',modification:'pill-amber',suppression:'pill-red',paiement:'pill-green'
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function JournalPage() {
  const { data: journal = [], isLoading } = useJournal()
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('tous')
  const [filterTable, setFilterTable] = useState('tous')

  const tables = [...new Set(journal.map(j => j.table_name))].sort()
  const actions = ['creation','modification','suppression','paiement']

  const filtered = journal.filter(j => {
    if (filterAction !== 'tous' && j.action !== filterAction) return false
    if (filterTable !== 'tous' && j.table_name !== filterTable) return false
    if (search && !JSON.stringify(j).toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function handleExport() {
    const rows = [
      ['Date', 'Utilisateur', 'Action', 'Table', 'Ancienne valeur', 'Nouvelle valeur'],
      ...filtered.map(j => [
        new Date(j.created_at).toLocaleString('fr-FR'),
        j.user_nom || '',
        j.action,
        j.table_name,
        j.old_value ? JSON.stringify(j.old_value) : '',
        j.new_value ? JSON.stringify(j.new_value) : ''
      ])
    ]
    downloadCSV(rows, `journal-${new Date().toISOString().split('T')[0]}.csv`)
  }

  return (
    <div>
      <div style={{ marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:10 }}>
        <div>
          <h1 className="page-title">Journal d'activité</h1>
          <p className="page-subtitle">{journal.length} entrées · Qui a fait quoi, quand</p>
        </div>
        <button className="btn btn-secondary" onClick={handleExport} disabled={filtered.length === 0}>
          📥 Exporter Excel ({filtered.length})
        </button>
      </div>
      <div className="filter-bar">
        <div className="search-bar" style={{ flex:1,maxWidth:260 }}>
          <span style={{ color:'var(--t3)',fontSize:15 }}>🔍</span>
          <input placeholder="Rechercher…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <select className="btn btn-secondary btn-sm" style={{ padding:'5px 10px' }} value={filterAction} onChange={e=>setFilterAction(e.target.value)}>
          <option value="tous">Toutes actions</option>
          {actions.map(a=><option key={a} value={a}>{a}</option>)}
        </select>
        <select className="btn btn-secondary btn-sm" style={{ padding:'5px 10px' }} value={filterTable} onChange={e=>setFilterTable(e.target.value)}>
          <option value="tous">Toutes tables</option>
          {tables.map(t=><option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Table</th><th>Ancienne valeur</th><th>Nouvelle valeur</th></tr></thead>
          <tbody>
            {isLoading&&<tr><td colSpan={6} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement…</td></tr>}
            {filtered.length===0&&!isLoading&&<tr><td colSpan={6} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Aucune entrée</td></tr>}
            {filtered.map(j=>(
              <tr key={j.id}>
                <td style={{ fontSize:11,color:'var(--t2)',whiteSpace:'nowrap' }}>{new Date(j.created_at).toLocaleString('fr-FR')}</td>
                <td style={{ fontSize:12 }}>{j.user_nom||'—'}</td>
                <td><span className={`pill ${ACTION_CLS[j.action]||'pill-gray'}`}>{j.action}</span></td>
                <td style={{ fontSize:11,fontFamily:'monospace',color:'var(--blTx)' }}>{j.table_name}</td>
                <td style={{ fontSize:10,color:'var(--t2)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                  {j.old_value ? JSON.stringify(j.old_value).slice(0,80)+'…' : '—'}
                </td>
                <td style={{ fontSize:10,color:'var(--t0)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                  {j.new_value ? JSON.stringify(j.new_value).slice(0,80)+'…' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
