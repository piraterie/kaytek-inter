// src/pages/DevisApercuPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDevisById, useParametres, useUpdateDevis, notifyUser, notifyAdmins } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import SignatureModal from '@/components/SignatureModal'

export default function DevisApercuPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: devis, isLoading, refetch } = useDevisById(id || '')
  const { data: params } = useParametres()
  const updDevis = useUpdateDevis()
  const [showSign, setShowSign] = useState(false)
  const [signing, setSigning] = useState(false)

  // Protection : désactiver clic droit + raccourcis impression
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault()
    const preventKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'p' || e.key === 's' || e.key === 'u' || e.key === 'c')
      ) e.preventDefault()
      if (e.key === 'PrintScreen') e.preventDefault()
    }
    document.addEventListener('contextmenu', prevent)
    document.addEventListener('keydown', preventKey)
    return () => {
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('keydown', preventKey)
    }
  }, [])

  async function handleSign(base64: string) {
    if (!devis) return
    setSigning(true)
    try {
      await updDevis.mutateAsync({
        id: devis.id,
        statut: 'accepte',
        signature_client: base64,
        signature_date: new Date().toISOString(),
        signe_par: `${user?.prenom || ''} ${user?.nom || ''}`.trim() || 'Client'
      } as any)
      // Notifier les admins
      await notifyAdmins(
        '✍ Devis signé par le client',
        `Le devis ${devis.numero} a été signé. Il peut être converti en facture.`,
        `/devis/${devis.id}/apercu`
      )
      add('Signature enregistrée — devis accepté')
      setShowSign(false)
      refetch()
    } catch (e: any) {
      add('Erreur signature: ' + e.message, 'error')
    } finally {
      setSigning(false)
    }
  }

  if (isLoading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Chargement…</div>
  if (!devis) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--rdTx)' }}>Devis introuvable</div>

  // Vérification accès : l'intervenant ne peut voir que ses propres devis
  if (user?.role !== 'admin' && devis.created_by !== user?.id && (devis as any).intervenant_id !== user?.id) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--rdTx)' }}>Accès refusé</div>
  }

  const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  const statut = devis.statut
  const isSigned = !!(devis as any).signature_client
  const canSign = user?.role !== 'admin' && ['brouillon', 'envoye'].includes(statut) && !isSigned
  const statutColor = statut === 'en_attente_validation' ? '#d97706' : statut === 'accepte' ? '#16a34a' : statut === 'refuse' ? '#dc2626' : '#64748b'
  const statutLabel = statut === 'en_attente_validation' ? '⏳ En attente de validation' : statut === 'accepte' ? '✓ Accepté' : statut === 'refuse' ? '✕ Refusé' : statut === 'envoye' ? '✉ Envoyé' : statut

  return (
    <div>
      {/* Inject CSS anti-screenshot dans le <head> via style tag */}
      <style>{`
        @media print {
          .apercu-protected { display: none !important; visibility: hidden !important; }
          body::after { content: 'Impression non autorisée'; font-size: 48px; color: red; display: block; text-align: center; margin-top: 40vh; }
        }
        .apercu-protected {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }
        .apercu-protected img {
          pointer-events: none;
        }
      `}</style>

      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className="btn-icon" onClick={() => nav(-1 as any)}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Aperçu devis {devis.numero}</h1>
          <p className="page-subtitle">Lecture seule — téléchargement réservé à l'administrateur</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: `${statutColor}22`, color: statutColor, border: `1px solid ${statutColor}44` }}>
            {statutLabel}
          </span>
          {canSign && (
            <button className="btn btn-primary" onClick={() => setShowSign(true)} style={{ whiteSpace: 'nowrap' }}>
              ✍ Faire signer le client
            </button>
          )}
        </div>
      </div>

      {statut === 'en_attente_validation' && (
        <div style={{ padding: '12px 16px', background: 'var(--amBg)', border: '1px solid var(--amBd)', borderRadius: 'var(--r2)', marginBottom: 16, fontSize: 13, color: 'var(--amTx)' }}>
          ⏳ Ce devis est en attente de validation par l'administrateur. Vous serez informé une fois validé.
        </div>
      )}

      {canSign && (
        <div style={{ padding: '12px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--r2)', marginBottom: 16, fontSize: 13, color: '#1d4ed8' }}>
          ✍ Ce devis est prêt — présentez-le au client et appuyez sur <strong>Faire signer le client</strong> pour recueillir sa signature.
        </div>
      )}

      {/* Contenu protégé */}
      <div
        ref={containerRef}
        className="apercu-protected"
        style={{ position: 'relative' }}
        onCopy={e => e.preventDefault()}
        onCut={e => e.preventDefault()}
      >
        {/* Filigrane */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none', zIndex: 9999, overflow: 'hidden',
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
          gap: 0, opacity: 0.035
        }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} style={{
              width: '25%', padding: '60px 20px',
              fontSize: 18, fontWeight: 900, color: '#000',
              transform: 'rotate(-35deg)', textAlign: 'center',
              whiteSpace: 'nowrap'
            }}>
              APERÇU UNIQUEMENT
            </div>
          ))}
        </div>

        <div className="card card-body" style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
          {/* En-tête devis */}
          <div style={{
            background: '#1e3a5f', borderRadius: 8, padding: '24px 28px',
            marginBottom: 20, color: '#fff',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            flexWrap: 'wrap', gap: 16
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
                {params?.raison_sociale || 'KAYTEK INTER'}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Serrurerie · Vitrerie</div>
              {params?.adresse && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>{params.adresse}</div>}
              {(params?.code_postal || params?.ville) && <div style={{ fontSize: 12, opacity: 0.8 }}>{params.code_postal} {params.ville}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, background: 'rgba(255,255,255,0.15)', padding: '8px 18px', borderRadius: 8 }}>
                DEVIS
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>{devis.numero}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {new Date(devis.created_at).toLocaleDateString('fr-FR')}
              </div>
              {devis.valide_jusqu_au && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                  Valable jusqu'au {new Date(devis.valide_jusqu_au).toLocaleDateString('fr-FR')}
                </div>
              )}
            </div>
          </div>

          {/* Client */}
          <div className="grid-2 mb-4" style={{ gap: 16 }}>
            <div style={{ padding: '14px 16px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Client</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{devis.client?.nom} {devis.client?.prenom}</div>
              {devis.client?.telephone && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>{devis.client.telephone}</div>}
              {devis.client?.email && <div style={{ fontSize: 13, color: 'var(--t2)' }}>{devis.client.email}</div>}
            </div>
            <div style={{ padding: '14px 16px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Intervenant</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{devis.intervenant?.prenom} {devis.intervenant?.nom}</div>
              {devis.activite && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>{devis.activite}</div>}
            </div>
          </div>

          {/* Prestations */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t0)', marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid var(--b1)' }}>
              Prestations
            </div>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--s1)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase', width: 60 }}>Qté</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase', width: 100 }}>Prix HT</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase', width: 70 }}>TVA</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Total TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {(devis.lignes || []).map((l, i) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--b0)', background: i % 2 === 0 ? 'transparent' : 'var(--s1)' }}>
                      <td style={{ padding: '10px 12px' }}>{l.description}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--t2)' }}>{l.quantite}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--t2)' }}>{eur(l.prix_ht)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--t2)' }}>{l.tva_pct}%</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{eur(l.total_ttc)}</td>
                    </tr>
                  ))}
                  {(!devis.lignes || devis.lignes.length === 0) && (
                    <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Aucune prestation</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totaux */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
            <div style={{ width: 260 }}>
              {[
                ['Total HT', eur(devis.total_ht), false],
                ['TVA', eur(devis.tva_montant), false],
                ...(devis.remise_pct ? [['Remise (' + devis.remise_pct + '%)', '-' + eur(devis.remise_montant || 0), false]] : []),
              ].map(([l, v, _]) => (
                <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: 'var(--t2)', borderBottom: '1px solid var(--b0)' }}>
                  <span>{l}</span><span>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: 20, fontWeight: 800, color: '#1e3a5f', borderTop: '2px solid var(--b1)', marginTop: 4 }}>
                <span>Total TTC</span>
                <span>{eur(devis.total_ttc)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {devis.notes && (
            <div style={{ padding: '12px 14px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)', fontSize: 13, color: 'var(--t2)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--t3)' }}>Notes</div>
              {devis.notes}
            </div>
          )}

          {/* Signature client */}
          {isSigned && (
            <div style={{ marginTop: 20, padding: '14px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--r2)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                ✅ Signé le {new Date((devis as any).signature_date).toLocaleDateString('fr-FR')} — {(devis as any).signe_par}
              </div>
              <img
                src={(devis as any).signature_client}
                alt="Signature client"
                style={{ maxWidth: '100%', maxHeight: 120, border: '1px solid #d1fae5', borderRadius: 6, background: '#fff', padding: 4 }}
              />
            </div>
          )}

          {/* Avertissement sécurité */}
          <div style={{ marginTop: 24, padding: '10px 14px', background: 'var(--amBg)', border: '1px solid var(--amBd)', borderRadius: 'var(--r2)', fontSize: 11, color: 'var(--amTx)', textAlign: 'center' }}>
            🔒 Document confidentiel — Aperçu uniquement. Téléchargement PDF réservé à l'administrateur.
          </div>
        </div>
      </div>

      {showSign && (
        <SignatureModal
          onConfirm={handleSign}
          onCancel={() => setShowSign(false)}
          loading={signing}
        />
      )}
    </div>
  )
}
