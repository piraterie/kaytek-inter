// src/pages/EcheanciersPage.tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Search, X, Euro } from 'lucide-react'
import { useEcheanciersList, type EcheancierListRow } from '@/lib/hooks/echeancier'
import { STATUT_ECHEANCE_LABELS, STATUT_ECHEANCE_COULEURS, STATUT_ECHEANCE_ICONES } from '@/lib/echeancier'
import type { StatutEcheancier } from '@/types'

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR')
const ns = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const FILTRES: { key: string; label: string; statuts?: StatutEcheancier[] }[] = [
  { key: 'tous', label: 'Tous' },
  { key: 'a_venir', label: 'À venir', statuts: ['a_facturer', 'en_attente_paiement'] },
  { key: 'a_facturer', label: 'À facturer', statuts: ['a_facturer'] },
  { key: 'en_attente_paiement', label: 'En attente de paiement', statuts: ['en_attente_paiement'] },
  { key: 'en_retard', label: 'En retard', statuts: ['en_retard'] },
  { key: 'paiement_partiel', label: 'Paiement partiel', statuts: ['paiement_partiel'] },
  { key: 'paye', label: 'Payés', statuts: ['paye'] },
  { key: 'impaye', label: 'Impayés', statuts: ['impaye'] },
  { key: 'annule', label: 'Annulés', statuts: ['annule'] },
]

function prochaineEcheance(row: EcheancierListRow) {
  const actives = (row.echeances || [])
    .filter(e => !['paye', 'annule'].includes(e.statut))
    .sort((a, b) => new Date(a.date_prevue).getTime() - new Date(b.date_prevue).getTime())
  return actives[0] || null
}

export default function EcheanciersPage() {
  const nav = useNavigate()
  const { data: rows = [], isLoading } = useEcheanciersList()
  const [filtre, setFiltre] = useState('tous')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const f = FILTRES.find(x => x.key === filtre)
    return rows.filter(r => {
      if (f?.statuts && !f.statuts.includes(r.statut)) return false
      if (search.trim()) {
        const q = ns(search)
        const hay = ns(`${r.devis?.numero || ''} ${r.client?.nom || ''} ${r.client?.prenom || ''}`)
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filtre, search])

  const totalRestant = rows.reduce((s, r) => s + (r.statut !== 'annule' ? r.montant_restant : 0), 0)

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title">Échéanciers</h1>
        <p className="page-subtitle">{rows.length} échéancier{rows.length > 1 ? 's' : ''} · {eur(totalRestant)} restant à encaisser</p>
      </div>

      <div className="grid-3 mb-4">
        <div className="stat-card accent-blue">
          <CalendarClock size={100} className="stat-decor" />
          <div className="stat-icon blue"><CalendarClock size={19} strokeWidth={2} /></div>
          <div className="stat-value">{rows.length}</div>
          <div className="stat-label">Échéanciers actifs</div>
        </div>
        <div className="stat-card" style={{ borderColor: 'var(--rdBd)' }}>
          <Euro size={100} className="stat-decor" />
          <div className="stat-icon red"><Euro size={19} strokeWidth={2} /></div>
          <div className="stat-value">{eur(totalRestant)}</div>
          <div className="stat-label">Reste à encaisser</div>
        </div>
        <div className="stat-card accent-green">
          <Euro size={100} className="stat-decor" />
          <div className="stat-icon green"><Euro size={19} strokeWidth={2} /></div>
          <div className="stat-value">{eur(rows.reduce((s, r) => s + r.montant_paye, 0))}</div>
          <div className="stat-label">Total encaissé</div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="search-bar" style={{ marginBottom: 10 }}>
          <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par n° de devis ou client…" />
          {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', color: 'var(--t3)', cursor: 'pointer', display: 'flex' }}><X size={15} /></button>}
        </div>
        <div className="filter-bar">
          {FILTRES.map(f => (
            <button key={f.key} onClick={() => setFiltre(f.key)} className={`btn btn-sm ${filtre === f.key ? 'btn-primary' : 'btn-secondary'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
      {!isLoading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--t3)' }}>Aucun échéancier</div>
      )}

      {/* ── MOBILE : cartes ──────────────────────────────── */}
      <div className="show-mobile">
        {filtered.map(r => {
          const prochaine = prochaineEcheance(r)
          return (
            <div key={r.id} data-testid="echeanciers-card" data-devis-numero={r.devis?.numero} onClick={() => nav(`/devis/${r.devis_id}/apercu`)}
              style={{ background: 'var(--s0)', borderRadius: 20, padding: '16px 18px', marginBottom: 10, boxShadow: 'var(--sh0)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>{r.client?.nom} {r.client?.prenom}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>{r.devis?.numero} · {r.nombre_echeances} échéance{r.nombre_echeances > 1 ? 's' : ''}</div>
                  {prochaine && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 3 }}>Prochaine : {fmtDate(prochaine.date_prevue)}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t0)', marginBottom: 6 }}>{eur(r.montant_restant)} restant</div>
                  <span className={`pill ${STATUT_ECHEANCE_COULEURS[r.statut]}`}>{STATUT_ECHEANCE_ICONES[r.statut]} {STATUT_ECHEANCE_LABELS[r.statut]}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── DESKTOP : table ──────────────────────────────── */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th><th>Devis</th><th>Montant total</th><th>Nb échéances</th>
              <th>Payé</th><th>Reste à payer</th><th>Prochaine échéance</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const prochaine = prochaineEcheance(r)
              return (
                <tr key={r.id} data-testid="echeanciers-row" data-devis-numero={r.devis?.numero} style={{ cursor: 'pointer' }} onClick={() => nav(`/devis/${r.devis_id}/apercu`)}>
                  <td>{r.client?.nom} {r.client?.prenom}</td>
                  <td>{r.devis?.numero}</td>
                  <td>{eur(r.montant_ttc)}</td>
                  <td>{r.nombre_echeances}</td>
                  <td>{eur(r.montant_paye)}</td>
                  <td data-testid="echeanciers-row-restant" style={{ fontWeight: 700 }}>{eur(r.montant_restant)}</td>
                  <td>{prochaine ? fmtDate(prochaine.date_prevue) : '—'}</td>
                  <td><span data-testid="echeanciers-row-statut" className={`pill ${STATUT_ECHEANCE_COULEURS[r.statut]}`}>{STATUT_ECHEANCE_ICONES[r.statut]} {STATUT_ECHEANCE_LABELS[r.statut]}</span></td>
                  <td></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
