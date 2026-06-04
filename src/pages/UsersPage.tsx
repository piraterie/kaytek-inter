// src/pages/UsersPage.tsx
import { useState } from 'react'
import { useProfiles, useUpdateProfile } from '@/lib/hooks'
import { useToastStore } from '@/lib/store'
import { inviterIntervenant } from '@/lib/supabase/auth'

export default function UsersPage() {
  const { add } = useToastStore()
  const { data: profiles = [], isLoading } = useProfiles()
  const upd = useUpdateProfile()
  const [modal, setModal] = useState(false)
  const [invForm, setInvForm] = useState({ email:'', nom:'', prenom:'', commission_pct:30 })
  const [invLoading, setInvLoading] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setInvLoading(true)
    const { error } = await inviterIntervenant(invForm.email, invForm.nom, invForm.prenom, invForm.commission_pct)
    setInvLoading(false)
    if (error) add(error,'error')
    else { add(`Invitation envoyée à ${invForm.email}`); setModal(false); setInvForm({ email:'',nom:'',prenom:'',commission_pct:30 }) }
  }

  async function toggleActive(id: string, actif: boolean) {
    try { await upd.mutateAsync({ id, actif: !actif }); add(actif?'Compte désactivé (historique conservé)':'Compte réactivé') }
    catch(e:any) { add(e.message,'error') }
  }

  async function updateCommission(id: string, pct: number) {
    try { await upd.mutateAsync({ id, commission_pct: pct }); add('Commission mise à jour') }
    catch(e:any) { add(e.message,'error') }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{ flexWrap:'wrap',gap:10 }}>
        <div><h1 className="page-title">Utilisateurs</h1><p className="page-subtitle">Admin : accès total · Intervenants : données isolées (RLS)</p></div>
        <button className="btn btn-primary" onClick={()=>setModal(true)}>+ Inviter intervenant</button>
      </div>
      <div className="card">
        {isLoading&&<div style={{ padding:24,textAlign:'center',color:'var(--t3)' }}>Chargement…</div>}
        {profiles.map(p=>(
          <div key={p.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderBottom:'1px solid var(--b0)',transition:'background .12s' }} onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background='var(--s1)'} onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background=''}>
            <div className={`avatar ${p.role==='admin'?'purple':''}`} style={{ width:34,height:34,fontSize:12 }}>{(p.prenom?.[0]||'')+(p.nom?.[0]||'')}</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:12,fontWeight:600,color:'var(--t0)' }}>{p.prenom} {p.nom}</div>
              <div style={{ fontSize:11,color:'var(--t2)' }}>{p.email} · {p.role} {p.role==='intervenant'?`· comm. ${p.commission_pct}%`:''}</div>
            </div>
            <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0,flexWrap:'wrap' }}>
              <span className={`pill ${p.role==='admin'?'pill-purple':'pill-blue'}`}>{p.role}</span>
              {p.role==='intervenant'&&(
                <>
                  <span className={`pill ${p.actif?'pill-green':'pill-red'}`}>{p.actif?'Actif':'Inactif'}</span>
                  <div className={`toggle ${p.actif?'':'off'}`} onClick={()=>toggleActive(p.id, p.actif)} title={p.actif?'Désactiver':'Activer'} />
                  <input type="number" defaultValue={p.commission_pct} min={0} max={100} step={1}
                    style={{ width:55,fontSize:11,padding:'3px 6px',minHeight:'auto' }}
                    onBlur={e=>{ if(+e.target.value!==p.commission_pct) updateCommission(p.id,+e.target.value) }}
                    title="Commission %" />
                  <span style={{ fontSize:11,color:'var(--t2)' }}>%</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:10,padding:'10px 14px',background:'var(--blBg)',borderRadius:'var(--r2)',border:'1px solid var(--blBd)',fontSize:11,color:'var(--blTx)',display:'flex',gap:8,alignItems:'center' }}>
        🛡 RLS actif — chaque intervenant ne voit que ses interventions. Suppression = désactivation, historique conservé.
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={()=>setModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">Inviter un intervenant</span><button className="btn-icon sm" onClick={()=>setModal(false)}>✕</button></div>
            <form onSubmit={handleInvite}>
              <div className="modal-body">
                <p style={{ fontSize:12,color:'var(--t2)',marginBottom:14 }}>Un email d'invitation sera envoyé. L'intervenant pourra définir son mot de passe.</p>
                <div className="form-row">
                  <div className="form-group"><label>Prénom *</label><input value={invForm.prenom} onChange={e=>setInvForm(f=>({...f,prenom:e.target.value}))} required /></div>
                  <div className="form-group"><label>Nom *</label><input value={invForm.nom} onChange={e=>setInvForm(f=>({...f,nom:e.target.value}))} required /></div>
                </div>
                <div className="form-group"><label>Email *</label><input type="email" value={invForm.email} onChange={e=>setInvForm(f=>({...f,email:e.target.value}))} required /></div>
                <div className="form-group"><label>Commission admin (%)</label><input type="number" min={0} max={100} value={invForm.commission_pct} onChange={e=>setInvForm(f=>({...f,commission_pct:+e.target.value}))} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={invLoading}>{invLoading?'Envoi…':'Envoyer invitation'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
