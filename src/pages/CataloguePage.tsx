// src/pages/CataloguePage.tsx
import { useState } from 'react'
import { Search, X, Pencil, Pause, Play, Info } from 'lucide-react'
import { useAllPrestations, useCreatePrestation, useUpdatePrestation, useSeedDefaultPrestations } from '@/lib/hooks'
import { useToastStore, useAuthStore } from '@/lib/store'
import type { Categorie, Prestation } from '@/types'

const ACTIVITES: { value: Categorie | 'tous'; label: string }[] = [
  { value: 'tous', label: 'Toutes' },
  { value: 'serrurerie', label: 'Serrurerie' },
  { value: 'plomberie', label: 'Plomberie' },
  { value: 'electricite', label: 'Électricité' },
  { value: 'vitrerie', label: 'Vitrerie' },
  { value: 'chauffagiste', label: 'Chauffagiste' },
]

const ACT_LABELS: Record<string, string> = {
  serrurerie: 'Serrurerie', plomberie: 'Plomberie',
  electricite: 'Électricité', vitrerie: 'Vitrerie',
  chauffagiste: 'Chauffagiste',
}
const ACT_PILLS: Record<string, string> = {
  serrurerie: 'pill-gray', plomberie: 'pill-blue',
  electricite: 'pill-amber', vitrerie: 'pill-purple',
  chauffagiste: 'pill-orange',
}

const ns = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const emptyForm = { nom: '', categorie: 'serrurerie' as Categorie, prix_conseille: 0, tva_pct: 10, actif: true, ordre: 99 }

