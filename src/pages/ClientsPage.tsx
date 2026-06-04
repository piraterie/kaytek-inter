// src/pages/ClientsPage.tsx
import { useState } from 'react'
import { useClients, useCreateClient, useUpdateClient } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'

export default function ClientsPage() {
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const { data: clients = [], isLoading } = useClients(search)
  const create = useCreateClient()
  const upd = useUpdateClient()
  const [form, setForm] = useState({ type:'particulier', nom:'', prenom:'', telephone:'', email:'', adresse_intervention:'', notes_internes:'' })

  function openEdit(c: any) { setEditing(c); setForm({ type:c.type, nom:c.nom, prenom:c.prenom||'', telephone:c.telephone||'', email:c.email||'', adresse_intervention:c.adresse_intervention||'', notes_internes:c.notes_internes||'' }); setModal(true) }
  function openCreate() { setEditing(null); setForm({ type:'particulier', nom:'', prenom:'', telephone:'', email:'', adresse_intervention:'', notes_internes:'' }); setModal(true) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editing) { await upd.mutateAsync({ id:editing.id, ...form }); add('Client mis à jour') }
      else { await create.mutateAsync(form as any); add('Client ajouté') }
      setModal(false)
    } catch(err:any) { add(err.message,'error') }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{ flexWrap:'wrap',gap:10 }}>
        <div><h1 className="page-title">Clients</h1><p className="page-subtitle">{clients.length} client{clients.length>1?'s':''}</p></div>
        {isAdmin&&<button className="btn btn-primary" onClick={openCreate}>+ Ajouter</button>}
      </div>
      <div className="filter-bar">
        <div className="search-bar" style={{ flex:1,maxWidth:280 }}>
          <span style={{ color:'var(--t3)',fontSize:15 }}>🔍</span>
          <input placeholder="Nom, email, téléphone…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Client</th><th>Contact</th><th>Adresse</th><th>Type</th>{isAdmin&&<th></th>}</tr></thead>
          <tbody>
            {isLoading&&<tr><td colSpan={5} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement…</td></tr>}
            {!isLoading&&clients.length===0&&<tr><td colSpan={5} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Aucun client</td></tr>}
            {clients.map(c=>(
              <tr key={c.id}>
                <td><div className="td-bold">{c.nom} {c.prenom}</div>{c.raison_sociale&&<div style={{ fontSize:10,color:'var(--t3)' }}>{c.raison_sociale}</div>}</td>
                <td><div style={{ fontSize:12 }}>{c.telephone||'—'}</div><div style={{ fontSize:11,color:'var(--t3)' }}>{c.email}</div></td>
                <td style={{ fontSize:11 }}>{c.adresse_intervention||'—'}</td>
                <td><span className="pill pill-gray">{c.type}</span></td>
                {isAdmin&&<td><button className="btn-icon sm" onClick={()=>openEdit(c)}>✏</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={()=>setModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">{editing?'Modifier':'Nouveau client'}</span><button className="btn-icon sm" onClick={()=>setModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>Type</label>
                    <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                      <option value="particulier">Particulier</option><option value="professionnel">Professionnel</option>
                      <option value="syndic">Syndic</option><option value="autre">Autre</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Nom *</label><input value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Prénom</label><input value={form.prenom} onChange={e=>setForm(f=>({...f,prenom:e.target.value}))} /></div>
                  <div className="form-group"><label>Téléphone</label><input value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} /></div>
                </div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
                <div className="form-group"><label>Adresse d'intervention</label><input value={form.adresse_intervention} onChange={e=>setForm(f=>({...f,adresse_intervention:e.target.value}))} /></div>
                <div className="form-group"><label>Notes internes</label><textarea value={form.notes_internes} onChange={e=>setForm(f=>({...f,notes_internes:e.target.value}))} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={create.isPending||upd.isPending}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
