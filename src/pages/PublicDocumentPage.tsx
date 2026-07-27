// src/pages/PublicDocumentPage.tsx
// Page publique de consultation client — accessible sans connexion via token de partage

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import KaytekLogo from '@/components/KaytekLogo'
import { generateDevisPDF, generateFacturePDF, downloadBlob } from '@/lib/pdf/generator'
import { resolveClientIdentity, formatAddressLines } from '@/lib/clientIdentity'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-public-document`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const eur = (n?: number | null) =>
  (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR') : '—'

const TVA_LABEL: Record<number, string> = { 0: '0 %', 10: '10 %', 20: '20 %' }

function StatusBadge({ statut }: { statut: string }) {
  const MAP: Record<string, { label: string; bg: string; color: string }> = {
    brouillon:             { label: 'Brouillon',    bg: '#f1f5f9', color: '#475569' },
    envoye:                { label: 'Envoyé',       bg: '#eff6ff', color: '#1d4ed8' },
    accepte:               { label: 'Accepté',      bg: '#f0fdf4', color: '#16a34a' },
    refuse:                { label: 'Refusé',       bg: '#fef2f2', color: '#dc2626' },
    expire:                { label: 'Expiré',       bg: '#fff7ed', color: '#c2410c' },
    en_attente_validation: { label: 'En attente',   bg: '#fffbeb', color: '#d97706' },
    impayee:               { label: 'Non payée',    bg: '#fef2f2', color: '#dc2626' },
    payee:                 { label: 'Payée',        bg: '#f0fdf4', color: '#16a34a' },
    acompte:               { label: 'Acompte reçu', bg: '#eff6ff', color: '#2563eb' },
    partiel:               { label: 'Partiel',      bg: '#fff7ed', color: '#c2410c' },
    annulee:               { label: 'Annulée',      bg: '#f1f5f9', color: '#475569' },
  }
  const s = MAP[statut] || { label: statut, bg: '#f1f5f9', color: '#475569' }
  return (
    <span style={{
      display: 'inline-block', padding: '4px 12px', borderRadius: 100,
      fontSize: 12, fontWeight: 700, background: s.bg, color: s.color
    }}>
      {s.label}
    </span>
  )
}

export default function PublicDocumentPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function handleDownloadPDF() {
    if (!data || generating) return
    setGenerating(true)
    try {
      const { document_type, document: doc, params } = data
      // Complète les champs optionnels manquants pour satisfaire le typage du générateur
      const p = {
        id: '', raison_sociale: '', tva_defaut: 20, couleur_principale: '#1e3a5f',
        modele_pdf_defaut: 0, email_envoi_devis: false, email_relance_facture: false,
        email_paiement_recu: false, email_new_intervention: false, updated_at: '',
        ...params,
      }
      let blob: Blob
      if (document_type === 'devis') {
        const devis = { modele_id: 0, remise_pct: 0, total_ht: 0, tva_montant: 0, total_ttc: 0, lignes: [], ...doc }
        blob = await generateDevisPDF(devis, p, devis.modele_id ?? 0)
        downloadBlob(blob, `devis-${doc.numero || 'document'}.pdf`)
      } else {
        const facture = { montant_ht: 0, tva_montant: 0, montant_ttc: 0, acompte_recu: 0, date_emission: '', ...doc }
        const devisLie = doc.devis ? { modele_id: 0, remise_pct: 0, total_ht: 0, tva_montant: 0, total_ttc: 0, lignes: [], ...doc.devis } : null
        blob = await generateFacturePDF(facture, devisLie, p)
        downloadBlob(blob, `facture-${doc.numero || 'document'}.pdf`)
      }
    } catch (e: any) {
      alert('Erreur lors de la génération du PDF : ' + (e?.message || String(e)))
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    if (!token) { setError('Lien invalide'); setLoading(false); return }

    fetch(`${EDGE_URL}?token=${token}`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      }
    })
      .then(async r => {
        let json: any
        try { json = await r.json() } catch { throw new Error('Réponse invalide du serveur') }
        const errMsg = json?.error || json?.message || json?.msg
        if (!r.ok || errMsg) throw new Error(errMsg || `Erreur ${r.status}`)
        if (!json.document_type || !json.document) throw new Error('Données du document manquantes')
        return json
      })
      .then(json => setData(json))
      .catch((e: any) => setError(e?.message || 'Impossible de charger le document'))
      .finally(() => setLoading(false))
  }, [token])

  // ── États de chargement / erreur ───────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 16, background: '#f8fafc' }}>
        <KaytekLogo size={48} />
        <p style={{ color: '#94a3b8', fontSize: 14 }}>Chargement du document…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 12, background: '#f8fafc', padding: 24 }}>
        <KaytekLogo size={40} />
        <div style={{ fontSize: 36, marginTop: 8 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0, textAlign: 'center' }}>Document introuvable</h2>
        <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          {error || 'Ce lien est invalide ou a expiré.'}
        </p>
        <p style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
          Demandez un nouveau lien à votre prestataire.
        </p>
      </div>
    )
  }

  // ── Extraction des données ─────────────────────────────────────────────────

  const { document_type, document: doc, params } = data
  const isDevis = document_type === 'devis'

  if (!doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 12, background: '#f8fafc', padding: 24 }}>
        <div style={{ fontSize: 36 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>Document introuvable</h2>
        <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
          Le document associé à ce lien n'existe plus.
        </p>
      </div>
    )
  }

  const lignes: any[] = isDevis ? (doc.lignes || []) : (doc.devis?.lignes || [])
  const client = doc.client || null
  const clientIdentity = resolveClientIdentity(doc.client_snapshot, client)
  const clientAddressLines = formatAddressLines(clientIdentity)
  const totalHT    = isDevis ? doc.total_ht   : doc.montant_ht
  const tvaMontant = doc.tva_montant
  const totalTTC   = isDevis ? doc.total_ttc  : doc.montant_ttc
  const statut     = isDevis ? doc.statut      : doc.statut_paiement
  const numero     = doc.numero || '—'
  const dateDoc    = isDevis ? doc.created_at  : doc.date_emission
  const dateEcheance = isDevis ? doc.valide_jusqu_au : doc.date_echeance

  const contactTel   = params?.telephone || null
  const contactEmail = params?.email || null

  // ── Rendu ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100dvh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>


      {/* Bandeau entreprise — masqué à l'impression (l'en-tête du document suffit) */}
      <div className="pub-no-print" style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <KaytekLogo size={26} />
        <span style={{ fontSize: 13, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {params?.raison_sociale || 'Document'}
        </span>
        <button
          onClick={handleDownloadPDF}
          disabled={generating}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e3a5f', color: '#fff', cursor: generating ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0, opacity: generating ? 0.7 : 1 }}
        >
          {generating ? '…' : '⬇ Télécharger PDF'}
        </button>
      </div>

      {/* Corps */}
      <div className="pub-page" style={{ maxWidth: 720, margin: '0 auto', padding: '20px 12px 48px' }}>
        <div className="pub-card" style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)' }}>

          {/* En-tête entreprise */}
          <div style={{
            background: '#1e3a5f', padding: '24px 28px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            flexWrap: 'wrap', gap: 16,
          }}>
            <div>
              {params?.logo_url
                ? <img src={params.logo_url} alt="Logo" style={{ height: 44, objectFit: 'contain', marginBottom: 8 }} />
                : <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: 0.3 }}>{params?.raison_sociale || 'Entreprise'}</div>
              }
              {params?.adresse && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', marginTop: 4 }}>{params.adresse}</div>}
              {(params?.code_postal || params?.ville) && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>
                  {[params?.code_postal, params?.ville].filter(Boolean).join(' ')}
                </div>
              )}
              {contactTel && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', marginTop: 4 }}>{contactTel}</div>}
              {contactEmail && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>{contactEmail}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: 2,
                background: 'rgba(255,255,255,0.13)', padding: '7px 16px', borderRadius: 10, display: 'inline-block',
              }}>
                {isDevis ? 'DEVIS' : 'FACTURE'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 8 }}>{numero}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', marginTop: 3 }}>{fmtDate(dateDoc)}</div>
              {dateEcheance && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>
                  {isDevis ? "Valable jusqu'au " : 'Échéance '}{fmtDate(dateEcheance)}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: '20px 24px 28px' }}>

            {/* Statut */}
            {statut && (
              <div style={{ marginBottom: 18 }}>
                <StatusBadge statut={statut} />
              </div>
            )}

            {/* Client — priorité au snapshot figé à la création du document
                (voir src/lib/clientIdentity.ts), repli sur la fiche client
                pour les documents créés avant cette fonctionnalité. */}
            {clientIdentity && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', marginBottom: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Client</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                  {clientIdentity.displayName}
                </div>
                {clientIdentity.contactName && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{clientIdentity.contactName}</div>}
                {clientIdentity.phone && <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{clientIdentity.phone}</div>}
                {clientIdentity.email && <div style={{ fontSize: 13, color: '#64748b' }}>{clientIdentity.email}</div>}
                {clientAddressLines.map((line, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#94a3b8', marginTop: i === 0 ? 6 : 0 }}>{line}</div>
                ))}
              </div>
            )}

            {/* Prestations */}
            {lignes.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #e2e8f0' }}>
                  Prestations
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Description</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', width: 50 }}>Qté</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', width: 90 }}>PU HT</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', width: 60 }}>TVA</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', width: 90 }}>Total TTC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'transparent' : '#f8fafc' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 500, color: '#1e293b' }}>{l.description || '—'}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>{l.quantite ?? 1}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', color: '#64748b' }}>{eur(l.prix_ht)}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b' }}>{TVA_LABEL[l.tva_pct] ?? `${l.tva_pct ?? 0} %`}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#1e293b' }}>{eur(l.total_ttc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totaux */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
              <div style={{ width: '100%', maxWidth: 260 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 13, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                  <span>Total HT</span><span style={{ fontWeight: 600 }}>{eur(totalHT)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: 13, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                  <span>TVA</span><span style={{ fontWeight: 600 }}>{eur(tvaMontant)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0 0', fontSize: 18, fontWeight: 800, color: '#1e3a5f', borderTop: '2px solid #1e3a5f', marginTop: 4 }}>
                  <span>Total TTC</span><span>{eur(totalTTC)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {doc.notes && (
              <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>{doc.notes}</div>
              </div>
            )}

            {/* Coordonnées bancaires (facture) */}
            {!isDevis && params?.iban && (
              <div style={{ padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Règlement par virement</div>
                <div style={{ fontSize: 13, color: '#166534' }}>IBAN : <strong>{params.iban}</strong></div>
                {params.bic && <div style={{ fontSize: 13, color: '#166534' }}>BIC : <strong>{params.bic}</strong></div>}
              </div>
            )}

            {/* Infos légales */}
            {params?.siret && (
              <div style={{ paddingTop: 14, borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
                SIRET : {params.siret}{params?.numero_tva ? ` — TVA : ${params.numero_tva}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Actions client — masquées à l'impression */}
        <div className="pub-no-print" style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>

          <button
            onClick={handleDownloadPDF}
            disabled={generating}
            style={{
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: '#1e3a5f', color: '#fff', cursor: generating ? 'wait' : 'pointer',
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              boxShadow: '0 2px 8px rgba(30,58,95,0.25)',
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? 'Génération…' : '⬇ Télécharger PDF'}
          </button>

          {/* Appel téléphonique si numéro disponible */}
          {contactTel && (
            <a
              href={`tel:${contactTel.replace(/\s/g, '')}`}
              style={{
                padding: '12px 24px', borderRadius: 10,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#1e293b', textDecoration: 'none',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              📞 {contactTel}
            </a>
          )}

          {/* Email si disponible */}
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              style={{
                padding: '12px 24px', borderRadius: 10,
                border: '1px solid #e2e8f0', background: '#fff',
                color: '#1e293b', textDecoration: 'none',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              ✉ Contacter
            </a>
          )}
        </div>

        <div className="pub-no-print" style={{ marginTop: 16, textAlign: 'center', fontSize: 11, color: '#cbd5e1' }}>
          Propulsé par Kaytek Inter · <a href="/confidentialite" style={{ color: '#94a3b8', textDecoration: 'none' }}>Confidentialité</a> · <a href="/delete-account" style={{ color: '#94a3b8', textDecoration: 'none' }}>Suppression de compte</a>
        </div>
      </div>
    </div>
  )
}
