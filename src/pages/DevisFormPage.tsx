// src/pages/DevisFormPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SignatureModal from '@/components/SignatureModal'
import { useCreateDevis, useUpdateDevis, useDevisById, useClients, useProfiles, usePrestations, useCreatePrestation, useParametres } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import { pdfCache } from '@/lib/pdf/cache'
import { uploadPdf } from '@/lib/supabase/storage'
import { THEMES } from '@/lib/themes'
import { CustomSelect } from '@/components/CustomSelect'
import type { Categorie, LigneDevis } from '@/types'

const newLine = (): LigneDevis => ({ id: crypto.randomUUID(), description: '', quantite: 1, prix_ht: 0, tva_pct: 10, total_ht: 0, total_ttc: 0 })

const calc = (l: LigneDevis): LigneDevis => {
  const total_ht = Math.round(l.quantite * l.prix_ht * 100) / 100
  return { ...l, total_ht, total_ttc: Math.round(total_ht * (1 + l.tva_pct / 100) * 100) / 100 }
}

const MODELES = Object.entries(THEMES).map(([id, t]) => ({
  id: Number(id), label: t.label, color: t.primary, accent: t.accent,
}))

const CAT_ICON: Record<string, string> = {
  serrurerie: '🔒', plomberie: '🔧', electricite: '⚡', vitrerie: '🪟'
}

