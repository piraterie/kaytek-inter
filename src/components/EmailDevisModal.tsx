// src/components/EmailDevisModal.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { generateDevisPDF } from '@/lib/pdf/generator'
import { pdfCache } from '@/lib/pdf/cache'
import { supabase } from '@/lib/supabase/client'
import { envoyerEmail } from '@/lib/supabase/auth'
import { getTheme } from '@/lib/themes'
import { useAuthStore, useToastStore } from '@/lib/store'
import { REQUIRED_PARAMS } from '@/lib/hooks'
import type { Devis, ParametresEntreprise } from '@/types'

interface Props {
  devis: Devis
  params: ParametresEntreprise
  onClose: () => void
  onSent: () => void
}

export default function EmailDevisModal({ devis, params, onClose, onSent }: Props) {
  const nav = useNavigate()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const [sending, setSending] = useState(false)
  const [closing, setClosing] = useState(false)
  const [emailTo, setEmailTo] = useState(devis.client?.email || '')
  const [error, setError] = useState('')
  const [paramsError, setParamsError] = useState(false)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const { add } = useToastStore()

  function handleClose() {
    if (closing || sending) return
    setClosing(true)
    setTimeout(onClose, 150)
  }

  // Pré-charge le logo en data-URL dès l'ouverture du modal pour éviter
  // le fetch réseau caché dans @react-pdf/renderer pendant la génération PDF
  useEffect(() => {
    if (!params.logo_url) return
    let cancelled = false
    fetch(params.logo_url)
      .then(r => r.blob())
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }))
      .then(dataUrl => { if (!cancelled) setLogoDataUrl(dataUrl) })
      .catch(() => {}) // silencieux — fallback sur l'URL originale
    return () => { cancelled = true }
  }, [params.logo_url])

  async function handleSend() {
    if (sending || !emailTo) { setError('Email destinataire requis'); return }
    const missing = REQUIRED_PARAMS.filter(f => !params[f.field as keyof ParametresEntreprise])
    if (missing.length > 0) {
      setParamsError(true)
      setError(
        `Paramètres entreprise incomplets — complétez : ${missing.map(m => m.label).join(', ')}.` +
        (isAdmin ? '' : ' Contactez votre administrateur.')
      )
      return
    }
    setParamsError(false)

    // Capturer toutes les valeurs avant de fermer la modale
    const _devis = devis
    const _params = params
    const _onSent = onSent
    const _to = emailTo
    const _logo = logoDataUrl

    // Fermer la modale immédiatement — l'utilisateur n'attend pas
    setSending(true) // évite double-clic pendant le re-render
    onClose()
    add('Envoi en cours…', 'info')

    // Envoi en arrière-plan — fire & forget
    ;(async () => {
      try {
        let blob: Blob | undefined

        // Devis signé : récupérer les données fraîches depuis la DB pour garantir
        // que signature_client est présente dans le PDF — le cache mémoire et le
        // storage peuvent contenir un PDF pré-généré AVANT la signature
        const isSigned = !!(_devis.signature_url || _devis.signature_client || _devis.statut === 'accepte')
        if (isSigned) {
          const { data: freshData } = await supabase
            .from('devis')
            .select('*, client:clients(*), intervenant:profiles!intervenant_id(*)')
            .eq('id', _devis.id)
            .single()
          const devisForPdf: any = (freshData && (freshData as any).signature_client) ? freshData : _devis
          const paramsForPDF = _logo ? { ..._params, logo_url: _logo } : _params
          blob = await generateDevisPDF(devisForPdf, paramsForPDF, devisForPdf.modele_id ?? _devis.modele_id ?? 0)
          pdfCache.set(_devis.id, blob)
        } else {
          // Niveau 1 : cache mémoire (instant)
          blob = pdfCache.get(_devis.id)

          // Niveau 2 : storage Supabase (~200ms vs 2-3s)
          if (!blob && _devis.pdf_url) {
            try {
              const { data, error } = await supabase.storage.from('pdf-documents').download(_devis.pdf_url)
              if (!error && data) {
                blob = data
                pdfCache.set(_devis.id, data)
              }
            } catch { /* fallback */ }
          }

          // Niveau 3 : génération fraîche (fallback)
          if (!blob) {
            const paramsForPDF = _logo ? { ..._params, logo_url: _logo } : _params
            blob = await generateDevisPDF(_devis, paramsForPDF, _devis.modele_id ?? 0)
            pdfCache.set(_devis.id, blob)
          }
        }

        if (!blob) throw new Error('Impossible de générer le PDF')

        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const pdfBase64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))

        const modeleId = _devis.modele_id ?? 0
        const theme = getTheme(modeleId)
        const logoHtml = _params.logo_url
          ? `<img src="${_params.logo_url}" alt="Logo" style="height:56px;margin-bottom:10px;"/>`
          : `<div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px;">K</div>`

        const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <div style="background:${theme.primary};padding:32px 40px;text-align:center;">
            ${logoHtml}
            <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;margin-top:6px;">${_params.raison_sociale || 'KAYTEK INTER'}</div>
            <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div>
          </div>
          <div style="background:${theme.accent};height:4px;"></div>
          <div style="background:#f8fafc;padding:24px 40px 0;text-align:center;">
            <div style="display:inline-block;background:${theme.primary};color:#fff;font-size:13px;font-weight:700;padding:6px 20px;border-radius:20px;letter-spacing:1px;">DEVIS ${_devis.numero}</div>
          </div>
          <div style="padding:32px 40px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">Bonjour <strong>${_devis.client?.prenom || ''} ${_devis.client?.nom || ''}</strong>,</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">
              Nous avons le plaisir de vous adresser votre devis pour nos prestations de <strong>${_devis.activite || 'serrurerie'}</strong>.
              Veuillez trouver ci-joint le document correspondant.
            </p>
            <div style="background:#f8fafc;border-left:4px solid ${theme.accent};border-radius:6px;padding:20px 24px;margin:24px 0;">
              <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Montant total TTC</div>
              <div style="font-size:28px;font-weight:700;color:${theme.primary};">${(_devis.total_ttc || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
              ${_devis.valide_jusqu_au ? `<div style="font-size:12px;color:${theme.accent};margin-top:8px;">⏳ Devis valable jusqu'au <strong>${new Date(_devis.valide_jusqu_au).toLocaleDateString('fr-FR')}</strong></div>` : ''}
            </div>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">
              Pour accepter ce devis, il vous suffit de nous le retourner signé avec la mention <em>« Bon pour accord »</em>, ou de nous contacter directement.
            </p>
            <p style="margin:0;font-size:15px;color:#374151;">Nous restons à votre disposition pour toute question ou information complémentaire.</p>
            <p style="margin:16px 0 0;font-size:15px;color:#374151;">Cordialement,</p>
            <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:${theme.primary};">${_params.raison_sociale || 'Kaytek Inter'}</p>
          </div>
          <div style="background:${theme.primary};padding:20px 40px;text-align:center;">
            <div style="color:rgba(255,255,255,0.85);font-size:12px;line-height:1.8;">
              ${_params.adresse ? `📍 ${_params.adresse}${_params.code_postal ? ', ' + _params.code_postal : ''}${_params.ville ? ' ' + _params.ville : ''}<br/>` : ''}
              ${_params.telephone ? `📞 ${_params.telephone}` : ''}${_params.telephone && _params.email ? '  ·  ' : ''}${_params.email ? `✉ ${_params.email}` : ''}
              ${_params.siret ? `<br/><span style="color:rgba(255,255,255,0.5);font-size:11px;">SIRET : ${_params.siret}</span>` : ''}
            </div>
          </div>
        </div>`

        const response = await envoyerEmail({
          to: _to,
          subject: `Devis ${_devis.numero} — ${_params.raison_sociale}`,
          html,
          pdfBase64,
          pdfFilename: `${_devis.numero}.pdf`,
          documentType: 'devis',
          documentId: _devis.id,
        })

        if (response.error) {
          add(`Impossible d'envoyer le devis`, 'error')
        } else {
          add(`Email envoyé à ${_to}`, 'success')
          _onSent() // marque le devis comme envoyé + notifie l'intervenant
        }
      } catch (e: any) {
        console.error('[devis-email] erreur', e)
        add(`Impossible d'envoyer le devis`, 'error')
      }
    })()
  }

  return (
    <div
      className={closing ? 'is-closing' : ''}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: closing ? undefined : 'fadeIn .2s ease',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'var(--s0)', borderRadius: 'var(--r3)',
          width: '100%', maxWidth: 480,
          padding: 24, boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column', gap: 16,
          animation: closing ? 'scaleOut .15s cubic-bezier(.32,.72,0,1) forwards' : 'scaleIn .22s cubic-bezier(.32,.72,0,1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--t0)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={18} /> Envoyer le devis par email
          </div>
          <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 4 }}>Le PDF sera joint automatiquement</div>
        </div>

        <div className="card" style={{ padding: '12px 14px', background: 'var(--s1)', borderRadius: 'var(--r2)' }}>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 4 }}>Devis</div>
          <div style={{ fontWeight: 700, color: 'var(--t0)' }}>{devis.numero}</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 2 }}>
            {devis.client?.prenom} {devis.client?.nom} · {(devis.total_ttc || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>
            Destinataire
          </label>
          <input
            className="input"
            type="email"
            value={emailTo}
            onChange={e => setEmailTo(e.target.value)}
            placeholder="email@client.fr"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ fontSize: 12, color: 'var(--t3)', padding: '10px 12px', background: 'var(--s1)', borderRadius: 'var(--r2)', borderLeft: '3px solid var(--b2)' }}>
          Objet : <strong>Devis {devis.numero} — {params.raison_sociale}</strong>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: 'var(--rdTx)', padding: '8px 12px', background: 'var(--rdBg)', borderRadius: 'var(--r2)', border: '1px solid var(--rdBd)' }}>
            {error}
            {paramsError && isAdmin && (
              <button
                type="button"
                onClick={() => { onClose(); nav('/parametres') }}
                style={{ marginTop: 8, display: 'block', width: '100%', padding: '6px 12px', background: 'rgba(220,38,38,0.12)', border: '1px solid var(--rdBd)', borderRadius: 6, color: 'var(--rdTx)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Ouvrir les Paramètres →
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={handleClose} disabled={sending}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || !emailTo}
            style={{ minHeight: 44, padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 10, fontWeight: 600, fontSize: 15 }}
          >
            <Mail size={17} /><span>Envoyer le devis</span>
          </button>
        </div>
      </div>
    </div>
  )
}
