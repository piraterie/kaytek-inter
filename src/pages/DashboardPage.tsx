// src/pages/DashboardPage.tsx
import { useNavigate } from 'react-router-dom'
import {
  Wrench, Euro, AlertTriangle, DollarSign, Clock, MessagesSquare,
  FileText, Mail, ArrowRight, Flame,
} from 'lucide-react'
import { useDashboard, useInterventions, useCommissions } from '@/lib/hooks'
import { useAuthStore } from '@/lib/store'
import { format } from 'date-fns'; import { fr } from 'date-fns/locale'

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const SC: Record<string, string> = {
  en_attente: 'pill-amber', accepte: 'pill-blue', en_cours: 'pill-orange',
  termine: 'pill-green', facture: 'pill-purple', annule: 'pill-gray', refuse: 'pill-red'
}
const ACT_PILL: Record<string, string> = {
  serrurerie: 'pill-gray', plomberie: 'pill-blue', electricite: 'pill-amber',
  vitrerie: 'pill-purple', chauffagiste: 'pill-orange',
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const nav = useNavigate()
  const { data: stats, isLoading } = useDashboard()
  const { data: interventions = [] } = useInterventions()
  const { data: commissions = [] } = useCommissions()
  const isAdmin = user?.role === 'admin'
  const isAssistant = user?.role === 'assistant'
  const canManageOps = isAdmin || isAssistant

  const recent = interventions.slice(0, 5)
  const urgentes = interventions.filter(i => i.urgence && i.statut === 'en_attente').slice(0, 3)
  const commDues = commissions.filter(c => c.statut === 'a_payer').slice(0, 3)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bonjour, {user?.prenom}</h1>
        <p className="page-subtitle">{format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}</p>
      </div>
      <div className="grid-4 mb-4">
        {(isAdmin ? [
          { l: "Interventions aujourd'hui", v: isLoading ? '…' : String(stats?.interventions_today ?? 0), ic: Wrench, c: 'blue' },
          { l: 'CA du mois', v: isLoading ? '…' : eur(stats?.ca_mois ?? 0), ic: Euro, c: 'green' },
          { l: 'Impayés', v: isLoading ? '…' : eur(stats?.montant_impaye ?? 0), ic: AlertTriangle, c: 'red' },
          { l: 'Commissions dues', v: isLoading ? '…' : eur(stats?.commissions_dues ?? 0), ic: DollarSign, c: 'amber' },
        ] : isAssistant ? [
          { l: 'Interventions du jour', v: isLoading ? '…' : String(stats?.interventions_today ?? 0), ic: Wrench, c: 'blue' },
          { l: 'À planifier', v: isLoading ? '…' : String(stats?.interventions_a_planifier ?? 0), ic: Clock, c: 'amber' },
          { l: 'Messages non lus', v: isLoading ? '…' : String(stats?.messages_non_lus ?? 0), ic: MessagesSquare, c: 'blue' },
        ] : [
          { l: "Mes interventions aujourd'hui", v: isLoading ? '…' : String(stats?.interventions_today ?? 0), ic: Wrench, c: 'blue' },
          { l: 'Mes gains ce mois', v: isLoading ? '…' : eur(stats?.mes_commissions_mois ?? 0), ic: Euro, c: 'green' },
          { l: 'À recevoir', v: isLoading ? '…' : eur(stats?.mes_commissions_dues ?? 0), ic: Clock, c: 'amber' },
          { l: 'Messages non lus', v: isLoading ? '…' : String(stats?.messages_non_lus ?? 0), ic: MessagesSquare, c: 'blue' },
        ]).map(s => (
          <div key={s.l} className="stat-card">
            <div className="flex justify-between items-center">
              <div className={`stat-icon ${s.c}`}><s.ic size={18} strokeWidth={2} /></div>
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
            <button className="btn btn-secondary btn-sm" onClick={() => nav('/interventions')}>Voir tout <ArrowRight size={13} /></button>
          </div>

          {/* MOBILE : liste compacte */}
          <div className="show-mobile" style={{ paddingBottom: 4 }}>
            {recent.length === 0 && <div style={{ textAlign:'center',padding:20,color:'var(--t3)',fontSize:13 }}>Aucune intervention</div>}
            {recent.map(i => (
              <div key={i.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--b0)',cursor:'pointer' }}
                onClick={() => nav(`/interventions/${i.id}`)}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:14, color:'var(--t0)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {i.urgence && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rd)', flexShrink: 0 }} />}
                    {i.numero}
                  </div>
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
                    <td className="td-bold">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {i.urgence && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rd)', flexShrink: 0 }} />}
                        {i.numero}
                      </div>
                    </td>
                    <td>{i.client?.nom} {i.client?.prenom}</td>
                    <td>{i.type ? <span className={`pill ${ACT_PILL[i.type] || 'pill-gray'}`}>{i.type}</span> : '—'}</td>
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
              <div className="card-header"><span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Flame size={14} color="var(--rdTx)" /> Urgences</span></div>
              <div style={{ padding: '8px 14px' }}>
                {urgentes.map(i => (
                  <div key={i.id} className="feed-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/interventions/${i.id}`)}>
                    <div className="feed-dot" style={{ background: 'var(--rdBg)', color: 'var(--rdTx)' }}><AlertTriangle size={13} /></div>
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
              <div className="card-header"><span className="card-title">Commissions à payer</span><button className="btn-icon sm" onClick={() => nav('/commissions')}><ArrowRight size={14} /></button></div>
              <div style={{ padding: '8px 14px' }}>
                {commDues.map(c => (
                  <div key={c.id} className="feed-item">
                    <div className="feed-dot" style={{ background: 'var(--amBg)', color: 'var(--amTx)' }}><DollarSign size={13} /></div>
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
              {canManageOps && <button className="btn btn-primary" onClick={() => nav('/interventions')} style={{ justifyContent: 'center' }}><Wrench size={14} /> Nouvelle intervention</button>}
              {isAdmin && <button className="btn btn-secondary" onClick={() => nav('/devis/nouveau')} style={{ justifyContent: 'center' }}><FileText size={14} /> Créer un devis</button>}
              <button className="btn btn-secondary" onClick={() => nav('/messagerie')} style={{ justifyContent: 'center' }}><Mail size={14} /> Messagerie</button>
              {!isAdmin && !isAssistant && <button className="btn btn-secondary" onClick={() => nav('/commissions')} style={{ justifyContent: 'center' }}><DollarSign size={14} /> Mes commissions</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
