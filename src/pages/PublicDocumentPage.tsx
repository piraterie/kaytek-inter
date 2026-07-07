// src/pages/PublicDocumentPage.tsx
// Page publique — visible sans authentification via un token de partage

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import KaytekLogo from '@/components/KaytekLogo'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-public-document`

const eur = (n?: number | null) =>
  (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const fmtDate = (s?: string) =>
  s ? new Date(s).toLocaleDateString('fr-FR') : '—'

const TVA_LABEL: Record<number, string> = { 0: '0%', 10: '10%', 20: '20%' }

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
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!token) { setError('Lien invalide'); setLoading(false); return }
    fetch(`${EDGE_URL}?token=${token}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) setError(json.error)
        else setData(json)
      })
      .catch(() => setError('Impossible de charger le document'))
      .finally(() => setLoading(false))
  }, [token])

  function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      navigator.share({ title: 'Document Kaytek Inter', url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  function handleWhatsApp() {
    const url = window.location.href
    const text = encodeURIComponent(`Voici votre document : ${url}`)
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank')
  }

  function handleSMS() {
    const url = window.location.href
    window.open(`sms:?body=${encodeURIComponent(`Votre document : ${url}`)}`)
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 16, background: '#f8fafc' }}>
        <KaytekLogo size={48} />
        <p style={{ color: '#94a3b8', fontSize: 14 }}>Chargement du document…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 12, background: '#f8fafc', padding: 24 }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>Document introuvable</h2>
        <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{error}</p>
      </div>
    )
  }

  const { document_type, document: doc, params } = data
  const isDevis = document_type === 'devis'
  const lignes = isDevis ? (doc.lignes || []) : (doc.devis?.lignes || [])
  const client = doc.client
  const totalHT = isDevis ? doc.total_ht : doc.montant_ht
  const tvaMontant = isDevis ? doc.tva_montant : doc.tva_montant
  const totalTTC = isDevis ? doc.total_ttc : doc.montant_ttc
  const statut = isDevis ? doc.statut : doc.statut_paiement
  const numero = doc.numero
  const dateDoc = isDevis ? doc.created_at : doc.date_emission
  const dateEcheance = isDevis ? doc.valide_jusqu_au : doc.date_echeance

  return (
    <div style={{ minHeight: '100dvh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Barre partage en haut */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <KaytekLogo size={28} />
        <span style={{ fontSize: 13, color: '#64748b', flex: 1 }}>
          {params?.raison_sociale || 'Document partagé'}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleCopyLink}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1e293b', fontFamily: 'inherit' }}
          >
            {copied ? '✓ Copié !' : '🔗 Copier le lien'}
          </button>
          <button
            onClick={handleWhatsApp}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#25D366', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'inherit' }}
          >
            WhatsApp
          </button>
          <button
            onClick={handleSMS}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#1e293b', fontFamily: 'inherit', display: 'none' }}
            className="sms-btn"
          >
            SMS
          </button>
          {navigator.share && (
            <button
              onClick={handleShare}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#2563eb', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'inherit' }}
            >
              Partager
            </button>
          )}
        </div>
      </div>

      {/* Corps du document */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px' }}>
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)' }}>
          {/* En-tête entreprise */}
          <div style={{ background: '#1e3a5f', padding: '28px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              {params?.logo_url ? (
                <img src={params.logo_url} alt="Logo" style={{ height: 48, objectFit: 'contain', marginBottom: 10 }} />
              ) : (
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>{params?.raison_sociale || 'Entreprise'}</div>
              )}
              {params?.adresse && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>{params.adresse}</div>}
              {(params?.code_postal || params?.ville) && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{[params?.code_postal, params?.ville].filter(Boolean).join(' ')}</div>}
              {params?.telephone && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>{params.telephone}</div>}
              {params?.email && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{params.email}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: 2, background: 'rgba(255,255,255,0.12)', padding: '8px 18px', borderRadius: 10, display: 'inline-block' }}>
                {isDevis ? 'DEVIS' : 'FACTURE'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 8 }}>{numero}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>{fmtDate(dateDoc)}</div>
              {dateEcheance && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                  {isDevis ? 'Valable jusqu\'au ' : 'Échéance '}{fmtDate(dateEcheance)}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: '24px 32px' }}>
            {/* Statut */}
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusBadge statut={statut} />
            </div>

            {/* Client */}
            {client && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Client</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b' }}>{[client.nom, client.prenom].filter(Boolean).join(' ')}</div>
                {client.telephone && <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{client.telephone}</div>}
                {client.email && <div style={{ fontSize: 13, color: '#64748b' }}>{client.email}</div>}
                {client.adresse_intervention && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{client.adresse_intervention}</div>}
              </div>
            )}

            {/* Prestations */}
            {lignes.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid #e2e8f0' }}>
                  Prestations
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* En-têtes desktop */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 60px 80px', gap: 8, padding: '6px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <span>Description</span>
                    <span style={{ textAlign: 'center' }}>Qté</span>
                    <span style={{ textAlign: 'right' }}>Prix HT</span>
                    <span style={{ textAlign: 'center' }}>TVA</span>
                    <span style={{ textAlign: 'right' }}>Total TTC</span>
                  </div>
                  {lignes.map((l: any, i: number) => (
                    <div key={i} style={{
                      display: 'grid', gridTemplateColumns: '1fr 60px 80px 60px 80px', gap: 8,
                      padding: '10px 12px',
                      background: i % 2 === 0 ? '#f8fafc' : '#fff',
                      borderRadius: 6, fontSize: 13, color: '#1e293b'
                    }}>
                      <span style={{ fontWeight: 500 }}>{l.description}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{l.quantite}</span>
                      <span style={{ textAlign: 'right' }}>{eur(l.prix_ht)}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{TVA_LABEL[l.tva_pct] || `${l.tva_pct}%`}</span>
                      <span style={{ textAlign: 'right', fontWeight: 600 }}>{eur(l.total_ttc)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Totaux */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: '100%', maxWidth: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                  <span>Total HT</span>
                  <span style={{ fontWeight: 600 }}>{eur(totalHT)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                  <span>TVA</span>
                  <span style={{ fontWeight: 600 }}>{eur(tvaMontant)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px', fontSize: 17, fontWeight: 800, color: '#1e293b', borderTop: '2px solid #1e3a5f', marginTop: 4 }}>
                  <span>Total TTC</span>
                  <span>{eur(totalTTC)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {doc.notes && (
              <div style={{ marginTop: 24, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>{doc.notes}</div>
              </div>
            )}

            {/* Coordonnées bancaires pour les factures */}
            {!isDevis && params?.iban && (
              <div style={{ marginTop: 20, padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Règlement par virement</div>
                <div style={{ fontSize: 13, color: '#166534' }}>IBAN : <strong>{params.iban}</strong></div>
                {params.bic && <div style={{ fontSize: 13, color: '#166534' }}>BIC : <strong>{params.bic}</strong></div>}
              </div>
            )}

            {/* Infos légales */}
            {params?.siret && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
                SIRET : {params.siret}{params?.numero_tva ? ` — TVA : ${params.numero_tva}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Boutons de partage en bas */}
        <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleCopyLink}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
          >
            {copied ? '✓ Lien copié !' : '🔗 Copier le lien'}
          </button>
          <button
            onClick={handleWhatsApp}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#25D366', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
          >
            WhatsApp
          </button>
          <button
            onClick={handleSMS}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
          >
            SMS
          </button>
        </div>

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: '#cbd5e1' }}>
          Propulsé par Kaytek Inter · <a href="/confidentialite" style={{ color: '#94a3b8', textDecoration: 'none' }}>Confidentialité</a> · <a href="/delete-account" style={{ color: '#94a3b8', textDecoration: 'none' }}>Suppression de compte</a>
        </div>
      </div>
    </div>
  )
}
