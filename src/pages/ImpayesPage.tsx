// src/pages/ImpayesPage.tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Euro, Users, Clock } from 'lucide-react'
import { useEcheancesImpayees, type EcheanceImpayeeRow } from '@/lib/hooks/echeancier'
import { STATUT_ECHEANCE_LABELS, STATUT_ECHEANCE_COULEURS, STATUT_ECHEANCE_ICONES } from '@/lib/echeancier'
import { useAuthStore, useToastStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import PaiementCreateModal from '@/components/PaiementCreateModal'

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR')

function joursDeRetard(datePrevue: string): number {
  const diff = Date.now() - new Date(datePrevue).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

function badgeRetard(jours: number): { label: string; classe: string } {
  if (jours <= 0) return { label: 'À échéance', classe: 'pill-gray' }
  if (jours <= 7) return { label: `${jours} j de retard`, classe: 'pill-orange' }
  if (jours <= 15) return { label: `${jours} j de retard`, classe: 'pill-red' }
  if (jours <= 30) return { label: `${jours} j de retard`, classe: 'pill-red' }
  return { label: `${jours} j de retard`, classe: 'pill-purple' }
}

export default function ImpayesPage() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const { data: rows = [], isLoading, refetch } = useEcheancesImpayees()
  const [paiementEcheance, setPaiementEcheance] = useState<EcheanceImpayeeRow | null>(null)
  const [relanceLoadingId, setRelanceLoadingId] = useState<string | null>(null)

  async function handleRelancer(echeanceId: string) {
    setRelanceLoadingId(echeanceId)
    try {
      const { data, error } = await supabase.functions.invoke('send-relances-echeance', { body: { echeance_id: echeanceId } })
      if (error) throw error
      if (data?.sent > 0) add('Relance envoyée par e-mail')
      else add(data?.results?.[0]?.status || 'Aucune relance envoyée', 'error')
    } catch (e: any) {
      add(e.message || "Erreur lors de l'envoi de la relance", 'error')
    } finally {
      setRelanceLoadingId(null)
    }
  }

  const stats = useMemo(() => {
    const totalImpaye = rows.reduce((s, r) => s + r.montant_restant, 0)
    const clients = new Set(rows.map(r => r.client?.id).filter(Boolean))
    const enRetardCount = rows.filter(r => r.statut === 'en_retard' || r.statut === 'impaye').length
    const retards = rows.map(r => joursDeRetard(r.date_prevue)).filter(j => j > 0)
    const retardMoyen = retards.length ? Math.round(retards.reduce((a, b) => a + b, 0) / retards.length) : 0
    const plusAncien = retards.length ? Math.max(...retards) : 0
    return { totalImpaye, nbClients: clients.size, enRetardCount, retardMoyen, plusAncien }
  }, [rows])

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title">Impayés</h1>
        <p className="page-subtitle">{rows.length} échéance{rows.length > 1 ? 's' : ''} en retard, impayée{rows.length > 1 ? 's' : ''} ou partiellement réglée{rows.length > 1 ? 's' : ''}</p>
      </div>

      <div className="grid-4 mb-4">
        <div className="stat-card" style={{ borderColor: 'var(--rdBd)' }}>
          <Euro size={100} className="stat-decor" />
          <div className="stat-icon red"><Euro size={19} strokeWidth={2} /></div>
          <div className="stat-value" data-testid="impayes-total">{eur(stats.totalImpaye)}</div>
          <div className="stat-label">Total impayé</div>
        </div>
        <div className="stat-card accent-blue">
          <Users size={100} className="stat-decor" />
          <div className="stat-icon blue"><Users size={19} strokeWidth={2} /></div>
          <div className="stat-value" data-testid="impayes-clients">{stats.nbClients}</div>
          <div className="stat-label">Clients concernés</div>
        </div>
        <div className="stat-card" style={{ borderColor: 'var(--amBd)' }}>
          <AlertTriangle size={100} className="stat-decor" />
          <div className="stat-icon amber"><AlertTriangle size={19} strokeWidth={2} /></div>
          <div className="stat-value" data-testid="impayes-en-retard-count">{stats.enRetardCount}</div>
          <div className="stat-label">Échéances en retard</div>
        </div>
        <div className="stat-card">
          <Clock size={100} className="stat-decor" />
          <div className="stat-icon"><Clock size={19} strokeWidth={2} /></div>
          <div className="stat-value">{stats.retardMoyen} j</div>
          <div className="stat-label">Retard moyen · plus ancien {stats.plusAncien} j</div>
        </div>
      </div>

      {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
      {!isLoading && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--t3)' }}>Aucun impayé — tout est à jour 🎉</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => {
          const jours = joursDeRetard(r.date_prevue)
          const badge = badgeRetard(jours)
          return (
            <div key={r.id} data-testid="impaye-row" data-devis-numero={r.devis?.numero} className="card card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{r.client?.nom} {r.client?.prenom}</span>
                  <span className={`pill ${badge.classe}`}>{badge.label}</span>
                  <span data-testid="impaye-row-statut" className={`pill ${STATUT_ECHEANCE_COULEURS[r.statut]}`}>{STATUT_ECHEANCE_ICONES[r.statut]} {STATUT_ECHEANCE_LABELS[r.statut]}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>
                  {r.devis?.numero} · {r.libelle} · prévu le {fmtDate(r.date_prevue)}
                  {r.client?.telephone && ` · ${r.client.telephone}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{eur(r.montant_restant)}</div>
                {r.montant_paye > 0 && <div style={{ fontSize: 11, color: 'var(--t3)' }}>{eur(r.montant_paye)} déjà payé</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary sm" onClick={() => nav(`/devis/${r.devis_id}/apercu`)}>Voir l'échéancier</button>
                {isAdmin && (
                  <button data-testid="impaye-relancer" className="btn btn-secondary sm" disabled={relanceLoadingId === r.id} onClick={() => handleRelancer(r.id)}>
                    {relanceLoadingId === r.id ? 'Envoi…' : '📧 Relancer'}
                  </button>
                )}
                <button data-testid="impaye-paiement" className="btn btn-primary sm" onClick={() => setPaiementEcheance(r)}>💳 Paiement</button>
              </div>
            </div>
          )
        })}
      </div>

      {paiementEcheance && (
        <PaiementCreateModal
          echeance={paiementEcheance}
          onClose={() => setPaiementEcheance(null)}
          onSaved={() => { setPaiementEcheance(null); refetch() }}
        />
      )}
    </>
  )
}
