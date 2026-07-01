// src/pages/CommissionsPage.tsx
import { useState } from 'react'
import { useCommissionsData, useMarkCommissionReceived, useUpdateInterventionMateriel, notifyUser, notifyAdmins } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { exportCommissionsPremium } from '@/lib/exportPremium'

const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

type MaterielModal = {
  intervention_id: string
  facture_numero: string
  cout_pieces: string
  materiel_payeur: string | null
  materiel_confirme: boolean
  original_cout: number
  intervenant_id: string | null
}

export default function CommissionsPage() {
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const isAdmin = user?.role === 'admin'
  const { data: commissionsData, isLoading, error } = useCommissionsData()
  const items = commissionsData?.items ?? []
  const unattributedCount = commissionsData?.unattributedCount ?? 0
  const markReceived = useMarkCommissionReceived()
  const updateMateriel = useUpdateInterventionMateriel()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [materielModal, setMaterielModal] = useState<MaterielModal | null>(null)
  const [materielInput, setMaterielInput] = useState('')

  function openMaterielModal(c: any) {
    setMaterielInput(c.cout_pieces_raw ? String(c.cout_pieces_raw) : '')
    setMaterielModal({
      intervention_id: c.intervention_id,
      facture_numero: c.facture_numero || '—',
      cout_pieces: c.cout_pieces_raw ? String(c.cout_pieces_raw) : '',
      materiel_payeur: c.materiel_payeur || null,
      materiel_confirme: c.materiel_confirme || false,
      original_cout: c.cout_pieces_raw || 0,
      intervenant_id: c.intervenant_id || null,
    })
  }

  async function handleSaveMateriel(confirmer: boolean) {
    if (!materielModal) return
    try {
      const newAmount = parseFloat(materielInput.replace(',', '.')) || 0
      await updateMateriel.mutateAsync({
        intervention_id: materielModal.intervention_id,
        cout_pieces: newAmount,
        materiel_payeur: materielModal.materiel_payeur,
        confirmer,
      })
      add(confirmer ? '✅ Matériel confirmé — commission recalculée' : '💾 Matériel enregistré')
      if (newAmount !== materielModal.original_cout) {
        const lien = '/commissions'
        if (isAdmin) {
          if (materielModal.intervenant_id) {
            await notifyUser(
              materielModal.intervenant_id,
              'Matériel mis à jour',
              'Le montant du matériel a été ajouté ou modifié sur une facture liée à votre intervention.',
              lien
            )
          }
          await notifyAdmins(
            'Matériel mis à jour',
            'Le montant du matériel a été ajouté ou modifié sur une facture.',
            lien
          )
        } else {
          await notifyAdmins(
            'Matériel mis à jour',
            'Un intervenant a ajouté ou modifié le montant du matériel sur une facture.',
            lien
          )
        }
      }
      setMaterielModal(null)
    } catch (e: any) {
      add(e.message || 'Erreur', 'error')
    }
  }

  async function handleMarkReceived(c: any) {
    if (processingId) return
    setProcessingId(c.id)
    try {
      await markReceived.mutateAsync({ facture_id: c.id, intervention_id: c.intervention_id })
      add('Commission marquée comme reçue')
    } catch (e: any) {
      add(e.message || 'Erreur', 'error')
    } finally {
      setProcessingId(null)
    }
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="page-title">{isAdmin ? 'Commissions' : 'Mes commissions'}</h1>
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Chargement…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="page-title">{isAdmin ? 'Commissions' : 'Mes commissions'}</h1>
        <div style={{ padding: '12px 16px', background: 'var(--rdBg)', color: 'var(--rdTx)', borderRadius: 'var(--r2)', border: '1px solid var(--rdBd)', margin: '16px 0' }}>
          Erreur : {(error as any)?.message || 'Impossible de charger les commissions'}
        </div>
      </div>
    )
  }

  function MaterielBtn({ c }: { c: any }) {
    const hasRaw = (c.cout_pieces_raw || 0) > 0
    const isConfirmed = c.materiel_confirme
    return (
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => openMaterielModal(c)}
        style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }}
      >
        {hasRaw
          ? isConfirmed
            ? `🔩 ${eur(c.cout_pieces_raw)} ✓`
            : `🔩 ${eur(c.cout_pieces_raw)} ⏳`
          : '🔩 Matériel'}
      </button>
    )
  }

  function renderMaterielModal() {
    if (!materielModal) return null
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setMaterielModal(null) }}>
        <div className="card card-body" style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>🔩 Matériel — {materielModal.facture_numero}</div>

          <div className="form-group">
            <label>Montant matériel (€)</label>
            <input
              type="text"
              inputMode="decimal"
              value={materielInput}
              placeholder="0.00"
              onChange={e => {
                const v = e.target.value
                if (/^[0-9]*([,.][0-9]*)?$/.test(v) || v === '') {
                  setMaterielInput(v)
                }
              }}
            />
          </div>

          <div className="form-group">
            <label>Payé par</label>
            <select
              value={materielModal.materiel_payeur || ''}
              onChange={e => setMaterielModal(m => m ? { ...m, materiel_payeur: e.target.value || null } : m)}
            >
              <option value="">— Non défini —</option>
              <option value="intervenant">L'intervenant</option>
              <option value="admin">L'entreprise</option>
            </select>
          </div>

          {materielModal.materiel_confirme && (
            <div style={{ fontSize: 12, color: '#16a34a', padding: '6px 0', marginBottom: 8 }}>
              ✅ Actuellement confirmé
            </div>
          )}
          {!materielModal.materiel_confirme && materielInput.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--amTx)', padding: '4px 0', marginBottom: 8 }}>
              ⏳ Non confirmé — non déduit du calcul
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            {isAdmin ? (
              <button className="btn btn-primary" onClick={() => handleSaveMateriel(true)} disabled={updateMateriel.isPending}>
                {updateMateriel.isPending ? 'Enregistrement…' : '✅ Confirmer matériel'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => handleSaveMateriel(false)} disabled={updateMateriel.isPending}>
                {updateMateriel.isPending ? 'Enregistrement…' : '💾 Enregistrer'}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setMaterielModal(null)}>Annuler</button>
          </div>
        </div>
      </div>
    )
  }

  // ── VUE INTERVENANT ──────────────────────────────────────────────
  if (!isAdmin) {
    const pending = items.filter(c => !c.recue)
    const received = items.filter(c => c.recue)
    const totalPending = pending.reduce((s, c) => s + c.commission_intervenant, 0)
    const totalReceived = received.reduce((s, c) => s + c.commission_intervenant, 0)

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <h1 className="page-title">Mes commissions</h1>
          <p className="page-subtitle">Calculées sur les factures payées de vos interventions</p>
        </div>

        {items.length === 0 ? (
          <div className="card card-body" style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
            <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 8 }}>Aucune commission pour le moment</div>
            <div style={{ fontSize: 13 }}>Les commissions apparaissent lorsqu'une facture liée à vos interventions est payée.</div>
          </div>
        ) : (
          <>
            <div className="grid-2 mb-4">
              <div className="stat-card">
                <div className="stat-icon amber" style={{ marginBottom: 8, fontSize: 18 }}>⏳</div>
                <div className="stat-value">{eur(totalPending)}</div>
                <div className="stat-label">À recevoir</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green" style={{ marginBottom: 8, fontSize: 18 }}>✓</div>
                <div className="stat-value">{eur(totalReceived)}</div>
                <div className="stat-label">Déjà reçu</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(c => (
                <div key={c.id} className="card card-body" style={{ borderLeft: c.recue ? '3px solid var(--gnBd)' : '3px solid var(--amBd)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>
                        {c.intervention_numero || '—'}
                      </div>
                      {c.client && (
                        <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 2 }}>
                          Client : {[c.client.nom, c.client.prenom].filter(Boolean).join(' ')}
                        </div>
                      )}
                      {c.intervention_adresse && (
                        <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 1 }}>{c.intervention_adresse}</div>
                      )}
                      {c.date_paiement && (
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                          Facture {c.facture_numero} · Payée le {new Date(c.date_paiement).toLocaleDateString('fr-FR')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--gnTx)' }}>{eur(c.commission_intervenant)}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>ma commission</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginBottom: 12 }}>
                    {[
                      { label: 'CA TTC', value: eur(c.montant_ttc), color: 'var(--t0)' },
                      { label: 'Matériel confirmé', value: eur(c.cout_pieces), color: 'var(--t2)' },
                      { label: 'Base', value: eur(c.base_commissionnable), color: 'var(--t0)' },
                      { label: `Taux`, value: `${c.commission_pct} %`, color: 'var(--blTx)' },
                      { label: 'Ma commission', value: eur(c.commission_intervenant), color: 'var(--gnTx)' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: 'var(--s1)', borderRadius: 'var(--r2)', padding: '7px 10px' }}>
                        <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <MaterielBtn c={c} />
                    {c.recue ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="pill pill-green">✓ Reçue</span>
                        {c.recue_le && (
                          <span style={{ fontSize: 12, color: 'var(--t3)' }}>
                            le {new Date(c.recue_le).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleMarkReceived(c)}
                        disabled={processingId === c.id}
                      >
                        {processingId === c.id ? 'Enregistrement…' : "✓ J'ai reçu ma commission"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {renderMaterielModal()}
      </div>
    )
  }

  // ── VUE ADMIN ────────────────────────────────────────────────────
  const byIntervenant: Record<string, typeof items> = {}
  items.forEach(c => {
    const key = c.intervenant_id || 'unknown'
    if (!byIntervenant[key]) byIntervenant[key] = []
    byIntervenant[key].push(c)
  })

  const totalCommAll = items.reduce((s, c) => s + c.commission_intervenant, 0)
  const totalResteAll = items.reduce((s, c) => s + c.reste_entreprise, 0)

  async function handleExportCSV() {
    try {
      await exportCommissionsPremium(items, { user: user ? { nom: user.nom, prenom: user.prenom } : null })
    } catch (e: any) { add('Erreur export : ' + e.message, 'error') }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Commissions</h1>
          <p className="page-subtitle">Calculées sur les factures payées · {items.length} entrée{items.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={items.length === 0}>📊 Excel</button>
      </div>

      {isAdmin && unattributedCount > 0 && (
        <div style={{ padding:'12px 14px',background:'var(--amBg)',border:'1px solid var(--amBd)',borderRadius:'var(--r2)',marginBottom:16,fontSize:13,color:'var(--amTx)' }}>
          ⚠ {unattributedCount} facture{unattributedCount > 1 ? 's' : ''} payée{unattributedCount > 1 ? 's' : ''} sans intervention associée — non incluse{unattributedCount > 1 ? 's' : ''} dans les commissions.
        </div>
      )}

      {items.length > 0 && (
        <div className="grid-2 mb-4">
          <div className="stat-card">
            <div className="stat-icon green" style={{ marginBottom: 8, fontSize: 16 }}>💰</div>
            <div className="stat-value">{eur(totalCommAll)}</div>
            <div className="stat-label">Total commissions intervenants</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue" style={{ marginBottom: 8, fontSize: 16 }}>🏢</div>
            <div className="stat-value">{eur(totalResteAll)}</div>
            <div className="stat-label">Reste entreprise</div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card card-body" style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--t3)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
          <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 8 }}>Aucune commission pour le moment</div>
          <div style={{ fontSize: 13 }}>Les commissions apparaissent lorsqu'une facture est payée et liée à une intervention avec un intervenant assigné.</div>
        </div>
      ) : (
        Object.entries(byIntervenant).map(([intId, comms]) => {
          const intervenant = comms[0]?.intervenant
          const commPct = comms[0]?.commission_pct ?? 30
          const totalCA = comms.reduce((s, c) => s + c.montant_ttc, 0)
          const totalBase = comms.reduce((s, c) => s + c.base_commissionnable, 0)
          const totalComm = comms.reduce((s, c) => s + c.commission_intervenant, 0)
          const totalReste = comms.reduce((s, c) => s + c.reste_entreprise, 0)
          const nbRecues = comms.filter(c => c.recue).length

          return (
            <div key={intId} className="card mb-4">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  <div className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                    {(intervenant?.prenom?.[0] || '') + (intervenant?.nom?.[0] || '')}
                  </div>
                  <span className="card-title">{intervenant?.prenom} {intervenant?.nom}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="pill pill-amber">Commission {commPct} %</span>
                  {nbRecues > 0 && (
                    <span className="pill pill-green">{nbRecues} reçue{nbRecues > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>

              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
                  {[
                    ['CA total TTC', eur(totalCA), 'var(--t0)'],
                    ['Base commissionnable', eur(totalBase), 'var(--t0)'],
                    ['Commission intervenant', eur(totalComm), 'var(--gnTx)'],
                    ['Reste entreprise', eur(totalReste), 'var(--blTx)'],
                  ].map(([label, value, color]) => (
                    <div key={label as string}>
                      <div style={{ fontSize: 10, color: 'var(--t2)', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: color as string }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Facture</th>
                        <th>Intervention</th>
                        <th>Client</th>
                        <th>CA TTC</th>
                        <th>Matériel</th>
                        <th>Base</th>
                        <th>Commission</th>
                        <th>Reste entrep.</th>
                        <th>Date paiement</th>
                        <th>Reçue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comms.map(c => (
                        <tr key={c.id}>
                          <td className="td-bold">{c.facture_numero || '—'}</td>
                          <td>{c.intervention_numero || '—'}</td>
                          <td style={{ color: 'var(--t2)' }}>
                            {c.client ? `${c.client.nom || ''} ${c.client.prenom || ''}`.trim() : '—'}
                          </td>
                          <td>{eur(c.montant_ttc)}</td>
                          <td>
                            <MaterielBtn c={c} />
                          </td>
                          <td>{eur(c.base_commissionnable)}</td>
                          <td className="text-green">{eur(c.commission_intervenant)}</td>
                          <td className="text-blue">{eur(c.reste_entreprise)}</td>
                          <td style={{ color: 'var(--t3)' }}>
                            {c.date_paiement ? new Date(c.date_paiement).toLocaleDateString('fr-FR') : '—'}
                          </td>
                          <td>
                            {c.recue ? (
                              <span className="pill pill-green" style={{ fontSize: 11 }}>
                                ✓{c.recue_le ? ` ${new Date(c.recue_le).toLocaleDateString('fr-FR')}` : ''}
                              </span>
                            ) : (
                              <span className="pill pill-amber" style={{ fontSize: 11 }}>⏳</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        })
      )}

      {renderMaterielModal()}
    </div>
  )
}
