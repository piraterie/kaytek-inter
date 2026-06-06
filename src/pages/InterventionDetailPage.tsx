// src/pages/InterventionDetailPage.tsx
import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIntervention, useUpdateIntervention, useUploadPhoto, useCreateFacture, useDevis, useSignedPhotos } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { Lightbox } from '@/components/Lightbox'
import { supabase } from '@/lib/supabase/client'

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

  const { data: inter, isLoading } = useIntervention(id!)
  const update = useUpdateIntervention()
  const uploadPhoto = useUploadPhoto()
  const createFacture = useCreateFacture()
  const { data: mesDevis = [] } = useDevis()
  const [cr, setCr] = useState({ travail_realise:'', materiel_utilise:'', temps_passe_min:0, montant_ttc:0, cout_pieces:0 })
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
    })
  }, [inter?.id])

  if (isLoading) return <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>Chargement…</div>
  if (!inter) return <div style={{ textAlign:'center',padding:40,color:'var(--rdTx)' }}>Intervention introuvable</div>

  const commPct = inter.intervenant?.commission_pct || 30
  const ttc = inter.montant_ttc ?? 0
  const commAdmin = Math.round(ttc * commPct / 100 * 100) / 100
  const partBrute = ttc - commAdmin
  const coutPieces = inter.cout_pieces || 0
  const partNette = Math.max(0, partBrute - coutPieces)

  async function updateStatut(statut: typeof STATUTS[number]) {
    try { await update.mutateAsync({ id:id!, statut }); add(`Statut : ${statut.replace('_',' ')}`) }
    catch(e:any) { add(e.message,'error') }
  }

  async function saveCR(e: React.FormEvent) {
    e.preventDefault()
    try { await update.mutateAsync({ id:id!, ...cr }); add('Compte-rendu sauvegardé') }
    catch(e:any) { add(e.message,'error') }
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
    for (const admin of admins) {
      await supabase.from('messages').insert({
        expediteur_id: user!.id, destinataire_id: admin.id,
        contenu, type: 'texte', intervention_id: id
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
    if (!inter.client_id) { add('Cette intervention n\'a pas de client associé', 'warning'); return }
    try {
      await createFacture.mutateAsync({
        intervention_id: id!,
        client_id: inter.client_id,
        montant_ht: Math.round((factureForm.montant_ttc / 1.1) * 100) / 100,
        tva_montant: Math.round((factureForm.montant_ttc - factureForm.montant_ttc / 1.1) * 100) / 100,
        montant_ttc: factureForm.montant_ttc,
        notes: factureForm.notes
      })
      add('Facture envoyée à l\'admin pour validation')
      setFactureModal(false)
    } catch(e:any) { add(e.message,'error') }
  }

  const tabs = isAdmin
    ? ['detail','photos','cr','comm'] as const
    : ['detail','photos','cr','comm','facturation'] as const
  const tabLabel: Record<string,string> = { detail:'📋 Détail', photos:`📷 Photos (${inter.photos?.length||0})`, cr:'📝 Compte-rendu', comm:'💰 Commission', facturation:'📄 Devis / Facture' }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap:'wrap' }}>
        <button className="btn-icon" onClick={()=>nav('/interventions')}>←</button>
        <div>
          <h1 className="page-title">{inter.numero}</h1>
          <p className="page-subtitle">{inter.client?.nom} {inter.client?.prenom} · {inter.adresse}</p>
        </div>
        <div style={{ marginLeft:'auto',display:'flex',gap:8,flexWrap:'wrap' }}>
          {inter.urgence && <span className="urgence-badge">🔴 URGENT</span>}
          <span className={`pill ${inter.statut==='termine'?'pill-green':inter.statut==='en_cours'?'pill-orange':inter.statut==='en_attente'?'pill-amber':'pill-gray'}`}>{inter.statut.replace('_',' ')}</span>
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={()=>nav(`/devis/nouveau?intervention=${id}`)}>📄 Créer devis</button>}
          {peutFacturer && <button className="btn btn-primary btn-sm" onClick={()=>{ setTab('facturation') }}>📄 Facturation</button>}
        </div>
      </div>
      {/* ─── Panel de réponse intervenant ─────────────────────────── */}
      {isAssigned && inter.statut === 'en_attente' && (
        <div className="card card-body mb-4" style={{ border:'2px solid var(--amBd)',background:'var(--amBg)' }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:12,marginBottom:14 }}>
            <span style={{ fontSize:22,flexShrink:0 }}>📋</span>
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
                ✅ Accepter
              </button>
              <button className="btn btn-secondary" onClick={()=>setReponseMode('refuser')}
                style={{ color:'var(--rdTx)',borderColor:'var(--rdBd)' }}>
                ✕ Refuser
              </button>
              <button className="btn btn-secondary" onClick={()=>setReponseMode('proposer')}>
                💬 Faire une proposition
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
                  {reponseLoading?'Envoi…':'📤 Envoyer la proposition'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display:'flex',borderBottom:'1px solid var(--b0)',marginBottom:16,gap:0,overflowX:'auto' }}>
        {tabs.map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{ padding:'9px 14px',fontSize:12,fontWeight:tab===t?600:400,background:'none',border:'none',borderBottom:tab===t?'2px solid var(--bl)':'2px solid transparent',color:tab===t?'var(--blTx)':'var(--t2)',cursor:'pointer',marginBottom:-1,whiteSpace:'nowrap' }}>
            {tabLabel[t]}
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
            {isAdmin&&inter.notes_admin&&<div style={{ marginTop:12,padding:10,background:'var(--amBg)',borderRadius:7,border:'1px solid var(--amBd)',fontSize:11,color:'var(--amTx)' }}>🔒 <strong>Notes admin</strong><br/>{inter.notes_admin}</div>}
          </div>
          <div className="card card-body">
            {isAdmin ? (
              <>
                <p style={{ fontSize:12,fontWeight:600,marginBottom:12 }}>Changer le statut</p>
                <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
                  {STATUTS.map(s => (
                    <button key={s} onClick={()=>updateStatut(s)} disabled={inter.statut===s}
                      className={`btn ${inter.statut===s?'btn-primary':'btn-secondary'}`} style={{ justifyContent:'flex-start' }}>
                      {s==='termine'?'✅':s==='en_cours'?'🔄':s==='annule'?'✕':s==='facture'?'🧾':'○'} {s.replace(/_/g,' ')}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize:12,fontWeight:600,marginBottom:12 }}>Avancement</p>
                <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                  {inter.statut === 'accepte' && (
                    <button className="btn btn-primary" onClick={()=>updateStatut('en_cours')} disabled={update.isPending}>
                      🔄 Démarrer l'intervention
                    </button>
                  )}
                  {inter.statut === 'en_cours' && (
                    <button className="btn btn-primary" onClick={()=>updateStatut('termine')} disabled={update.isPending}
                      style={{ background:'#16a34a',border:'none' }}>
                      ✅ Marquer terminée
                    </button>
                  )}
                  {inter.statut === 'termine' && (
                    <div style={{ padding:12,background:'var(--gnBg)',borderRadius:8,border:'1px solid var(--gnBd)',fontSize:13,color:'var(--gnTx)',textAlign:'center',lineHeight:1.5 }}>
                      ✅ Intervention terminée<br/>
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
              {uploadPhoto.isPending?'⏳ Upload…':'📷 Ajouter photos'}
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
                <label>🔩 Pièces achetées (€)</label>
                <input type="number" step="0.01" min={0} defaultValue={inter.cout_pieces||''} placeholder="0.00"
                  onChange={e=>setCr(c=>({...c,cout_pieces:+e.target.value}))} />
                <span style={{ fontSize:11,color:'var(--t3)',marginTop:3,display:'block' }}>Montant des pièces payées par l'intervenant — déduit de sa part</span>
              </div>
            </div>
            {/* Aperçu du calcul en temps réel */}
            {(cr.montant_ttc > 0 || inter.montant_ttc) && (
              <div style={{ padding:'12px 14px',background:'var(--blBg)',borderRadius:8,border:'1px solid var(--blBd)',fontSize:12,marginBottom:14 }}>
                <div style={{ fontWeight:600,marginBottom:8,color:'var(--blTx)' }}>Aperçu de la répartition</div>
                {(() => {
                  const ttc = cr.montant_ttc || inter.montant_ttc || 0
                  const pct = commPct
                  const admin = Math.round(ttc * pct / 100 * 100) / 100
                  const brute = ttc - admin
                  const pieces = cr.cout_pieces ?? (inter.cout_pieces || 0)
                  const nette = Math.max(0, brute - pieces)
                  return (
                    <>
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>Montant client</span><span style={{ fontWeight:600 }}>{ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>Commission chef ({pct}%)</span><span style={{ color:'var(--blTx)',fontWeight:500 }}>− {admin.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                      {pieces > 0 && <div style={{ display:'flex',justifyContent:'space-between',padding:'3px 0' }}><span style={{ color:'var(--t2)' }}>Pièces achetées</span><span style={{ color:'var(--rdTx)',fontWeight:500 }}>− {pieces.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>}
                      <div style={{ display:'flex',justifyContent:'space-between',padding:'6px 0 0',borderTop:'1px solid var(--blBd)',marginTop:4 }}><span style={{ fontWeight:600 }}>Part nette intervenant</span><span style={{ fontWeight:700,color:'#16a34a' }}>{nette.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span></div>
                    </>
                  )
                })()}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>💾 Sauvegarder</button>
          </form>
        </div>
      )}
      {tab==='comm' && (
        <div className="card card-body" style={{ maxWidth:420 }}>
          {!inter.montant_ttc && (
            <div style={{ padding:'10px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:8,fontSize:12,color:'var(--amTx)',marginBottom:16 }}>
              ⚠ Renseignez le montant TTC dans l'onglet Compte-rendu pour voir les commissions.
            </div>
          )}
          {[
            ['Montant client TTC', ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}), 'var(--t0)'],
            [`Commission chef (${commPct}%)`, `− ${commAdmin.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}`, 'var(--blTx)'],
            ...(coutPieces > 0 ? [['🔩 Pièces achetées', `− ${coutPieces.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}`, 'var(--rdTx)']] : []),
          ].map(([l,v,c])=>(
            <div key={l as string} style={{ display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--b0)',fontSize:13 }}>
              <span style={{ color:'var(--t2)' }}>{l}</span>
              <span style={{ fontWeight:600,color:c as string }}>{v}</span>
            </div>
          ))}
          <div style={{ display:'flex',justifyContent:'space-between',padding:'12px 0 4px',fontSize:14 }}>
            <span style={{ fontWeight:700 }}>Part nette intervenant</span>
            <span style={{ fontWeight:700,color:'#16a34a',fontSize:16 }}>{partNette.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</span>
          </div>
          {coutPieces > 0 && (
            <div style={{ fontSize:11,color:'var(--t3)',marginTop:4 }}>
              = {ttc.toLocaleString('fr-FR',{style:'currency',currency:'EUR'})} − commission − pièces
            </div>
          )}
        </div>
      )}
      {tab==='facturation' && !isAdmin && (
        <div>
          {!peutFacturer && (
            <div style={{ padding:'14px 16px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:13,color:'var(--amTx)' }}>
              ⚠ Vous pouvez créer un devis ou une facture uniquement quand l'intervention est <strong>terminée</strong>.
            </div>
          )}
          {peutFacturer && canCreateDocs && (
            <div style={{ display:'flex',gap:10,marginBottom:16,flexWrap:'wrap' }}>
              <button className="btn btn-primary" onClick={()=>nav(`/devis/nouveau?intervention=${id}`)}>
                📄 Créer un devis
              </button>
              <button className="btn btn-secondary" onClick={()=>setFactureModal(true)}>
                🧾 Créer une facture directe
              </button>
            </div>
          )}
          {peutFacturer && !canCreateDocs && (
            <div style={{ padding:'12px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',marginBottom:12,fontSize:13,color:'var(--amTx)' }}>
              ⚠ L'administrateur ne vous a pas encore autorisé à créer des devis ou factures.
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
                      {d.statut==='en_attente_validation'?'En attente validation':d.statut}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={()=>nav(`/devis/${d.id}/apercu`)}>
                      👁 Aperçu
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
      {/* Modal création facture directe */}
      {factureModal && (
        <div className="modal-overlay" onClick={()=>setFactureModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Créer une facture</span>
              <button className="btn-icon sm" onClick={()=>setFactureModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateFacture}>
              <div className="modal-body">
                <div style={{ padding:'10px 14px',background:'var(--blBg)',borderRadius:'var(--r2)',border:'1px solid var(--blBd)',fontSize:12,color:'var(--blTx)',marginBottom:14 }}>
                  ℹ La facture sera soumise à validation de l'administrateur avant d'être active.
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
                  {createFacture.isPending?'Envoi…':'Envoyer pour validation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
