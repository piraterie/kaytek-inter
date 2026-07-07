// src/pages/InterventionsPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  FileSpreadsheet, Archive, ArchiveRestore, CheckSquare, Trash2, X, Search,
  MapPin, Calendar, User, Eye, Pencil, Mail, Play, CheckCircle2, MoreHorizontal,
  AlertTriangle,
} from 'lucide-react'
import { useInterventions, useCreateIntervention, useUpdateIntervention, useDeleteIntervention, useArchiveIntervention, useBulkArchiveInterventions, useDeleteArchivedInterventions, useClients, useIntervenants, useProfiles, useSendMessage, useCreateClient } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { CustomSelect } from '@/components/CustomSelect'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import ConfirmModal from '@/components/ConfirmModal'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'
import { exportInterventionsPremium } from '@/lib/exportPremium'
import type { Categorie, Intervention } from '@/types'

const ns = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

const ACTIVITES: { value: Categorie; label: string }[] = [
  { value: 'serrurerie', label: 'Serrurerie' },
  { value: 'plomberie', label: 'Plomberie' },
  { value: 'electricite', label: 'Électricité' },
  { value: 'vitrerie', label: 'Vitrerie' },
  { value: 'chauffagiste', label: 'Chauffagiste' },
]
const ACT_PILL: Record<string, string> = {
  serrurerie: 'pill-gray', plomberie: 'pill-blue', electricite: 'pill-amber',
  vitrerie: 'pill-purple', chauffagiste: 'pill-orange',
}

const SC: Record<string,string> = { en_attente:'pill-amber',accepte:'pill-blue',en_cours:'pill-orange',termine:'pill-green',facture:'pill-purple',annule:'pill-gray',refuse:'pill-red' }
const STATUTS_LIST = ['en_attente','accepte','en_cours','termine','facture','annule'] as const
const chkStyle: React.CSSProperties = { width: 18, height: 18, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--bl)' }

