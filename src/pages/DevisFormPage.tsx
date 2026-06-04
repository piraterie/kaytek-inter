// src/pages/DevisFormPage.tsx
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import { useCreateDevis, useUpdateDevis, useDevisById, useClients, useProfiles, usePrestations, useParametres } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import { uploadSignature } from '@/lib/supabase/storage'
import { generateDevisPDF, downloadBlob } from '@/lib/pdf/generator'
import type { LigneDevis } from '@/types'

const newLine = (): LigneDevis => ({ id: crypto.randomUUID(), description: '', quantite: 1, prix_ht: 0, tva_pct: 10, total_ht: 0, total_ttc: 0 })

const calc = (l: LigneDevis): LigneDevis => {
  const total_ht = Math.round(l.quantite * l.prix_ht * 100) / 100
  return { ...l, total_ht, total_ttc: Math.round(total_ht * (1 + l.tva_pct / 100) * 100) / 100 }
}

const MODELES = [
  { id: 0, label: 'Minimaliste', color: '#f0f0f2', fg: '#111' },
  { id: 1, label: 'Bleu', color: '#2563eb', fg: '#fff' },
  { id: 2, label: 'Noir', color: '#111', fg: '#fff' },
  { id: 3, label: 'Orange', color: '#ea580c', fg: '#fff' },
  { id: 4, label: 'Vert', color: '#16a34a', fg: '#fff' },
]

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
  const [sigPad, setSigPad] = useState<SignaturePad | null>(null)
  const [showSig, setShowSig] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  const { data: existing } = useDevisById(id || '')
  const { data: clients = [] } = useClients()
  const { data: profiles = [] } = useProfiles()
  const { data: prestations = [] } = usePrestations()
  const create = useCreateDevis()
  const update = useUpdateDevis()

  const [form, setForm] = useState({
    client_id: '', intervenant_id: user?.id || '', activite: 'serrurerie' as 'serrurerie' | 'vitrerie',
    notes: '', modele_id: 0, remise_pct: 0,
    valide_jusqu_au: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    intervention_id: sp.get('intervention') || ''
  })
  const [lignes, setLignes] = useState<LigneDevis[]>([newLine()])

  useEffect(() => {
    if (existing) {
      setForm({
        client_id: existing.client_id || '', intervenant_id: existing.intervenant_id || '',
        activite: existing.activite || 'serrurerie', notes: existing.notes || '',
        modele_id: existing.modele_id || 0, remise_pct: existing.remise_pct || 0,
        valide_jusqu_au: existing.valide_jusqu_au || '', intervention_id: existing.intervention_id || ''
      })
      if (existing.lignes?.length) setLignes(existing.lignes)
    }
  }, [existing])

  useEffect(() => {
    if (showSig && canvasRef.current && !sigPad) {
      setSigPad(new SignaturePad(canvasRef.current, { backgroundColor: 'rgba(255,255,255,0)' }))
    }
  }, [showSig, sigPad])

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

  async function save(statut: 'brouillon' | 'envoye') {
    if (!form.client_id) { add('Selectionnez un client', 'warning'); return }
    const payload: any = {
      client_id: form.client_id, statut, lignes,
      total_ht: tot.ht, tva_montant: tva, total_ttc: totalFinal, remise_montant: remise,
      remise_pct: form.remise_pct, modele_id: form.modele_id,
      activite: form.activite, notes: form.notes,
      valide_jusqu_au: form.valide_jusqu_au || null,
    }
    if (form.intervenant_id) payload.intervenant_id = form.intervenant_id
    if (form.intervention_id) payload.intervention_id = form.intervention_id
    try {
      if (isEdit) { await update.mutateAsync({ id: id!, ...payload }); add('Devis mis a jour') }
      else { await create.mutateAsync(payload); add('Devis cree') }
      nav('/devis')
    } catch (e: any) { add('Erreur: ' + e.message, 'error') }
  }

  async function handleSign() {
    if (!sigPad || sigPad.isEmpty()) { add('Veuillez signer', 'warning'); return }
    const dataUrl = sigPad.toDataURL()
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const { url, error } = await uploadSignature(blob, id || 'nouveau', 'devis')
    if (error) { add(error, 'error'); return }
    await update.mutateAsync({ id: id!, signature_url: url, signe_le: new Date().toISOString(), statut: 'accepte' })
    add('Signature enregistree')
    setShowSig(false)
  }

  const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="flex items-center gap-3 mb-4">
        <button className="btn-icon" onClick={() => nav('/devis')}>←</button>
        <div>
          <h1 className="page-title">{isEdit ? 'Modifier le devis' : 'Nouveau devis'}</h1>
          {isEdit && existing && <p className="page-subtitle">{existing.numero}</p>}
        </div>
      </div>

      {/* Choix modele visuel */}
      <div className="card card-body mb-3">
        <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Modele PDF</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {MODELES.map(m => (
            <div key={m.id} onClick={() => setForm(f => ({ ...f, modele_id: m.id }))}
              style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: form.modele_id === m.id ? '3px solid var(--bl)' : '3px solid transparent', transition: 'border .15s' }}>
              <div style={{ width: 80, height: 52, background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: m.fg, fontSize: 9, fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>DEVIS{'\n'}KAYTEK</span>
              </div>
              <div style={{ background: 'var(--s1)', textAlign: 'center', fontSize: 10, padding: '3px 6px', color: form.modele_id === m.id ? 'var(--blTx)' : 'var(--t2)', fontWeight: form.modele_id === m.id ? 600 : 400 }}>{m.label}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm mt-3" onClick={handlePreview} disabled={pdfLoading} style={{ alignSelf: 'flex-start' }}>
          {pdfLoading ? 'Generation...' : '👁 Apercu PDF du modele'}
        </button>
      </div>

      {/* Infos */}
      <div className="grid-2 mb-3">
        <div className="form-group">
          <label>Client *</label>
          <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
            <option value="">Selectionner un client...</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nom} {c.prenom} {c.telephone ? `· ${c.telephone}` : ''}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Intervenant</label>
          <select value={form.intervenant_id} onChange={e => setForm(f => ({ ...f, intervenant_id: e.target.value }))}>
            <option value="">—</option>
            {profiles.filter(p => p.actif).map(p => <option key={p.id} value={p.id}>{p.prenom} {p.nom} ({p.role})</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Activite</label>
          <select value={form.activite} onChange={e => setForm(f => ({ ...f, activite: e.target.value as any }))}>
            <option value="serrurerie">Serrurerie</option>
            <option value="vitrerie">Vitrerie</option>
          </select>
        </div>
        <div className="form-group">
          <label>Valable jusqu au</label>
          <input type="date" value={form.valide_jusqu_au} onChange={e => setForm(f => ({ ...f, valide_jusqu_au: e.target.value }))} />
        </div>
      </div>

      {/* Catalogue */}
      <div className="card card-body mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 500, flexShrink: 0 }}>Catalogue rapide :</span>
          <select style={{ width: 'auto', flex: 1, maxWidth: 340 }} defaultValue="" onChange={e => { addFromCat(e.target.value); (e.target as HTMLSelectElement).value = '' }}>
            <option value="">Ajouter une prestation...</option>
            {prestations.filter(p => p.categorie === form.activite).map(p => (
              <option key={p.id} value={p.id}>{p.nom} — {p.prix_conseille}€ HT</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lignes */}
      <div className="card mb-3">
        <div className="card-header">
          <span className="card-title">Prestations</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setLignes(l => [...l, newLine()])}>+ Ligne</button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th style={{ minWidth: 200 }}>Description</th>
              <th style={{ width: 60 }}>Qte</th>
              <th style={{ width: 90 }}>Prix HT</th>
              <th style={{ width: 75 }}>TVA</th>
              <th style={{ width: 100 }}>Total TTC</th>
              <th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={l.id}>
                  <td><input value={l.description} onChange={e => updLine(i, 'description', e.target.value)} placeholder="Description..." /></td>
                  <td><input type="number" value={l.quantite} min={1} onChange={e => updLine(i, 'quantite', +e.target.value)} /></td>
                  <td><input type="number" value={l.prix_ht} step={0.01} min={0} onChange={e => updLine(i, 'prix_ht', +e.target.value)} /></td>
                  <td>
                    <select value={l.tva_pct} onChange={e => updLine(i, 'tva_pct', +e.target.value)}>
                      <option value={0}>0%</option>
                      <option value={5.5}>5.5%</option>
                      <option value={10}>10%</option>
                      <option value={20}>20%</option>
                    </select>
                  </td>
                  <td style={{ fontWeight: 600, textAlign: 'right' }}>{eur(l.total_ttc)}</td>
                  <td><button className="btn-icon sm" style={{ color: 'var(--rdTx)' }} onClick={() => setLignes(ls => ls.filter((_, idx) => idx !== i))}>🗑</button></td>
                </tr>
              ))}
              {lignes.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--t3)' }}>Aucune ligne — ajoutez une prestation</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--b0)', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 240 }}>
            <div className="flex justify-between" style={{ padding: '4px 0', fontSize: 12, color: 'var(--t2)' }}>
              <span>Total HT</span><span>{eur(tot.ht)}</span>
            </div>
            <div className="flex justify-between" style={{ padding: '4px 0', fontSize: 12, color: 'var(--t2)' }}>
              <span>TVA</span><span>{eur(tva)}</span>
            </div>
            {form.remise_pct > 0 && (
              <div className="flex justify-between" style={{ padding: '4px 0', fontSize: 12, color: 'var(--rdTx)' }}>
                <span>Remise ({form.remise_pct}%)</span><span>-{eur(remise)}</span>
              </div>
            )}
            <div className="flex justify-between" style={{ padding: '8px 0 0', fontSize: 16, fontWeight: 700, borderTop: '2px solid var(--b1)', marginTop: 4 }}>
              <span>Total TTC</span><span style={{ color: 'var(--blTx)' }}>{eur(totalFinal)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="form-row mb-3">
        <div className="form-group">
          <label>Remise (%)</label>
          <input type="number" min={0} max={100} value={form.remise_pct} onChange={e => setForm(f => ({ ...f, remise_pct: +e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Notes / Conditions</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions particulieres, remarques..." style={{ minHeight: 60 }} />
        </div>
      </div>

      {/* Signature — disponible avant ET apres creation */}
      <div className="card card-body mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Signature client</span>
            <p style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>Le client signe ici pour accepter le devis</p>
          </div>
          {existing?.signature_url
            ? <span className="pill pill-green">✓ Signe le {existing.signe_le ? new Date(existing.signe_le).toLocaleDateString('fr-FR') : ''}</span>
            : <button className="btn btn-secondary btn-sm" onClick={() => setShowSig(!showSig)}>
              {showSig ? 'Masquer' : '✍ Zone de signature'}
            </button>
          }
        </div>
        {showSig && !existing?.signature_url && (
          <div>
            <div style={{ background: 'var(--s1)', border: '2px dashed var(--b1)', borderRadius: 8, padding: 4 }}>
              <canvas ref={canvasRef} width={600} height={130}
                style={{ display: 'block', width: '100%', touchAction: 'none', cursor: 'crosshair', borderRadius: 6 }} />
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-secondary btn-sm" onClick={() => sigPad?.clear()}>Effacer</button>
              {isEdit && <button className="btn btn-primary btn-sm" onClick={handleSign}>✓ Valider signature</button>}
              {!isEdit && <span style={{ fontSize: 11, color: 'var(--amTx)', alignSelf: 'center' }}>⚠ Sauvegardez d abord le devis pour valider la signature</span>}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end flex-wrap">
        <button className="btn btn-secondary" onClick={() => nav('/devis')}>Annuler</button>
        <button className="btn btn-secondary" onClick={handlePreview} disabled={pdfLoading}>
          {pdfLoading ? '...' : '📄 Apercu PDF'}
        </button>
        <button className="btn btn-secondary" onClick={() => save('brouillon')} disabled={create.isPending || update.isPending}>
          💾 Sauvegarder brouillon
        </button>
        <button className="btn btn-primary" onClick={() => save('envoye')} disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? 'Sauvegarde...' : '✉ Enregistrer & Envoyer'}
        </button>
      </div>
    </div>
  )
}
