// src/pages/ParamsPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParametres, useUpdateParametres } from '@/lib/hooks'
import { useToastStore, useParamsStore } from '@/lib/store'
import { uploadLogo } from '@/lib/supabase/storage'

export default function ParamsPage() {
  const { add } = useToastStore()
  const { setParams } = useParamsStore()
  const { data: params, isLoading } = useParametres()
  const upd = useUpdateParametres()
  const logoRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Record<string,any>>({})
  const [logoUploading, setLogoUploading] = useState(false)

  useEffect(() => { if (params) setForm({ ...params }) }, [params])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await upd.mutateAsync(form)
      setParams({ ...params!, ...form })
      add('Paramètres sauvegardés')
    } catch(err:any) { add(err.message,'error') }
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setLogoUploading(true)
    const { url, error } = await uploadLogo(file)
    setLogoUploading(false)
    if (error) { add(error,'error'); return }
    setForm((f:any) => ({ ...f, logo_url:url }))
    add('Logo mis à jour')
  }

  if (isLoading) return <div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>Chargement…</div>

  const F = ({ label, field, type='text', placeholder='' }: { label:string; field:string; type?:string; placeholder?:string }) => (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'1px solid var(--b0)',gap:12,flexWrap:'wrap' }}>
      <div><div style={{ fontSize:12,fontWeight:500,color:'var(--t0)' }}>{label}</div></div>
      <input type={type} value={form[field]||''} onChange={e=>setForm((f:any)=>({...f,[field]:e.target.value}))} placeholder={placeholder} style={{ width:'auto',flex:1,maxWidth:220,minWidth:140 }} />
    </div>
  )

  return (
    <div style={{ maxWidth:800 }}>
      <div style={{ marginBottom:18 }}><h1 className="page-title">Paramètres entreprise</h1><p className="page-subtitle">Ces informations apparaissent sur tous les devis, factures et emails</p></div>
      <form onSubmit={save}>
        <div className="grid-2 mb-4">
          <div className="card card-body">
            <h3 style={{ fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14 }}>Identité</h3>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'1px solid var(--b0)',flexWrap:'wrap',gap:8 }}>
              <div><div style={{ fontSize:12,fontWeight:500,color:'var(--t0)' }}>Logo</div></div>
              <div className="flex items-center gap-2">
                {form.logo_url&&<img src={form.logo_url} alt="logo" style={{ width:36,height:36,borderRadius:7,objectFit:'contain',border:'1px solid var(--b1)' }} />}
                <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} style={{ display:'none' }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={()=>logoRef.current?.click()} disabled={logoUploading}>{logoUploading?'Upload…':'↑ Changer'}</button>
              </div>
            </div>
            <F label="Raison sociale" field="raison_sociale" />
            <F label="Téléphone" field="telephone" type="tel" />
            <F label="Email" field="email" type="email" />
            <F label="Site web" field="site_web" placeholder="www.exemple.fr" />
            <F label="Adresse" field="adresse" />
            <F label="Code postal" field="code_postal" />
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'none',gap:12 }}>
              <div><div style={{ fontSize:12,fontWeight:500,color:'var(--t0)' }}>Ville</div></div>
              <input value={form.ville||''} onChange={e=>setForm((f:any)=>({...f,ville:e.target.value}))} style={{ width:'auto',flex:1,maxWidth:220,minWidth:140 }} />
            </div>
          </div>
          <div className="card card-body">
            <h3 style={{ fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14 }}>Légal & bancaire</h3>
            <F label="SIRET" field="siret" />
            <F label="N° TVA" field="numero_tva" />
            <F label="IBAN" field="iban" type="password" />
            <F label="BIC" field="bic" />
            <F label="RC Pro" field="rc_pro" />
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'1px solid var(--b0)',gap:12 }}>
              <div><div style={{ fontSize:12,fontWeight:500,color:'var(--t0)' }}>TVA par défaut</div></div>
              <select value={form.tva_defaut||10} onChange={e=>setForm((f:any)=>({...f,tva_defaut:+e.target.value}))} style={{ width:'auto' }}>
                <option value={0}>0%</option><option value={5.5}>5.5%</option><option value={10}>10%</option><option value={20}>20%</option>
              </select>
            </div>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'none',gap:12 }}>
              <div><div style={{ fontSize:12,fontWeight:500,color:'var(--t0)' }}>Couleur principale</div></div>
              <div className="flex items-center gap-2">
                {['#2563eb','#111114','#16a34a','#ea580c','#7c3aed'].map(c=>(
                  <div key={c} onClick={()=>setForm((f:any)=>({...f,couleur_principale:c}))} style={{ width:22,height:22,borderRadius:'50%',background:c,cursor:'pointer',border:form.couleur_principale===c?'2px solid var(--t0)':'2px solid transparent',transition:'border-color .15s' }} />
                ))}
                <input type="color" value={form.couleur_principale||'#2563eb'} onChange={e=>setForm((f:any)=>({...f,couleur_principale:e.target.value}))} style={{ width:28,height:28,padding:1,border:'1px solid var(--b1)',borderRadius:'var(--r)',cursor:'pointer',minHeight:'auto' }} />
              </div>
            </div>
          </div>
          <div className="card card-body" style={{ gridColumn:'1/-1' }}>
            <h3 style={{ fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14 }}>Conditions générales (pied de page PDF)</h3>
            <textarea value={form.cgv||''} onChange={e=>setForm((f:any)=>({...f,cgv:e.target.value}))} style={{ minHeight:90 }} placeholder="Conditions de paiement, mentions légales…" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={()=>setForm({...params})}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={upd.isPending}>💾 {upd.isPending?'Sauvegarde…':'Sauvegarder'}</button>
        </div>
      </form>
    </div>
  )
}
