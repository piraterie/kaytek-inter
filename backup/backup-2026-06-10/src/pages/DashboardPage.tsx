// src/pages/DashboardPage.tsx
import { useNavigate } from 'react-router-dom'
import { useDashboard, useInterventions, useCommissions } from '@/lib/hooks'
import { useAuthStore } from '@/lib/store'
import { format } from 'date-fns'; import { fr } from 'date-fns/locale'

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const SC: Record<string, string> = {
  en_attente: 'pill-amber', accepte: 'pill-blue', en_cours: 'pill-orange',
  termine: 'pill-green', facture: 'pill-purple', annule: 'pill-gray', refuse: 'pill-red'
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const nav = useNavigate()
  const { data: stats, isLoading } = useDashboard()
  const { data: interventions = [] } = useInterventions()
  const { data: commissions = [] } = useCommissions()

  const recent = interventions.slice(0, 5)
  const urgentes = interventions.filter(i => i.urgence && i.statut === 'en_attente').slice(0, 3)
  const commDues = commissions.filter(c => c.statut === 'a_payer').slice(0, 3)

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title">Bonjour, {user?.prenom} 👋</h1>
        <p className="page-subtitle">{format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}</p>
      </div>
      <div className="grid-4 mb-4">
        {(user?.role === 'admin' ? [
          { l: "Interventions aujourd'hui", v: isLoading ? '…' : String(stats?.interventions_today ?? 0), ic: '🔧', c: 'blue' },
          { l: 'CA du mois', v: isLoading ? '…' : eur(stats?.ca_mois ?? 0), ic: '💶', c: 'green' },
          { l: 'Impayés', v: isLoading ? '…' : eur(stats?.montant_impaye ?? 0), ic: '⚠', c: 'red' },
          { l: 'Commissions dues', v: isLoading ? '…' : eur(stats?.commissions_dues ?? 0), ic: '💰', c: 'amber' },
        ] : [
          { l: "Mes interventions aujourd'hui", v: isLoading ? '…' : String(stats?.interventions_today ?? 0), ic: '🔧', c: 'blue' },
          { l: 'Mes gains ce mois', v: isLoading ? '…' : eur(stats?.mes_commissions_mois ?? 0), ic: '💶', c: 'green' },
          { l: 'À recevoir', v: isLoading ? '…' : eur(stats?.mes_commissions_dues ?? 0), ic: '⏳', c: 'amber' },
          { l: 'Messages non lus', v: isLoading ? '…' : String(stats?.messages_non_lus ?? 0), ic: '💬', c: 'blue' },
        ]).map(s => (
          <div key={s.l} className="stat-card">
            <div className="flex justify-between items-center">
              <div className={`stat-icon ${s.c}`} style={{ fontSize: 17 }}>{s.ic}</div>
            </div>
            <div className="stat-value">{s.v}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="grid-2 mb-4">
        {/* Interventions récentes */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Interventions récentes</span>
            <button className="btn btn-secondary btn-sm" onClick={() => nav('/interventions')}>Voir tout →</button>
          </div>

          {/* MOBILE : liste compacte */}
          <div className="show-mobile" style={{ paddingBottom: 4 }}>
            {recent.length === 0 && <div style={{ textAlign:'center',padding:20,color:'var(--t3)',fontSize:13 }}>Aucune intervention</div>}
            {recent.map(i => (
              <div key={i.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--b0)',cursor:'pointer' }}
                onClick={() => nav(`/interventions/${i.id}`)}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:14, color:'var(--t0)' }}>{i.urgence && '🔴 '}{i.numero}</div>
                  <div style={{ fontSize:13, color:'var(--t2)', marginTop:1 }}>{i.client?.nom} {i.client?.prenom}</div>
                </div>
                <span className={`pill ${SC[i.statut] || 'pill-gray'}`}>{i.statut.replace('_',' ')}</span>
              </div>
            ))}
          </div>

          {/* DESKTOP : table */}
          <div className="hide-mobile overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>N°</th><th>Client</th><th>Type</th><th>Statut</th></tr></thead>
              <tbody>
                {recent.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--t3)' }}>Aucune intervention</td></tr>}
                {recent.map(i => (
                  <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                    <td className="td-bold">{i.urgence && '🔴 '}{i.numero}</td>
                    <td>{i.client?.nom} {i.client?.prenom}</td>
                    <td>{i.type ? <span className={`pill ${i.type === 'serrurerie' ? 'pill-gray' : 'pill-blue'}`}>{i.type}</span> : '—'}</td>
                    <td><span className={`pill ${SC[i.statut] || 'pill-gray'}`}>{i.statut.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Colonne droite */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {urgentes.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-title">🔴 Urgences</span></div>
              <div style={{ padding: '8px 14px' }}>
                {urgentes.map(i => (
                  <div key={i.id} className="feed-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                    <div className="feed-dot" style={{ background: 'var(--rdBg)', color: 'var(--rdTx)' }}>!</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{i.client?.nom} · {i.description?.slice(0, 35) || i.type}</div>
                      <div style={{ fontSize: 12, color: 'var(--t2)' }}>{i.adresse}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {commDues.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-title">Commissions à payer</span><button className="btn btn-secondary btn-sm" onClick={() => nav('/commissions')}>→</button></div>
              <div style={{ padding: '8px 14px' }}>
                {commDues.map(c => (
                  <div key={c.id} className="feed-item">
                    <div className="feed-dot" style={{ background: 'var(--amBg)', color: 'var(--amTx)' }}>💰</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.intervenant?.prenom} {c.intervenant?.nom}</div>
                      <div style={{ fontSize: 12, color: 'var(--t2)' }}>{c.intervention?.numero}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amTx)' }}>{eur(c.commission_admin)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {user?.role === 'admin' && <button className="btn btn-primary" onClick={() => nav('/interventions')} style={{ justifyContent: 'center' }}>🔧 Nouvelle intervention</button>}
              {user?.role === 'admin' && <button className="btn btn-secondary" onClick={() => nav('/devis/nouveau')} style={{ justifyContent: 'center' }}>📄 Créer un devis</button>}
              <button className="btn btn-secondary" onClick={() => nav('/messagerie')} style={{ justifyContent: 'center' }}>✉ Messagerie</button>
              {user?.role !== 'admin' && <button className="btn btn-secondary" onClick={() => nav('/commissions')} style={{ justifyContent: 'center' }}>💰 Mes commissions</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
