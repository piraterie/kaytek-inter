// src/pages/FacturesPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileSpreadsheet, CheckSquare, Trash2, Clock, AlertTriangle, Mail, MoreHorizontal,
  Search, X, Euro, FileText, CheckCircle2, XCircle, Link2, Loader2, Send, Check,
} from 'lucide-react'
import { useFactures, useUpdateFacture, useDeleteFacture, useDeleteAllFactures, useParametres, useCreatePublicLink, notifyAdmins, REQUIRED_PARAMS } from '@/lib/hooks'
import { useAuthStore, useToastStore, useParamsStore } from '@/lib/store'
import ConfirmModal from '@/components/ConfirmModal'
import { pdfCache } from '@/lib/pdf/cache'
import { supabase } from '@/lib/supabase/client'
import { envoyerEmail } from '@/lib/supabase/auth'
import { getTheme } from '@/lib/themes'
import { DocSheet, SheetRow, SheetSection } from '@/components/DocSheet'
import type { Facture } from '@/types'

function downloadCSV(rows: string[][], filename: string) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

const SC: Record<string, string> = { en_attente_validation: 'pill-amber', payee: 'pill-green', impayee: 'pill-red', acompte: 'pill-purple', partiel: 'pill-orange', annulee: 'pill-gray' }
const SL: Record<string, string> = { en_attente_validation: 'En attente', payee: 'Payée', impayee: 'Impayée', acompte: 'Acompte', partiel: 'Partielle', annulee: 'Annulée' }
const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('fr-FR')
const chkStyle: React.CSSProperties = { width: 18, height: 18, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--bl)' }

const STATUTS = ['tous', 'en_attente_validation', 'impayee', 'payee', 'acompte', 'partiel', 'annulee']

