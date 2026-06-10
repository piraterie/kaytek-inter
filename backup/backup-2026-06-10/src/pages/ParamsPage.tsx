// src/pages/ParamsPage.tsx
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useParametres, useUpdateParametres } from '@/lib/hooks'
import { useToastStore, useParamsStore } from '@/lib/store'
import { uploadLogo } from '@/lib/supabase/storage'
import { THEMES } from '@/lib/themes'

// Composant extrait EN DEHORS du render pour éviter le démontage/remontage à chaque frappe
interface ParamFieldProps {
  label: string
  field: string
  type?: string
  placeholder?: string
  form: Record<string, any>
  setForm: Dispatch<SetStateAction<Record<string, any>>>
}
function ParamField({ label, field, type = 'text', placeholder = '', form, setForm }: ParamFieldProps) {
  return (
    <div className="param-field-row">
      <div style={{ fontSize:13, fontWeight:500, color:'var(--t0)', flexShrink:0 }}>{label}</div>
      <input
        className="param-field-input"
        type={type}
        value={form[field] ?? ''}
        onChange={e => setForm((f: any) => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  )
}

export default function ParamsPage() {
  const { add } = useToastStore()
  const { setParams } = useParamsStore()
  const { data: params, isLoading } = useParametres()
  const upd = useUpdateParametres()
  const logoRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Record<string,any>>({})
  const [logoUploading, setLogoUploading] = useState(false)
  const initialized = useRef(false)

  // Initialiser le form uniquement au premier chargement — évite l'écrasement pendant la saisie
  useEffect(() => {
    if (params && !initialized.current) {
      setForm({ ...params })
      initialized.current = true
    }
  }, [params])

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
    setForm((f: any) => ({ ...f, logo_url: url }))
    add('Logo mis à jour')
  }

  if (isLoading) return <div style={{ textAlign:'center', padding:40, color:'var(--t3)' }}>Chargement…</div>

  return (
    <div className="devis-form-wrapper" style={{ maxWidth:1100, margin:'0 auto' }}>

      {/* ── Header ──────────────────────────────────────── */}
      <div style={{ marginBottom:20 }}>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Ces informations apparaissent sur tous les devis, factures et emails</p>
      </div>

      <form onSubmit={save}>

        {/* ── Section : Entreprise ────────────────────── */}
        <div className="params-section-label">Entreprise</div>
        <div className="grid-2 mb-4">

          {/* ── Identité ─────────────────────────────── */}
          <div className="card card-body">
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--b0)' }}>
              <span style={{ fontSize:20 }}>🏢</span>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Identité</div>
                <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>Coordonnées, logo, contact</div>
              </div>
            </div>

            {/* Logo */}
            <div className="param-field-row">
              <div style={{ fontSize:13, fontWeight:500, color:'var(--t0)', flexShrink:0 }}>Logo</div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                {form.logo_url && <img src={form.logo_url} alt="logo" style={{ width:40, height:40, borderRadius:8, objectFit:'contain', border:'1px solid var(--b1)' }} />}
                <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} style={{ display:'none' }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoRef.current?.click()} disabled={logoUploading}>
                  {logoUploading ? 'Upload…' : '↑ Changer'}
                </button>
              </div>
            </div>

            <ParamField label="Raison sociale" field="raison_sociale" form={form} setForm={setForm} />
            <ParamField label="Téléphone" field="telephone" type="tel" form={form} setForm={setForm} />
            <ParamField label="Email" field="email" type="email" form={form} setForm={setForm} />
            <ParamField label="Site web" field="site_web" placeholder="www.exemple.fr" form={form} setForm={setForm} />
            <ParamField label="Adresse" field="adresse" form={form} setForm={setForm} />
            <ParamField label="Code postal" field="code_postal" form={form} setForm={setForm} />
            <div className="param-field-row" style={{ borderBottom:'none' }}>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--t0)', flexShrink:0 }}>Ville</div>
              <input className="param-field-input" value={form.ville ?? ''} onChange={e => setForm((f:any) => ({...f, ville:e.target.value}))} />
            </div>
          </div>

          {/* ── Légal & bancaire ──────────────────────── */}
          <div className="card card-body">
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--b0)' }}>
              <span style={{ fontSize:20 }}>⚖️</span>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Légal & bancaire</div>
                <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>SIRET, TVA, IBAN, RC Pro</div>
              </div>
            </div>

            <ParamField label="SIRET" field="siret" form={form} setForm={setForm} />
            <ParamField label="N° TVA" field="numero_tva" form={form} setForm={setForm} />
            <ParamField label="IBAN" field="iban" type="password" form={form} setForm={setForm} />
            <ParamField label="BIC" field="bic" form={form} setForm={setForm} />
            <ParamField label="RC Pro" field="rc_pro" form={form} setForm={setForm} />

            <div className="param-field-row">
              <div style={{ fontSize:13, fontWeight:500, color:'var(--t0)', flexShrink:0 }}>TVA par défaut</div>
              <select
                className="param-field-input"
                value={form.tva_defaut ?? 10}
                onChange={e => setForm((f:any) => ({...f, tva_defaut:+e.target.value}))}
                style={{ maxWidth:120 }}
              >
                <option value={0}>0%</option>
                <option value={5.5}>5.5%</option>
                <option value={10}>10%</option>
                <option value={20}>20%</option>
              </select>
            </div>

            <div style={{ padding:'14px 0 4px' }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--t1)', marginBottom:10 }}>Modèle PDF par défaut</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {Object.entries(THEMES).map(([id, t]) => {
                  const mid = Number(id)
                  const selected = (form.modele_pdf_defaut ?? 0) === mid
                  return (
                    <div key={mid} onClick={() => setForm((f:any) => ({...f, modele_pdf_defaut:mid}))}
                      style={{ cursor:'pointer', borderRadius:8, overflow:'hidden', border:selected ? '3px solid var(--bl)' : '3px solid transparent', transition:'border .15s' }}>
                      <div style={{ width:72, height:44, background:t.primary, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', position:'relative' }}>
                        <span style={{ color:'#fff', fontSize:8, fontWeight:700, textAlign:'center', lineHeight:1.3 }}>DEVIS{'\n'}KAYTEK</span>
                        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:4, background:t.accent }} />
                      </div>
                      <div style={{ background:'var(--s1)', textAlign:'center', fontSize:9, padding:'3px 4px', color:selected ? 'var(--blTx)' : 'var(--t2)', fontWeight:selected ? 600 : 400, whiteSpace:'nowrap' }}>{t.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Section : Documents ─────────────────────── */}
        <div className="params-section-label">Documents</div>
        <div className="card card-body mb-4">
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--b0)' }}>
            <span style={{ fontSize:20 }}>📃</span>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Conditions générales</div>
              <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>Pied de page des PDF devis & factures</div>
            </div>
          </div>
          <textarea
            value={form.cgv ?? ''}
            onChange={e => setForm((f:any) => ({...f, cgv:e.target.value}))}
            style={{ minHeight:100 }}
            placeholder="Conditions de paiement, mentions légales…"
          />
        </div>

        {/* ── Actions desktop ──────────────────────────── */}
        <div className="hide-mobile flex gap-2 justify-end" style={{ paddingBottom:8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setForm({...params})}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={upd.isPending}>
            {upd.isPending ? '⏳ Sauvegarde…' : '💾 Sauvegarder'}
          </button>
        </div>

        {/* ── Actions mobile sticky ────────────────────── */}
        <div className="bottom-action-bar">
          <button type="button" className="btn btn-secondary" onClick={() => setForm({...params})}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={upd.isPending}>
            {upd.isPending ? '⏳ Sauvegarde…' : '💾 Sauvegarder'}
          </button>
        </div>

      </form>
    </div>
  )
}
