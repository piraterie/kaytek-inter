// src/pages/ClientsPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  FileSpreadsheet, Archive, ArchiveRestore, CheckSquare, Trash2, X, Search,
  Phone, MapPin, Eye, Pencil, MoreHorizontal, AlertTriangle,
} from 'lucide-react'
import { useClients, useCreateClient, useUpdateClient, useArchiveClient, useDeleteClientSafe, useBulkArchiveClients, useDeleteArchivedClients } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import ConfirmModal from '@/components/ConfirmModal'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const chkStyle: React.CSSProperties = { width: 18, height: 18, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--bl)' }

export default function ClientsPage() {
  const nav = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [activeSheet, setActiveSheet] = useState<any>(null)
  const [showMobileActions, setShowMobileActions] = useState(false)

  const { data: clients = [], isLoading } = useClients(search, showArchived)
  const create = useCreateClient()
  const upd = useUpdateClient()
  const archiveM = useArchiveClient()
  const delSafe = useDeleteClientSafe()
  const bulkArchive = useBulkArchiveClients()
  const delArchived = useDeleteArchivedClients()

  const [form, setForm] = useState({ type:'particulier', nom:'', prenom:'', telephone:'', email:'', adresse_intervention:'', notes_internes:'' })
  const [modalClosing, setModalClosing] = useState(false)

  useEffect(() => {
    if ((location.state as any)?.openCreate) {
      openCreate()
      window.history.replaceState({}, '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function closeModal() {
    if (modalClosing) return
    setModalClosing(true)
    setTimeout(() => { setModal(false); setModalClosing(false) }, 150)
  }

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected(selected.size === clients.length ? new Set() : new Set(clients.map(c => c.id)))
  }
  function exitSelection() { setSelected(new Set()); setSelectionMode(false) }

  function openEdit(c: any) {
    setEditing(c)
    setForm({ type:c.type, nom:c.nom, prenom:c.prenom||'', telephone:c.telephone||'', email:c.email||'', adresse_intervention:c.adresse_intervention||'', notes_internes:c.notes_internes||'' })
    setModal(true)
  }
  function openCreate() {
    setEditing(null)
    setForm({ type:'particulier', nom:'', prenom:'', telephone:'', email:'', adresse_intervention:'', notes_internes:'' })
    setModal(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editing) { await upd.mutateAsync({ id:editing.id, ...form }); add('Client mis à jour') }
      else { await create.mutateAsync(form as any); add('Client ajouté') }
      setModal(false)
    } catch(err:any) { add(err.message,'error') }
  }

  function handleArchive(c: any) {
    const action = c.archive ? 'Restaurer' : 'Archiver'
    setConfirmDialog({
      message: `${action} ${c.nom} ${c.prenom || ''} ?`,
      action: async () => {
        try {
          await archiveM.mutateAsync({ id: c.id, archive: !c.archive })
          add(c.archive ? 'Client restauré' : 'Client archivé')
        } catch(err:any) { add(err.message, 'error') }
      }
    })
  }

  function handleDelete(c: any) {
    setConfirmDialog({
      message: `Supprimer définitivement ${c.nom} ${c.prenom || ''} ?\nCette action est irréversible.`,
      action: async () => {
        try {
          await delSafe.mutateAsync(c.id)
          add('Client supprimé')
        } catch(err:any) { add(err.message, 'error') }
      }
    })
  }

  function handleArchiveSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment archiver ${ids.length} client${ids.length > 1 ? 's' : ''} sélectionné${ids.length > 1 ? 's' : ''} ?\nIls resteront accessibles dans les archives.`,
      action: async () => {
        try { await bulkArchive.mutateAsync(ids); add(`${ids.length} client${ids.length > 1 ? 's' : ''} archivé${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch(err:any) { add(err.message, 'error') }
      }
    })
  }

  function handleDeleteSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment supprimer définitivement ${ids.length} client${ids.length > 1 ? 's' : ''} archivé${ids.length > 1 ? 's' : ''} ?\nCette action est irréversible.`,
      action: async () => {
        try { await delArchived.mutateAsync(ids); add(`${ids.length} client${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch(err:any) { add(err.message, 'error') }
      }
    })
  }

  function handleViderArchives() {
    const archivedIds = clients.map(c => c.id)
    if (!archivedIds.length) { add('Aucun client archivé à supprimer', 'warning'); return }
    setConfirmDialog({
      message: `Voulez-vous vraiment supprimer toutes les archives clients ?\n${archivedIds.length} client${archivedIds.length > 1 ? 's' : ''} seront supprimés définitivement. Cette action est irréversible.`,
      action: async () => {
        try { await delArchived.mutateAsync(archivedIds); add('Archives clients vidées') }
        catch(err:any) { add(err.message, 'error') }
      }
    })
  }

  function handleExport() {
    const rows = [
      ['Nom', 'Prénom', 'Téléphone', 'Email', 'Adresse', 'Type', 'Date création'],
      ...clients.map(c => [
        c.nom, c.prenom||'', c.telephone||'', c.email||'',
        c.adresse_intervention||'', c.type,
        new Date(c.created_at).toLocaleDateString('fr-FR')
      ])
    ]
    downloadCSV(rows, `clients-${new Date().toISOString().split('T')[0]}.csv`)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients{showArchived ? ' — Archives' : ''}</h1>
          <p className="page-subtitle">{clients.length} client{clients.length>1?'s':''}</p>
        </div>
        {/* Desktop : inchangé */}
        <div className="page-actions hide-mobile">
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={clients.length===0}><FileSpreadsheet size={14} /> CSV</button>
          {isAdmin && (
            <button
              className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setShowArchived(v => !v); exitSelection() }}
            >
              <Archive size={14} /> {showArchived ? 'Masquer archives' : 'Archives'}
            </button>
          )}
          {isAdmin && !selectionMode && clients.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setSelectionMode(true)}><CheckSquare size={14} /> Sélectionner</button>
          )}
          {isAdmin && showArchived && clients.length > 0 && (
            <button className="btn btn-secondary" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleViderArchives} disabled={delArchived.isPending}>
              <Trash2 size={14} /> Vider les archives
            </button>
          )}
          {isAdmin && !showArchived && <button className="btn btn-primary" onClick={openCreate}>+ Ajouter</button>}
        </div>
        {/* Mobile : ligne compacte sous le titre */}
        <div className="show-mobile" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && !showArchived && (
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={openCreate}>
                + Ajouter
              </button>
            )}
            <button
              className="btn btn-secondary"
              style={{ paddingLeft: 16, paddingRight: 16, justifyContent: 'center' }}
              onClick={() => setShowMobileActions(true)}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Barre de sélection */}
      {selectionMode && (
        <div style={{ background: 'var(--blBg)', border: '1px solid var(--blBd)', borderRadius: 'var(--r2)', padding: '8px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input type="checkbox" style={chkStyle} checked={selected.size === clients.length && clients.length > 0} onChange={toggleSelectAll} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blTx)' }}>{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          {selected.size > 0 && !showArchived && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--amTx)', borderColor: 'var(--amBd)' }}
              onClick={handleArchiveSelected} disabled={bulkArchive.isPending}>
              <Archive size={13} /> Archiver la sélection
            </button>
          )}
          {selected.size > 0 && showArchived && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleDeleteSelected} disabled={delArchived.isPending}>
              <Trash2 size={13} /> Supprimer la sélection
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exitSelection}><X size={13} /> Annuler la sélection</button>
        </div>
      )}

      <div className="filter-bar">
        <div className="search-bar" style={{ flex:1, minWidth:160, maxWidth:300 }}>
          <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
          <input placeholder="Nom, email, téléphone…" value={search} onChange={e=>setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} style={{ border:'none',background:'none',color:'var(--t3)',cursor:'pointer',padding:'0 2px',display:'flex',flexShrink:0 }}><X size={15} /></button>
          )}
        </div>
      </div>

      {/* MOBILE : cards */}
      <div className="show-mobile">
        {isLoading && [0,1,2,3].map(i => (
          <div key={i} style={{ background:'var(--s0)',borderRadius:20,padding:'16px 18px',marginBottom:10,boxShadow:'var(--sh0)' }}>
            <div style={{ display:'flex',gap:12,alignItems:'center' }}>
              <div style={{ flex:1,display:'flex',flexDirection:'column',gap:8 }}>
                <div className="skeleton-row" style={{ height:16,width:'55%' }} />
                <div className="skeleton-row" style={{ height:12,width:'40%' }} />
              </div>
              <div className="skeleton-row" style={{ height:20,width:50,borderRadius:999 }} />
            </div>
          </div>
        ))}
        {!isLoading && clients.length === 0 && (
          <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom:12 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : 'Aucun client'}
          </div>
        )}
        {clients.map(c => (
          <div key={c.id}
            style={{
              background: selected.has(c.id) ? 'var(--blBg)' : 'var(--s0)',
              borderRadius: 20, padding: '16px 18px', marginBottom: 10,
              boxShadow: selected.has(c.id) ? '0 0 0 2px var(--bl)' : 'var(--sh0)',
              opacity: c.archive ? 0.65 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}>
            <div
              onClick={selectionMode ? () => toggleSelect(c.id) : () => nav(`/clients/${c.id}`)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
              {selectionMode && (
                <input type="checkbox" style={chkStyle} checked={selected.has(c.id)}
                  onChange={() => {}} onClick={e => { e.stopPropagation(); toggleSelect(c.id) }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)', marginBottom: 3 }}>
                  {c.nom}{c.prenom ? ` ${c.prenom}` : ''}
                </div>
                {c.telephone && (
                  <div style={{ fontSize: 13, color: 'var(--t1)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} /> {c.telephone}</div>
                )}
                {c.adresse_intervention && (
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={11} /> {c.adresse_intervention}</div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="pill pill-gray" style={{ fontSize: 10 }}>{c.type}</span>
                {c.archive && <span className="pill pill-amber" style={{ fontSize: 9 }}>Archivé</span>}
                {isAdmin && !selectionMode && (
                  <button
                    className="btn-icon sm"
                    onClick={e => { e.stopPropagation(); setActiveSheet(c) }}
                    style={{ marginTop: 4 }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP : table */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectionMode && <th style={{ width: 40, paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.size === clients.length && clients.length > 0} onChange={toggleSelectAll} /></th>}
              <th>Client</th><th>Contact</th><th>Adresse</th><th>Type</th>{isAdmin&&<th></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading&&[0,1,2,3].map(i=>(
              <tr key={i}>
                {selectionMode&&<td />}
                <td><div className="skeleton-row" style={{ height:14,width:'70%',marginBottom:4 }} /><div className="skeleton-row" style={{ height:11,width:'40%' }} /></td>
                <td><div className="skeleton-row" style={{ height:13,width:'80%',marginBottom:4 }} /><div className="skeleton-row" style={{ height:11,width:'60%' }} /></td>
                <td><div className="skeleton-row" style={{ height:13,width:'90%' }} /></td>
                <td><div className="skeleton-row" style={{ height:20,width:60,borderRadius:999 }} /></td>
                {isAdmin&&<td />}
              </tr>
            ))}
            {!isLoading&&clients.length===0&&<tr><td colSpan={selectionMode ? 6 : 5} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>
              {search.trim() ? <><span>Aucun résultat — </span><button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button></> : 'Aucun client'}
            </td></tr>}
            {clients.map(c=>(
              <tr key={c.id} style={{ opacity: c.archive ? 0.55 : 1, cursor: 'pointer', ...(selected.has(c.id) ? { background: 'var(--blBg)' } : {}) }}
                onClick={selectionMode ? () => toggleSelect(c.id) : () => nav(`/clients/${c.id}`)}>
                {selectionMode && <td style={{ paddingRight: 0 }} onClick={e => e.stopPropagation()}><input type="checkbox" style={chkStyle} checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} /></td>}
                <td>
                  <div className="td-bold">{c.nom} {c.prenom}</div>
                  {c.raison_sociale&&<div style={{ fontSize:11,color:'var(--t3)' }}>{c.raison_sociale}</div>}
                  {c.archive && <span className="pill pill-amber" style={{ fontSize:9,marginTop:3 }}>Archivé</span>}
                </td>
                <td><div style={{ fontSize:13 }}>{c.telephone||'—'}</div><div style={{ fontSize:12,color:'var(--t3)' }}>{c.email}</div></td>
                <td style={{ fontSize:12 }}>{c.adresse_intervention||'—'}</td>
                <td><span className="pill pill-gray">{c.type}</span></td>
                {isAdmin&&(
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display:'flex', gap:4 }}>
                      {!c.archive && <button className="btn-icon sm" onClick={()=>openEdit(c)} title="Modifier"><Pencil size={14} /></button>}
                      <button className="btn-icon sm" onClick={()=>handleArchive(c)} title={c.archive?'Restaurer':'Archiver'} style={{ color: c.archive ? 'var(--gnTx)' : 'var(--amTx)' }}>{c.archive ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
                      {c.archive && <button className="btn-icon sm" style={{ color:'var(--rdTx)' }} onClick={()=>handleDelete(c)} title="Supprimer définitivement"><Trash2 size={14} /></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showArchived && !selectionMode && (
        <div style={{ marginTop:12,padding:'10px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',fontSize:12,color:'var(--amTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Les clients archivés restent liés à leurs devis, factures et interventions. La suppression définitive n'est possible que si aucune donnée n'y est rattachée.
        </div>
      )}

      {/* ── Bottom sheet actions ─────────────────────────── */}
      {activeSheet && (
        <DocSheet
          title={[activeSheet.nom, activeSheet.prenom].filter(Boolean).join(' ')}
          subtitle={activeSheet.type}
          onClose={() => setActiveSheet(null)}
        >
          <SheetRow icon={<Eye size={16} />} label="Voir la fiche client"
            onClick={() => { setActiveSheet(null); nav(`/clients/${activeSheet.id}`) }} />

          {!activeSheet.archive && (
            <>
              <SheetSection label="Édition" />
              <SheetRow icon={<Pencil size={16} />} label="Modifier"
                onClick={() => { setActiveSheet(null); openEdit(activeSheet) }} />
            </>
          )}

          <SheetSection label="Archivage" />
          <SheetRow
            icon={activeSheet.archive ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            label={activeSheet.archive ? 'Restaurer le client' : 'Archiver le client'}
            onClick={() => { setActiveSheet(null); handleArchive(activeSheet) }} />

          {activeSheet.archive && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow icon={<Trash2 size={16} />} label="Supprimer définitivement" danger
                onClick={() => { setActiveSheet(null); handleDelete(activeSheet) }} />
            </>
          )}
        </DocSheet>
      )}

      {/* ── Actions globales mobile ─────────────────────── */}
      {showMobileActions && (
        <DocSheet title="Actions" onClose={() => setShowMobileActions(false)}>
          <SheetRow
            icon={<FileSpreadsheet size={16} />}
            label="Exporter CSV"
            sublabel={clients.length === 0 ? 'Aucun client' : `${clients.length} client${clients.length > 1 ? 's' : ''}`}
            onClick={() => { setShowMobileActions(false); handleExport() }}
            disabled={clients.length === 0}
          />
          {isAdmin && (
            <SheetRow
              icon={<Archive size={16} />}
              label={showArchived ? 'Masquer les archives' : 'Voir les archives'}
              onClick={() => { setShowMobileActions(false); setShowArchived(v => !v); exitSelection() }}
            />
          )}
          {isAdmin && !selectionMode && clients.length > 0 && (
            <SheetRow
              icon={<CheckSquare size={16} />}
              label="Mode sélection"
              sublabel="Sélectionner des clients"
              onClick={() => { setShowMobileActions(false); setSelectionMode(true) }}
            />
          )}
          {isAdmin && showArchived && clients.length > 0 && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon={<Trash2 size={16} />}
                label="Vider les archives"
                sublabel={`Supprimer les ${clients.length} archive${clients.length > 1 ? 's' : ''}`}
                danger
                onClick={() => { setShowMobileActions(false); handleViderArchives() }}
                disabled={delArchived.isPending}
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

      {/* MODAL créer/modifier */}
      {modal&&(
        <div className={`modal-overlay${modalClosing?' is-closing':''}`} onClick={closeModal}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">{editing?'Modifier client':'Nouveau client'}</span><button className="btn-icon sm" onClick={closeModal}><X size={15} /></button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="form-group"><label>Type</label>
                  <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                    <option value="particulier">Particulier</option>
                    <option value="professionnel">Professionnel</option>
                    <option value="syndic">Syndic</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div className="form-group"><label>Nom <span className="req">*</span></label><input value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} required /></div>
                <div className="form-group"><label>Prénom</label><input value={form.prenom} onChange={e=>setForm(f=>({...f,prenom:e.target.value}))} /></div>
                <div className="form-group"><label>Téléphone</label><input value={form.telephone} onChange={e=>setForm(f=>({...f,telephone:e.target.value}))} type="tel" /></div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
                <div className="form-group">
                  <label>Adresse d'intervention</label>
                  <AddressAutocomplete
                    value={form.adresse_intervention}
                    onChange={v => setForm(f => ({ ...f, adresse_intervention: v }))}
                    onSelect={s => setForm(f => ({
                      ...f,
                      adresse_intervention: s.label,
                    }))}
                    placeholder="Adresse complète"
                  />
                </div>
                <div className="form-group"><label>Notes internes</label><textarea value={form.notes_internes} onChange={e=>setForm(f=>({...f,notes_internes:e.target.value}))} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={create.isPending||upd.isPending}>Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
