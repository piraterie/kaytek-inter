// src/pages/InterventionDetailPage.tsx
import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIntervention, useUpdateIntervention, useUploadPhoto } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'

const STATUTS = ['en_attente','accepte','en_cours','termine','facture','annule'] as const

export default function InterventionDetailPage() {
  const { id } = useParams<{id:string}>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const [tab, setTab] = useState<'detail'|'photos'|'cr'|'comm'>('detail')
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoType, setPhotoType] = useState<'avant'|'apres'|'autre'>('avant')

  const { data: inter, isLoading } = useIntervention(id!)
  const update = useUpdateIntervention()
  const uploadPhoto = useUploadPhoto()
  const [cr, setCr] = useState({ travail_realise:'', materiel_utilise:'', temps_passe_min:0, montant_ttc:0 })

  if (isLoading) return <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>Chargement…</div>
  if (!inter) return <div style={{ textAlign:'center',padding:40,color:'var(--rdTx)' }}>Intervention introuvable</div>

  const commPct = inter.intervenant?.commission_pct || 30
  const commAdmin = inter.montant_ttc ? Math.round(inter.montant_ttc * commPct / 100 * 100)/100 : 0
  const partIntervenant = inter.montant_ttc ? inter.montant_ttc - commAdmin : 0

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

  const tabs = ['detail','photos','cr','comm'] as const
  const tabLabel = { detail:'📋 Détail', photos:`📷 Photos (${inter.photos?.length||0})`, cr:'📝 Compte-rendu', comm:'💰 Commission' }

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
        </div>
      </div>
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
            <p style={{ fontSize:12,fontWeight:600,marginBottom:12 }}>Changer le statut</p>
            <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
              {STATUTS.map(s => (
                <button key={s} onClick={()=>updateStatut(s)} disabled={inter.statut===s}
                  className={`btn ${inter.statut===s?'btn-primary':'btn-secondary'}`} style={{ justifyContent:'flex-start' }}>
                  {s==='termine'?'✅':s==='en_cours'?'🔄':s==='annule'?'✕':s==='facture'?'🧾':'○'} {s.replace('_',' ')}
                </button>
              ))}
            </div>
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
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10 }}>
            {(!inter.photos||inter.photos.length===0)&&<div style={{ gridColumn:'1/-1',textAlign:'center',padding:32,color:'var(--t3)' }}>Aucune photo</div>}
            {inter.photos?.map(p=>(
              <div key={p.id} style={{ position:'relative',aspectRatio:'4/3',borderRadius:8,overflow:'hidden',border:'1px solid var(--b1)' }}>
                <img src={p.url} alt={p.type||''} style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" />
                <div style={{ position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,.6)',color:'#fff',fontSize:10,padding:'3px 7px' }}>
                  {p.type} · {new Date(p.created_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
            ))}
          </div>
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
            <div className="form-group"><label>Montant final TTC (€)</label><input type="number" step="0.01" defaultValue={inter.montant_ttc||''} onChange={e=>setCr(c=>({...c,montant_ttc:+e.target.value}))} /></div>
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>💾 Sauvegarder</button>
          </form>
        </div>
      )}
      {tab==='comm' && (
        <div className="card card-body" style={{ maxWidth:400 }}>
          {inter.montant_ttc ? (
            [['Montant client',`${inter.montant_ttc} €`,'var(--t0)'],
             [`Part intervenant (${100-commPct}%)`,`${partIntervenant.toFixed(2)} €`,'var(--gnTx)'],
             [`Commission admin (${commPct}%)`,`${commAdmin.toFixed(2)} €`,'var(--blTx)']
            ].map(([l,v,c])=>(
              <div key={l as string} style={{ display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--b0)',fontSize:13 }}>
                <span style={{ color:'var(--t2)' }}>{l}</span>
                <span style={{ fontWeight:600,color:c as string }}>{v}</span>
              </div>
            ))
          ) : <p style={{ color:'var(--t3)',textAlign:'center',padding:20 }}>Aucun montant renseigné</p>}
        </div>
      )}
    </div>
  )
}
