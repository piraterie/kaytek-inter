// src/pages/DevisFormPage.tsx
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import { useCreateDevis, useUpdateDevis, useDevisById, useClients, useProfiles, usePrestations, useCreatePrestation, useParametres } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import { uploadSignature } from '@/lib/supabase/storage'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import { THEMES } from '@/lib/themes'
import { CustomSelect } from '@/components/CustomSelect'
import type { Categorie, LigneDevis } from '@/types'

const newLine = (): LigneDevis => ({ id: crypto.randomUUID(), description: '', quantite: 1, prix_ht: 0, tva_pct: 10, total_ht: 0, total_ttc: 0 })

const calc = (l: LigneDevis): LigneDevis => {
  const total_ht = Math.round(l.quantite * l.prix_ht * 100) / 100
  return { ...l, total_ht, total_ttc: Math.round(total_ht * (1 + l.tva_pct / 100) * 100) / 100 }
}

const MODELES = Object.entries(THEMES).map(([id, t]) => ({
  id: Number(id), label: t.label, color: t.primary, accent: t.accent, fg: '#fff',
}))

export default function DevisFormPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [sp] = useSearchParams()
  const isEdit = !!id && id !== 'nouveau'
  const { user } = useAuthStore()
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sigPadRef = useRef<SignaturePad | null>(null)
  const [showSig, setShowSig] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [sigSaving, setSigSaving] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showCatalogueSheet, setShowCatalogueSheet] = useState(false)
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [manuelModal, setManuelModal] = useState<{ description: string; quantite: string; prix_ht: string; tva_pct: number } | null>(null)
  const [remiseStr, setRemiseStr] = useState('')
  const catalogueTouchMoved = useRef(false)
  const [showModele, setShowModele] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  const { data: existing } = useDevisById(id || '')
  const { data: clients = [] } = useClients()
  const { data: profiles = [] } = useProfiles()
  const { data: prestations = [] } = usePrestations()
  const create = useCreateDevis()
  const update = useUpdateDevis()
  const createPrestation = useCreatePrestation()
  const interventionId = sp.get('intervention') || ''

  const [form, setForm] = useState({
    client_id: '', intervenant_id: user?.id || '', activite: 'serrurerie' as Categorie,
    notes: '', modele_id: 0, remise_pct: 0,
    valide_jusqu_au: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    intervention_id: interventionId
  })
  const [lignes, setLignes] = useState<LigneDevis[]>([])
  const isAdmin = user?.role === 'admin'
  const [clientFromIntervention, setClientFromIntervention] = useState<{nom:string;prenom?:string;telephone?:string;email?:string}|null>(null)

  useEffect(() => {
    if (!interventionId || isEdit || user?.role === 'admin') return
    supabase
      .from('interventions')
      .select('client_id, type, client:clients(id, nom, prenom, telephone, email)')
      .eq('id', interventionId)
      .single()
      .then(({ data }) => {
        if (!data) return
        if (data.client_id) {
          setForm(f => ({ ...f, client_id: data.client_id, activite: (data.type as Categorie) || f.activite }))
        }
        if (data.client) setClientFromIntervention(data.client as any)
      })
  }, [interventionId, user?.role, isEdit])

  useEffect(() => {
    if (existing) {
      setForm({
        client_id: existing.client_id || '', intervenant_id: existing.intervenant_id || '',
        activite: existing.activite || 'serrurerie', notes: existing.notes || '',
        modele_id: existing.modele_id || params?.modele_pdf_defaut || 0,
        remise_pct: existing.remise_pct || 0,
        valide_jusqu_au: existing.valide_jusqu_au || '', intervention_id: existing.intervention_id || ''
      })
      setRemiseStr(existing.remise_pct ? String(existing.remise_pct) : '')
      if (existing.lignes?.length) setLignes(existing.lignes)
      if ((existing.remise_pct ?? 0) > 0 || existing.notes?.trim()) setShowOptions(true)
    }
  }, [existing])

  useEffect(() => {
    if (!isEdit && params?.modele_pdf_defaut != null) {
      setForm(f => f.modele_id === 0 ? { ...f, modele_id: params.modele_pdf_defaut! } : f)
    }
  }, [params?.modele_pdf_defaut, isEdit])

  useEffect(() => {
    if (!showSig) return
    let sp: SignaturePad | null = null
    const init = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      if (!w || !h) { requestAnimationFrame(init); return }
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      canvas.width = w * ratio
      canvas.height = h * ratio
      canvas.getContext('2d')?.scale(ratio, ratio)
      sp = new SignaturePad(canvas, { backgroundColor: 'rgba(255,255,255,0)', penColor: '#1e3a5f', minWidth: 1.5, maxWidth: 3 })
      sigPadRef.current = sp
    }
    requestAnimationFrame(init)
    return () => { sigPadRef.current?.off(); sigPadRef.current = null }
  }, [showSig])

  const tot = lignes.reduce((a, l) => ({ ht: a.ht + l.total_ht, ttc: a.ttc + l.total_ttc }), { ht: 0, ttc: 0 })
  const remise = Math.round(tot.ttc * (form.remise_pct / 100) * 100) / 100
  const totalFinal = tot.ttc - remise
  const tva = Math.round((totalFinal - tot.ht) * 100) / 100

  function updLine(i: number, f: keyof LigneDevis, v: string | number) {
    setLignes(ls => ls.map((l, idx) => idx === i ? calc({ ...l, [f]: v }) : l))
  }

  function addFromCat(pid: string) {
    const p = prestations.find(x => x.id === pid)
    if (!p) return
    setLignes(ls => [...ls, calc({ ...newLine(), description: p.nom, prix_ht: p.prix_conseille || 0, tva_pct: p.tva_pct })])
  }

  async function addLineToCatalogue(l: LigneDevis) {
    if (!l.description.trim()) { add('La description est vide', 'warning'); return }
    try {
      await createPrestation.mutateAsync({
        nom: l.description.trim(), categorie: form.activite,
        prix_conseille: l.prix_ht, tva_pct: l.tva_pct, actif: true, ordre: 99,
      } as any)
      add(`"${l.description}" ajouté au catalogue ${form.activite}`)
    } catch (err: any) { add('Erreur : ' + err.message, 'error') }
  }

  function buildMockDevis() {
    const client = clients.find(c => c.id === form.client_id)
    const intervenant = profiles.find(p => p.id === form.intervenant_id)
    return {
      id: id || 'preview', numero: existing?.numero || 'DEV-APERCU',
      ...form, lignes, total_ht: tot.ht, tva_montant: tva, total_ttc: totalFinal,
      remise_montant: remise, statut: 'brouillon' as const,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      signature_url: existing?.signature_url, signe_le: existing?.signe_le,
      client, intervenant
    }
  }

  async function handlePreview() {
    if (!params) { add('Remplissez les parametres entreprise d abord', 'warning'); return }
    setPdfLoading(true)
    try {
      const blob = await generateDevisPDF(buildMockDevis() as any, params, form.modele_id)
      downloadBlob(blob, `apercu-devis-${MODELES[form.modele_id]?.label || ''}.pdf`)
      add('PDF ouvert')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
    setPdfLoading(false)
  }

  const modeIntervenant = user?.role !== 'admin'

  async function save(statutAdmin: 'brouillon' | 'envoye') {
    if (!form.client_id) { add('Selectionnez un client', 'warning'); return }
    const validLignes = lignes.filter(l => l.description.trim() && l.quantite > 0 && l.prix_ht > 0)
    if (validLignes.length === 0) { add('Veuillez ajouter au moins une prestation avant d\'enregistrer le devis.', 'error'); return }
    const canBypass = modeIntervenant && user?.can_bypass_validation === true
    const statut = modeIntervenant ? (canBypass ? 'brouillon' : 'en_attente_validation') : statutAdmin
    const payload: any = {
      client_id: form.client_id, statut, lignes: validLignes,
      total_ht: tot.ht, tva_montant: tva, total_ttc: totalFinal, remise_montant: remise,
      remise_pct: form.remise_pct, modele_id: form.modele_id,
      activite: form.activite, notes: form.notes,
      valide_jusqu_au: form.valide_jusqu_au || null,
    }
    if (form.intervenant_id) payload.intervenant_id = form.intervenant_id
    if (form.intervention_id) payload.intervention_id = form.intervention_id
    try {
      if (isEdit) { await update.mutateAsync({ id: id!, ...payload }); add('Devis mis à jour') }
      else {
        await create.mutateAsync(payload)
        add(canBypass ? 'Devis créé' : 'Devis envoyé à l\'admin pour validation')
      }
      nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')
    } catch (e: any) { add('Erreur: ' + e.message, 'error') }
  }

  function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',')
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }

  async function handleSign() {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) { add('Veuillez signer avant de valider', 'warning'); return }
    setSigSaving(true)
    try {
      const dataUrl = sigPadRef.current.toDataURL('image/png')
      const blob = dataUrlToBlob(dataUrl)
      const { url, error } = await uploadSignature(blob, id!, 'devis')
      if (error) { add('Erreur upload signature : ' + error, 'error'); return }
      if (!url) { add('URL signature vide — vérifiez le bucket Supabase "signatures"', 'error'); return }
      await update.mutateAsync({ id: id!, signature_url: url, signe_le: new Date().toISOString(), statut: 'accepte' })
      add('Signature enregistrée ✓')
      setShowSig(false)
    } catch (e: any) {
      add('Erreur : ' + e.message, 'error')
    } finally { setSigSaving(false) }
  }

  const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

  const manuelTtc = manuelModal
    ? Math.round(Math.round(parseFloat(manuelModal.quantite || '0') * parseFloat(manuelModal.prix_ht || '0') * 100) / 100 * (1 + manuelModal.tva_pct / 100) * 100) / 100
    : 0

  void showPreview // keep lint happy

  return (
    <div className="devis-form-wrapper" style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 8 }}>

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button className="btn-icon" onClick={() => nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')}>←</button>
        <div>
          <h1 className="page-title">{isEdit ? 'Modifier le devis' : 'Nouveau devis'}</h1>
          {isEdit && existing && <p className="page-subtitle">{existing.numero}</p>}
        </div>
      </div>

      {/* Banner intervenant */}
      {modeIntervenant && (
        <div style={{ padding:'10px 14px', borderRadius:'var(--r2)', fontSize:12, marginBottom:12,
          background: user?.can_bypass_validation ? 'var(--gnBg)' : 'var(--blBg)',
          border: user?.can_bypass_validation ? '1px solid var(--gnBd)' : '1px solid var(--blBd)',
          color: user?.can_bypass_validation ? 'var(--gnTx)' : 'var(--blTx)' }}>
          {user?.can_bypass_validation
            ? '✓ Votre devis sera créé directement en brouillon. L\'administrateur sera notifié.'
            : 'ℹ Votre devis sera soumis à validation de l\'administrateur avant d\'être actif.'}
        </div>
      )}

      {/* ── Bloc 1 : Infos devis ─────────────────────────────── */}
      <div className="card card-body mb-3">
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--b0)' }}>
          <span style={{ fontSize:16 }}>📋</span>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Infos devis</span>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label>Client *</label>
            {modeIntervenant ? (
              <div style={{ padding:'10px 12px', background:'var(--s1)', borderRadius:'var(--r)', fontSize:13, border:'1px solid var(--b1)', minHeight:44, display:'flex', alignItems:'center' }}>
                {(() => {
                  if (clientFromIntervention) return [clientFromIntervention.nom, clientFromIntervention.prenom].filter(Boolean).join(' ')
                  if (form.client_id) {
                    const c = clients.find(c => c.id === form.client_id)
                    return c ? [c.nom, c.prenom].filter(Boolean).join(' ') : 'Client lié'
                  }
                  return interventionId ? 'Chargement…' : '—'
                })()}
              </div>
            ) : (
              <CustomSelect
                value={form.client_id}
                placeholder="Sélectionner un client…"
                options={clients.map(c => ({
                  value: c.id,
                  label: [c.nom, c.prenom].filter(Boolean).join(' ') + (c.telephone ? ` · ${c.telephone}` : '')
                }))}
                onChange={v => setForm(f => ({ ...f, client_id: v }))}
              />
            )}
          </div>
          <div className="form-group">
            <label>Intervenant</label>
            {modeIntervenant ? (
              <div style={{ padding:'10px 12px', background:'var(--s1)', borderRadius:'var(--r)', fontSize:13, border:'1px solid var(--b1)', minHeight:44, display:'flex', alignItems:'center' }}>
                {[user?.prenom, user?.nom].filter(Boolean).join(' ') || user?.email || 'Moi'}
              </div>
            ) : (
              <CustomSelect
                value={form.intervenant_id}
                placeholder="—"
                options={[
                  { value: '', label: '—' },
                  ...profiles.filter(p => p.actif).map(p => ({
                    value: p.id,
                    label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant sans nom'
                      + ` (${p.role})`
                  }))
                ]}
                onChange={v => setForm(f => ({ ...f, intervenant_id: v }))}
              />
            )}
          </div>
          <div className="form-group">
            <label>Activité</label>
            <select value={form.activite} onChange={e => setForm(f => ({ ...f, activite: e.target.value as Categorie }))}>
              <option value="serrurerie">Serrurerie</option>
              <option value="plomberie">Plomberie</option>
              <option value="electricite">Électricité</option>
              <option value="vitrerie">Vitrerie</option>
            </select>
          </div>
          <div className="form-group">
            <label>Valable jusqu au</label>
            <input type="date" value={form.valide_jusqu_au} onChange={e => setForm(f => ({ ...f, valide_jusqu_au: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* ── Modèle PDF — accordion admin ─────────────────────── */}
      {!modeIntervenant && (
        <div className="card card-body mb-3">
          <button
            type="button"
            onClick={() => setShowModele(v => !v)}
            style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'none', border:'none', cursor:'pointer', padding:0, gap:8 }}
          >
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:16 }}>🎨</span>
              <span style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Modèle PDF</span>
              <span style={{ fontSize:11, color:'var(--t3)' }}>{MODELES.find(m => m.id === form.modele_id)?.label || ''}</span>
            </div>
            <span style={{ fontSize:11, color:'var(--t3)', flexShrink:0 }}>{showModele ? '▲' : '▼'}</span>
          </button>
          {showModele && (
            <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--b0)' }}>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                {MODELES.map(m => (
                  <div key={m.id} onClick={() => setForm(f => ({ ...f, modele_id: m.id }))}
                    style={{ cursor:'pointer', borderRadius:8, overflow:'hidden', border: form.modele_id === m.id ? '3px solid var(--bl)' : '3px solid transparent', transition:'border .15s' }}>
                    <div style={{ width:80, height:52, background:m.color, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', position:'relative' }}>
                      <span style={{ color:m.fg, fontSize:9, fontWeight:700, textAlign:'center', lineHeight:1.3 }}>DEVIS{'\n'}KAYTEK</span>
                      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:4, background:m.accent }} />
                    </div>
                    <div style={{ background:'var(--s1)', textAlign:'center', fontSize:10, padding:'3px 6px', color: form.modele_id === m.id ? 'var(--blTx)' : 'var(--t2)', fontWeight: form.modele_id === m.id ? 600 : 400 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary btn-sm mt-3" onClick={handlePreview} disabled={pdfLoading} style={{ alignSelf:'flex-start' }}>
                {pdfLoading ? 'Generation...' : '👁 Apercu PDF du modele'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Bloc 2 : Prestations ─────────────────────────────── */}
      <div className="card card-body mb-3">
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--b0)' }}>
          <span style={{ fontSize:16 }}>🔧</span>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Prestations</span>
          {lignes.length > 0 && (
            <span style={{ fontSize:11, background:'var(--s2)', color:'var(--t2)', padding:'2px 8px', borderRadius:10, marginLeft:'auto' }}>
              {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Boutons d'ajout */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
          <button
            className="btn btn-secondary"
            style={{ flex:1, minWidth:140, minHeight:44 }}
            onClick={() => { setCatalogueSearch(''); setShowCatalogueSheet(true) }}
          >
            📋 Depuis le catalogue
          </button>
          <button
            className="btn btn-secondary"
            style={{ flex:1, minWidth:160, minHeight:44 }}
            onClick={() => setManuelModal({ description:'', quantite:'', prix_ht:'', tva_pct:10 })}
          >
            ✏ Prestation manuelle
          </button>
        </div>

        {/* Lignes */}
        {lignes.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th style={{ minWidth:200 }}>Description</th>
                  <th style={{ width:60 }}>Qte</th>
                  <th style={{ width:90 }}>Prix HT</th>
                  <th style={{ width:75 }}>TVA</th>
                  <th style={{ width:100 }}>Total TTC</th>
                  <th style={{ width: isAdmin ? 70 : 40 }}></th>
                </tr></thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={l.id}>
                      <td><input value={l.description} onChange={e => updLine(i, 'description', e.target.value)} placeholder="Description..." /></td>
                      <td><input type="number" value={l.quantite} min={1}
                        onFocus={e => e.target.select()}
                        onChange={e => updLine(i, 'quantite', parseFloat(e.target.value) || 0)}
                        onBlur={e => { if (!e.target.value || parseFloat(e.target.value) <= 0) updLine(i, 'quantite', 1) }} /></td>
                      <td><input type="number" value={l.prix_ht} step={0.01} min={0}
                        onFocus={e => e.target.select()}
                        onChange={e => updLine(i, 'prix_ht', parseFloat(e.target.value) || 0)}
                        onBlur={e => { if (!e.target.value) updLine(i, 'prix_ht', 0) }} /></td>
                      <td>
                        <select value={l.tva_pct} onChange={e => updLine(i, 'tva_pct', +e.target.value)}>
                          <option value={0}>0%</option>
                          <option value={5.5}>5.5%</option>
                          <option value={10}>10%</option>
                          <option value={20}>20%</option>
                        </select>
                      </td>
                      <td style={{ fontWeight:600, textAlign:'right' }}>{eur(l.total_ttc)}</td>
                      <td>
                        <div style={{ display:'flex', gap:2 }}>
                          {isAdmin && (
                            <button className="btn-icon sm" title="Ajouter au catalogue" style={{ fontSize:10, color:'var(--gnTx)' }} onClick={() => addLineToCatalogue(l)}>+C</button>
                          )}
                          <button className="btn-icon sm" style={{ color:'var(--rdTx)' }} onClick={() => setLignes(ls => ls.filter((_, idx) => idx !== i))}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop:10 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setLignes(l => [...l, newLine()])}>+ Ligne vide</button>
            </div>
            {isAdmin && (
              <div style={{ marginTop:8, fontSize:12, color:'var(--t3)' }}>
                ℹ Cliquez sur <strong>+C</strong> à droite d'une ligne pour l'ajouter au catalogue.
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign:'center', padding:'20px 16px', color:'var(--t3)', fontSize:13, border:'1px dashed var(--b1)', borderRadius:'var(--r2)' }}>
            Aucune ligne — ajoutez une prestation ci-dessus
          </div>
        )}
      </div>

      {/* ── Bloc 3 : Total ───────────────────────────────────── */}
      <div className="card card-body mb-3" style={{ background:'var(--blBg)', border:'1px solid var(--blBd)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <span style={{ fontSize:16 }}>💰</span>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--blTx)' }}>Total</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--t2)', padding:'3px 0' }}>
          <span>Total HT</span><span>{eur(tot.ht)}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--t2)', padding:'3px 0' }}>
          <span>TVA</span><span>{eur(tva)}</span>
        </div>
        {form.remise_pct > 0 && (
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--rdTx)', padding:'3px 0' }}>
            <span>Remise ({form.remise_pct}%)</span><span>-{eur(remise)}</span>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:10, marginTop:6, borderTop:'2px solid var(--blBd)' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'var(--blTx)' }}>Total TTC</span>
          <span style={{ fontSize:24, fontWeight:800, color:'var(--blTx)' }}>{eur(totalFinal)}</span>
        </div>
      </div>

      {/* ── Bloc 4 : Options — accordion ─────────────────────── */}
      <div className="card card-body mb-3">
        <button
          type="button"
          onClick={() => setShowOptions(v => !v)}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'none', border:'none', cursor:'pointer', padding:0, gap:8 }}
        >
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:16 }}>⚙</span>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Options</span>
            {(form.remise_pct > 0 || form.notes.trim()) && (
              <span style={{ fontSize:11, background:'var(--s2)', color:'var(--t2)', padding:'2px 8px', borderRadius:10 }}>
                {[form.remise_pct > 0 && `Remise ${form.remise_pct}%`, form.notes.trim() && 'Notes'].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          <span style={{ fontSize:11, color:'var(--t3)', flexShrink:0 }}>{showOptions ? '▲' : '▼'}</span>
        </button>
        {showOptions && (
          <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--b0)', display:'flex', flexDirection:'column', gap:14 }}>
            <div className="form-group" style={{ margin:0 }}>
              <label>Remise (%)</label>
              <input
                type="number" inputMode="decimal" min={0} max={100}
                value={remiseStr}
                onChange={e => {
                  setRemiseStr(e.target.value)
                  const n = parseFloat(e.target.value)
                  setForm(f => ({ ...f, remise_pct: isNaN(n) ? 0 : Math.max(0, Math.min(100, n)) }))
                }}
                onBlur={() => {
                  const n = parseFloat(remiseStr)
                  const safe = isNaN(n) ? 0 : Math.max(0, Math.min(100, n))
                  setRemiseStr(safe === 0 ? '' : String(safe))
                  setForm(f => ({ ...f, remise_pct: safe }))
                }}
              />
            </div>
            <div className="form-group" style={{ margin:0 }}>
              <label>Notes / Conditions</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions particulieres, remarques..." style={{ minHeight:80 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Bloc 5 : Signature client ─────────────────────────── */}
      <div className="card card-body mb-4">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:16 }}>✍</span>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--t0)' }}>Signature client</div>
              <div style={{ fontSize:11, color:'var(--t2)', marginTop:2 }}>Le client signe ici pour accepter le devis</div>
            </div>
          </div>
          {existing?.signature_url
            ? <span className="pill pill-green">✓ Signé le {existing.signe_le ? new Date(existing.signe_le).toLocaleDateString('fr-FR') : ''}</span>
            : isEdit
              ? <button className="btn btn-secondary btn-sm" onClick={() => setShowSig(!showSig)}>
                  {showSig ? 'Masquer' : '✍ Zone de signature'}
                </button>
              : <span style={{ fontSize:12, color:'var(--t3)', fontStyle:'italic' }}>Disponible après enregistrement du devis.</span>
          }
        </div>

        {/* MODALE SIGNATURE PLEIN ÉCRAN — logique inchangée */}
        {showSig && !existing?.signature_url && (
          <div style={{ position:'fixed', inset:0, background:'#fff', zIndex:200, display:'flex', flexDirection:'column' }}>
            <div style={{ background:'#1e3a5f', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:16 }}>✍ Signature client</div>
                <div style={{ color:'rgba(255,255,255,0.6)', fontSize:12, marginTop:2 }}>Signez dans la zone ci-dessous pour accepter le devis</div>
              </div>
              <button onClick={() => setShowSig(false)} style={{ background:'rgba(255,255,255,0.15)', border:'none', color:'#fff', borderRadius:8, padding:'8px 14px', cursor:'pointer', fontSize:14, fontWeight:600 }}>✕ Annuler</button>
            </div>
            <div style={{ flex:1, display:'flex', flexDirection:'column', padding:16, gap:12 }}>
              <div style={{ flex:1, border:'2px dashed #1e3a5f', borderRadius:12, overflow:'hidden', position:'relative', background:'#fafafa' }}>
                <canvas ref={canvasRef} style={{ display:'block', width:'100%', height:'100%', touchAction:'none', cursor:'crosshair' }} />
                <div style={{ position:'absolute', bottom:12, left:0, right:0, textAlign:'center', pointerEvents:'none' }}>
                  <span style={{ fontSize:12, color:'#c8c8ce', fontStyle:'italic' }}>Signez ici avec votre doigt</span>
                </div>
              </div>
              <div style={{ display:'flex', gap:12, flexShrink:0 }}>
                <button className="btn btn-secondary" style={{ flex:1, minHeight:52, fontSize:15 }} onClick={() => sigPadRef.current?.clear()}>🗑 Effacer</button>
                {isEdit ? (
                  <button className="btn btn-primary" style={{ flex:2, minHeight:52, fontSize:15 }} onClick={handleSign} disabled={sigSaving}>
                    {sigSaving ? 'Enregistrement…' : '✓ Valider la signature'}
                  </button>
                ) : (
                  <div style={{ flex:2, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--amBg)', border:'1px solid var(--amBd)', borderRadius:8, padding:'10px 16px', fontSize:13, color:'var(--amTx)', textAlign:'center' }}>
                    ⚠ Sauvegardez le devis d'abord
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Actions mobile sticky ─────────────────────────────── */}
      <div className="bottom-action-bar">
        <button className="btn btn-secondary" onClick={() => nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')}>Annuler</button>
        {!modeIntervenant && (
          <button className="btn btn-secondary" onClick={() => save('brouillon')} disabled={create.isPending || update.isPending}>
            💾 Brouillon
          </button>
        )}
        <button className="btn btn-primary" onClick={() => save('envoye')} disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? '…' : modeIntervenant ? (user?.can_bypass_validation ? '💾 Créer le devis' : '📤 Soumettre') : '✉ Envoyer'}
        </button>
      </div>

      {/* ── Actions desktop ───────────────────────────────────── */}
      <div className="hide-mobile flex gap-2 justify-end flex-wrap">
        <button className="btn btn-secondary" onClick={() => nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')}>Annuler</button>
        {!modeIntervenant && (
          <>
            <button className="btn btn-secondary" onClick={handlePreview} disabled={pdfLoading}>
              {pdfLoading ? '...' : '📄 Apercu PDF'}
            </button>
            <button className="btn btn-secondary" onClick={() => save('brouillon')} disabled={create.isPending || update.isPending}>
              💾 Sauvegarder brouillon
            </button>
          </>
        )}
        <button className="btn btn-primary" onClick={() => save('envoye')} disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? 'Sauvegarde...' : modeIntervenant ? (user?.can_bypass_validation ? '💾 Créer le devis' : '📤 Soumettre pour validation') : '✉ Enregistrer & Envoyer'}
        </button>
      </div>

      {/* ── Bottom sheet catalogue ────────────────────────────── */}
      {showCatalogueSheet && (
        <div
          style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,0.5)', display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
          onClick={() => setShowCatalogueSheet(false)}
        >
          <div
            style={{ background:'var(--s0)', borderRadius:'20px 20px 0 0', maxHeight:'85dvh', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 0' }}>
              <div style={{ width:40, height:4, borderRadius:2, background:'var(--b1)' }} />
            </div>
            <div style={{ padding:'14px 16px 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontWeight:700, fontSize:16, color:'var(--t0)' }}>Catalogue · {form.activite}</span>
              <button onClick={() => setShowCatalogueSheet(false)} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--t2)', padding:'4px 8px', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ padding:'12px 16px 8px' }}>
              <input
                placeholder="Rechercher une prestation…"
                value={catalogueSearch}
                onChange={e => setCatalogueSearch(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', padding:'11px 14px', borderRadius:10, border:'1px solid var(--b1)', fontSize:15, background:'var(--s1)', color:'var(--t0)' }}
              />
            </div>
            <div
              style={{ overflowY:'auto', flex:1, padding:'0 10px 32px', overscrollBehavior:'contain' }}
              onTouchStart={() => { catalogueTouchMoved.current = false }}
              onTouchMove={() => { catalogueTouchMoved.current = true }}
            >
              {prestations
                .filter(p => p.categorie === form.activite && (!catalogueSearch || p.nom.toLowerCase().includes(catalogueSearch.toLowerCase())))
                .map(p => (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (catalogueTouchMoved.current) return
                      addFromCat(p.id)
                      setShowCatalogueSheet(false)
                    }}
                    style={{ padding:'14px 16px', borderRadius:14, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, userSelect:'none', background:'var(--s1)', border:'1px solid var(--b0)', WebkitTapHighlightColor:'transparent', transition:'opacity .1s', minHeight:64 }}
                  >
                    <div style={{ flex:1, minWidth:0, marginRight:12 }}>
                      <div style={{ fontWeight:700, fontSize:15, color:'var(--t0)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
                      <div style={{ fontSize:12, color:'var(--t3)', marginTop:3, display:'flex', gap:10 }}>
                        <span>TVA {p.tva_pct}%</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                      <span style={{ fontWeight:700, color:'var(--blTx)', fontSize:16 }}>{p.prix_conseille}€ HT</span>
                      <div style={{ width:28, height:28, borderRadius:8, background:'var(--bl)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:18, fontWeight:700, lineHeight:1, flexShrink:0 }}>+</div>
                    </div>
                  </div>
                ))}
              {prestations.filter(p =>
                p.categorie === form.activite &&
                (!catalogueSearch || p.nom.toLowerCase().includes(catalogueSearch.toLowerCase()))
              ).length === 0 && (
                <div style={{ textAlign:'center', padding:'40px 16px', color:'var(--t3)', fontSize:14 }}>
                  Aucune prestation dans le catalogue pour cette activité
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal saisie manuelle ─────────────────────────────── */}
      {manuelModal && (
        <div
          style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,0.5)', display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
          onClick={() => setManuelModal(null)}
        >
          <div
            style={{ background:'var(--s0)', borderRadius:'20px 20px 0 0', maxHeight:'calc(100dvh - 60px)', display:'flex', flexDirection:'column', overscrollBehavior:'contain' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 4px', flexShrink:0 }}>
              <div style={{ width:40, height:4, borderRadius:2, background:'var(--b1)' }} />
            </div>
            <div style={{ padding:'10px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, borderBottom:'1px solid var(--b0)' }}>
              <span style={{ fontWeight:700, fontSize:17, color:'var(--t0)' }}>Prestation manuelle</span>
              <button onClick={() => setManuelModal(null)} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--t2)', padding:'4px 8px', lineHeight:1 }}>✕</button>
            </div>
            <div style={{ overflowY:'auto', flex:1, padding:'20px 20px 0', paddingBottom:'calc(20px + env(safe-area-inset-bottom))', display:'flex', flexDirection:'column', gap:14 }}>
              <div className="form-group" style={{ margin:0 }}>
                <label>Description *</label>
                <input
                  value={manuelModal.description}
                  onChange={e => setManuelModal(m => m && { ...m, description: e.target.value })}
                  placeholder="Ex : Remplacement serrure 3 points…"
                  style={{ fontSize:16, padding:'12px 14px' }}
                  onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block:'nearest', behavior:'smooth' }), 350) }}
                />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div className="form-group" style={{ margin:0 }}>
                  <label>Quantité</label>
                  <input
                    type="number" inputMode="decimal" min={0.1} step={0.1}
                    value={manuelModal.quantite}
                    onChange={e => setManuelModal(m => m && { ...m, quantite: e.target.value })}
                    onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block:'nearest', behavior:'smooth' }), 350) }}
                    onBlur={() => {
                      const n = parseFloat(manuelModal?.quantite || '')
                      setManuelModal(m => m && { ...m, quantite: !n || n <= 0 ? '1' : String(n) })
                    }}
                    style={{ fontSize:16, padding:'12px 14px' }}
                  />
                </div>
                <div className="form-group" style={{ margin:0 }}>
                  <label>Prix HT (€)</label>
                  <input
                    type="number" inputMode="decimal" min={0} step={0.01}
                    value={manuelModal.prix_ht}
                    onChange={e => setManuelModal(m => m && { ...m, prix_ht: e.target.value })}
                    onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block:'nearest', behavior:'smooth' }), 350) }}
                    onBlur={() => {
                      const n = parseFloat(manuelModal?.prix_ht || '')
                      setManuelModal(m => m && { ...m, prix_ht: isNaN(n) ? '0' : String(Math.max(0, n)) })
                    }}
                    style={{ fontSize:16, padding:'12px 14px' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ margin:0 }}>
                <label>TVA</label>
                <select
                  value={manuelModal.tva_pct}
                  onChange={e => setManuelModal(m => m && { ...m, tva_pct: +e.target.value })}
                  style={{ fontSize:16, padding:'12px 14px' }}
                >
                  <option value={0}>0%</option>
                  <option value={5.5}>5.5%</option>
                  <option value={10}>10%</option>
                  <option value={20}>20%</option>
                </select>
              </div>
              <div style={{ background:'var(--blBg)', border:'1px solid var(--blBd)', borderRadius:12, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'var(--blTx)', fontWeight:500 }}>Total TTC</span>
                <span style={{ fontSize:24, fontWeight:700, color:'var(--blTx)' }}>{eur(manuelTtc)}</span>
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <button className="btn btn-secondary" style={{ flex:1, minHeight:52, fontSize:16 }} onClick={() => setManuelModal(null)}>Annuler</button>
                <button
                  className="btn btn-primary"
                  style={{ flex:2, minHeight:52, fontSize:16 }}
                  onClick={() => {
                    if (!manuelModal.description.trim()) { add('La description est obligatoire', 'warning'); return }
                    setLignes(ls => [...ls, calc({ ...newLine(), description: manuelModal.description.trim(), quantite: parseFloat(manuelModal.quantite) || 1, prix_ht: parseFloat(manuelModal.prix_ht) || 0, tva_pct: manuelModal.tva_pct })])
                    setManuelModal(null)
                  }}
                >✓ Valider</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
