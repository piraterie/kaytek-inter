// src/pages/CommissionsPage.tsx
import { useCommissions, useUpdateCommission, useProfiles } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'

const eur = (n: number) => (n||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})

export default function CommissionsPage() {
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const { data: commissions = [], isLoading } = useCommissions()
  const upd = useUpdateCommission()

  const byIntervenant: Record<string,any[]> = {}
  commissions.forEach(c => {
    const key = c.intervenant_id
    if (!byIntervenant[key]) byIntervenant[key] = []
    byIntervenant[key].push(c)
  })

  async function markPaid(id: string) {
    try { await upd.mutateAsync({ id, statut:'paye' }); add('Commission marquée payée') }
    catch(e:any) { add(e.message,'error') }
  }

  if (!isAdmin) {
    const myComm = commissions
    const dues = myComm.filter(c=>c.statut==='a_payer').reduce((s,c)=>s+c.part_intervenant,0)
    const payees = myComm.filter(c=>c.statut==='paye').reduce((s,c)=>s+c.part_intervenant,0)
    return (
      <div>
        <div style={{ marginBottom:16 }}><h1 className="page-title">Mes commissions</h1></div>
        <div className="grid-2 mb-4">
          <div className="stat-card"><div className="stat-icon amber" style={{ marginBottom:8,fontSize:16 }}>⏳</div><div className="stat-value">{eur(dues)}</div><div className="stat-label">À recevoir</div></div>
          <div className="stat-card"><div className="stat-icon green" style={{ marginBottom:8,fontSize:16 }}>✓</div><div className="stat-value">{eur(payees)}</div><div className="stat-label">Déjà reçu</div></div>
        </div>
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Intervention</th><th>Montant client</th><th>Ma part</th><th>Commission admin</th><th>Statut</th></tr></thead>
            <tbody>
              {isLoading&&<tr><td colSpan={5} style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement…</td></tr>}
              {myComm.map(c=>(
                <tr key={c.id}>
                  <td className="td-bold">{c.intervention?.numero||'—'}</td>
                  <td>{eur(c.montant_total_client)}</td>
                  <td className="td-bold text-green">{eur(c.part_intervenant)}</td>
                  <td>{eur(c.commission_admin)}</td>
                  <td><span className={`pill ${c.statut==='paye'?'pill-green':'pill-amber'}`}>{c.statut==='paye'?'Payée':'À recevoir'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom:16 }}><h1 className="page-title">Commissions</h1><p className="page-subtitle">Répartition par intervenant</p></div>
      {Object.entries(byIntervenant).map(([intId, comms]) => {
        const intervenant = comms[0]?.intervenant
        const totalClient = comms.reduce((s,c)=>s+c.montant_total_client,0)
        const totalAdmin = comms.reduce((s,c)=>s+c.commission_admin,0)
        const totalInter = comms.reduce((s,c)=>s+c.part_intervenant,0)
        const dues = comms.filter(c=>c.statut==='a_payer')
        const montantDu = dues.reduce((s,c)=>s+c.commission_admin,0)
        return (
          <div key={intId} className="card mb-4">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <div className="avatar" style={{ width:28,height:28,fontSize:10 }}>{(intervenant?.prenom?.[0]||'')+(intervenant?.nom?.[0]||'')}</div>
                <span className="card-title">{intervenant?.prenom} {intervenant?.nom}</span>
              </div>
              <span className="pill pill-amber">Commission {comms[0]?.commission_pct}%</span>
            </div>
            <div className="card-body">
              <div style={{ display:'flex',gap:24,flexWrap:'wrap',marginBottom:14 }}>
                {[['CA total client',eur(totalClient),'var(--t0)'],
                  [`Part intervenant (${100-comms[0]?.commission_pct}%)`,eur(totalInter),'var(--gnTx)'],
                  [`Commission admin (${comms[0]?.commission_pct}%)`,eur(totalAdmin),'var(--blTx)'],
                  ['À payer',eur(montantDu),'var(--amTx)']
                ].map(([l,v,c])=>(
                  <div key={l as string}>
                    <div style={{ fontSize:10,color:'var(--t2)',marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:16,fontWeight:600,color:c as string }}>{v}</div>
                  </div>
                ))}
              </div>
              {dues.length>0&&(
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Intervention</th><th>Montant client</th><th>Part inter.</th><th>Commission</th><th></th></tr></thead>
                    <tbody>
                      {dues.map(c=>(
                        <tr key={c.id}>
                          <td className="td-bold">{c.intervention?.numero||'—'}</td>
                          <td>{eur(c.montant_total_client)}</td>
                          <td className="text-green">{eur(c.part_intervenant)}</td>
                          <td className="text-blue">{eur(c.commission_admin)}</td>
                          <td><button className="btn btn-primary btn-sm" onClick={()=>markPaid(c.id)} disabled={upd.isPending}>✓ Payé</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {dues.length===0&&<p style={{ color:'var(--gnTx)',fontSize:12 }}>✓ Tout est à jour</p>}
            </div>
          </div>
        )
      })}
      {commissions.length===0&&!isLoading&&<div style={{ textAlign:'center',padding:40,color:'var(--t3)' }}>Aucune commission</div>}
    </div>
  )
}
