// src/pages/DevisApercuPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDevisById, useParametres, usePublicParametres, useUpdateDevis, useDevisToFacture, useDuplicateDevis, useCreatePublicLink, useIsMobile, useCreateIntervention, notifyUser, notifyAdmins } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import SignatureModal from '@/components/SignatureModal'
import EmailDevisModal from '@/components/EmailDevisModal'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { resolveClientIdentity, formatAddressLines } from '@/lib/clientIdentity'

export default function DevisApercuPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const { add } = useToastStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: devis, isLoading, refetch } = useDevisById(id || '')
  // Admin : IBAN/BIC inclus (RLS admin-only). Non-admin : jamais
  // iban/bic, uniquement les mentions publiques (SIRET/TVA/RC Pro
  // restent affichées sur le PDF, légalement obligatoires).
  const { data: dbParams } = useParametres()
  const { data: publicParams } = usePublicParametres()
  const params = isAdmin ? (dbParams || publicParams) : publicParams
  const updDevis = useUpdateDevis()
  const toFacture = useDevisToFacture()
  const dup = useDuplicateDevis()
  const createLink = useCreatePublicLink()
  const createIntervention = useCreateIntervention()
  const isMobile = useIsMobile()
  const [showSign, setShowSign] = useState(false)
  const [signing, setSigning] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [signedSuccess, setSignedSuccess] = useState(false)
  const [showUnsignedWarning, setShowUnsignedWarning] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)
  const [showRdvModal, setShowRdvModal] = useState(false)
  const [rdvForm, setRdvForm] = useState({ adresse: '', date_prevue: '' })
  const [rdvLoading, setRdvLoading] = useState(false)

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
      await notifyAdmins(
        '✍ Devis signé par le client',
        `Le devis ${devis.numero} a été signé. Il peut être converti en facture.`,
        `/devis/${devis.id}/apercu`
      )
      add('Signature enregistrée — devis accepté')
      setShowSign(false)
      setSignedSuccess(true)
      refetch()
    } catch (e: any) {
      add('Erreur signature: ' + e.message, 'error')
    } finally {
      setSigning(false)
    }
  }

  function handleSendClick() {
    const signed = signedSuccess || !!((devis as any)?.signature_client)
    if (signed) {
      setShowEmail(true)
    } else {
      setShowUnsignedWarning(true)
    }
  }

  async function handleDuplicate() {
    if (!devis) return
    try {
      const newDevis = await dup.mutateAsync(devis as any)
      add('Devis dupliqué en brouillon')
      nav(`/devis/${(newDevis as any).id}/editer`)
    } catch (e: any) {
      add(e.message, 'error')
    }
  }

  async function handleShare() {
    if (!devis) return
    if (shareUrl) return
    try {
      const result = await createLink.mutateAsync({ document_type: 'devis', document_id: devis.id })
      setShareUrl(`${window.location.origin}/d/${result.token}`)
    } catch (e: any) {
      add(e.message, 'error')
    }
  }

  async function handleToFacture() {
    if (!devis) return
    try {
      const facture = await toFacture.mutateAsync(devis.id)
      add('Facture créée avec succès')
      nav('/factures')
    } catch (e: any) {
      add(e.message, 'error')
    }
  }

  function openRdvModal() {
    if (!devis) return
    setRdvForm({ adresse: (devis.client as any)?.adresse_intervention || '', date_prevue: '' })
    setShowRdvModal(true)
  }

  async function submitRdv(e: React.FormEvent) {
    e.preventDefault()
    if (!devis) return
    setRdvLoading(true)
    try {
      const payload: any = {
        client_id: devis.client_id,
        type: devis.activite,
        description: devis.notes || '',
        adresse: rdvForm.adresse || '',
      }
      if ((devis as any).intervenant_id) payload.intervenant_id = (devis as any).intervenant_id
      if (rdvForm.date_prevue) payload.date_prevue = new Date(rdvForm.date_prevue).toISOString()
      const newIntervention: any = await createIntervention.mutateAsync(payload)
      await updDevis.mutateAsync({ id: devis.id, intervention_id: newIntervention.id } as any)
      add('Rendez-vous créé et lié au devis')
      setShowRdvModal(false)
      nav(`/interventions/${newIntervention.id}`)
    } catch (e: any) {
      add('Erreur : ' + e.message, 'error')
    } finally {
      setRdvLoading(false)
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
  const canSign = !isAdmin && ['brouillon', 'envoye'].includes(statut) && !isSigned
  const canFacture = (isAdmin || user?.can_create_documents === true) && (statut === 'accepte' || isSigned)
  const canSendEmail = isAdmin || (user?.can_create_documents === true && user?.can_bypass_validation === true)
  const canDuplicate = isAdmin || user?.can_create_documents === true
  const canRdv = (isAdmin || user?.can_create_documents === true) && !(devis as any).intervention_id

  const statutColor = statut === 'en_attente_validation' ? '#d97706' : statut === 'accepte' ? '#16a34a' : statut === 'refuse' ? '#dc2626' : '#64748b'
  const statutLabel = statut === 'en_attente_validation' ? '⏳ En attente de validation' : statut === 'accepte' ? '✓ Accepté' : statut === 'refuse' ? '✕ Refusé' : statut === 'envoye' ? '✉ Envoyé' : statut

  // Barre mobile fixe visible si au moins une action disponible
  const hasMobileBar = isMobile && (canSign || canFacture || canSendEmail || true)
  const mobileBarH = hasMobileBar ? 64 : 0
  const isSignedOrSuccess = isSigned || signedSuccess

  return (
    <div style={{ paddingBottom: mobileBarH + 8 }}>
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
        .apercu-mobile-bar {
          position: fixed;
          bottom: 56px;
          left: 0; right: 0;
          z-index: 200;
          background: var(--s0);
          border-top: 1px solid var(--b1);
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          box-shadow: 0 -2px 12px rgba(0,0,0,0.10);
        }
        .apercu-mobile-bar .bar-btn {
          flex: 1;
          padding: 10px 6px;
          border-radius: var(--r2);
          border: none;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .bar-btn-primary { background: var(--bl); color: #fff; }
        .bar-btn-secondary { background: var(--s1); color: var(--t0); border: 1px solid var(--b1) !important; }
        .bar-btn-green { background: #16a34a; color: #fff; }
      `}</style>

      {/* En-tête */}
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className="btn-icon" onClick={() => nav(-1 as any)}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Aperçu devis {devis.numero}</h1>
          <p className="page-subtitle">Lecture seule — téléchargement réservé à l'administrateur</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: `${statutColor}22`, color: statutColor, border: `1px solid ${statutColor}44` }}>
            {statutLabel}
          </span>
          {!isMobile && canSign && (
            <button className="btn btn-primary" onClick={() => setShowSign(true)} style={{ whiteSpace: 'nowrap' }}>
              ✍ Faire signer
            </button>
          )}
          {!isMobile && canSendEmail && (
            <button className="btn" onClick={handleSendClick} style={{ whiteSpace: 'nowrap' }}>
              {isSignedOrSuccess ? '📧 Envoyer le devis signé' : '✉ Envoyer sans signature'}
            </button>
          )}
          {!isMobile && canFacture && (
            <button className="btn btn-primary" onClick={handleToFacture} disabled={toFacture.isPending} style={{ whiteSpace: 'nowrap', background: '#16a34a' }}>
              {toFacture.isPending ? 'Création…' : '🧾 Transformer en facture'}
            </button>
          )}
          {!isMobile && canRdv && (
            <button className="btn btn-secondary" onClick={openRdvModal} style={{ whiteSpace: 'nowrap' }}>
              📅 RDV
            </button>
          )}
          {!isMobile && canDuplicate && (
            <button className="btn btn-secondary" onClick={handleDuplicate} disabled={dup.isPending} style={{ whiteSpace: 'nowrap' }}>
              {dup.isPending ? 'Duplication…' : '📋 Dupliquer'}
            </button>
          )}
          {!isMobile && isAdmin && (
            <button className="btn btn-secondary" onClick={handleShare} disabled={createLink.isPending} style={{ whiteSpace: 'nowrap' }}>
              {createLink.isPending ? 'Création…' : shareUrl ? '🔗 Voir le lien' : '🔗 Partager'}
            </button>
          )}
        </div>
      </div>

      {/* Banière en attente de validation */}
      {statut === 'en_attente_validation' && (
        <div style={{ padding: '12px 16px', background: 'var(--amBg)', border: '1px solid var(--amBd)', borderRadius: 'var(--r2)', marginBottom: 16, fontSize: 13, color: 'var(--amTx)' }}>
          ⏳ Ce devis est en attente de validation par l'administrateur. Vous serez informé une fois validé.
        </div>
      )}

      {/* BLOC SIGNATURE — visible et proéminent */}
      {signedSuccess ? (
        /* ── Juste signé dans cette session ── */
        <div style={{ padding: '20px', background: '#f0fdf4', border: '2px solid #86efac', borderRadius: 'var(--r2)', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a', marginBottom: 4 }}>✅ Devis signé avec succès !</div>
          <div style={{ fontSize: 13, color: '#166534', marginBottom: 16 }}>La signature a été enregistrée. Envoyez le devis au client ou transformez-le en facture.</div>
          {!isMobile && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {canSendEmail && (
                <button className="btn btn-primary" onClick={handleSendClick} style={{ fontWeight: 700 }}>
                  📧 Envoyer le devis signé
                </button>
              )}
              {canFacture && (
                <button className="btn" onClick={handleToFacture} disabled={toFacture.isPending}>
                  {toFacture.isPending ? 'Création…' : '🧾 Transformer en facture'}
                </button>
              )}
              <button className="btn" style={{ color: 'var(--t2)' }} onClick={() => nav('/devis')}>
                ← Retour aux devis
              </button>
            </div>
          )}
        </div>
      ) : isSigned ? (
        /* ── Déjà signé (chargé depuis la base) ── */
        <div style={{ padding: '20px', background: '#f0fdf4', border: '2px solid #86efac', borderRadius: 'var(--r2)', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#16a34a', marginBottom: 4 }}>
            ✅ Signature enregistrée le {new Date((devis as any).signature_date).toLocaleDateString('fr-FR')} — {(devis as any).signe_par}
          </div>
          {!isMobile && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              {canSendEmail && (
                <button className="btn btn-primary" onClick={handleSendClick} style={{ fontWeight: 700 }}>
                  📧 Envoyer le devis signé
                </button>
              )}
              {canFacture && (
                <button className="btn" onClick={handleToFacture} disabled={toFacture.isPending}>
                  {toFacture.isPending ? 'Création…' : '🧾 Transformer en facture'}
                </button>
              )}
              <button className="btn" style={{ color: 'var(--t2)' }} onClick={() => nav('/devis')}>
                ← Retour aux devis
              </button>
            </div>
          )}
        </div>
      ) : canSign ? (
        /* ── Non signé — intervenant peut faire signer ── */
        <div style={{ padding: '20px', background: '#eff6ff', border: '2px solid #3b82f6', borderRadius: 'var(--r2)', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>✍ Signature client requise</div>
          <div style={{ fontSize: 13, color: '#1e40af', marginBottom: isMobile ? 0 : 16 }}>
            Faites signer le client directement sur votre téléphone avant l'envoi ou la facturation.
          </div>
          {!isMobile && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button className="btn btn-primary" onClick={() => setShowSign(true)} style={{ fontWeight: 700 }}>
                ✍ Faire signer maintenant
              </button>
              {canSendEmail && (
                <button className="btn" onClick={handleSendClick}>
                  ✉ Envoyer sans signature
                </button>
              )}
              <button className="btn" style={{ color: 'var(--t2)' }} onClick={() => nav('/devis')}>
                ← Retour aux devis
              </button>
            </div>
          )}
        </div>
      ) : !isSigned && isAdmin && ['brouillon', 'envoye'].includes(statut) ? (
        /* ── Admin : signature en attente ── */
        <div style={{ padding: '14px 16px', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--r2)', marginBottom: 16, fontSize: 13, color: 'var(--t2)' }}>
          ⏳ Signature en attente — le devis n'a pas encore été signé par le client.
        </div>
      ) : null}

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
                {new Date(devis.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              {devis.valide_jusqu_au && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                  Valable jusqu'au {new Date(devis.valide_jusqu_au).toLocaleDateString('fr-FR')}
                </div>
              )}
            </div>
          </div>

          {/* Client — priorité au snapshot figé à la création (voir
              src/lib/clientIdentity.ts), repli sur la fiche client pour
              les devis créés avant cette fonctionnalité. */}
          <div className="grid-2 mb-4" style={{ gap: 16 }}>
            {(() => {
              const identity = resolveClientIdentity(devis.client_snapshot, devis.client)
              const addressLines = formatAddressLines(identity)
              return (
                <div style={{ padding: '14px 16px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Client</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{identity?.displayName || '—'}</div>
                  {identity?.contactName && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 2 }}>{identity.contactName}</div>}
                  {identity?.phone && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 4 }}>{identity.phone}</div>}
                  {identity?.email && <div style={{ fontSize: 13, color: 'var(--t2)' }}>{identity.email}</div>}
                  {addressLines.map((line, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--t2)', marginTop: i === 0 ? 4 : 0 }}>{line}</div>
                  ))}
                </div>
              )
            })()}
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

          {/* Signature client (dans le document) */}
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

      {/* Barre d'action fixe mobile */}
      {hasMobileBar && (
        <div className="apercu-mobile-bar">
          {isSignedOrSuccess ? (
            /* Signé → Envoyer (primaire) + Facturer + Retour */
            <>
              {canSendEmail && (
                <button className="bar-btn bar-btn-primary" onClick={handleSendClick}>
                  📧 Envoyer
                </button>
              )}
              {canFacture && (
                <button className="bar-btn bar-btn-green" onClick={handleToFacture} disabled={toFacture.isPending}>
                  {toFacture.isPending ? '…' : '🧾 Facturer'}
                </button>
              )}
              <button className="bar-btn bar-btn-secondary" onClick={() => nav('/devis')}>
                ← Retour
              </button>
            </>
          ) : canSign ? (
            /* Non signé, intervenant → Signer (primaire) + Envoyer + Retour */
            <>
              <button className="bar-btn bar-btn-primary" onClick={() => setShowSign(true)}>
                ✍ Signer
              </button>
              {canSendEmail && (
                <button className="bar-btn bar-btn-secondary" onClick={handleSendClick}>
                  Envoyer
                </button>
              )}
              <button className="bar-btn bar-btn-secondary" onClick={() => nav('/devis')}>
                ← Retour
              </button>
            </>
          ) : (
            /* Admin ou autre → Envoyer + Facturer + Dupliquer + Retour */
            <>
              {canSendEmail && (
                <button className="bar-btn bar-btn-secondary" onClick={handleSendClick}>
                  ✉ Envoyer
                </button>
              )}
              {canFacture && (
                <button className="bar-btn bar-btn-green" onClick={handleToFacture} disabled={toFacture.isPending}>
                  {toFacture.isPending ? '…' : '🧾 Facturer'}
                </button>
              )}
              {canDuplicate && (
                <button className="bar-btn bar-btn-secondary" onClick={handleDuplicate} disabled={dup.isPending}>
                  {dup.isPending ? '…' : '📋 Copier'}
                </button>
              )}
              {isAdmin && (
                <button className="bar-btn bar-btn-secondary" onClick={handleShare} disabled={createLink.isPending}>
                  {createLink.isPending ? '…' : '🔗 Lien'}
                </button>
              )}
              <button className="bar-btn bar-btn-secondary" onClick={() => nav('/devis')}>
                ← Retour
              </button>
            </>
          )}
        </div>
      )}

      {showUnsignedWarning && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(15,23,42,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}>
          <div style={{
            background: 'var(--s0)',
            borderRadius: 'var(--r2)',
            padding: '24px 20px',
            maxWidth: 420,
            width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            border: '1px solid var(--b1)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#d97706', marginBottom: 12 }}>
              ⚠️ Devis non signé
            </div>
            <div style={{ fontSize: 14, color: 'var(--t1)', lineHeight: 1.6, marginBottom: 20 }}>
              Ce devis n'a pas encore été signé par le client.<br /><br />
              Vous pouvez le faire signer maintenant ou l'envoyer sans signature si le client souhaite réfléchir.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ fontWeight: 700, justifyContent: 'center', textAlign: 'center' }}
                onClick={() => { setShowUnsignedWarning(false); setShowSign(true) }}
              >
                ✍ Signer le devis
              </button>
              <button
                className="btn"
                style={{ justifyContent: 'center', textAlign: 'center' }}
                onClick={() => { setShowUnsignedWarning(false); setShowEmail(true) }}
              >
                📧 Envoyer sans signature
              </button>
              <button
                className="btn"
                style={{ color: 'var(--t2)', justifyContent: 'center', textAlign: 'center' }}
                onClick={() => setShowUnsignedWarning(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {shareUrl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,23,42,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
          <div style={{ background: 'var(--s0)', borderRadius: 'var(--r2)', padding: '24px 20px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', border: '1px solid var(--b1)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t0)', marginBottom: 4 }}>🔗 Lien de partage</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 14 }}>Ce lien permet au client de consulter le devis sans connexion.</div>
            <div style={{ padding: '10px 14px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)', fontSize: 12, color: 'var(--t1)', wordBreak: 'break-all', marginBottom: 14 }}>
              {shareUrl}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" style={{ justifyContent: 'center', textAlign: 'center' }}
                onClick={() => { navigator.clipboard.writeText(shareUrl); setCopiedShare(true); setTimeout(() => setCopiedShare(false), 2000) }}>
                {copiedShare ? '✓ Lien copié !' : '🔗 Copier le lien'}
              </button>
              <button className="btn" style={{ background: '#25D366', color: '#fff', border: 'none', justifyContent: 'center', textAlign: 'center' }}
                onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent('Votre devis : ' + shareUrl)}`, '_blank')}>
                WhatsApp
              </button>
              <button className="btn" style={{ justifyContent: 'center', textAlign: 'center' }}
                onClick={() => window.open(`sms:?body=${encodeURIComponent('Votre devis : ' + shareUrl)}`)}>
                SMS
              </button>
              {navigator.share && (
                <button className="btn" style={{ background: '#2563eb', color: '#fff', border: 'none', justifyContent: 'center', textAlign: 'center' }}
                  onClick={() => navigator.share({ title: 'Devis Kaytek Inter', url: shareUrl }).catch(() => {})}>
                  Partager via…
                </button>
              )}
              <button className="btn" style={{ color: 'var(--t2)', justifyContent: 'center', textAlign: 'center' }} onClick={() => setShareUrl(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showSign && (
        <SignatureModal
          onConfirm={handleSign}
          onCancel={() => setShowSign(false)}
          loading={signing}
        />
      )}

      {showEmail && devis && params && (
        <EmailDevisModal
          devis={devis as any}
          params={params}
          onClose={() => setShowEmail(false)}
          onSent={() => {
            add(`Devis envoyé au client`)
            const intervenantId = (devis as any).intervenant_id
            if (intervenantId) {
              notifyUser(
                intervenantId,
                '✉ Devis envoyé au client',
                `Le devis ${devis.numero} a été envoyé au client, en attente de signature.`,
                `/devis/${devis.id}/apercu`
              ).catch(() => {})
            }
            setShowEmail(false)
          }}
        />
      )}

      {showRdvModal && devis && (
        <div className="modal-overlay" onClick={() => setShowRdvModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Créer un RDV</span>
              <button className="btn-icon sm" onClick={() => setShowRdvModal(false)}>✕</button>
            </div>
            <form onSubmit={submitRdv}>
              <div className="modal-body">
                <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 14 }}>
                  {devis.client?.nom} {devis.client?.prenom}
                  {devis.client?.telephone && ` · ${devis.client.telephone}`}
                </div>
                <div className="form-group">
                  <label>Adresse</label>
                  <AddressAutocomplete
                    value={rdvForm.adresse}
                    onChange={v => setRdvForm(f => ({ ...f, adresse: v }))}
                    onSelect={s => setRdvForm(f => ({ ...f, adresse: s.label }))}
                    placeholder="Adresse complète"
                  />
                </div>
                <div className="form-group">
                  <label>Date prévue</label>
                  <input type="datetime-local" value={rdvForm.date_prevue} onChange={e => setRdvForm(f => ({ ...f, date_prevue: e.target.value }))} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                  Activité et description reprises automatiquement du devis.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRdvModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={rdvLoading}>{rdvLoading ? 'Création…' : 'Créer le RDV'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
