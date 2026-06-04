// src/pages/InterventionsPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterventions, useCreateIntervention, useClients, useProfiles } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'

const SC: Record<string,string> = { en_attente:'pill-amber',accepte:'pill-blue',en_cours:'pill-orange',termine:'pill-green',facture:'pill-purple',annule:'pill-gray',refuse:'pill-red' }

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

export default function InterventionsPage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const [statut, setStatut] = useState('tous')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const { data: items = [], isLoading, isError, error } = useInterventions({ statut, search })
  const { data: clients = [] } = useClients()
  const { data: profiles = [] } = useProfiles()
  const create = useCreateIntervention()
  const [form, setForm] = useState({ client_id:'', intervenant_id:'', type:'serrurerie' as 'serrurerie'|'vitrerie', urgence:false, adresse:'', description:'', date_prevue:'', notes_admin:'' })

  function handleExport() {
    const rows = [
      ['Numéro','Client','Intervenant','Type','Date prévue','Montant TTC','Statut','Adresse','Description'],
      ...items.map(i => [
        i.numero, `${i.client?.nom || ''} ${i.client?.prenom || ''}`.trim(),
        `${i.intervenant?.prenom || ''} ${i.intervenant?.nom || ''}`.trim(),
        i.type || '', i.date_prevue ? new Date(i.date_prevue).toLocaleDateString('fr-FR') : '',
        i.montant_ttc ? String(i.montant_ttc) : '', i.statut, i.adresse || '', i.description || ''
      ])
    ]
    downloadCSV(rows, `interventions-${new Date().toISOString().split('T')[0]}.csv`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_id) { add('Selectionnez un client', 'warning'); return }
    try {
      const payload: any = { statut: 'en_attente', tva_pct: 10, type: form.type, urgence: form.urgence, client_id: form.client_id }
      if (form.intervenant_id) payload.intervenant_id = form.intervenant_id
      if (form.adresse) payload.adresse = form.adresse
      if (form.description) payload.description = form.description
      if (form.date_prevue) payload.date_prevue = new Date(form.date_prevue).toISOString()
      if (isAdmin && form.notes_admin) payload.notes_admin = form.notes_admin
      await create.mutateAsync(payload)
      add('Intervention creee')
      setModal(false)
      setForm({ client_id:'', intervenant_id:'', type:'serrurerie', urgence:false, adresse:'', description:'', date_prevue:'', notes_admin:'' })
    } catch(err: any) { add('Erreur: ' + err.message, 'error') }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{ flexWrap:'wrap', gap:10 }}>
        <div><h1 className="page-title">Interventions</h1><p className="page-subtitle">{items.length} résultat{items.length>1?'s':''}</p></div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={handleExport} disabled={items.length===0}>📥 Excel</button>
          {isAdmin && <button className="btn btn-primary" onClick={() => setModal(true)}>+ Nouvelle</button>}
        </div>
      </div>
      <div className="filter-bar">
        <div className="search-bar" style={{ flex:1, maxWidth:260 }}>
          <span style={{ color:'var(--t3)', fontSize:15 }}>🔍</span>
          <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['tous','en_attente','en_cours','termine','annule'].map(s => (
          <button key={s} onClick={() => setStatut(s)} className={`btn btn-sm ${statut===s?'btn-primary':'btn-secondary'}`}>{s==='tous'?'Tous':s.replace('_',' ')}</button>
        ))}
      </div>
      {isError && (
        <div style={{ padding:'10px 14px',background:'var(--rdBg)',border:'1px solid var(--rdBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:12,color:'var(--rdTx)' }}>
          ⚠ Erreur de chargement : {(error as Error)?.message} — Vérifiez les politiques RLS dans Supabase.
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>N°</th><th>Client</th>{isAdmin&&<th>Intervenant</th>}<th>Type</th><th>Date</th><th>Montant</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement…</td></tr>}
            {!isLoading&&items.length===0 && <tr><td colSpan={8} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Aucune intervention</td></tr>}
            {items.map(i => (
              <tr key={i.id} style={{ cursor:'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                <td className="td-bold">{i.urgence&&'🔴 '}{i.numero}</td>
                <td><div className="td-bold">{i.client?.nom} {i.client?.prenom}</div><div style={{ fontSize:10,color:'var(--t3)' }}>{i.client?.telephone}</div></td>
                {isAdmin&&<td style={{ fontSize:12 }}>{i.intervenant?.prenom} {i.intervenant?.nom}</td>}
                <td>{i.type?<span className={`pill ${i.type==='serrurerie'?'pill-gray':'pill-blue'}`}>{i.type}</span>:'—'}</td>
                <td style={{ fontSize:11 }}>{i.date_prevue?new Date(i.date_prevue).toLocaleDateString('fr-FR'):'—'}</td>
                <td className="td-bold">{i.montant_ttc?i.montant_ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}):'—'}</td>
                <td><span className={`pill ${SC[i.statut]||'pill-gray'}`}>{i.statut.replace('_',' ')}</span></td>
                <td onClick={e=>e.stopPropagation()}><button className="btn-icon sm" onClick={()=>nav(`/interventions/${i.id}`)}>👁</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">Nouvelle intervention</span><button className="btn-icon sm" onClick={()=>setModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>Client</label>
                    <select value={form.client_id} onChange={e=>setForm(f=>({...f,client_id:e.target.value}))} required>
                      <option value="">Sélectionner…</option>
                      {clients.map(c=><option key={c.id} value={c.id}>{c.nom} {c.prenom}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Intervenant</label>
                    <select value={form.intervenant_id} onChange={e=>setForm(f=>({...f,intervenant_id:e.target.value}))}>
                      <option value="">Non affecté</option>
                      {profiles.filter(p=>p.role==='intervenant'&&p.actif).map(p=><option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Type</label>
                    <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value as any}))}>
                      <option value="serrurerie">Serrurerie</option><option value="vitrerie">Vitrerie</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Date prévue</label>
                    <input type="datetime-local" value={form.date_prevue} onChange={e=>setForm(f=>({...f,date_prevue:e.target.value}))} />
                  </div>
                </div>
                <div className="form-group"><label>Adresse</label><input value={form.adresse} onChange={e=>setForm(f=>({...f,adresse:e.target.value}))} placeholder="Adresse complète" /></div>
                <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Nature de l'intervention…" /></div>
                {isAdmin&&<div className="form-group"><label>Notes admin (privées)</label><textarea value={form.notes_admin} onChange={e=>setForm(f=>({...f,notes_admin:e.target.value}))} /></div>}
                <label style={{ display:'flex',alignItems:'center',gap:8,textTransform:'none',fontSize:13,fontWeight:500,letterSpacing:0 }}>
                  <input type="checkbox" checked={form.urgence} onChange={e=>setForm(f=>({...f,urgence:e.target.checked}))} style={{ width:'auto',minHeight:'auto' }} />
                  🔴 Urgente
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending?'Création…':'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
