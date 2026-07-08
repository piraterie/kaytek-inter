// src/pages/InterventionDetailPage.tsx
import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, FileText, ClipboardList, Camera, NotebookPen,
  DollarSign, CheckCircle2, XCircle, MessageCircle, Send, Zap, RefreshCw,
  Receipt, Circle, Play, Package, Save, Eye, Phone, MapPin, Copy, X,
  Loader2, Info, Check, Handshake, UserCog,
} from 'lucide-react'
import { useIntervention, useUpdateIntervention, useUploadPhoto, useCreateFacture, useDevis, useSignedPhotos, useIntervenants } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { Lightbox } from '@/components/Lightbox'
import { supabase } from '@/lib/supabase/client'
import { DocSheet, SheetRow } from '@/components/DocSheet'
import { CustomSelect } from '@/components/CustomSelect'
import SendToPartnerModal from '@/components/SendToPartnerModal'

const STATUTS = ['en_attente','accepte','en_cours','termine','facture','annule'] as const

export default function InterventionDetailPage() {
  const { id } = useParams<{id:string}>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const canCreateDocs = isAdmin || user?.can_create_documents === true
  const [tab, setTab] = useState<'detail'|'photos'|'cr'|'comm'|'facturation'>('detail')
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoType, setPhotoType] = useState<'avant'|'apres'|'autre'>('avant')
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [factureForm, setFactureForm] = useState({ montant_ttc: 0, notes: '' })
  const [factureModal, setFactureModal] = useState(false)
  const [reponseMode, setReponseMode] = useState<null | 'refuser' | 'proposer'>(null)
  const [reponseTexte, setReponseTexte] = useState('')
  const [reponseLoading, setReponseLoading] = useState(false)
  const [actionsSheet, setActionsSheet] = useState(false)
  const [partnerModal, setPartnerModal] = useState(false)
  const [assignModal, setAssignModal] = useState(false)
  const [assignIntervenantId, setAssignIntervenantId] = useState('')
  const [assigning, setAssigning] = useState(false)

  const { data: inter, isLoading } = useIntervention(id!)
  const update = useUpdateIntervention()
  const uploadPhoto = useUploadPhoto()
  const createFacture = useCreateFacture()
  const { data: mesDevis = [] } = useDevis()
  const { data: intervenants = [] } = useIntervenants()
  const [cr, setCr] = useState({ travail_realise:'', materiel_utilise:'', temps_passe_min:0, montant_ttc:0, cout_pieces:0, materiel_payeur: null as string | null })
  const signedPhotoUrls = useSignedPhotos(inter?.photos)

  // Sync CR form with existing intervention data when loaded
  useEffect(() => {
    if (!inter) return
    setCr({
      travail_realise: inter.travail_realise || '',
      materiel_utilise: inter.materiel_utilise || '',
      temps_passe_min: inter.temps_passe_min || 0,
      montant_ttc: inter.montant_ttc || 0,
      cout_pieces: inter.cout_pieces || 0,
      materiel_payeur: inter.materiel_payeur || null,
    })
  }, [inter?.id])

  if (isLoading) return <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>Chargement…</div>
  if (!inter) return <div style={{ textAlign:'center',padding:40,color:'var(--rdTx)' }}>Intervention introuvable</div>

  const commPct = inter.intervenant?.commission_pct || 30
  const ttc = inter.montant_ttc ?? 0
  const coutPieces = inter.materiel_confirme ? (inter.cout_pieces || 0) : 0
  const base = ttc - coutPieces
  const commIntervenant = Math.round(base * commPct / 100 * 100) / 100
  const resteEntreprise = Math.round((base - commIntervenant) * 100) / 100

  async function updateStatut(statut: typeof STATUTS[number]) {
    try { await update.mutateAsync({ id:id!, statut }); add(`Statut : ${statut.replace('_',' ')}`) }
    catch(e:any) { add(e.message,'error') }
  }

  function openAssignModal() {
    setAssignIntervenantId(inter?.intervenant_id || '')
    setAssignModal(true)
  }

  async function handleAssign() {
    setAssigning(true)
    try {
      await update.mutateAsync({ id: id!, intervenant_id: assignIntervenantId || null } as any)
      add(assignIntervenantId ? 'Intervenant assigné' : 'Intervenant retiré')
      setAssignModal(false)
    } catch (e: any) { add(e.message, 'error') }
    setAssigning(false)
  }

  async function saveCR(e: React.FormEvent) {
    e.preventDefault()
    const payload: any = { id: id!, ...cr }
    if (inter.materiel_confirme && cr.cout_pieces !== (inter.cout_pieces || 0)) {
      payload.materiel_confirme = false
      payload.materiel_confirme_par = null
      payload.materiel_confirme_at = null
    }
    try { await update.mutateAsync(payload); add('Compte-rendu sauvegardé') }
    catch(e:any) { add(e.message,'error') }
  }

  async function confirmMateriel() {
    try {
      await update.mutateAsync({ id: id!, materiel_confirme: true, materiel_confirme_par: user!.id, materiel_confirme_at: new Date().toISOString() })
      add('Matériel confirmé')
    } catch(e:any) { add(e.message,'error') }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    for (const file of Array.from(e.target.files||[])) {
      try { await uploadPhoto.mutateAsync({ file, interventionId:id!, type:photoType }); add('Photo ajoutée') }
      catch(err:any) { add(err.message,'error') }
    }
    if(fileRef.current) fileRef.current.value=''
  }

  const peutFacturer = !isAdmin && inter.statut === 'termine'
  const devisIntervention = mesDevis.filter(d => d.intervention_id === id)
  const isAssigned = !isAdmin && inter.intervenant_id === user?.id

  async function notifyAdminsMessage(contenu: string) {
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (!admins?.length) return
    const org_id = user?.organisation_id
    if (!org_id) return
    for (const admin of admins) {
      await supabase.from('messages').insert({
        expediteur_id: user!.id, destinataire_id: admin.id,
        contenu, type: 'texte', intervention_id: id, organisation_id: org_id
      })
    }
  }

  async function handleAccepter() {
    try {
      await update.mutateAsync({ id: id!, statut: 'accepte' })
      await notifyAdminsMessage(`✅ ${user?.prenom} ${user?.nom} a accepté l'intervention ${inter.numero} — ${inter.adresse}`)
      add('Intervention acceptée')
    } catch(e: any) { add(e.message, 'error') }
  }

  async function handleRefuser() {
    if (!reponseTexte.trim()) return
    setReponseLoading(true)
    try {
      await notifyAdminsMessage(`❌ ${user?.prenom} ${user?.nom} a refusé l'intervention ${inter.numero}\n\nRaison : ${reponseTexte}`)
      add('Refus transmis à l\'administrateur')
      setReponseMode(null)
      setReponseTexte('')
    } catch(e: any) { add(e.message, 'error') }
    setReponseLoading(false)
  }

  async function handleProposer() {
    if (!reponseTexte.trim()) return
    setReponseLoading(true)
    try {
      await notifyAdminsMessage(`💬 Proposition de ${user?.prenom} ${user?.nom} pour l'intervention ${inter.numero}\n\n${reponseTexte}`)
      add('Proposition envoyée à l\'administrateur')
      setReponseMode(null)
      setReponseTexte('')
    } catch(e: any) { add(e.message, 'error') }
    setReponseLoading(false)
  }

  async function handleCreateFacture(e: React.FormEvent) {
    e.preventDefault()
    if (!id) { add("Identifiant d'intervention manquant", 'error'); return }
    if (!inter.client_id) { add('Cette intervention n\'a pas de client associé', 'warning'); return }
    try {
      await createFacture.mutateAsync({
        intervention_id: id,
        client_id: inter.client_id,
        montant_ht: Math.round((factureForm.montant_ttc / 1.1) * 100) / 100,
        tva_montant: Math.round((factureForm.montant_ttc - factureForm.montant_ttc / 1.1) * 100) / 100,
        montant_ttc: factureForm.montant_ttc,
        notes: factureForm.notes
      })
      add(user?.can_bypass_validation ? 'Facture créée' : 'Facture envoyée à l\'admin pour validation')
      setFactureModal(false)
    } catch(e:any) { add(e.message,'error') }
  }

  const tabs = isAdmin
    ? ['detail','photos','cr','comm'] as const
    : ['detail','photos','cr','comm','facturation'] as const
  const tabIcon: Record<string, React.ReactNode> = {
    detail: <ClipboardList size={13} />, photos: <Camera size={13} />, cr: <NotebookPen size={13} />,
    comm: <DollarSign size={13} />, facturation: <FileText size={13} />,
  }
  const tabLabel: Record<string,string> = { detail:'Détail', photos:`Photos (${inter.photos?.length||0})`, cr:'Compte-rendu', comm:'Commission', facturation:'Devis / Facture' }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap:'wrap' }}>
        <button className="btn-icon" onClick={()=>nav('/interventions')}><ArrowLeft size={16} /></button>
        <div>
          <h1 className="page-title">{inter.numero}</h1>
          <p className="page-subtitle">{inter.client?.nom} {inter.client?.prenom} · {inter.adresse}</p>
        </div>
        <div style={{ marginLeft:'auto',display:'flex',gap:8,flexWrap:'wrap' }}>
          {inter.urgence && <span className="urgence-badge"><AlertTriangle size={11} /> URGENT</span>}
          <span className={`pill ${inter.statut==='termine'?'pill-green':inter.statut==='en_cours'?'pill-orange':inter.statut==='en_attente'?'pill-amber':'pill-gray'}`}>{inter.statut.replace('_',' ')}</span>
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={()=>nav(`/devis/nouveau?intervention=${id}`)}><FileText size={14} /> Créer devis</button>}
          {isAdmin && <button className="btn btn-secondary btn-sm" onClick={openAssignModal}><UserCog size={14} /> {inter.intervenant ? 'Réassigner' : 'Assigner'} un intervenant</button>}
          {isAdmin && <button className="btn btn-secondary btn-sm" onClick={()=>setPartnerModal(true)}><Handshake size={14} /> Envoyer à un partenaire</button>}
          {peutFacturer && <button className="btn btn-primary btn-sm" onClick={()=>{ setTab('facturation') }}><FileText size={14} /> Facturation</button>}
        </div>
      </div>
      {/* ─── Panel de réponse intervenant ─────────────────────────── */}
      {isAssigned && inter.statut === 'en_attente' && (
        <div className="card card-body mb-4" style={{ border:'2px solid var(--amBd)',background:'var(--amBg)' }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:12,marginBottom:14 }}>
            <span style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,0,0,0.08)', color: 'var(--amTx)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink:0 }}><ClipboardList size={19} /></span>
            <div>
              <p style={{ fontWeight:700,fontSize:14,color:'var(--amTx)',marginBottom:3 }}>Nouvelle intervention vous a été assignée</p>
              <p style={{ fontSize:12,color:'var(--t2)' }}>
                {[inter.type,inter.adresse,inter.date_prevue&&new Date(inter.date_prevue).toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'})].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          {!reponseMode ? (
            <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
              <button className="btn btn-primary" onClick={handleAccepter} disabled={update.isPending}
                style={{ background:'#16a34a',border:'none' }}>
                <CheckCircle2 size={15} /> Accepter
              </button>
              <button className="btn btn-secondary" onClick={()=>setReponseMode('refuser')}
                style={{ color:'var(--rdTx)',borderColor:'var(--rdBd)' }}>
                <XCircle size={15} /> Refuser
              </button>
              <button className="btn btn-secondary" onClick={()=>setReponseMode('proposer')}>
                <MessageCircle size={15} /> Faire une proposition
              </button>
            </div>
          ) : reponseMode === 'refuser' ? (
            <div>
              <div className="form-group" style={{ marginBottom:10 }}>
                <label style={{ fontSize:12,fontWeight:600 }}>Raison du refus *</label>
                <textarea value={reponseTexte} onChange={e=>setReponseTexte(e.target.value)}
                  placeholder="Ex : Indisponible ce jour, problème de matériel…"
                  style={{ minHeight:80 }} autoFocus />
              </div>
              <div style={{ display:'flex',gap:8 }}>
                <button className="btn btn-secondary" onClick={()=>{setReponseMode(null);setReponseTexte('')}}>Annuler</button>
                <button className="btn btn-primary" onClick={handleRefuser}
                  disabled={!reponseTexte.trim()||reponseLoading}
                  style={{ background:'#dc2626',border:'none' }}>
                  {reponseLoading?'Envoi…':'Confirmer le refus'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="form-group" style={{ marginBottom:10 }}>
                <label style={{ fontSize:12,fontWeight:600 }}>Votre proposition *</label>
                <textarea value={reponseTexte} onChange={e=>setReponseTexte(e.target.value)}
                  placeholder="Ex : Disponible mais à une autre date, besoin de précisions sur l'accès…"
                  style={{ minHeight:80 }} autoFocus />
              </div>
              <div style={{ display:'flex',gap:8 }}>
                <button className="btn btn-secondary" onClick={()=>{setReponseMode(null);setReponseTexte('')}}>Annuler</button>
                <button className="btn btn-primary" onClick={handleProposer}
                  disabled={!reponseTexte.trim()||reponseLoading}>
                  {reponseLoading?'Envoi…':<><Send size={14} /> Envoyer la proposition</>}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Actions rapides ──────────────────────────────────────── */}
      {(inter.client?.telephone || inter.adresse) && (
        <div className="card card-body mb-4" style={{ padding: '12px 14px' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', gap: 8, minHeight: 48, fontWeight: 600 }}
            onClick={() => setActionsSheet(true)}
          >
            <Zap size={15} /> Actions
          </button>
        </div>
      )}

      <div style={{ display:'flex',borderBottom:'1px solid var(--b0)',marginBottom:16,gap:0,overflowX:'auto' }}>
        {tabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'9px 14px',fontSize:12,fontWeight:tab===t?600:400,background:'none',border:'none',borderBottom:tab===t?'2px solid var(--bl)':'2px solid transparent',color:tab===t?'var(--blTx)':'var(--t2)',cursor:'pointer',marginBottom:-1,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:5 }}>
            {tabIcon[t]}{tabLabel[t]}
          </button>
        ))}
      </div>
      {tab==='detail' && (
        <div className="grid-2">
          <div className="card card-body">
            {[['Client',`${inter.client?.nom||''} ${inter.client?.prenom||''}`],['Tél.',inter.client?.telephone||'—'],['Adresse',inter.adresse||'—'],['Code accès',inter.code_acces||'—'],['Type',inter.type||'—'],['Intervenant',`${inter.intervenant?.prenom||''} ${inter.intervenant?.nom||''}`],['Date',inter.date_prevue?new Date(inter.date_prevue).toLocaleString('fr-FR'):'—'],['Montant TTC',inter.montant_ttc?`${inter.montant_ttc} €`:'—']].map(([k,v])=>(
              <div key={k as string} style={{ display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--b0)',fontSize:12 }}>
                <span style={{ color:'var(--t2)' }}>{k}</span>
                <span style={{ fontWeight:500,textAlign:'right',maxWidth:'55%' }}>{v}</span>
              </div>
            ))}
            {isAdmin&&inter.notes_admin&&<div style={{ marginTop:12,padding:10,background:'var(--amBg)',borderRadius:7,border:'1px solid var(--amBd)',fontSize:11,color:'var(--amTx)' }}><strong>Notes admin</strong><br/>{inter.notes_admin}</div>}
          </div>
          <div className="card card-body">
            {isAdmin ? (
              <>
                <p style={{ fontSize:12,fontWeight:600,marginBottom:12 }}>Changer le statut</p>
                <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
                  {STATUTS.map(s => {
                    const StatIcon = s==='termine'?CheckCircle2:s==='en_cours'?RefreshCw:s==='annule'?XCircle:s==='facture'?Receipt:Circle
                    return (
                    <button key={s} onClick={()=>updateStatut(s)} disabled={inter.statut===s}
                      className={`btn ${inter.statut===s?'btn-primary':'btn-secondary'}`} style={{ justifyContent:'flex-start' }}>
                      <StatIcon size={14} /> {s.replace(/_/g,' ')}
                    </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize:12,fontWeight:600,marginBottom:12 }}>Avancement</p>
                <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                  {inter.statut === 'accepte' && (
                    <button className="btn btn-primary" onClick={()=>updateStatut('en_cours')} disabled={update.isPending}>
                      <Play size={14} /> Démarrer l'intervention
                    </button>
                  )}
                  {inter.statut === 'en_cours' && (
                    <button className="btn btn-primary" onClick={()=>updateStatut('termine')} disabled={update.isPending}
                      style={{ background:'#16a34a',border:'none' }}>
                      <CheckCircle2 size={14} /> Marquer terminée
                    </button>
                  )}
                  {inter.statut === 'termine' && (
                    <div style={{ padding:12,background:'var(--gnBg)',borderRadius:8,border:'1px solid var(--gnBd)',fontSize:13,color:'var(--gnTx)',textAlign:'center',lineHeight:1.5 }}>
                      <CheckCircle2 size={15} style={{ verticalAlign: 'text-bottom' }} /> Intervention terminée<br/>
                      <span style={{ fontSize:11,opacity:.8 }}>Rendez-vous dans l'onglet Devis / Facture</span>
                    </div>
                  )}
                  {inter.statut === 'en_attente' && (
                    <div style={{ padding:12,background:'var(--amBg)',borderRadius:8,border:'1px solid var(--amBd)',fontSize:13,color:'var(--amTx)',textAlign:'center' }}>
                      En attente de votre réponse ci-dessus
                    </div>
                  )}
                  {!['en_attente','accepte','en_cours','termine'].includes(inter.statut) && (
                    <div style={{ padding:12,background:'var(--s1)',borderRadius:8,fontSize:13,color:'var(--t2)',textAlign:'center' }}>
                      Statut : {inter.statut.replace(/_/g,' ')}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {tab==='photos' && (
        <div>
          <div className="card card-body mb-3 flex items-center gap-3 flex-wrap">
            <select value={photoType} onChange={e=>setPhotoType(e.target.value as any)} style={{ width:'auto' }}>
              <option value="avant">Avant</option><option value="apres">Après</option><option value="autre">Autre</option>
            </select>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{ display:'none' }} capture="environment" />
            <button className="btn btn-primary" onClick={()=>fileRef.current?.click()} disabled={uploadPhoto.isPending}>
              {uploadPhoto.isPending?<><Loader2 size={14} className="spin" /> Upload…</>:<><Camera size={14} /> Ajouter photos</>}
            </button>
            <span style={{ fontSize:11,color:'var(--t3)' }}>Compression auto · max 15 MB</span>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10 }}>
            {(!inter.photos||inter.photos.length===0)&&<div style={{ gridColumn:'1/-1',textAlign:'center',padding:32,color:'var(--t3)' }}>Aucune photo</div>}
            {inter.photos?.map(p=>{
              const photoUrl = (p.storage_path && signedPhotoUrls[p.storage_path]) || p.url
              return (
              <div key={p.id} onClick={()=>setLightboxSrc(photoUrl)} style={{ position:'relative',aspectRatio:'4/3',borderRadius:8,overflow:'hidden',border:'1px solid var(--b1)',cursor:'zoom-in' }}>
                <img src={photoUrl} alt={p.type||''} style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" />
                <div style={{ position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,.6)',color:'#fff',fontSize:10,padding:'3px 7px' }}>
                  {p.type} · {new Date(p.created_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
            )})}
          </div>
          {lightboxSrc && <Lightbox src={lightboxSrc} onClose={()=>setLightboxSrc(null)} />}
        </div>
      )}
      {tab==='cr' && (
        <div className="card card-body">
          <form onSubmit={saveCR}>
            <div className="form-group"><label>Travail réalisé</label><textarea defaultValue={inter.travail_realise||''} onChange={e=>setCr(c=>({...c,travail_realise:e.target.value}))} style={{ minHeight:100 }} /></div>
            <div className="form-row">
              <div className="form-group"><label>Matériel utilisé</label><input defaultValue={inter.materiel_utilise||''} onChange={e=>setCr(c=>({...c,materiel_utilise:e.target.value}))} /></div>
              <div className="form-group"><label>Temps (min)</label><input type="number" defaultValue={inter.temps_passe_min||''} onChange={e=>setCr(c=>({...c,temps_passe_min:+e.target.value}))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Montant final TTC (€)</label><input type="number" step="0.01" defaultValue={inter.montant_ttc||''} onChange={e=>setCr(c=>({...c,montant_ttc:+e.target.value}))} /></div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Package size={11} /> Pièces achetées (€)</label>
                <input type="number" step="0.01" min={0} defaultValue={inter.cout_pieces||''} placeholder="0.00"
                  onChange={e=>setCr(c=>({...c,cout_pieces:+e.target.value}))} />
                <span style={{ fontSize:11,color:'var(--t3)',marginTop:3,display:'block' }}>Coût des pièces — déduit de la base commissionnable une fois confirmé</span>
              </div>
            </div>
            {/* Section confirmation matériel */}
            {(cr.cout_pieces > 0 || (inter.cout_pieces || 0) > 0) && (
              <div style={{ padding:'12px 14px',background:'var(--b0)',borderRadius:8,border:'1px solid var(--b1)',marginBottom:14 }}>
                <div style={{ fontWeight:600,fontSize:13,marginBottom:10 }}>Prise en charge du matériel</div>
                <div className="form-group" style={{ marginBottom:8 }}>
                  <label style={{ fontSize:12 }}>Payé par</label>
                  <select value={cr.materiel_payeur||''} onChange={e=>setCr(c=>({...c,materiel_payeur:e.target.value||null}))}>
                    <option value="">— Non défini —</option>
                    <option value="intervenant">L'intervenant</option>
                    <option value="admin">L'entreprise</option>
                  </select>
                </div>
                {inter.materiel_confirme && cr.cout_pieces === (inter.cout_pieces || 0) ? (
                  <div style={{ fontSize:12,color:'#16a34a',display:'flex',alignItems:'center',gap:6 }}>
                    <CheckCircle2 size={14} /> Confirmé le {inter.materiel_confirme_at ? new Date(inter.materiel_confirme_at).toLocaleDateString('fr-FR') : ''}
                  </div>
                ) : inter.materiel_confirme && cr.cout_pieces !== (inter.cout_pieces || 0) ? (
                  <div style={{ fontSize:11,color:'var(--amTx)', display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={12} /> Montant modifié — la confirmation sera réinitialisée à la sauvegarde</div>
                ) : isAdmin && (cr.cout_pieces > 0 || (inter.cout_pieces || 0) > 0) ? (
                  <button type="button" className="btn btn-secondary" style={{ fontSize:12 }} onClick={confirmMateriel} disabled={update.isPending}>
                    <CheckCircle2 size={13} /> Confirmer le matériel
                  </button>
                ) : (
                  <div style={{ fontSize:11,color:'var(--t3)' }}>En attente de confirmation admin</div>
                )}
              </div>
            )}
            {/* Aperçu du calcul en temps réel */}
            {(cr.montant_ttc > 0 || inter.montant_ttc) && (
              <div style={{ padding:'12px 14px',background:'var(--blBg)',borderRadius:8,border:'1px solid var(--blBd)',fontSize:12,marginBottom:14 }}>
                <div style={{ fontWeight:600,marginBottom:8,color:'var(--blTx)' }}>Aperçu de la répartition</div>
                {(() => {
                  const caTtc = cr.montant_ttc || inter.montant_ttc || 0
                  const pct = commPct
                  const pieces = cr.cout_pieces ?? (inter.cout_pieces || 0)
                  const baseComm = caTtc - pieces
                  const comm = Math.round(baseComm * pct / 100 * 100) / 100
                  return (
                    <>
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>CA TTC</span><span style={{ fontWeight:600 }}>{caTtc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                      {pieces > 0 && <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>Matériel</span><span style={{ color:'var(--rdTx)',fontWeight:500 }}>− {pieces.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>}
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>Base commissionnable</span><span style={{ fontWeight:500 }}>{baseComm.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'6px 0 0',borderTop:'1px solid var(--blBd)',marginTop:4 }}><span style={{ fontWeight:600 }}>Commission intervenant ({pct}%)</span><span style={{ fontWeight:700,color:'#16a34a' }}>{comm.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                    </>
                  )
                })()}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={update.isPending}><Save size={14} /> Sauvegarder</button>
          </form>
        </div>
      )}
      {tab==='comm' && (
        <div className="card card-body" style={{ maxWidth:420 }}>
          {!inter.montant_ttc && (
            <div style={{ padding:'10px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:8,fontSize:12,color:'var(--amTx)',marginBottom:16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Renseignez le montant TTC dans l'onglet Compte-rendu pour voir les commissions.
            </div>
          )}
          {isAdmin && inter.intervenant && (
            <div style={{ fontSize:12,color:'var(--t3)',marginBottom:10 }}>
              Intervenant : <strong style={{ color:'var(--t1)' }}>{inter.intervenant.prenom} {inter.intervenant.nom}</strong>
            </div>
          )}
          {(inter.cout_pieces || 0) > 0 && !inter.materiel_confirme && (
            <div style={{ padding:'8px 12px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:6,fontSize:11,color:'var(--amTx)',marginBottom:12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Package size={12} style={{ flexShrink: 0 }} /> Matériel non confirmé ({(inter.cout_pieces||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}) — non déduit de la base
            </div>
          )}
          {[
            ['CA TTC', ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}), 'var(--t0)'],
            ...(coutPieces > 0 ? [['Matériel confirmé', `− ${coutPieces.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}`, 'var(--rdTx)']] : []),
            ['Base commissionnable', base.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}), 'var(--t0)'],
            ['Pourcentage', `${commPct} %`, 'var(--blTx)'],
          ].map(([l,v,c])=>(
            <div key={l as string} style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--b0)',fontSize:13 }}>
              <span style={{ color:'var(--t2)' }}>{l}</span>
              <span style={{ fontWeight:500,color:c as string }}>{v}</span>
            </div>
          ))}
          <div style={{ display:'flex',justifyContent:'space-between',padding:'12px 0 4px',fontSize:14,borderBottom:isAdmin?'1px solid var(--b0)':'none' }}>
            <span style={{ fontWeight:700 }}>Commission intervenant</span>
            <span style={{ fontWeight:700,color:'#16a34a',fontSize:16 }}>{commIntervenant.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span>
          </div>
          {isAdmin && (
            <div style={{ display:'flex',justifyContent:'space-between',padding:'10px 0 4px',fontSize:13 }}>
              <span style={{ color:'var(--t2)' }}>Reste entreprise</span>
              <span style={{ fontWeight:600,color:'var(--blTx)' }}>{resteEntreprise.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span>
            </div>
          )}
        </div>
      )}
      {tab==='facturation' && !isAdmin && (
        <div>
          {!peutFacturer && (
            <div style={{ padding:'14px 16px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:13,color:'var(--amTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0 }} /> Vous pouvez créer un devis ou une facture uniquement quand l'intervention est <strong>terminée</strong>.
            </div>
          )}
          {peutFacturer && canCreateDocs && (
            <div style={{ display:'flex',gap:10,marginBottom:16,flexWrap:'wrap' }}>
              <button className="btn btn-primary" onClick={()=>nav(`/devis/nouveau?intervention=${id}`)}>
                <FileText size={14} /> Créer un devis
              </button>
              <button className="btn btn-secondary" onClick={()=>setFactureModal(true)}>
                <Receipt size={14} /> Créer une facture directe
              </button>
            </div>
          )}
          {peutFacturer && !canCreateDocs && (
            <div style={{ padding:'12px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:13,color:'var(--amTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0 }} /> L'administrateur ne vous a pas encore autorisé à créer des devis ou factures.
            </div>
          )}
          {/* Devis existants pour cette intervention */}
          {devisIntervention.length > 0 && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header"><span className="card-title">Mes devis sur cette intervention</span></div>
              {devisIntervention.map(d => (
                <div key={d.id} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderBottom:'1px solid var(--b0)',gap:10,flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontWeight:600,fontSize:13 }}>{d.numero}</div>
                    <div style={{ fontSize:11,color:'var(--t3)',marginTop:2 }}>{d.total_ttc?.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</div>
                  </div>
                  <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                    <span className={`pill ${d.statut==='en_attente_validation'?'pill-amber':d.statut==='accepte'?'pill-green':d.statut==='refuse'?'pill-red':'pill-gray'}`}>
                      {d.statut==='en_attente_validation'?'En attente validation':d.statut==='brouillon'?'Brouillon':d.statut}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={()=>nav(`/devis/${d.id}/apercu`)}>
                      <Eye size={13} /> Aperçu
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {devisIntervention.length === 0 && peutFacturer && (
            <div style={{ textAlign:'center',padding:24,color:'var(--t3)',fontSize:13 }}>
              Aucun devis créé pour cette intervention.
            </div>
          )}
        </div>
      )}
      {/* ─── Actions sheet ──────────────────────────────────────── */}
      {actionsSheet && (() => {
        const tel = inter.client?.telephone
        const addrParts = [inter.adresse, inter.code_postal, inter.ville].filter(Boolean)
        const addrFull = addrParts.join(' ')
        const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(addrFull)}&navigate=yes`
        return (
          <DocSheet
            title="Actions rapides"
            subtitle={[inter.client?.nom, inter.client?.prenom].filter(Boolean).join(' ')}
            onClose={() => setActionsSheet(false)}
          >
            {tel && (
              <SheetRow icon={<Phone size={16} />} label="Appeler" sublabel={tel}
                onClick={() => { setActionsSheet(false); window.location.href = `tel:${tel}` }} />
            )}
            {tel && (
              <SheetRow icon={<MessageCircle size={16} />} label="Envoyer un SMS" sublabel={tel}
                onClick={() => { setActionsSheet(false); window.location.href = `sms:${tel}` }} />
            )}
            {addrFull && (
              <SheetRow icon={<MapPin size={16} />} label="Ouvrir dans Waze" sublabel={addrFull}
                onClick={() => { setActionsSheet(false); window.open(wazeUrl, '_blank') }} />
            )}
            {addrFull && (
              <SheetRow icon={<Copy size={16} />} label="Copier l'adresse" sublabel={addrFull}
                onClick={async () => {
                  setActionsSheet(false)
                  try { await navigator.clipboard.writeText(addrFull); add('Adresse copiée') }
                  catch { add("Impossible de copier l'adresse", 'error') }
                }} />
            )}
          </DocSheet>
        )
      })()}

      {/* Modal création facture directe */}
      {factureModal && (
        <div className="modal-overlay" onClick={()=>setFactureModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Créer une facture</span>
              <button className="btn-icon sm" onClick={()=>setFactureModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleCreateFacture}>
              <div className="modal-body">
                <div style={{ padding:'10px 14px',borderRadius:'var(--r2)',fontSize:12,marginBottom:14,
                  background: user?.can_bypass_validation ? 'var(--gnBg)' : 'var(--blBg)',
                  border: user?.can_bypass_validation ? '1px solid var(--gnBd)' : '1px solid var(--blBd)',
                  color: user?.can_bypass_validation ? 'var(--gnTx)' : 'var(--blTx)',
                  display: 'flex', alignItems: 'center', gap: 8 }}>
                  {user?.can_bypass_validation
                    ? <><Check size={14} style={{ flexShrink: 0 }} /> La facture sera créée directement. L'administrateur sera notifié.</>
                    : <><Info size={14} style={{ flexShrink: 0 }} /> La facture sera soumise à validation de l'administrateur avant d'être active.</>}
                </div>
                <div className="form-group">
                  <label>Montant TTC (€) *</label>
                  <input type="number" step="0.01" min={0} required
                    value={factureForm.montant_ttc || ''}
                    onChange={e=>setFactureForm(f=>({...f,montant_ttc:+e.target.value}))}
                    placeholder={inter.montant_ttc ? `Suggéré : ${inter.montant_ttc} €` : '0.00'}
                  />
                  {inter.montant_ttc && factureForm.montant_ttc === 0 && (
                    <button type="button" className="btn btn-secondary btn-sm mt-1"
                      onClick={()=>setFactureForm(f=>({...f,montant_ttc:inter.montant_ttc!}))}>
                      Utiliser {inter.montant_ttc} €
                    </button>
                  )}
                </div>
                <div className="form-group">
                  <label>Notes (optionnel)</label>
                  <textarea value={factureForm.notes} onChange={e=>setFactureForm(f=>({...f,notes:e.target.value}))} style={{ minHeight:60 }} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setFactureModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={createFacture.isPending}>
                  {createFacture.isPending ? 'Envoi…' : user?.can_bypass_validation ? 'Créer la facture' : 'Envoyer pour validation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {partnerModal && (
        <SendToPartnerModal intervention={inter} onClose={() => setPartnerModal(false)} />
      )}

      {assignModal && (
        <div className="modal-overlay" onClick={() => setAssignModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Assigner un intervenant</span>
              <button className="btn-icon sm" onClick={() => setAssignModal(false)}><X size={15} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Intervenant interne</label>
                <CustomSelect
                  value={assignIntervenantId}
                  placeholder="Non affecté"
                  options={[
                    { value: '', label: 'Non affecté' },
                    ...intervenants.map(p => ({
                      value: p.id,
                      label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant sans nom'
                    }))
                  ]}
                  onChange={setAssignIntervenantId}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--t3)' }}>
                Pour envoyer cette intervention à une organisation partenaire plutôt qu'à un intervenant interne, utilisez « Envoyer à un partenaire ».
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setAssignModal(false)}>Annuler</button>
              <button type="button" className="btn btn-primary" disabled={assigning} onClick={handleAssign}>
                {assigning ? 'Enregistrement…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