const QTY_BTN: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 10, border: '1px solid var(--b1)',
  background: 'var(--s1)', color: 'var(--t0)', fontSize: 18,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1, flexShrink: 0,
}

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
  // UI state
  const [showSig, setShowSig] = useState(false)
  const [sigSaving, setSigSaving] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [catalogueSearch, setCatalogueSearch] = useState('')
  const [catFilter, setCatFilter] = useState('tous')
  const [manuelModal, setManuelModal] = useState<{ description: string; quantite: string; prix_ht: string; tva_pct: number; notes: string } | null>(null)
  const [remiseStr, setRemiseStr] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [clientExpanded, setClientExpanded] = useState(true)

  // Data
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
  const [clientFromIntervention, setClientFromIntervention] = useState<{ nom: string; prenom?: string; telephone?: string; email?: string } | null>(null)

  useEffect(() => {
    if (!interventionId || isEdit || user?.role === 'admin') return
    supabase
      .from('interventions')
      .select('client_id, type, client:clients(id, nom, prenom, telephone, email)')
      .eq('id', interventionId)
      .single()
      .then(({ data }) => {
        if (!data) return
        if (data.client_id) setForm(f => ({ ...f, client_id: data.client_id, activite: (data.type as Categorie) || f.activite }))
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
      setClientExpanded(false)
    }
  }, [existing])

  useEffect(() => {
    if (!isEdit && params?.modele_pdf_defaut != null) {
      setForm(f => f.modele_id === 0 ? { ...f, modele_id: params.modele_pdf_defaut! } : f)
    }
  }, [params?.modele_pdf_defaut, isEdit])

  // Totals
  const tot = lignes.reduce((a, l) => ({ ht: a.ht + l.total_ht, ttc: a.ttc + l.total_ttc }), { ht: 0, ttc: 0 })
  const remise = Math.round(tot.ttc * (form.remise_pct / 100) * 100) / 100
  const totalFinal = tot.ttc - remise
  const tva = Math.round((totalFinal - tot.ht) * 100) / 100
  const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

  // Derived
  const modeIntervenant = user?.role !== 'admin'
  const displayClient = form.client_id ? (clients.find(c => c.id === form.client_id) || null) : clientFromIntervention
  const step1Done = !!form.client_id
  const step2Done = lignes.filter(l => l.description.trim()).length > 0
  const activeStep = !step1Done ? 1 : !step2Done ? 2 : showOptions ? 3 : 4

  const activePrestations = prestations.filter(p => p.categorie === form.activite)
  const subCats = Array.from(new Set(activePrestations.map(p => p.sous_categorie).filter(Boolean))) as string[]
  const catChips = subCats.length > 0 ? ['tous', ...subCats] : []
  const cataloguePrestations = activePrestations.filter(p => {
    const matchesCat = catFilter === 'tous' || p.sous_categorie === catFilter
    const matchesSearch = !catalogueSearch || p.nom.toLowerCase().includes(catalogueSearch.toLowerCase()) || (p.description || '').toLowerCase().includes(catalogueSearch.toLowerCase())
    return matchesCat && matchesSearch
  })
  const manuelTtc = manuelModal
    ? Math.round(Math.round(parseFloat(manuelModal.quantite || '0') * parseFloat(manuelModal.prix_ht || '0') * 100) / 100 * (1 + manuelModal.tva_pct / 100) * 100) / 100
    : 0

  function clientInitials() {
    return `${(displayClient?.prenom || '').charAt(0)}${(displayClient?.nom || '').charAt(0)}`.toUpperCase() || '?'
  }

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
      await createPrestation.mutateAsync({ nom: l.description.trim(), categorie: form.activite, prix_conseille: l.prix_ht, tva_pct: l.tva_pct, actif: true, ordre: 99 } as any)
      add(`"${l.description}" ajouté au catalogue ${form.activite}`)
    } catch (err: any) { add('Erreur : ' + err.message, 'error') }
  }

  function buildMockDevis() {
    const client = clients.find(c => c.id === form.client_id)
    const intervenant = profiles.find(p => p.id === form.intervenant_id)
    return { id: id || 'preview', numero: existing?.numero || 'DEV-APERCU', ...form, lignes, total_ht: tot.ht, tva_montant: tva, total_ttc: totalFinal, remise_montant: remise, statut: 'brouillon' as const, created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), signature_url: existing?.signature_url, signe_le: existing?.signe_le, client, intervenant }
  }

  async function handlePreview() {
    if (!params) { add('Remplissez les parametres entreprise d abord', 'warning'); return }
    setPdfLoading(true)
    try {
      const blob = await generateDevisPDF(buildMockDevis() as any, params, form.modele_id)
      downloadBlob(blob, `apercu-devis.pdf`)
      add('PDF ouvert')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
    setPdfLoading(false)
  }

  async function save(statutAdmin: 'brouillon' | 'envoye') {
    if (!form.client_id) { add('Selectionnez un client', 'warning'); return }
    const validLignes = lignes.filter(l => l.description.trim() && l.quantite > 0 && l.prix_ht > 0)
    if (validLignes.length === 0) { add('Veuillez ajouter au moins une prestation avant d\'enregistrer le devis.', 'error'); return }
    const canBypass = modeIntervenant && user?.can_bypass_validation === true
    const statut = modeIntervenant ? (canBypass ? 'brouillon' : 'en_attente_validation') : statutAdmin
    const payload: any = { client_id: form.client_id, statut, lignes: validLignes, total_ht: tot.ht, tva_montant: tva, total_ttc: totalFinal, remise_montant: remise, remise_pct: form.remise_pct, modele_id: form.modele_id, activite: form.activite, notes: form.notes, valide_jusqu_au: form.valide_jusqu_au || null }
    if (form.intervenant_id) payload.intervenant_id = form.intervenant_id
    if (form.intervention_id) payload.intervention_id = form.intervention_id
    try {
      let savedId: string
      let savedNumero: string

      if (isEdit) {
        await update.mutateAsync({ id: id!, ...payload })
        savedId = id!
        savedNumero = existing?.numero || ''
        add('Devis mis à jour')
      } else {
        const result: any = await create.mutateAsync(payload)
        savedId = result?.id || ''
        savedNumero = result?.numero || 'DEV-APERCU'
        add(canBypass ? 'Devis créé' : 'Devis envoyé à l\'admin pour validation')
      }

      // Capturer les valeurs avant nav() — elles seront utilisées dans l'IIFE en arrière-plan
      const _savedId = savedId
      const _params = params
      const _modeleId = form.modele_id
      const _orgId = user?.organisation_id
      const _devisForPdf = { ...buildMockDevis(), id: _savedId, numero: savedNumero }

      nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')

      // Pré-générer le PDF en arrière-plan — met à jour le cache mémoire + storage
      if (_savedId && _params) {
        ;(async () => {
          try {
            const blob = await generateDevisPDF(_devisForPdf as any, _params, _modeleId)
            pdfCache.set(_savedId, blob)
            if (_orgId) {
              const { path, error } = await uploadPdf(blob, _savedId, 'devis', _orgId)
              if (!error && path) {
                await supabase.from('devis').update({ pdf_url: path }).eq('id', _savedId)
              }
            }
          } catch { /* pré-génération non bloquante */ }
        })()
      }
    } catch (e: any) { add('Erreur: ' + e.message, 'error') }
  }

  async function handleSign(base64: string) {
    setSigSaving(true)
    try {
      const sigDate = new Date().toISOString()
      const sigPar = `${user?.prenom || ''} ${user?.nom || ''}`.trim() || 'Admin'
      await (update.mutateAsync as any)({ id: id!, signature_client: base64, signature_date: sigDate, signe_le: sigDate, statut: 'accepte', signe_par: sigPar })
      add('Signature enregistrée ✓')
      setShowSig(false)
      if (id && params) {
        ;(async () => {
          try {
            const devisWithSig = { ...buildMockDevis(), signature_client: base64, signature_date: sigDate, signe_par: sigPar, statut: 'accepte' as const }
            const blob = await generateDevisPDF(devisWithSig as any, params, form.modele_id)
            pdfCache.set(id, blob)
            if (user?.organisation_id) {
              const { path, error } = await uploadPdf(blob, id, 'devis', user.organisation_id)
              if (!error && path) await supabase.from('devis').update({ pdf_url: path }).eq('id', id)
            }
          } catch { /* régénération non bloquante */ }
        })()
      }
    } catch (e: any) { add('Erreur : ' + e.message, 'error') } finally { setSigSaving(false) }
  }

  const isSigned = !!(existing?.signature_url || existing?.signature_client)

  return (
    <div className="devis-form-wrapper" style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 8 }}>

      {/* ── Header ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn-icon" onClick={() => nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 18 }}>{isEdit ? 'Modifier le devis' : 'Créer un devis'}</h1>
          {isEdit && existing && (
            <p className="page-subtitle">
              <span style={{ fontWeight: 700 }}>{existing.numero}</span>
              {' · '}
              <span style={{ color: 'var(--bl)', fontWeight: 600 }}>
                {existing.statut === 'brouillon' ? 'Brouillon' : existing.statut === 'envoye' ? 'Envoyé' : existing.statut}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* ── Stepper ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
        {([
          { n: 1, label: 'Client', done: step1Done },
          { n: 2, label: 'Prestations', done: step2Done },
          { n: 3, label: 'Options', done: false },
          { n: 4, label: 'Envoi', done: false },
        ] as const).map((step, idx) => (
          <div key={step.n} style={{ display: 'flex', alignItems: 'center', flex: idx < 3 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', fontSize: 13, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: step.done ? 'var(--gn)' : step.n === activeStep ? 'var(--bl)' : 'var(--s2)',
                color: step.done || step.n === activeStep ? '#fff' : 'var(--t3)',
                border: step.done || step.n === activeStep ? 'none' : '2px solid var(--b1)',
                transition: 'all .2s',
              }}>
                {step.done ? '✓' : step.n}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', color: step.done ? 'var(--gnTx)' : step.n === activeStep ? 'var(--blTx)' : 'var(--t3)' }}>
                {step.label}
              </span>
            </div>
            {idx < 3 && (
              <div style={{ flex: 1, height: 2, borderRadius: 1, margin: '0 4px', marginBottom: 18, background: step.done ? 'var(--gn)' : 'var(--s3)', transition: 'background .3s' }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Banner intervenant ────────────────────────────── */}
      {modeIntervenant && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r2)', fontSize: 12, marginBottom: 12, background: user?.can_bypass_validation ? 'var(--gnBg)' : 'var(--blBg)', border: `1px solid ${user?.can_bypass_validation ? 'var(--gnBd)' : 'var(--blBd)'}`, color: user?.can_bypass_validation ? 'var(--gnTx)' : 'var(--blTx)' }}>
          {user?.can_bypass_validation ? '✓ Votre devis sera créé directement en brouillon. L\'administrateur sera notifié.' : 'ℹ Votre devis sera soumis à validation de l\'administrateur avant d\'être actif.'}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          SECTION 1 — CLIENT
         ══════════════════════════════════════════════════ */}
      <div className="card mb-3">
        <div style={{ padding: '16px 18px' }}>

          {/* Client sélectionné — carte compacte */}
          {displayClient ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bl)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                  {clientInitials()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>{displayClient.nom} {displayClient.prenom}</span>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gn)', flexShrink: 0 }} />
                  </div>
                  {displayClient.telephone && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>📞 {displayClient.telephone}</div>}
                  {displayClient.email && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 1 }}>✉ {displayClient.email}</div>}
                </div>
                {!modeIntervenant && (
                  <button type="button" onClick={() => setClientExpanded(v => !v)} className="btn-icon sm" title="Changer le client" style={{ flexShrink: 0 }}>✏</button>
                )}
              </div>
              {clientExpanded && !modeIntervenant && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--b0)' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Client</label>
                    <CustomSelect
                      value={form.client_id}
                      placeholder="Sélectionner un client…"
                      options={clients.map(c => ({ value: c.id, label: [c.nom, c.prenom].filter(Boolean).join(' ') + (c.telephone ? ` · ${c.telephone}` : '') }))}
                      onChange={v => { setForm(f => ({ ...f, client_id: v })); if (v) setClientExpanded(false) }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : modeIntervenant ? (
            <div style={{ padding: '10px 12px', background: 'var(--s1)', borderRadius: 'var(--r)', fontSize: 13, border: '1px solid var(--b1)', minHeight: 44, display: 'flex', alignItems: 'center', color: 'var(--t3)' }}>
              {interventionId ? 'Chargement…' : '—'}
            </div>
          ) : (
            <div className="form-group" style={{ margin: 0 }}>
              <label>Client <span className="req">*</span></label>
              <CustomSelect
                value={form.client_id}
                placeholder="Sélectionner un client…"
                options={clients.map(c => ({ value: c.id, label: [c.nom, c.prenom].filter(Boolean).join(' ') + (c.telephone ? ` · ${c.telephone}` : '') }))}
                onChange={v => setForm(f => ({ ...f, client_id: v }))}
              />
            </div>
          )}

          {/* Activité + Validité */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--b0)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Activité</label>
              <select value={form.activite} onChange={e => { setForm(f => ({ ...f, activite: e.target.value as Categorie })); setCatFilter('tous') }}>
                <option value="serrurerie">🔒 Serrurerie</option>
                <option value="plomberie">🔧 Plomberie</option>
                <option value="electricite">⚡ Électricité</option>
                <option value="vitrerie">🪟 Vitrerie</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Valide jusqu'au</label>
              <input type="date" value={form.valide_jusqu_au} onChange={e => setForm(f => ({ ...f, valide_jusqu_au: e.target.value }))} />
            </div>
          </div>

          {/* Intervenant admin */}
          {isAdmin && (
            <div className="form-group" style={{ margin: 0, marginTop: 12 }}>
              <label>Intervenant</label>
              <CustomSelect
                value={form.intervenant_id}
                placeholder="—"
                options={[{ value: '', label: '—' }, ...profiles.filter(p => p.actif).map(p => ({ value: p.id, label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant' }))]}
                onChange={v => setForm(f => ({ ...f, intervenant_id: v }))}
              />
            </div>
          )}

          {form.valide_jusqu_au && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--blBg)', borderRadius: 10, fontSize: 12, color: 'var(--blTx)' }}>
              ℹ Ce devis sera valable jusqu'au {new Date(form.valide_jusqu_au).toLocaleDateString('fr-FR')}. Date modifiable ci-dessus.
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 2 — PRESTATIONS
         ══════════════════════════════════════════════════ */}
      <div className="card mb-3">
        <div style={{ padding: '16px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 18 }}>🔧</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t0)' }}>Prestations</span>
            {lignes.length > 0 && (
              <span style={{ fontSize: 11, background: 'var(--blBg)', color: 'var(--blTx)', padding: '2px 8px', borderRadius: 10, marginLeft: 'auto', fontWeight: 700 }}>
                {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Search bar */}
          <div className="search-bar" style={{ marginBottom: 10 }}>
            <span style={{ color: 'var(--t3)', fontSize: 15, flexShrink: 0 }}>🔍</span>
            <input value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder="Rechercher dans le catalogue…" />
            {catalogueSearch && (
              <button onClick={() => setCatalogueSearch('')} style={{ border: 'none', background: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0, padding: '0 2px' }}>✕</button>
            )}
          </div>

          {/* Category chips */}
          {catChips.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
              {catChips.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCatFilter(cat)}
                  style={{
                    flexShrink: 0, padding: '6px 14px', borderRadius: 100, fontFamily: 'inherit',
                    border: catFilter === cat ? 'none' : '1px solid var(--b1)',
                    background: catFilter === cat ? 'var(--bl)' : 'var(--s0)',
                    color: catFilter === cat ? '#fff' : 'var(--t1)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                  }}
                >{cat === 'tous' ? 'Tout' : cat}</button>
              ))}
            </div>
          )}

          {/* Catalogue cards */}
          {cataloguePrestations.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 2, marginBottom: 14 }}>
              {cataloguePrestations.map(p => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { addFromCat(p.id); add(`${p.nom} ajouté`) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addFromCat(p.id); add(`${p.nom} ajouté`) } }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--blBg)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blBd)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--b0)' }}
                  onPointerDown={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.982)' }}
                  onPointerUp={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                  onPointerLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--b0)' }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '11px 13px', borderRadius: 14, background: 'var(--s1)',
                    border: '1px solid var(--b0)', gap: 10,
                    cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    transition: 'background .1s, border-color .1s, transform .1s',
                    outline: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--s0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0, border: '1px solid var(--b0)' }}>
                      {CAT_ICON[form.activite] || '🔧'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                      {p.description && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--blTx)', fontSize: 13, marginBottom: 4 }}>{p.prix_conseille}€ HT</div>
                    {/* stopPropagation : la carte gère déjà le clic, le bouton évite le double-ajout */}
                    <button
                      tabIndex={-1}
                      onClick={e => { e.stopPropagation(); addFromCat(p.id); add(`${p.nom} ajouté`) }}
                      style={{ padding: '5px 12px', borderRadius: 100, background: 'var(--bl)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >+ Ajouter</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '16px 0 14px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
              {catalogueSearch ? `Aucun résultat pour « ${catalogueSearch} »` : 'Aucune prestation dans le catalogue pour cette activité'}
            </div>
          )}
        </div>

        {/* Selected lignes */}
        {lignes.length > 0 && (
          <>
            <div style={{ borderTop: '2px solid var(--b0)', margin: '0 0' }} />
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                Sélectionnées ({lignes.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lignes.map((l, i) => (
                  <div key={l.id} style={{ padding: '13px 14px', borderRadius: 16, background: 'var(--s0)', border: '1px solid var(--b1)', boxShadow: 'var(--sh0)' }}>
                    {/* Description + delete */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                      <input
                        value={l.description}
                        onChange={e => updLine(i, 'description', e.target.value)}
                        placeholder="Description…"
                        style={{ flex: 1, border: 'none', background: 'transparent', padding: 0, fontWeight: 600, fontSize: 14, color: 'var(--t0)', outline: 'none', minWidth: 0, fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {isAdmin && (
                          <button onClick={() => addLineToCatalogue(l)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--gnBd)', background: 'var(--gnBg)', color: 'var(--gnTx)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} title="Ajouter au catalogue">+C</button>
                        )}
                        <button onClick={() => setLignes(ls => ls.filter((_, idx) => idx !== i))} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--rdBd)', background: 'var(--rdBg)', color: 'var(--rdTx)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>🗑</button>
                      </div>
                    </div>
                    {/* Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button style={QTY_BTN} onClick={() => updLine(i, 'quantite', Math.max(0.1, l.quantite - 1))}>−</button>
                        <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontSize: 15 }}>{l.quantite}</span>
                        <button style={QTY_BTN} onClick={() => updLine(i, 'quantite', l.quantite + 1)}>+</button>
                        <select value={l.tva_pct} onChange={e => updLine(i, 'tva_pct', +e.target.value)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 8, border: '1px solid var(--b1)', background: 'var(--s1)', color: 'var(--t1)', width: 'auto', minHeight: 'auto', cursor: 'pointer' }}>
                          <option value={0}>0%</option><option value={5.5}>5.5%</option><option value={10}>10%</option><option value={20}>20%</option>
                        </select>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                          <input type="number" value={l.prix_ht} min={0} step={0.01} onFocus={e => e.target.select()} onChange={e => updLine(i, 'prix_ht', parseFloat(e.target.value) || 0)} style={{ width: 60, textAlign: 'right', border: 'none', background: 'transparent', fontSize: 11, color: 'var(--t3)', padding: 0, outline: 'none', fontFamily: 'inherit' }} />
                          <span>€ HT × {l.quantite}</span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t0)', letterSpacing: '-.02em' }}>{eur(l.total_ttc)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Add manual */}
        <div style={{ padding: '0 18px 16px' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}
            onClick={() => setManuelModal({ description: '', quantite: '1', prix_ht: '0', tva_pct: params?.tva_defaut || 10, notes: '' })}
          >+ Ajouter une prestation manuelle</button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          RÉCAPITULATIF inline (mobile + desktop)
         ══════════════════════════════════════════════════ */}
      <div className="card card-body mb-3" style={{ background: 'var(--blBg)', border: '1px solid var(--blBd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>💰</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blTx)' }}>Récapitulatif</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--blTx)', opacity: 0.8, padding: '2px 0' }}>
          <span>Total HT</span><span>{eur(tot.ht)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--blTx)', opacity: 0.8, padding: '2px 0' }}>
          <span>TVA</span><span>{eur(tva)}</span>
        </div>
        {form.remise_pct > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--rdTx)', padding: '2px 0' }}>
            <span>Remise ({form.remise_pct}%)</span><span>−{eur(remise)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 6, borderTop: '2px solid var(--blBd)' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--blTx)' }}>Total TTC</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--blTx)', letterSpacing: '-.04em' }}>{eur(totalFinal)}</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 3 — OPTIONS
         ══════════════════════════════════════════════════ */}
      <div className="card card-body mb-3">
        <button type="button" onClick={() => setShowOptions(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>⚙</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)' }}>Options avancées</span>
            {(form.remise_pct > 0 || form.notes.trim()) && (
              <span style={{ fontSize: 11, background: 'var(--s2)', color: 'var(--t2)', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>
                {[form.remise_pct > 0 && `Remise ${form.remise_pct}%`, form.notes.trim() && 'Notes'].filter(Boolean).join(' · ')}
              </span>
            )}
            {!showOptions && <span style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Modèle PDF, conditions, remise…</span>}
          </div>
          <span style={{ fontSize: 14, color: 'var(--t3)', flexShrink: 0 }}>{showOptions ? '∧' : '∨'}</span>
        </button>
        {showOptions && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--b0)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!modeIntervenant && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Modèle PDF</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  {MODELES.map(m => (
                    <div key={m.id} onClick={() => setForm(f => ({ ...f, modele_id: m.id }))} style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: form.modele_id === m.id ? '3px solid var(--bl)' : '3px solid transparent', transition: 'border .15s' }}>
                      <div style={{ width: 72, height: 44, background: m.color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                        <span style={{ color: '#fff', fontSize: 8, fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>DEVIS{'\n'}KAYTEK</span>
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: m.accent }} />
                      </div>
                      <div style={{ background: 'var(--s1)', textAlign: 'center', fontSize: 9, padding: '3px 4px', color: form.modele_id === m.id ? 'var(--blTx)' : 'var(--t2)', fontWeight: form.modele_id === m.id ? 600 : 400 }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handlePreview} disabled={pdfLoading}>
                  {pdfLoading ? 'Génération...' : '👁 Aperçu PDF du modèle'}
                </button>
              </div>
            )}
            <div className="form-group" style={{ margin: 0 }}>
              <label>Remise (%)</label>
              <input type="number" inputMode="decimal" min={0} max={100} value={remiseStr}
                onChange={e => { setRemiseStr(e.target.value); const n = parseFloat(e.target.value); setForm(f => ({ ...f, remise_pct: isNaN(n) ? 0 : Math.max(0, Math.min(100, n)) })) }}
                onBlur={() => { const n = parseFloat(remiseStr); const safe = isNaN(n) ? 0 : Math.max(0, Math.min(100, n)); setRemiseStr(safe === 0 ? '' : String(safe)); setForm(f => ({ ...f, remise_pct: safe })) }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Notes / Conditions</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions particulières, remarques..." style={{ minHeight: 80 }} />
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 4 — SIGNATURE CLIENT
         ══════════════════════════════════════════════════ */}
      <div className="card card-body mb-4">
        {isSigned ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gnBg)', border: '2px solid var(--gnBd)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>✓</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--gnTx)' }}>Signature enregistrée</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                Signée le {existing?.signe_le ? new Date(existing.signe_le).toLocaleDateString('fr-FR') : '—'}
                {existing?.signe_par ? ` par ${existing.signe_par}` : ''}
              </div>
            </div>
          </div>
        ) : isEdit ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--blBg)', border: '1px solid var(--blBd)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>✍</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t0)' }}>Signature client</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>Le client signe ici pour accepter le devis</div>
                </div>
              </div>
              {!showSig && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowSig(true)} style={{ flexShrink: 0 }}>✍ Signer maintenant</button>
              )}
            </div>
            {showSig && (
              <SignatureModal onConfirm={handleSign} onCancel={() => setShowSig(false)} loading={sigSaving} />
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>✍</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)' }}>Signature client</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2, fontStyle: 'italic' }}>Disponible après enregistrement du devis.</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Actions mobile sticky ─────────────────────────── */}
      <div className="bottom-action-bar" style={{ alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 500, lineHeight: 1 }}>Total TTC</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t0)', lineHeight: 1.2, letterSpacing: '-.03em' }}>{eur(totalFinal)}</div>
        </div>
        {!modeIntervenant && (
          <button className="btn btn-secondary" onClick={() => save('brouillon')} disabled={create.isPending || update.isPending} style={{ flex: 'none' as any, paddingLeft: 14, paddingRight: 14 }}>
            💾 Brouillon
          </button>
        )}
        <button className="btn btn-primary" onClick={() => save('envoye')} disabled={create.isPending || update.isPending} style={{ flex: 1 }}>
          {create.isPending || update.isPending ? '…' : modeIntervenant ? (user?.can_bypass_validation ? '💾 Créer' : '📤 Soumettre') : '✉ Envoyer'}
        </button>
      </div>

      {/* ── Actions desktop ───────────────────────────────── */}
      <div className="hide-mobile flex gap-2 justify-end flex-wrap">
        <button className="btn btn-secondary" onClick={() => nav(form.intervention_id ? `/interventions/${form.intervention_id}` : '/devis')}>Annuler</button>
        {!modeIntervenant && (
          <>
            <button className="btn btn-secondary" onClick={handlePreview} disabled={pdfLoading}>{pdfLoading ? '...' : '📄 Aperçu PDF'}</button>
            <button className="btn btn-secondary" onClick={() => save('brouillon')} disabled={create.isPending || update.isPending}>💾 Sauvegarder brouillon</button>
          </>
        )}
        <button className="btn btn-primary" onClick={() => save('envoye')} disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? 'Sauvegarde...' : modeIntervenant ? (user?.can_bypass_validation ? '💾 Créer le devis' : '📤 Soumettre pour validation') : '✉ Enregistrer & Envoyer'}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════
          BOTTOM SHEET — PRESTATION MANUELLE
         ══════════════════════════════════════════════════ */}
      {manuelModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setManuelModal(null)}>
          <div style={{ background: 'var(--s0)', borderRadius: '24px 24px 0 0', maxHeight: 'calc(100dvh - 60px)', display: 'flex', flexDirection: 'column', overscrollBehavior: 'contain' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b1)' }} />
            </div>
            <div style={{ padding: '10px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderBottom: '1px solid var(--b0)' }}>
              <span style={{ fontWeight: 700, fontSize: 17, color: 'var(--t0)' }}>Ajouter une prestation manuelle</span>
              <button onClick={() => setManuelModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--t2)', padding: '4px 8px', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Description *</label>
                <input
                  value={manuelModal.description}
                  onChange={e => setManuelModal(m => m && { ...m, description: e.target.value })}
                  placeholder="Ex : Remplacement serrure 3 points…"
                  style={{ fontSize: 16, padding: '12px 14px' }}
                  onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350) }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Quantité *</label>
                  <input type="number" inputMode="decimal" min={0.1} step={0.1} value={manuelModal.quantite}
                    onChange={e => setManuelModal(m => m && { ...m, quantite: e.target.value })}
                    onFocus={e => { e.target.select(); const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350) }}
                    onBlur={() => { const n = parseFloat(manuelModal?.quantite || ''); setManuelModal(m => m && { ...m, quantite: !n || n <= 0 ? '1' : String(n) }) }}
                    style={{ fontSize: 16, padding: '12px 14px' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Prix unitaire HT *</label>
                  <input type="number" inputMode="decimal" min={0} step={0.01} value={manuelModal.prix_ht}
                    onChange={e => setManuelModal(m => m && { ...m, prix_ht: e.target.value })}
                    onFocus={e => { e.target.select(); const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350) }}
                    onBlur={() => { const n = parseFloat(manuelModal?.prix_ht || ''); setManuelModal(m => m && { ...m, prix_ht: isNaN(n) ? '0' : String(Math.max(0, n)) }) }}
                    style={{ fontSize: 16, padding: '12px 14px' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>TVA *</label>
                <select value={manuelModal.tva_pct} onChange={e => setManuelModal(m => m && { ...m, tva_pct: +e.target.value })} style={{ fontSize: 16, padding: '12px 14px' }}>
                  <option value={0}>0%</option><option value={5.5}>5.5%</option><option value={10}>10%</option><option value={20}>20%</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Notes (optionnel)</label>
                <textarea
                  value={manuelModal.notes}
                  onChange={e => setManuelModal(m => m && { ...m, notes: e.target.value })}
                  placeholder="Informations complémentaires…"
                  style={{ fontSize: 15, minHeight: 72 }}
                  onFocus={e => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350) }}
                />
              </div>
              <div style={{ background: 'var(--blBg)', border: '1px solid var(--blBd)', borderRadius: 14, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--blTx)', fontWeight: 600 }}>Total ligne</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--blTx)' }}>{eur(manuelTtc)} <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>HT</span></span>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', minHeight: 54, fontSize: 16, borderRadius: 14 }}
                onClick={() => {
                  if (!manuelModal.description.trim()) { add('La description est obligatoire', 'warning'); return }
                  setLignes(ls => [...ls, calc({ ...newLine(), description: manuelModal.description.trim(), quantite: parseFloat(manuelModal.quantite) || 1, prix_ht: parseFloat(manuelModal.prix_ht) || 0, tva_pct: manuelModal.tva_pct })])
                  setManuelModal(null)
                }}
              >+ Ajouter cette prestation</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