export default function CataloguePage() {
  const { add } = useToastStore()
  const { isAdmin, user } = useAuthStore()
  const { data: prestations = [], isLoading } = useAllPrestations()
  const create = useCreatePrestation()
  const upd = useUpdatePrestation()
  const seed = useSeedDefaultPrestations()

  const [filterAct, setFilterAct] = useState<Categorie | 'tous'>('tous')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Prestation | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  const filtered = prestations
    .filter(p => filterAct === 'tous' || p.categorie === filterAct)
    .filter(p => {
      if (!search.trim()) return true
      const q = ns(search)
      return ns(p.nom).includes(q) || ns(ACT_LABELS[p.categorie] || p.categorie).includes(q)
    })

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm, categorie: filterAct === 'tous' ? 'serrurerie' : filterAct as Categorie })
    setModal(true)
  }

  function openEdit(p: Prestation) {
    setEditing(p)
    setForm({ nom: p.nom, categorie: p.categorie, prix_conseille: p.prix_conseille || 0, tva_pct: p.tva_pct, actif: p.actif, ordre: p.ordre })
    setModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nom.trim()) { add('Le nom est requis', 'warning'); return }
    try {
      if (editing) {
        await upd.mutateAsync({ id: editing.id, ...form })
        add('Prestation mise à jour')
      } else {
        await create.mutateAsync(form as any)
        add('Prestation créée')
      }
      setModal(false)
    } catch (err: any) { add(err.message, 'error') }
  }

  async function handleSeedDefaults() {
    if (!user?.organisation_id) return
    try {
      const n = await seed.mutateAsync(user.organisation_id)
      add(n > 0 ? `${n} prestation${n > 1 ? 's' : ''} par défaut ajoutée${n > 1 ? 's' : ''}` : 'Prestations par défaut déjà présentes')
    } catch (err: any) { add(err.message, 'error') }
  }

  async function toggleActif(p: Prestation) {
    try {
      await upd.mutateAsync({ id: p.id, actif: !p.actif })
      add(p.actif ? 'Prestation désactivée' : 'Prestation réactivée')
    } catch (err: any) { add(err.message, 'error') }
  }

  const stats = {
    total: prestations.length,
    actives: prestations.filter(p => p.actif).length,
    inactives: prestations.filter(p => !p.actif).length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue des prestations</h1>
          <p className="page-subtitle">{stats.actives} actives · {stats.inactives} inactives · {stats.total} total</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Ajouter</button>
      </div>

      {/* Recherche + Filtres activité */}
      <div style={{ marginBottom: 16 }}>
        <div className="search-bar" style={{ marginBottom: 10 }}>
          <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une prestation…"
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ border:'none',background:'none',color:'var(--t3)',cursor:'pointer',padding:'0 2px',display:'flex',flexShrink:0 }}><X size={15} /></button>
          )}
        </div>
        <div className="filter-bar">
          {ACTIVITES.map(a => (
            <button key={a.value} onClick={() => setFilterAct(a.value)}
              className={`btn btn-sm ${filterAct === a.value ? 'btn-primary' : 'btn-secondary'}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* MOBILE : cards */}
      <div className="show-mobile">
        {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom: 12 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : isAdmin() ? (
              <>
                <p style={{ marginBottom: 14, fontSize: 14 }}>
                  Aucune prestation{filterAct !== 'tous' ? ` en ${ACT_LABELS[filterAct] || filterAct}` : ''}.
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSeedDefaults}
                  disabled={seed.isPending}
                >
                  {seed.isPending ? 'Ajout en cours…' : '+ Ajouter les prestations par défaut'}
                </button>
              </>
            ) : (
              <p style={{ fontSize: 14 }}>Aucune prestation{filterAct !== 'tous' ? ` dans cette catégorie` : ''}.</p>
            )}
          </div>
        )}
        {filtered.map(p => (
          <div key={p.id} className="mobile-card" style={{ opacity: p.actif ? 1 : 0.55 }}>
            <div className="mobile-card-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>{p.nom}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <span className={`pill ${ACT_PILLS[p.categorie] || 'pill-gray'}`} style={{ fontSize: 10 }}>{ACT_LABELS[p.categorie] || p.categorie}</span>
                  <span className={`pill ${p.actif ? 'pill-green' : 'pill-gray'}`} style={{ fontSize: 10 }}>{p.actif ? 'Actif' : 'Inactif'}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{(p.prix_conseille || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>TVA {p.tva_pct}%</div>
              </div>
            </div>
            <div className="mobile-card-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}><Pencil size={13} /> Modifier</button>
              <button className="btn btn-secondary btn-sm" onClick={() => toggleActif(p)}>
                {p.actif ? <><Pause size={13} /> Désactiver</> : <><Play size={13} /> Réactiver</>}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP : table */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Activité</th>
              <th style={{ textAlign: 'right' }}>Prix HT</th>
              <th>TVA</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                {search.trim() ? (
                  <><span>Aucun résultat — </span><button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button></>
                ) : isAdmin() ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                    <span>Aucune prestation{filterAct !== 'tous' ? ` en ${ACT_LABELS[filterAct] || filterAct}` : ''} —</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSeedDefaults}
                      disabled={seed.isPending}
                    >
                      {seed.isPending ? 'Ajout…' : '+ Ajouter les prestations par défaut'}
                    </button>
                  </span>
                ) : (
                  `Aucune prestation${filterAct !== 'tous' ? ' dans cette catégorie' : ''}`
                )}
              </td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} style={{ opacity: p.actif ? 1 : 0.5 }}>
                <td className="td-bold">{p.nom}</td>
                <td><span className={`pill ${ACT_PILLS[p.categorie] || 'pill-gray'}`}>{ACT_LABELS[p.categorie] || p.categorie}</span></td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{(p.prix_conseille || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                <td style={{ fontSize: 13 }}>{p.tva_pct}%</td>
                <td><span className={`pill ${p.actif ? 'pill-green' : 'pill-gray'}`}>{p.actif ? 'Actif' : 'Inactif'}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon sm" onClick={() => openEdit(p)} title="Modifier"><Pencil size={14} /></button>
                    <button className="btn-icon sm" onClick={() => toggleActif(p)} title={p.actif ? 'Désactiver' : 'Réactiver'}
                      style={{ color: p.actif ? 'var(--amTx)' : 'var(--gnTx)' }}>
                      {p.actif ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Note info */}
      <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--blBg)', border: '1px solid var(--blBd)', borderRadius: 'var(--r2)', fontSize: 12, color: 'var(--blTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Info size={14} style={{ flexShrink: 0 }} /> Les prestations désactivées n'apparaissent plus dans le catalogue rapide des devis, mais restent liées aux devis existants.
      </div>

      {/* MODAL */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Modifier la prestation' : 'Nouvelle prestation'}</span>
              <button className="btn-icon sm" onClick={() => setModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Nom *</label>
                  <input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} required placeholder="Ex : Ouverture porte claquée" />
                </div>
                <div className="form-group">
                  <label>Activité</label>
                  <select value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value as Categorie }))}>
                    <option value="serrurerie">Serrurerie</option>
                    <option value="plomberie">Plomberie</option>
                    <option value="electricite">Électricité</option>
                    <option value="vitrerie">Vitrerie</option>
                    <option value="chauffagiste">Chauffagiste</option>
                  </select>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Prix HT (€)</label>
                    <input type="number" min={0} step={0.01} value={form.prix_conseille}
                      onChange={e => setForm(f => ({ ...f, prix_conseille: +e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>TVA (%)</label>
                    <select value={form.tva_pct} onChange={e => setForm(f => ({ ...f, tva_pct: +e.target.value }))}>
                      <option value={0}>0%</option>
                      <option value={5.5}>5.5%</option>
                      <option value={10}>10%</option>
                      <option value={20}>20%</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Ordre d'affichage</label>
                  <input type="number" min={1} value={form.ordre} onChange={e => setForm(f => ({ ...f, ordre: +e.target.value }))} />
                </div>
                {editing && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))} style={{ width: 'auto', minHeight: 'auto' }} />
                    Prestation active
                  </label>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={create.isPending || upd.isPending}>
                  {create.isPending || upd.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