const ns = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export default function FacturesPage() {
  const nav = useNavigate()
  const { params: storeParams } = useParamsStore()
  const { data: dbParams } = useParametres()
  const params = storeParams || dbParams
  const { add } = useToastStore()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const canSendEmail = isAdmin || (user?.can_create_documents === true && user?.can_bypass_validation === true)
  const canMarkPaid = !isAdmin && user?.can_create_documents === true && user?.can_bypass_validation === true

  const { data: factures = [], isLoading, isError, error } = useFactures()
  const upd = useUpdateFacture()
  const del = useDeleteFacture()
  const delAll = useDeleteAllFactures()

  const [filterStatut, setFilterStatut] = useState('tous')
  const [search, setSearch] = useState('')
  const [payModal, setPayModal] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  const [sendConfirmModal, setSendConfirmModal] = useState<Facture | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [activeSheet, setActiveSheet] = useState<Facture | null>(null)
  const [showMobileActions, setShowMobileActions] = useState(false)
  const createLink = useCreatePublicLink()
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)

  const filtered = factures
    .filter(f => filterStatut === 'tous' || f.statut_paiement === filterStatut)
    .filter(f => {
      if (!search.trim()) return true
      const q = ns(search)
      return (
        ns(f.numero).includes(q) ||
        ns(`${f.client?.nom || ''} ${f.client?.prenom || ''}`).includes(q) ||
        ns(f.client?.telephone || '').includes(q) ||
        ns(f.client?.email || '').includes(q) ||
        ns(SL[f.statut_paiement] || '').includes(q) ||
        ns(f.devis?.activite || '').includes(q) ||
        String(f.montant_ttc || 0).includes(search.replace(',', '.'))
      )
    })
  const pendingCount = factures.filter(f => f.statut_paiement === 'en_attente_validation').length
  const impaye = factures.filter(f => f.statut_paiement === 'impayee').reduce((s, f) => s + f.montant_ttc, 0)
  const paye = factures.filter(f => f.statut_paiement === 'payee').reduce((s, f) => s + f.montant_ttc, 0)

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelectAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(f => f.id)))
  }
  function exitSelection() { setSelected(new Set()); setSelectionMode(false) }

  async function markPaid(id: string, mode: string) {
    try {
      await upd.mutateAsync({ id, statut_paiement: 'payee', mode_paiement: mode as any, date_paiement: new Date().toISOString() })
      add('Facture marquée payée')
      setPayModal(null)
    } catch (e: any) { add(e.message, 'error') }
  }

  async function handleMarkPaidIntervenant(f: Facture) {
    try {
      await upd.mutateAsync({ id: f.id, statut_paiement: 'payee', date_paiement: new Date().toISOString() })
      await notifyAdmins('💶 Facture marquée payée', `${user?.prenom || ''} ${user?.nom || ''} a marqué la facture ${f.numero} comme payée.`, '/factures')
      add('Facture marquée comme payée')
    } catch (e: any) { add(e.message, 'error') }
  }

  function checkParams(): boolean {
    if (!params) {
      add('Configurez les paramètres entreprise dans Paramètres', 'warning',
        isAdmin ? { label: 'Ouvrir', fn: () => nav('/parametres') } : undefined)
      return false
    }
    const missing = REQUIRED_PARAMS.filter(f => !params[f.field as keyof typeof params])
    if (missing.length > 0) {
      add(
        `Paramètres incomplets — complétez : ${missing.map(m => m.label).join(', ')}`,
        'warning',
        isAdmin ? { label: 'Ouvrir', fn: () => nav('/parametres') } : undefined
      )
      return false
    }
    return true
  }

  function openSheet(f: Facture) {
    setActiveSheet(f)
    // Pré-génération opportuniste — si l'utilisateur ouvre le sheet, il va probablement envoyer
    if (!pdfCache.get(f.id) && params) {
      ;(async () => {
        try {
          const { generateFacturePDF } = await import('@/lib/pdf/generator')
          const blob = await generateFacturePDF(f, f.devis || null, params)
          pdfCache.set(f.id, blob)
          console.log('[pdf-cache] facture pré-générée', f.numero)
        } catch { /* silencieux */ }
      })()
    }
  }

  async function dlPDF(f: Facture) {
    if (!checkParams()) return
    try {
      add('Generation PDF...', 'info')
      const { generateFacturePDF, downloadBlob } = await import('@/lib/pdf/generator')
      const blob = await generateFacturePDF(f, f.devis || null, params)
      downloadBlob(blob, `${f.numero}.pdf`)
      add('PDF telecharge')
    } catch (e: any) { add('Erreur PDF: ' + e.message, 'error') }
  }

  function handleEmail(f: Facture) {
    if (sendingEmailId) return
    const email = f.client?.email
    if (!email) { add('Ce client n\'a pas d\'adresse email', 'warning'); return }
    if (!checkParams()) return

    // Feedback immédiat — l'UI n'est pas bloquée
    add('Envoi en cours…', 'info')
    setSendingEmailId(f.id)

    // Envoi en arrière-plan — fire & forget
    ;(async () => {
      const t0 = Date.now()
      try {
        // Niveau 1 : cache mémoire (instant)
        let blob: Blob | undefined = pdfCache.get(f.id)
        if (blob) {
          console.log(`[facture-email] PDF depuis cache mémoire (0ms)`)
        }

        // Niveau 2 : storage Supabase (~200ms vs 2-3s)
        if (!blob && f.pdf_url) {
          try {
            const tS = Date.now()
            const { data, error } = await supabase.storage.from('pdf-documents').download(f.pdf_url)
            if (!error && data) {
              blob = data
              pdfCache.set(f.id, data)
              console.log(`[facture-email] PDF depuis storage ${Date.now() - tS}ms`)
            }
          } catch { /* fallback */ }
        }

        // Niveau 3 : génération fraîche (fallback)
        if (!blob) {
          const tG = Date.now()
          const { generateFacturePDF } = await import('@/lib/pdf/generator')
          blob = await generateFacturePDF(f, f.devis || null, params)
          pdfCache.set(f.id, blob)
          console.log(`[facture-email] PDF généré ${Date.now() - tG}ms`)
        }

        if (!blob) throw new Error('Impossible de générer le PDF')
        console.log(`[facture-email] PDF prêt (${(blob.size / 1024).toFixed(0)}KB) — total ${Date.now() - t0}ms`)

        const t1 = Date.now()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const pdfBase64 = btoa(binary)
        console.log(`[facture-email] encode ${Date.now() - t1}ms`)

        const estPayee = f.statut_paiement === 'payee'
        const modeleId = f.devis?.modele_id ?? params!.modele_pdf_defaut ?? 0
        const theme = getTheme(modeleId)
        const logoHtml = params!.logo_url
          ? `<img src="${params!.logo_url}" alt="Logo" style="height:56px;margin-bottom:10px;"/>`
          : `<div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:2px;">K</div>`
        const accentColor = estPayee ? '#16a34a' : theme.accent
        const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <div style="background:${theme.primary};padding:32px 40px;text-align:center;">${logoHtml}<div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:6px;">${params!.raison_sociale || 'KAYTEK SERRURE'}</div><div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div></div>
          <div style="background:${accentColor};height:4px;"></div>
          <div style="background:#f8fafc;padding:24px 40px 0;text-align:center;"><div style="display:inline-block;background:${theme.primary};color:#fff;font-size:13px;font-weight:700;padding:6px 20px;border-radius:20px;">FACTURE ${f.numero}</div>${estPayee ? `<div style="display:inline-block;margin-left:10px;background:#dcfce7;color:#16a34a;font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;">✓ PAYÉE</div>` : ''}</div>
          <div style="padding:32px 40px;"><p style="margin:0 0 16px;font-size:15px;color:#374151;">Bonjour <strong>${f.client?.prenom || ''} ${f.client?.nom || ''}</strong>,</p><p style="margin:0 0 16px;font-size:15px;color:#374151;">Veuillez trouver ci-joint votre facture pour nos prestations de serrurerie. ${estPayee ? 'Merci pour votre paiement.' : 'Merci de procéder au règlement avant la date d\'échéance indiquée.'}</p>
          <div style="background:#f8fafc;border-left:4px solid ${accentColor};border-radius:6px;padding:20px 24px;margin:24px 0;"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Montant total TTC</div><div style="font-size:28px;font-weight:700;color:${theme.primary};">${(f.montant_ttc||0).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</div>${!estPayee && f.date_echeance ? `<div style="font-size:12px;color:${theme.accent};margin-top:8px;">⏳ À régler avant le <strong>${new Date(f.date_echeance).toLocaleDateString('fr-FR')}</strong></div>` : ''}${estPayee && f.date_paiement ? `<div style="font-size:12px;color:#16a34a;margin-top:8px;">✓ Réglée le ${new Date(f.date_paiement).toLocaleDateString('fr-FR')}</div>` : ''}</div>
          <p style="margin:16px 0 0;font-size:15px;font-weight:700;color:${theme.primary};">${params!.raison_sociale || 'Kaytek Serrure'}</p></div>
          <div style="background:${theme.primary};padding:20px 40px;text-align:center;"><div style="color:rgba(255,255,255,0.85);font-size:12px;line-height:1.8;">${params!.adresse ? `📍 ${params!.adresse}${params!.code_postal ? ', ' + params!.code_postal : ''}${params!.ville ? ' ' + params!.ville : ''}<br/>` : ''}${params!.telephone ? `📞 ${params!.telephone}` : ''}${params!.telephone && params!.email ? '  ·  ' : ''}${params!.email ? `✉ ${params!.email}` : ''}${params!.siret ? `<br/><span style="color:rgba(255,255,255,0.5);font-size:11px;">SIRET : ${params!.siret}</span>` : ''}</div></div>
        </div>`

        const t2 = Date.now()
        const { error } = await envoyerEmail({
          to: email,
          subject: `Facture ${f.numero} — ${params!.raison_sociale}`,
          html, pdfBase64, pdfFilename: `${f.numero}.pdf`
        })
        console.log(`[facture-email] edge fn ${Date.now() - t2}ms — total ${Date.now() - t0}ms`)

        if (error) { add(error, 'error') }
        else { add(`Facture ${f.numero} envoyée à ${email}`) }
      } catch (e: any) {
        add('Erreur : ' + (e.message || 'Erreur inconnue'), 'error')
      } finally {
        setSendingEmailId(null)
      }
    })()
  }

  function handleEmailClick(f: Facture) {
    if (sendingEmailId) return
    if (f.statut_paiement === 'impayee') { setSendConfirmModal(f) } else { handleEmail(f) }
  }

  async function handleEmailAndMarkPaid(f: Facture) {
    setSendConfirmModal(null)
    try {
      await upd.mutateAsync({ id: f.id, statut_paiement: 'payee', date_paiement: new Date().toISOString() })
      await handleEmail({ ...f, statut_paiement: 'payee', date_paiement: new Date().toISOString() })
    } catch (e: any) { add(e.message, 'error') }
  }

  async function handleShareFacture(f: Facture) {
    setActiveSheet(null)
    try {
      const result = await createLink.mutateAsync({ document_type: 'facture', document_id: f.id })
      setShareUrl(`${window.location.origin}/d/${result.token}`)
    } catch (e: any) {
      add(e.message, 'error')
    }
  }

  function handleDel(id: string) {
    setConfirmDialog({
      message: 'Supprimer cette facture ?',
      action: async () => {
        try { await del.mutateAsync(id); add('Facture supprimée') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleDeleteSelected() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setConfirmDialog({
      message: `Voulez-vous vraiment supprimer les factures sélectionnées ?\n${ids.length} facture${ids.length > 1 ? 's' : ''} seront supprimées. Cette action est irréversible.`,
      action: async () => {
        try { await delAll.mutateAsync(ids); add(`${ids.length} facture${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`); exitSelection() }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  function handleVider() {
    if (!factures.length) { add('Aucune facture à supprimer', 'warning'); return }
    setConfirmDialog({
      message: `Voulez-vous vraiment tout supprimer ?\nCette action est irréversible.`,
      action: async () => {
        try { await delAll.mutateAsync(factures.map(f => f.id)); add('Toutes les factures ont été supprimées') }
        catch (e: any) { add(e.message, 'error') }
      }
    })
  }

  async function handleValidateFacture(id: string) {
    try { await upd.mutateAsync({ id, statut_paiement: 'impayee' }); add('Facture validée — maintenant active') }
    catch (e: any) { add(e.message, 'error') }
  }
  async function handleRejectFacture(id: string) {
    try { await upd.mutateAsync({ id, statut_paiement: 'annulee' }); add('Facture refusée') }
    catch (e: any) { add(e.message, 'error') }
  }

  function handleExportCSV() {
    const rows = [
      ['Numéro', 'Client', 'Activité', 'Total HT', 'Total TTC', 'Statut', 'Date émission'],
      ...filtered.map(f => [
        f.numero,
        `${f.client?.nom || ''} ${f.client?.prenom || ''}`.trim(),
        f.devis?.activite || '—',
        String(f.montant_ht || 0),
        String(f.montant_ttc || 0),
        f.statut_paiement,
        fmtDate(f.date_emission)
      ])
    ]
    downloadCSV(rows, `factures-${new Date().toISOString().split('T')[0]}.csv`)
  }

  return (
    <>
      {/* ── En-tête ─────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 0 }}>
          <div>
            <h1 className="page-title">Factures</h1>
            <p className="page-subtitle">
              {factures.length} facture{factures.length > 1 ? 's' : ''}
              {pendingCount > 0 && <span style={{ color: 'var(--amTx)', fontWeight: 600 }}> · {pendingCount} à valider</span>}
            </p>
          </div>
          {/* Desktop : inchangé */}
          <div className="page-actions hide-mobile">
            <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={filtered.length === 0}><FileSpreadsheet size={14} /> CSV</button>
            {isAdmin && !selectionMode && filtered.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectionMode(true)}><CheckSquare size={14} /> Sélectionner</button>
            )}
            {isAdmin && selectionMode && factures.length > 0 && (
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)' }} onClick={handleVider} disabled={delAll.isPending}>
                <Trash2 size={14} /> Tout supprimer
              </button>
            )}
          </div>
          {/* Mobile : ligne compacte sous le titre */}
          <div className="show-mobile" style={{ width: '100%' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setShowMobileActions(true)}
              >
                <MoreHorizontal size={15} /> Actions
              </button>
            </div>
          </div>
        </div>

        {/* Bannière : factures à valider */}
        {isAdmin && pendingCount > 0 && (
          <button
            onClick={() => setFilterStatut('en_attente_validation')}
            style={{
              marginTop: 14, display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '13px 18px',
              background: 'var(--amBg)', border: '1px solid var(--amBd)',
              borderRadius: 'var(--r2)', cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--amTx)' }}>
              <Clock size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--amTx)' }}>
                {pendingCount} facture{pendingCount > 1 ? 's' : ''} en attente de validation
              </div>
              <div style={{ fontSize: 12, color: 'var(--amTx)', opacity: 0.75, marginTop: 1 }}>Appuyer pour filtrer</div>
            </div>
          </button>
        )}
      </div>

      {/* ── Barre de sélection ──────────────────────────── */}
      {selectionMode && (
        <div style={{
          background: 'var(--blBg)', border: '1px solid var(--blBd)',
          borderRadius: 'var(--r2)', padding: '10px 16px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
        }}>
          <input type="checkbox" style={chkStyle} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blTx)', flex: 1 }}>
            {selected.size} sélectionnée{selected.size > 1 ? 's' : ''}
          </span>
          {selected.size > 0 && (
            <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)', borderColor: 'var(--rdBd)' }}
              onClick={handleDeleteSelected} disabled={delAll.isPending}>
              <Trash2 size={13} /> Supprimer la sélection
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exitSelection}><X size={13} /> Annuler</button>
        </div>
      )}

      {/* ── Stats ───────────────────────────────────────── */}
      <div className="grid-3 mb-4">
        <div className="stat-card accent-green">
          <Euro size={100} className="stat-decor" />
          <div className="stat-icon green"><Euro size={19} strokeWidth={2} /></div>
          <div className="stat-value">{eur(paye)}</div>
          <div className="stat-label">Encaissé</div>
        </div>
        <div className="stat-card" style={{ borderColor: 'var(--rdBd)' }}>
          <AlertTriangle size={100} className="stat-decor" />
          <div className="stat-icon red"><AlertTriangle size={19} strokeWidth={2} /></div>
          <div className="stat-value">{eur(impaye)}</div>
          <div className="stat-label">Impayé</div>
        </div>
        <div className="stat-card accent-blue">
          <FileText size={100} className="stat-decor" />
          <div className="stat-icon blue"><FileText size={19} strokeWidth={2} /></div>
          <div className="stat-value">{factures.length}</div>
          <div className="stat-label">Total factures</div>
        </div>
      </div>

      {/* ── Recherche + Filtres ─────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div className="search-bar" style={{ marginBottom: 10 }}>
          <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par n°, client, téléphone, montant…"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ border: 'none', background: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '0 2px', display: 'flex', flexShrink: 0 }}
            ><X size={15} /></button>
          )}
        </div>
        <div className="filter-bar">
          {STATUTS.map(s => (
            <button key={s}
              onClick={() => { setFilterStatut(s); setSelected(new Set()) }}
              className={`btn btn-sm ${filterStatut === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'tous' ? 'Tous' : (SL[s] || s)}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div style={{ padding: '10px 14px', background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 'var(--r2)', marginBottom: 12, fontSize: 12, color: 'var(--rdTx)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} /> Erreur : {(error as Error)?.message}
        </div>
      )}

      {/* ── MOBILE : cartes épurées ──────────────────────── */}
      <div className="show-mobile">
        {isLoading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)' }}>Chargement…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom: 12 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : 'Aucune facture'}
          </div>
        )}
        {filtered.map(f => {
          const enRetard = f.date_echeance && new Date(f.date_echeance) < new Date() && f.statut_paiement !== 'payee'
          return (
            <div
              key={f.id}
              onClick={() => selectionMode ? toggleSelect(f.id) : openSheet(f)}
              style={{
                background: selected.has(f.id) ? 'var(--blBg)' : 'var(--s0)',
                borderRadius: 20,
                padding: '16px 18px',
                marginBottom: 10,
                boxShadow: selected.has(f.id) ? '0 0 0 2px var(--bl)' : 'var(--sh0)',
                cursor: 'pointer',
                transition: 'box-shadow .15s, transform .12s',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {selectionMode && (
                <div style={{ marginBottom: 10 }}>
                  <input type="checkbox" style={chkStyle} checked={selected.has(f.id)}
                    onChange={() => toggleSelect(f.id)} onClick={e => e.stopPropagation()} />
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--t0)' }}>{f.numero}</span>
                    {f.statut_paiement === 'en_attente_validation' && (
                      <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--amBg)', color: 'var(--amTx)', borderRadius: 100, fontWeight: 700 }}>À valider</span>
                    )}
                    {enRetard && (
                      <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--rdBg)', color: 'var(--rdTx)', borderRadius: 100, fontWeight: 700 }}>En retard</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--t1)' }}>{f.client?.nom} {f.client?.prenom}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                    {fmtDate(f.date_emission)}
                    {f.date_echeance && <> · Éch. {fmtDate(f.date_echeance)}</>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--t0)', marginBottom: 6 }}>{eur(f.montant_ttc)}</div>
                  <span className={`pill ${SC[f.statut_paiement] || 'pill-gray'}`}>{SL[f.statut_paiement] || f.statut_paiement}</span>
                </div>
              </div>
              {canSendEmail && !selectionMode && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--b0)' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={e => { e.stopPropagation(); if (f.client?.email) handleEmailClick(f) }}
                    disabled={!!sendingEmailId || !f.client?.email}
                    title={!f.client?.email ? 'Aucun email client renseigné' : undefined}
                    style={{ width: '100%', justifyContent: 'center', opacity: !f.client?.email ? 0.45 : 1 }}
                  >{sendingEmailId === f.id ? <><Loader2 size={13} className="spin" /> Envoi…</> : <><Mail size={13} /> Email</>}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── DESKTOP : table ──────────────────────────────── */}
      <div className="hide-mobile card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectionMode && <th style={{ width: 40, paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} /></th>}
              <th>N°</th><th>Client</th><th>Date</th><th>Échéance</th><th>Montant TTC</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={selectionMode ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>Chargement…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={selectionMode ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                {search.trim()
                  ? <><span>Aucun résultat — </span><button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button></>
                  : 'Aucune facture'}
              </td></tr>
            )}
            {filtered.map(f => {
              const enRetard = f.date_echeance && new Date(f.date_echeance) < new Date() && f.statut_paiement !== 'payee'
              return (
                <tr key={f.id} style={{
                  ...(f.statut_paiement === 'en_attente_validation' ? { background: 'var(--amBg)' } : {}),
                  ...(selected.has(f.id) ? { background: 'var(--blBg)' } : {}),
                }}>
                  {selectionMode && <td style={{ paddingRight: 0 }}><input type="checkbox" style={chkStyle} checked={selected.has(f.id)} onChange={() => toggleSelect(f.id)} /></td>}
                  <td className="td-bold">{f.numero}</td>
                  <td className="td-bold">{f.client?.nom} {f.client?.prenom}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(f.date_emission)}</td>
                  <td style={{ fontSize: 12, color: enRetard ? 'var(--rdTx)' : 'inherit', fontWeight: enRetard ? 600 : 400 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {f.date_echeance ? fmtDate(f.date_echeance) : '—'}{enRetard && <AlertTriangle size={12} />}
                    </span>
                  </td>
                  <td className="td-bold">{eur(f.montant_ttc)}</td>
                  <td><span className={`pill ${SC[f.statut_paiement] || 'pill-gray'}`}>{SL[f.statut_paiement] || f.statut_paiement}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                      {canSendEmail && (
                        <button
                          className="btn-icon sm"
                          onClick={() => f.client?.email && handleEmailClick(f)}
                          title={f.client?.email ? `Envoyer à ${f.client.email}` : 'Aucun email client renseigné'}
                          disabled={!!sendingEmailId || !f.client?.email}
                          style={{ opacity: !f.client?.email ? 0.45 : 1 }}
                        >{sendingEmailId === f.id ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}</button>
                      )}
                      <button
                        className="btn-icon sm"
                        onClick={() => openSheet(f)}
                        title="Actions"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Bottom sheet actions ─────────────────────────── */}
      {activeSheet && (
        <DocSheet
          title={activeSheet.numero}
          subtitle={[activeSheet.client?.nom, activeSheet.client?.prenom].filter(Boolean).join(' ')}
          onClose={() => setActiveSheet(null)}
        >
          {/* Validation admin */}
          {isAdmin && activeSheet.statut_paiement === 'en_attente_validation' && (
            <>
              <SheetSection label="Validation" />
              <SheetRow
                icon={<CheckCircle2 size={16} />}
                label="Valider cette facture"
                sublabel="La facture sera marquée comme impayée"
                onClick={() => { setActiveSheet(null); handleValidateFacture(activeSheet.id) }}
                disabled={upd.isPending}
              />
              <SheetRow
                icon={<XCircle size={16} />}
                label="Refuser cette facture"
                danger
                onClick={() => { setActiveSheet(null); handleRejectFacture(activeSheet.id) }}
                disabled={upd.isPending}
              />
            </>
          )}

          {/* Paiement admin */}
          {isAdmin && activeSheet.statut_paiement !== 'payee' && activeSheet.statut_paiement !== 'en_attente_validation' && (
            <>
              <SheetSection label="Paiement" />
              <SheetRow
                icon={<Euro size={16} />}
                label="Marquer comme payée"
                sublabel="Choisir le mode de paiement"
                onClick={() => { setActiveSheet(null); setPayModal(activeSheet.id) }}
              />
            </>
          )}

          {/* Paiement intervenant */}
          {canMarkPaid && activeSheet.statut_paiement !== 'payee' && activeSheet.statut_paiement !== 'annulee' && (
            <>
              <SheetSection label="Paiement" />
              <SheetRow
                icon={<Euro size={16} />}
                label="C'est payé"
                sublabel="Notifier l'admin que le paiement est reçu"
                onClick={() => { setActiveSheet(null); handleMarkPaidIntervenant(activeSheet) }}
                disabled={upd.isPending}
              />
            </>
          )}

          {/* Document */}
          <SheetSection label="Document" />
          {isAdmin && (
            <SheetRow
              icon={<FileText size={16} />}
              label="Exporter PDF"
              onClick={() => { setActiveSheet(null); dlPDF(activeSheet) }}
            />
          )}
          {canSendEmail && (
            <SheetRow
              icon={<Mail size={16} />}
              label="Envoyer par email"
              sublabel={activeSheet.client?.email ?? 'Aucun email client renseigné'}
              onClick={() => { setActiveSheet(null); handleEmailClick(activeSheet) }}
              disabled={!activeSheet.client?.email}
              loading={sendingEmailId === activeSheet.id}
            />
          )}
          {isAdmin && (
            <SheetRow
              icon={<Link2 size={16} />}
              label="Partager par lien"
              sublabel="Crée un lien public pour que le client consulte la facture"
              onClick={() => handleShareFacture(activeSheet)}
              loading={createLink.isPending}
            />
          )}

          {/* Danger */}
          {isAdmin && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon={<Trash2 size={16} />}
                label="Supprimer cette facture"
                danger
                onClick={() => { setActiveSheet(null); handleDel(activeSheet.id) }}
              />
            </>
          )}
        </DocSheet>
      )}

      {/* ── Actions globales mobile ─────────────────────── */}
      {showMobileActions && (
        <DocSheet title="Actions" onClose={() => setShowMobileActions(false)}>
          <SheetRow
            icon={<FileSpreadsheet size={16} />}
            label="Exporter CSV"
            sublabel={filtered.length === 0 ? 'Aucune facture' : `${filtered.length} facture${filtered.length > 1 ? 's' : ''}`}
            onClick={() => { setShowMobileActions(false); handleExportCSV() }}
            disabled={filtered.length === 0}
          />
          {isAdmin && !selectionMode && filtered.length > 0 && (
            <SheetRow
              icon={<CheckSquare size={16} />}
              label="Mode sélection"
              sublabel="Sélectionner des factures"
              onClick={() => { setShowMobileActions(false); setSelectionMode(true) }}
            />
          )}
          {isAdmin && factures.length > 0 && (
            <>
              <SheetSection label="Zone dangereuse" />
              <SheetRow
                icon={<Trash2 size={16} />}
                label="Tout supprimer"
                sublabel={`Supprimer les ${factures.length} facture${factures.length > 1 ? 's' : ''}`}
                danger
                onClick={() => { setShowMobileActions(false); handleVider() }}
                disabled={delAll.isPending}
              />
            </>
          )}
        </DocSheet>
      )}

      {/* ── Modal : confirmation email impayée ──────────── */}
      {sendConfirmModal && (
        <div className="modal-overlay" onClick={() => setSendConfirmModal(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} color="var(--amTx)" /> Facture impayée</span>
              <button className="btn-icon sm" onClick={() => setSendConfirmModal(null)}><X size={15} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--t1)', marginBottom: 20 }}>
                Cette facture est actuellement marquée comme <strong>impayée</strong>.<br/>
                Voulez-vous vraiment l'envoyer au client avec ce statut ?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(isAdmin || canMarkPaid) && (
                  <button className="btn btn-primary" style={{ justifyContent: 'center' }}
                    onClick={() => handleEmailAndMarkPaid(sendConfirmModal)}
                    disabled={sendingEmailId === sendConfirmModal.id || upd.isPending}>
                    <CheckCircle2 size={15} /> Marquer comme payée puis envoyer
                  </button>
                )}
                <button className="btn btn-secondary" style={{ justifyContent: 'center' }}
                  onClick={() => { setSendConfirmModal(null); handleEmail(sendConfirmModal) }}
                  disabled={sendingEmailId === sendConfirmModal.id}>
                  {sendingEmailId === sendConfirmModal.id ? <><Send size={14} /> Envoi en cours…</> : <><Mail size={14} /> Envoyer quand même</>}
                </button>
                <button className="btn btn-secondary" style={{ justifyContent: 'center', color: 'var(--t3)' }} onClick={() => setSendConfirmModal(null)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : mode de paiement ────────────────────── */}
      {payModal && (
        <div className="modal-overlay" onClick={() => setPayModal(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Mode de paiement</span>
              <button className="btn-icon sm" onClick={() => setPayModal(null)}><X size={15} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[['Espèces', 'especes'], ['CB', 'cb'], ['Virement', 'virement'], ['Chèque', 'cheque']].map(([label, val]) => (
                <button key={val} className="btn btn-secondary" style={{ justifyContent: 'center' }}
                  onClick={() => markPaid(payModal, val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          onConfirm={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {shareUrl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,23,42,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
          <div style={{ background: 'var(--s0)', borderRadius: 'var(--r2)', padding: '24px 20px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', border: '1px solid var(--b1)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t0)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}><Link2 size={17} /> Lien de partage</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 14 }}>Ce lien permet au client de consulter la facture sans connexion.</div>
            <div style={{ padding: '10px 14px', background: 'var(--s1)', borderRadius: 8, border: '1px solid var(--b1)', fontSize: 12, color: 'var(--t1)', wordBreak: 'break-all', marginBottom: 14 }}>
              {shareUrl}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" style={{ justifyContent: 'center', textAlign: 'center' }}
                onClick={() => { navigator.clipboard.writeText(shareUrl); setCopiedShare(true); setTimeout(() => setCopiedShare(false), 2000) }}>
                {copiedShare ? <><Check size={15} /> Lien copié !</> : <><Link2 size={15} /> Copier le lien</>}
              </button>
              <button className="btn" style={{ background: '#25D366', color: '#fff', border: 'none', justifyContent: 'center', textAlign: 'center' }}
                onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent('Votre facture : ' + shareUrl)}`, '_blank')}>
                WhatsApp
              </button>
              <button className="btn" style={{ justifyContent: 'center', textAlign: 'center' }}
                onClick={() => window.open(`sms:?body=${encodeURIComponent('Votre facture : ' + shareUrl)}`)}>
                SMS
              </button>
              {navigator.share && (
                <button className="btn" style={{ background: '#2563eb', color: '#fff', border: 'none', justifyContent: 'center', textAlign: 'center' }}
                  onClick={() => navigator.share({ title: 'Facture Kaytek Inter', url: shareUrl }).catch(() => {})}>
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
    </>
  )
}