export default function InterventionsPage() {
  const nav = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const [statut, setStatut] = useState('tous')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [createModal, setCreateModal] = useState(false)

  useEffect(() => {
    if ((location.state as any)?.openCreate) {
      setCreateModal(true)
      window.history.replaceState({}, '')
    }
  }, [])
  const [editModal, setEditModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Intervention | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [activeSheet, setActiveSheet] = useState<Intervention | null>(null)
  const [showMobileActions, setShowMobileActions] = useState(false)

  const { data: rawItems = [], isLoading, isError, error } = useInterventions({ statut, showArchived })

  const items = rawItems.filter(i => {
    if (!search.trim()) return true
    const q = ns(search)
    return (
      ns(i.numero || '').includes(q) ||
      ns(`${i.client?.nom || ''} ${i.client?.prenom || ''}`).includes(q) ||
      ns(i.client?.telephone || '').includes(q) ||
      ns(i.adresse || '').includes(q) ||
      ns(i.description || '').includes(q) ||
      ns(i.type || '').includes(q) ||
      ns(`${i.intervenant?.prenom || ''} ${i.intervenant?.nom || ''}`).includes(q)
    )
  })
  const { data: clients = [] } = useClients()
  const { data: intervenants = [] } = useIntervenants()
  const { data: profiles = [] } = useProfiles()
  const create = useCreateIntervention()
  const update = useUpdateIntervention()
  const del = useDeleteIntervention()
  const archive = useArchiveIntervention()
  const bulkArchive = useBulkArchiveInterventions()
  const delArchived = useDeleteArchivedInterventions()

  const [createForm, setCreateForm] = useState({ client_id:'', intervenant_id:'', type:'serrurerie' as Categorie, urgence:false, adresse:'', description:'', date_prevue:'', notes_admin:'' })
  const [editForm, setEditForm] = useState({ statut:'en_attente' as any, montant_ttc:'', intervenant_id:'', date_prevue:'', notes_admin:'' })
  const [msgModal, setMsgModal] = useState<{ inter: Intervention; text: string; destinataire_id: string } | null>(null)
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientForm, setClientForm] = useState({ type: 'particulier', nom: '', prenom: '', telephone: '', email: '', adresse_intervention: '' })
  const createClient = useCreateClient()
  const [createModalClosing, setCreateModalClosing] = useState(false)
  const [editModalClosing, setEditModalClosing] = useState(false)

  function closeCreateModal() {
    if (createModalClosing) return
    setCreateModalClosing(true)
    setTimeout(() => { setCreateModal(false); setCreateModalClosing(false) }, 150)
  }
  function closeEditModal() {
    if (editModalClosing) return
    setEditModalClosing(true)
    setTimeout(() => { setEditModal(false); setEditModalClosing(false) }, 150)
  }
  const sendMsg = useSendMessage()

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map(i => i.id)))
  }
  function exitSelection() { setSelected(new Set()); setSelectionMode(false) }

  async function handleExport() {
    try {
      await exportInterventionsPremium(items, { user: user ? { nom: user.nom, prenom: user.prenom } : null })
    } catch (e: any) { add('Erreur export : ' + e.message, 'error') }
  }

  async function submitNewClient(e: React.FormEvent) {
    e.preventDefault()
    if (!clientForm.nom.trim()) { add('Le nom est requis', 'warning'); return }
    try {
      const newClient = await createClient.mutateAsync(clientForm as any)
      setCreateForm(f => ({
        ...f,
        client_id: (newClient as any).id,
        adresse: (newClient as any).adresse_intervention || f.adresse
      }))
      add(`Client ${clientForm.nom} créé et sélectionné`)
      setShowClientModal(false)
      setClientForm({ type: 'particulier', nom: '', prenom: '', telephone: '', email: '', adresse_intervention: '' })
    } catch (err: any) { add('Erreur : ' + err.message, 'error') }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!createForm.client_id) { add('Sélectionnez un client', 'warning'); return }
    try {
      const payload: any = { statut:'en_attente', tva_pct:10, type:createForm.type, urgence:createForm.urgence, client_id:createForm.client_id }
      if (createForm.intervenant_id) payload.intervenant_id = createForm.intervenant_id
      if (createForm.adresse) payload.adresse = createForm.adresse
      if (createForm.description) payload.description = createForm.description
      if (createForm.date_prevue) payload.date_prevue = new Date(createForm.date_prevue).toISOString()
      if (isAdmin && createForm.notes_admin) payload.notes_admin = createForm.notes_admin
      await create.mutateAsync(payload)
      add('Intervention créée')
      setCreateModal(false)
      setCreateForm({ client_id:'', intervenant_id:'', type:'serrurerie' as Categorie, urgence:false, adresse:'', description:'', date_prevue:'', notes_admin:'' })
    } catch(err: any) { add('Erreur : ' + err.message, 'error') }
  }

  function openEdit(i: Intervention) {
    setEditTarget(i)
    setEditForm({
      statut: i.statut,
      montant_ttc: i.montant_ttc ? String(i.montant_ttc) : '',
      intervenant_id: i.intervenant_id || '',
      date_prevue: i.date_prevue ? new Date(i.date_prevue).toISOString().slice(0, 16) : '',
      notes_admin: i.notes_admin || ''
    })
    setEditModal(true)
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    try {
      const payload: any = { id: editTarget.id, statut: editForm.statut }
      if (editForm.montant_ttc) payload.montant_ttc = parseFloat(editForm.montant_ttc)
      if (editForm.intervenant_id) payload.intervenant_id = editForm.intervenant_id
      if (editForm.date_prevue) payload.date_prevue = new Date(editForm.date_prevue).toISOString()
      if (isAdmin) payload.notes_admin = editForm.notes_admin
      await update.mutateAsync(payload)
      add('Intervention mise à jour')
      setEditModal(false)
      setEditTarget(null)
    } catch(err: any) { add('Erreur : ' + err.message, 'error') }
  }

  function handleDelete(i: Intervention) {
    setConfirmDialog({
      message: `Supprimer l'intervention ${i.numero} ?\nCette action est irréversible.`,
      action: async () => {
        try { await del.mutateAsync(i.id); add('Intervention supprimée') }
        catch(err: any) { add('Erreur : ' + err.message, 'error') }
      }
    })
  }

  function handleArchive(i: Intervention) {
    const action = i.archive ? 'Restaurer' : 'Archiver'
    setConfirmDialog({
      message: `${action} l'intervention ${i.numero} ?`,
      action: async () => {
        try {
          await archive.mutateAsync({ id: i.id, archive: !i.archive })
          add(i.archive ? 'Intervention restaurée' : 'Intervention archivée')
        } catch(err: any) { add('Erreur : ' + err.message, 'error') }
      }
    })
  }

  function handleArchiveSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment archiver ${ids.length} intervention${ids.length > 1 ? 's' : ''} sélectionnée${ids.length > 1 ? 's' : ''} ?\nElles resteront accessibles dans les archives.`,
      action: async () => {
        try { await bulkArchive.mutateAsync(ids); add(`${ids.length} intervention${ids.length > 1 ? 's' : ''} archivée${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch(err: any) { add('Erreur : ' + err.message, 'error') }
      }
    })
  }

  function handleDeleteArchivedSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment supprimer définitivement ${ids.length} intervention${ids.length > 1 ? 's' : ''} archivée${ids.length > 1 ? 's' : ''} ?\nCette action est irréversible.`,
      action: async () => {
        try { await delArchived.mutateAsync(ids); add(`${ids.length} intervention${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch(err: any) { add('Erreur : ' + err.message, 'error') }
      }
    })
  }

  function handleViderArchives() {
    const archivedIds = items.map(i => i.id)
    if (!archivedIds.length) { add('Aucune intervention archivée à supprimer', 'warning'); return }
    setConfirmDialog({
      message: `Voulez-vous vraiment vider toutes les archives ?\n${archivedIds.length} intervention${archivedIds.length > 1 ? 's' : ''} seront supprimées définitivement. Cette action est irréversible.`,
      action: async () => {
        try { await delArchived.mutateAsync(archivedIds); add('Archives vidées') }
        catch(err: any) { add('Erreur : ' + err.message, 'error') }
      }
    })
  }

  async function handleQuickStatut(id: string, statut: string) {
    try {
      await update.mutateAsync({ id, statut })
      add(statut === 'en_cours' ? 'Intervention démarrée' : 'Intervention terminée')
    } catch(err: any) { add('Erreur : ' + err.message, 'error') }
  }

  function openMsgModal(i: Intervention) {
    const intervenantId = i.intervenant_id || i.intervenant?.id || ''
    const parts = [
      `🔧 Intervention ${i.numero}`,
      `Client : ${[i.client?.nom, i.client?.prenom].filter(Boolean).join(' ')}`,
      i.adresse ? `Adresse : ${i.adresse}` : '',
      i.type ? `Type : ${i.type}` : '',
      i.date_prevue ? `Date : ${new Date(i.date_prevue).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}` : '',
      i.description ? `Description : ${i.description}` : '',
      i.urgence ? '🔴 URGENT' : '',
    ].filter(Boolean)
    const interventionText = parts.join('\n')
    if (intervenantId) {
      nav(`/messagerie/${intervenantId}`, { state: { prefilledText: interventionText } })
      return
    }
    setMsgModal({ inter: i, text: interventionText, destinataire_id: '' })
  }

  async function handleSendMsg() {
    if (!msgModal) return
    if (!msgModal.destinataire_id) { add('Sélectionnez un destinataire', 'warning'); return }
    try {
      await sendMsg.mutateAsync({ destinataire_id: msgModal.destinataire_id, contenu: msgModal.text, type: 'texte' })
      add('Message envoyé')
      setMsgModal(null)
      nav(`/messagerie/${msgModal.destinataire_id}`)
    } catch (err: any) { add('Erreur : ' + err.message, 'error') }
  }

  const STATUTS_FILTER = ['tous','en_attente','en_cours','termine','annule','refuse']

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Interventions{showArchived ? ' — Archives' : ''}</h1>
          <p className="page-subtitle">{items.length} résultat{items.length>1?'s':''}</p>
        </div>
        {/* Desktop : inchangé */}
        <div className="page-actions hide-mobile">
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={items.length===0}><FileSpreadsheet size={14} /> Excel</button>
          {isAdmin && (
            <button
              className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setShowArchived(v => !v); setStatut('tous'); exitSelection() }}
            >
              <Archive size={14} /> {showArchived ? 'Masquer archives' : 'Archives'}
            </button>
          )}
          {isAdmin && !selectionMode && items.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setSelectionMode(true)}><CheckSquare size={14} /> Sélectionner</button>
          )}
          {isAdmin && showArchived && items.length > 0 && (
            <button className="btn btn-secondary" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleViderArchives} disabled={delArchived.isPending}>
              <Trash2 size={14} /> Vider les archives
            </button>
          )}
          {isAdmin && !showArchived && <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ Nouvelle</button>}
        </div>
        {/* Mobile : ligne compacte sous le titre */}
        <div className="show-mobile" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && !showArchived && (
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setCreateModal(true)}>
                + Nouvelle
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
          <input type="checkbox" style={chkStyle} checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blTx)' }}>{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          {selected.size > 0 && !showArchived && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--amTx)', borderColor: 'var(--amBd)' }}
              onClick={handleArchiveSelected} disabled={bulkArchive.isPending}>
              <Archive size={13} /> Archiver la sélection
            </button>
          )}
          {selected.size > 0 && showArchived && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleDeleteArchivedSelected} disabled={delArchived.isPending}>
              <Trash2 size={13} /> Supprimer la sélection
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exitSelection}><X size={13} /> Annuler la sélection</button>
        </div>
      )}

      <div className="filter-bar">
        <div className="search-bar" style={{ flex:1, minWidth:160, maxWidth:280 }}>
          <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
          <input placeholder="Client, adresse, intervenant…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} style={{ border:'none',background:'none',color:'var(--t3)',cursor:'pointer',padding:'0 2px',display:'flex',flexShrink:0 }}><X size={15} /></button>
          )}
        </div>
        {!showArchived && STATUTS_FILTER.map(s => (
          <button key={s} onClick={() => setStatut(s)} className={`btn btn-sm ${statut===s?'btn-primary':'btn-secondary'}`}>{s==='tous'?'Tous':s.replace('_',' ')}</button>
        ))}
      </div>

      {isError && (
        <div style={{ padding:'10px 14px',background:'var(--rdBg)',border:'1px solid var(--rdBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:13,color:'var(--rdTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Erreur : {(error as Error)?.message}
        </div>
      )}

      {/* MOBILE : cards */}
      <div className="show-mobile">
        {isLoading && [0,1,2,3].map(i => (
          <div key={i} style={{ background:'var(--s0)',borderRadius:20,padding:'16px 18px',marginBottom:10,boxShadow:'var(--sh0)' }}>
            <div style={{ display:'flex',gap:12,alignItems:'flex-start' }}>
              <div style={{ flex:1,display:'flex',flexDirection:'column',gap:8 }}>
                <div className="skeleton-row" style={{ height:15,width:'40%' }} />
                <div className="skeleton-row" style={{ height:13,width:'55%' }} />
                <div className="skeleton-row" style={{ height:11,width:'35%' }} />
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end' }}>
                <div className="skeleton-row" style={{ height:15,width:70 }} />
                <div className="skeleton-row" style={{ height:20,width:60,borderRadius:999 }} />
              </div>
            </div>
          </div>
        ))}
        {!isLoading && items.length === 0 && (
          <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom:12 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : 'Aucune intervention'}
          </div>
        )}
        {items.map(i => (
          <div key={i.id}
            style={{
              background: selected.has(i.id) ? 'var(--blBg)' : 'var(--s0)',
              borderRadius: 20, padding: '16px 18px', marginBottom: 10,
              boxShadow: selected.has(i.id) ? '0 0 0 2px var(--bl)' : 'var(--sh0)',
              WebkitTapHighlightColor: 'transparent',
            }}>
            <div
              onClick={selectionMode ? () => toggleSelect(i.id) : () => nav(`/interventions/${i.id}`)}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              {selectionMode && (
                <input type="checkbox" style={chkStyle} checked={selected.has(i.id)}
                  onChange={() => {}} onClick={e => { e.stopPropagation(); toggleSelect(i.id) }} />
              )}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  {i.urgence && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rd)', flexShrink: 0 }} />}
                  <span style={{ fontWeight:700, fontSize:15, color:'var(--t0)' }}>{i.numero}</span>
                </div>
                <div style={{ fontSize:14, color:'var(--t1)' }}>{i.client?.nom} {i.client?.prenom}</div>
                {i.adresse && <div style={{ fontSize:12, color:'var(--t3)', marginTop:2, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {i.adresse}</div>}
                {i.date_prevue && <div style={{ fontSize:12, color:'var(--t3)', marginTop:1, display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} /> {new Date(i.date_prevue).toLocaleDateString('fr-FR')}</div>}
                {!selectionMode && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {i.type && <span className={`pill ${ACT_PILL[i.type]||'pill-gray'}`}>{i.type}</span>}
                    {isAdmin && i.intervenant && <span style={{ fontSize:11, color:'var(--t2)', display: 'flex', alignItems: 'center', gap: 4 }}><User size={11} /> {i.intervenant.prenom} {i.intervenant.nom}</span>}
                  </div>
                )}
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontWeight:700, fontSize:15, color:'var(--t0)', marginBottom:6 }}>
                  {i.montant_ttc ? i.montant_ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}) : '—'}
                </div>
                <span className={`pill ${SC[i.statut]||'pill-gray'}`}>{i.statut.replace('_',' ')}</span>
              </div>
            </div>
            {!selectionMode && (
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={e => { e.stopPropagation(); setActiveSheet(i) }}
                  style={{ padding: '6px 16px' }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* DESKTOP : table */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectionMode && <th style={{ width: 40, paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} /></th>}
              <th>N°</th><th>Client</th>{isAdmin&&<th>Intervenant</th>}<th>Type</th><th>Date</th><th>Montant</th><th>Statut</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && [0,1,2,3].map(i=>(
              <tr key={i}>
                {selectionMode&&<td />}
                <td><div className="skeleton-row" style={{ height:14,width:'80%' }} /></td>
                <td><div className="skeleton-row" style={{ height:14,width:'70%',marginBottom:4 }} /><div className="skeleton-row" style={{ height:11,width:'45%' }} /></td>
                {isAdmin&&<td><div className="skeleton-row" style={{ height:13,width:'65%' }} /></td>}
                <td><div className="skeleton-row" style={{ height:20,width:70,borderRadius:999 }} /></td>
                <td><div className="skeleton-row" style={{ height:13,width:'80%' }} /></td>
                <td><div className="skeleton-row" style={{ height:14,width:60 }} /></td>
                <td><div className="skeleton-row" style={{ height:20,width:70,borderRadius:999 }} /></td>
                <td />
              </tr>
            ))}
            {!isLoading&&items.length===0 && (
              <tr><td colSpan={selectionMode ? 9 : 8} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>
                {search.trim()
                  ? <><span>Aucun résultat — </span><button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer</button></>
                  : 'Aucune intervention'}
              </td></tr>
            )}
            {items.map(i => (
              <tr key={i.id} style={selected.has(i.id) ? { background: 'var(--blBg)' } : {}}>
                {selectionMode && <td style={{ paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} /></td>}
                <td className="td-bold" style={{ cursor:'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {i.urgence && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rd)', flexShrink: 0 }} />}
                    {i.numero}
                  </div>
                </td>
                <td style={{ cursor:'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                  <div className="td-bold">{i.client?.nom} {i.client?.prenom}</div>
                  <div style={{ fontSize:11,color:'var(--t3)' }}>{i.client?.telephone}</div>
                </td>
                {isAdmin&&<td style={{ fontSize:13 }}>{i.intervenant?.prenom} {i.intervenant?.nom}</td>}
                <td>{i.type?<span className={`pill ${ACT_PILL[i.type]||'pill-gray'}`}>{i.type}</span>:'—'}</td>
                <td style={{ fontSize:12 }}>{i.date_prevue?new Date(i.date_prevue).toLocaleDateString('fr-FR'):'—'}</td>
                <td className="td-bold">{i.montant_ttc?i.montant_ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}):'—'}</td>
                <td><span className={`pill ${SC[i.statut]||'pill-gray'}`}>{i.statut.replace('_',' ')}</span></td>
                <td>
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn-icon sm" onClick={() => nav(`/interventions/${i.id}`)} title="Voir"><Eye size={14} /></button>
                    {!showArchived && <button className="btn-icon sm" onClick={() => openEdit(i)} title="Modifier"><Pencil size={14} /></button>}
                    {!showArchived && <button className="btn-icon sm" onClick={() => openMsgModal(i)} title="Messagerie"><Mail size={14} /></button>}
                    {isAdmin && <button className="btn-icon sm" onClick={() => handleArchive(i)} title={i.archive ? 'Restaurer' : 'Archiver'} style={{ color: i.archive ? 'var(--gnTx)' : 'var(--amTx)' }}>{i.archive ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>}
                    {isAdmin && !i.archive && <button className="btn-icon sm" style={{ color:'var(--rdTx)' }} onClick={() => handleDelete(i)} title="Supprimer"><Trash2 size={14} /></button>}
                  </div>
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
          <SheetRow icon={<Eye size={16} />} label="Voir le détail"
            onClick={() => { setActiveSheet(null); nav(`/interventions/${activeSheet.id}`) }} />

          {/* Statut rapide intervenant */}
          {!isAdmin && activeSheet.intervenant_id === user?.id && activeSheet.statut === 'accepte' && (
            <>
              <SheetSection label="Avancement" />
              <SheetRow icon={<Play size={16} />} label="Démarrer l'intervention"
                onClick={() => { setActiveSheet(null); handleQuickStatut(activeSheet.id, 'en_cours') }}
                disabled={update.isPending} />
            </>
          )}
          {!isAdmin && activeSheet.intervenant_id === user?.id && activeSheet.statut === 'en_cours' && (
            <>
              <SheetSection label="Avancement" />
              <SheetRow icon={<CheckCircle2 size={16} />} label="Marquer terminée"
                onClick={() => { setActiveSheet(null); handleQuickStatut(activeSheet.id, 'termine') }}
                disabled={update.isPending} />
            </>
          )}

          {/* Actions */}
          {!showArchived && (
            <>
              <SheetSection label="Actions" />
              <SheetRow icon={<Pencil size={16} />} label="Modifier"
                onClick={() => { setActiveSheet(null); openEdit(activeSheet) }} />
              <SheetRow icon={<Mail size={16} />} label="Envoyer via messagerie"
                onClick={() => { setActiveSheet(null); openMsgModal(activeSheet) }} />
            </>
          )}

          {/* Admin */}
          {isAdmin && (
            <>
              <SheetSection label="Administration" />
              <SheetRow
                icon={activeSheet.archive ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                label={activeSheet.archive ? 'Restaurer' : 'Archiver'}
                onClick={() => { setActiveSheet(null); handleArchive(activeSheet) }} />
              {!activeSheet.archive && (
                <SheetRow icon={<Trash2 size={16} />} label="Supprimer" danger
                  onClick={() => { setActiveSheet(null); handleDelete(activeSheet) }} />
              )}
            </>
          )}
        </DocSheet>
      )}

      {/* ── Actions globales mobile ─────────────────────── */}
      {showMobileActions && (
        <DocSheet title="Actions" onClose={() => setShowMobileActions(false)}>
          <SheetRow
            icon={<FileSpreadsheet size={16} />}
            label="Exporter Excel"
            sublabel={items.length === 0 ? 'Aucune intervention' : `${items.length} intervention${items.length > 1 ? 's' : ''}`}
            onClick={() => { setShowMobileActions(false); handleExport() }}
            disabled={items.length === 0}
          />
          {isAdmin && (
            <SheetRow
              icon={<Archive size={16} />}
              label={showArchived ? 'Masquer les archives' : 'Voir les archives'}
              onClick={() => { setShowMobileActions(false); setShowArchived(v => !v); setStatut('tous'); exitSelection() }}
            />
          )}
          {isAdmin && !selectionMode && items.length > 0 && (
            <SheetRow
              icon={<CheckSquare size={16} />}
              label="Mode sélection"
              sublabel="Sélectionner des interventions"
              onClick={() => { setShowMobileActions(false); setSelectionMode(true) }}
            />
          )}
          {isAdmin && showArchived && items.length > 0 && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon={<Trash2 size={16} />}
                label="Vider les archives"
                sublabel={`Supprimer les ${items.length} archive${items.length > 1 ? 's' : ''}`}
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

      {/* MODAL CRÉER */}
      {createModal && (
        <div className={`modal-overlay${createModalClosing?' is-closing':''}`} onClick={closeCreateModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">Nouvelle intervention</span><button className="btn-icon sm" onClick={closeCreateModal}><X size={15} /></button></div>
            <form onSubmit={submitCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Client <span className="req">*</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <CustomSelect
                        value={createForm.client_id}
                        placeholder="Sélectionner un client…"
                        options={clients.map(c => ({
                          value: c.id,
                          label: [c.nom, c.prenom].filter(Boolean).join(' ') + (c.telephone ? ` · ${c.telephone}` : '')
                        }))}
                        onChange={cid => {
                          const client = clients.find(c => c.id === cid)
                          setCreateForm(f => ({ ...f, client_id: cid, adresse: client?.adresse_intervention || f.adresse }))
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowClientModal(true)}
                      title="Créer un nouveau client"
                      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                      + Nouveau
                    </button>
                  </div>
                </div>
                <div className="form-group"><label>Intervenant</label>
                  <CustomSelect
                    value={createForm.intervenant_id}
                    placeholder="Non affecté"
                    options={[
                      { value: '', label: 'Non affecté' },
                      ...intervenants.map(p => ({
                        value: p.id,
                        label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant sans nom'
                          + (p.actif === false ? ' (inactif)' : '')
                      }))
                    ]}
                    onChange={v => setCreateForm(f => ({ ...f, intervenant_id: v }))}
                  />
                </div>
                <div className="form-group"><label>Activité</label>
                  <CustomSelect
                    value={createForm.type}
                    options={ACTIVITES}
                    onChange={v => setCreateForm(f => ({ ...f, type: v as Categorie }))}
                  />
                </div>
                <div className="form-group"><label>Date prévue</label>
                  <input type="datetime-local" value={createForm.date_prevue} onChange={e => setCreateForm(f=>({...f,date_prevue:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label>Adresse</label>
                  <AddressAutocomplete
                    value={createForm.adresse}
                    onChange={v => setCreateForm(f => ({ ...f, adresse: v }))}
                    onSelect={s => setCreateForm(f => ({ ...f, adresse: s.label }))}
                    placeholder="Adresse complète"
                  />
                </div>
                <div className="form-group"><label>Description</label><textarea value={createForm.description} onChange={e => setCreateForm(f=>({...f,description:e.target.value}))} placeholder="Nature de l'intervention…" /></div>
                {isAdmin && <div className="form-group"><label>Notes admin (privées)</label><textarea value={createForm.notes_admin} onChange={e => setCreateForm(f=>({...f,notes_admin:e.target.value}))} /></div>}
                <label style={{ display:'flex',alignItems:'center',gap:8,textTransform:'none',fontSize:14,fontWeight:500,letterSpacing:0,cursor:'pointer' }}>
                  <input type="checkbox" checked={createForm.urgence} onChange={e => setCreateForm(f=>({...f,urgence:e.target.checked}))} style={{ width:'auto',minHeight:'auto' }} />
                  <AlertTriangle size={14} color="var(--rdTx)" /> Urgente
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending?'Création…':'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MODIFIER */}
      {editModal && editTarget && (
        <div className={`modal-overlay${editModalClosing?' is-closing':''}`} onClick={closeEditModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Modifier {editTarget.numero}</span>
              <button className="btn-icon sm" onClick={closeEditModal}><X size={15} /></button>
            </div>
            <form onSubmit={submitEdit}>
              <div className="modal-body">
                <div style={{ fontSize:13, color:'var(--t2)', marginBottom:14 }}>
                  {editTarget.client?.nom} {editTarget.client?.prenom} · {editTarget.adresse}
                </div>
                <div className="form-group"><label>Statut</label>
                  <CustomSelect
                    value={editForm.statut}
                    options={STATUTS_LIST.map(s => ({ value: s, label: s.replace(/_/g, ' ') }))}
                    onChange={v => setEditForm(f => ({ ...f, statut: v }))}
                  />
                </div>
                <div className="form-group"><label>Montant TTC (€)</label>
                  <input type="number" step="0.01" min="0" value={editForm.montant_ttc} onChange={e => setEditForm(f=>({...f,montant_ttc:e.target.value}))} placeholder="0.00" />
                </div>
                {isAdmin && (
                  <div className="form-group"><label>Intervenant</label>
                    <CustomSelect
                      value={editForm.intervenant_id}
                      placeholder="Non affecté"
                      options={[
                        { value: '', label: 'Non affecté' },
                        ...intervenants.map(p => ({
                          value: p.id,
                          label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant sans nom'
                            + (p.actif === false ? ' (inactif)' : '')
                        }))
                      ]}
                      onChange={v => setEditForm(f => ({ ...f, intervenant_id: v }))}
                    />
                  </div>
                )}
                <div className="form-group"><label>Date prévue</label>
                  <input type="datetime-local" value={editForm.date_prevue} onChange={e => setEditForm(f=>({...f,date_prevue:e.target.value}))} />
                </div>
                {isAdmin && <div className="form-group"><label>Notes admin (privées)</label><textarea value={editForm.notes_admin} onChange={e => setEditForm(f=>({...f,notes_admin:e.target.value}))} /></div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeEditModal}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={update.isPending}>{update.isPending?'Sauvegarde…':'Enregistrer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CRÉER CLIENT RAPIDE */}
      {showClientModal && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowClientModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Nouveau client</span>
              <button className="btn-icon sm" onClick={() => setShowClientModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={submitNewClient}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Nom <span className="req">*</span></label>
                  <input
                    autoFocus
                    value={clientForm.nom}
                    onChange={e => setClientForm(f => ({ ...f, nom: e.target.value }))}
                    placeholder="Nom du client"
                  />
                </div>
                <div className="form-group">
                  <label>Prénom</label>
                  <input
                    value={clientForm.prenom}
                    onChange={e => setClientForm(f => ({ ...f, prenom: e.target.value }))}
                    placeholder="Prénom (optionnel)"
                  />
                </div>
                <div className="form-group">
                  <label>Téléphone</label>
                  <input
                    type="tel"
                    value={clientForm.telephone}
                    onChange={e => setClientForm(f => ({ ...f, telephone: e.target.value }))}
                    placeholder="06 00 00 00 00"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={clientForm.email}
                    onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@exemple.fr (optionnel)"
                  />
                </div>
                <div className="form-group">
                  <label>Adresse d'intervention</label>
                  <AddressAutocomplete
                    value={clientForm.adresse_intervention}
                    onChange={v => setClientForm(f => ({ ...f, adresse_intervention: v }))}
                    onSelect={s => setClientForm(f => ({ ...f, adresse_intervention: s.label }))}
                    placeholder="Adresse complète (optionnel)"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowClientModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={createClient.isPending}>
                  {createClient.isPending ? 'Création…' : 'Créer et sélectionner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ENVOYER EN MESSAGERIE */}
      {msgModal && (
        <div className="modal-overlay" onClick={() => setMsgModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={16} /> Envoyer via messagerie — {msgModal.inter.numero}</span>
              <button className="btn-icon sm" onClick={() => setMsgModal(null)}><X size={15} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Destinataire *</label>
                <CustomSelect
                  value={msgModal.destinataire_id}
                  placeholder="Sélectionner…"
                  options={profiles.filter(p => p.id !== user?.id).map(p => ({
                    value: p.id,
                    label: ([p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Sans nom') + ` — ${p.role}`
                  }))}
                  onChange={v => setMsgModal(m => m ? { ...m, destinataire_id: v } : null)}
                />
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea
                  rows={6}
                  value={msgModal.text}
                  onChange={e => setMsgModal(m => m ? { ...m, text: e.target.value } : null)}
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMsgModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSendMsg} disabled={sendMsg.isPending || !msgModal.text.trim()}>
                {sendMsg.isPending ? 'Envoi…' : <><Mail size={14} /> Envoyer</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
