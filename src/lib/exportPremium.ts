// src/lib/exportPremium.ts
// Exports XLSX premium — design Kaytek Inter, dashboard, totaux, couleurs statuts

import type { Devis, Facture, Client, Intervention, JournalEntry, ParametresEntreprise } from '@/types'

// ── Types publics ─────────────────────────────────────────────────────────────

export interface CommissionItem {
  id: string
  facture_numero?: string
  intervention_numero?: string
  intervention_adresse?: string
  intervenant_id: string
  intervenant?: { nom: string; prenom: string; commission_pct?: number }
  client?: { nom: string; prenom: string }
  montant_ttc: number
  cout_pieces: number
  base_commissionnable: number
  commission_pct: number
  commission_intervenant: number
  reste_entreprise: number
  date_paiement?: string | null
  created_at: string
  recue: boolean
  recue_le?: string | null
}

export interface ExportContext {
  params?: ParametresEntreprise | null
  user?: { nom: string; prenom: string } | null
}

export interface AllExportData {
  devis?: Devis[]
  factures?: Facture[]
  clients?: Client[]
  commissions?: CommissionItem[]
  journal?: JournalEntry[]
  interventions?: Intervention[]
}

// ── Palette ───────────────────────────────────────────────────────────────────

const P = {
  headerBg:    '1E3A5F',
  headerText:  'FFFFFF',
  subBg:       '243B55',
  subText:     'BFD3E8',
  evenBg:      'F8FAFC',
  oddBg:       'FFFFFF',
  totalsBg:    'EFF6FF',
  totalsText:  '1E40AF',
  summaryBg:   'F0F7FF',
  summaryHdr:  'BFDBFE',
  borderLight: 'E2E8F0',
  borderMid:   'CBD5E1',
  borderHdr:   '1E3A5F',
}

// status → [bgHex, fgHex]
const SC: Record<string, [string, string]> = {
  brouillon:             ['F3F4F6', '374151'],
  envoye:                ['DBEAFE', '1E40AF'],
  accepte:               ['D1FAE5', '065F46'],
  refuse:                ['FEE2E2', '991B1B'],
  expire:                ['FEF3C7', '92400E'],
  en_attente_validation: ['FEF3C7', '92400E'],
  payee:                 ['D1FAE5', '065F46'],
  impayee:               ['FEE2E2', '991B1B'],
  partiel:               ['FEF3C7', '92400E'],
  acompte:               ['FEF3C7', '92400E'],
  annulee:               ['F3F4F6', '374151'],
  en_attente:            ['FEF3C7', '92400E'],
  accepte_inter:         ['DBEAFE', '1E40AF'],
  en_cours:              ['EDE9FE', '5B21B6'],
  termine:               ['D1FAE5', '065F46'],
  annule:                ['FEE2E2', '991B1B'],
  facture:               ['F3F4F6', '374151'],
  creation:              ['D1FAE5', '065F46'],
  modification:          ['DBEAFE', '1E40AF'],
  suppression:           ['FEE2E2', '991B1B'],
  paiement:              ['D1FAE5', '065F46'],
}

// ── Libellés ──────────────────────────────────────────────────────────────────

const L_DEVIS: Record<string, string> = {
  en_attente_validation: 'À valider', brouillon: 'Brouillon', envoye: 'Envoyé',
  accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré',
}
const L_FACT: Record<string, string> = {
  en_attente_validation: 'À valider', impayee: 'Impayée', payee: 'Payée',
  acompte: 'Acompte', partiel: 'Partiel', annulee: 'Annulée', en_attente: 'En attente',
}
const L_INTER: Record<string, string> = {
  en_attente: 'En attente', accepte: 'Acceptée', refuse: 'Refusée',
  en_cours: 'En cours', termine: 'Terminée', annule: 'Annulée', facture: 'Facturée',
}
const L_ACTION: Record<string, string> = {
  creation: 'Création', modification: 'Modification', suppression: 'Suppression', paiement: 'Paiement',
}
const L_TABLE: Record<string, string> = {
  devis: 'Devis', factures: 'Factures', interventions: 'Interventions',
  clients: 'Clients', utilisateurs: 'Utilisateurs', commissions: 'Commissions',
}

// ── Formatters ────────────────────────────────────────────────────────────────

const eur = (n?: number | null) =>
  `${(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const fmtD = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR') : '—'

const today = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Download ──────────────────────────────────────────────────────────────────

function downloadBuffer(buf: unknown, filename: string) {
  const blob = new Blob([buf as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── ExcelJS factory ───────────────────────────────────────────────────────────

async function newWorkbook() {
  // Dynamic import → code-split, chargé seulement à l'export
  // CJS interop : Vite peut placer le module dans .default ou directement
  const mod = await import('exceljs') as any
  const EJS = mod.default ?? mod
  const wb = new EJS.Workbook()
  wb.creator = 'Kaytek Inter'
  wb.created = new Date()
  return { wb }
}

// ── Primitives de style ───────────────────────────────────────────────────────

type WS = any

const argb = (hex: string) => 'FF' + hex.replace('#', '')

function solidFill(hex: string) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }
}

function fnt(opts: { bold?: boolean; size?: number; color?: string; italic?: boolean }) {
  return {
    name: 'Calibri',
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    size: opts.size ?? 10,
    ...(opts.color ? { color: { argb: argb(opts.color) } } : {}),
  }
}

function thinBorder(hex: string) {
  const side = { style: 'thin', color: { argb: argb(hex) } }
  return { top: side, left: side, bottom: side, right: side }
}

function colWidths(ws: WS, widths: number[]) {
  ws.columns = widths.map(w => ({ width: w }))
}

// ── Blocs de mise en page ────────────────────────────────────────────────────

function addTitleBlock(ws: WS, title: string, subtitle: string, ncols: number) {
  ws.addRow([title, ...Array(ncols - 1).fill('')])
  const r1 = ws.lastRow; r1.height = 38
  ws.mergeCells(r1.number, 1, r1.number, ncols)
  const c1 = ws.getCell(r1.number, 1)
  c1.font = fnt({ bold: true, size: 16, color: P.headerText })
  c1.fill = solidFill(P.headerBg)
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  ws.addRow([subtitle, ...Array(ncols - 1).fill('')])
  const r2 = ws.lastRow; r2.height = 20
  ws.mergeCells(r2.number, 1, r2.number, ncols)
  const c2 = ws.getCell(r2.number, 1)
  c2.font = fnt({ italic: true, size: 10, color: P.subText })
  c2.fill = solidFill(P.subBg)
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  ws.addRow([])
  ws.getRow(ws.lastRow.number).height = 6
}

function addSummaryHeader(ws: WS, label: string, ncols: number) {
  ws.addRow([label, ...Array(ncols - 1).fill('')])
  const r = ws.lastRow; r.height = 22
  ws.mergeCells(r.number, 1, r.number, ncols)
  const c = ws.getCell(r.number, 1)
  c.font = fnt({ bold: true, size: 10, color: P.headerText })
  c.fill = solidFill(P.headerBg)
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
}

function addKpi(ws: WS, label: string, value: string | number, ncols: number, isHdr = false) {
  ws.addRow([label, value, ...Array(Math.max(0, ncols - 2)).fill('')])
  const r = ws.lastRow; r.height = 20
  const c1 = ws.getCell(r.number, 1)
  const c2 = ws.getCell(r.number, 2)
  c1.font = fnt({ bold: isHdr, size: 10, color: isHdr ? P.headerBg : '4B5563' })
  c1.fill = solidFill(isHdr ? P.summaryHdr : P.summaryBg)
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }
  c2.font = fnt({ bold: true, size: 10, color: P.headerBg })
  c2.fill = solidFill(isHdr ? P.summaryHdr : P.summaryBg)
  c2.alignment = { vertical: 'middle', horizontal: 'right' }
  c2.border = { bottom: { style: 'thin', color: { argb: argb(P.borderLight) } } }
  c1.border = { bottom: { style: 'thin', color: { argb: argb(P.borderLight) } } }
  if (ncols > 2) ws.mergeCells(r.number, 2, r.number, ncols)
}

function addHeaderRow(ws: WS, headers: string[]) {
  ws.addRow(headers)
  const r = ws.lastRow; r.height = 26
  r.eachCell((cell: any) => {
    cell.font = fnt({ bold: true, size: 10, color: P.headerText })
    cell.fill = solidFill(P.headerBg)
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = thinBorder(P.borderHdr)
  })
  return r.number
}

function addDataRow(ws: WS, vals: (string | number | null | undefined)[], isEven: boolean) {
  ws.addRow(vals)
  const r = ws.lastRow; r.height = 19
  r.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.fill = solidFill(isEven ? P.evenBg : P.oddBg)
    cell.border = thinBorder(P.borderLight)
    cell.alignment = { vertical: 'middle' }
  })
  return r
}

function addTotalsRow(ws: WS, vals: (string | number | null | undefined)[]) {
  ws.addRow(vals)
  const r = ws.lastRow; r.height = 24
  r.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.font = fnt({ bold: true, size: 10, color: P.totalsText })
    cell.fill = solidFill(P.totalsBg)
    cell.border = thinBorder('93C5FD')
    cell.alignment = { vertical: 'middle' }
  })
  return r
}

function styleStatus(ws: WS, rowN: number, colN: number, status: string) {
  const colors = SC[status]
  if (!colors) return
  const cell = ws.getCell(rowN, colN)
  cell.fill = solidFill(colors[0])
  cell.font = { ...cell.font, bold: true, color: { argb: argb(colors[1]) } }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
}

function styleMoney(ws: WS, rowN: number, colN: number) {
  const cell = ws.getCell(rowN, colN)
  cell.numFmt = '#,##0.00 €'
  cell.alignment = { vertical: 'middle', horizontal: 'right' }
}

function styleDate(ws: WS, rowN: number, colN: number) {
  ws.getCell(rowN, colN).alignment = { vertical: 'middle', horizontal: 'center' }
}

function freeze(ws: WS, afterRow: number) {
  ws.views = [{ state: 'frozen', ySplit: afterRow }]
}

function autofilter(ws: WS, headerRow: number, ncols: number) {
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: ncols } }
}

function spacer(ws: WS) {
  ws.addRow([])
  ws.getRow(ws.lastRow.number).height = 6
}

// ── Feuille Devis ─────────────────────────────────────────────────────────────

function sheetDevis(wb: any, devis: Devis[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Devis')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Numéro', 'Client', 'Email', 'Activité', 'Total HT (€)', 'Total TTC (€)', 'Statut', 'Date', 'Valide jusqu\'au', 'Intervenant']
  const ncols = headers.length

  colWidths(ws, [14, 22, 26, 14, 14, 14, 14, 13, 16, 22])
  addTitleBlock(ws, 'Devis', `Export du ${today()} · ${empresa}${byUser} · ${devis.length} devis`, ncols)

  const totalHT  = devis.reduce((s, d) => s + (d.total_ht  || 0), 0)
  const totalTTC = devis.reduce((s, d) => s + (d.total_ttc || 0), 0)
  const acceptes = devis.filter(d => d.statut === 'accepte').length
  const refuses  = devis.filter(d => d.statut === 'refuse').length
  const envoyes  = devis.filter(d => d.statut === 'envoye').length
  const brouillons = devis.filter(d => d.statut === 'brouillon').length
  const expires  = devis.filter(d => d.statut === 'expire').length
  const taux = devis.length ? `${(acceptes / devis.length * 100).toFixed(1)} %` : '—'

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'Total devis', devis.length, ncols)
  addKpi(ws, 'Total HT', eur(totalHT), ncols)
  addKpi(ws, 'Total TTC', eur(totalTTC), ncols)
  addKpi(ws, 'Acceptés', acceptes, ncols)
  addKpi(ws, "Taux d'acceptation", taux, ncols)
  addKpi(ws, 'Envoyés', envoyes, ncols)
  addKpi(ws, 'Brouillons', brouillons, ncols)
  addKpi(ws, 'Refusés', refuses, ncols)
  addKpi(ws, 'Expirés', expires, ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  devis.forEach((d, i) => {
    const row = addDataRow(ws, [
      d.numero,
      `${d.client?.nom || ''} ${d.client?.prenom || ''}`.trim() || '—',
      d.client?.email || '—',
      d.activite || '—',
      d.total_ht  || 0,
      d.total_ttc || 0,
      L_DEVIS[d.statut] || d.statut,
      fmtD(d.created_at),
      fmtD(d.valide_jusqu_au),
      d.intervenant ? `${d.intervenant.prenom} ${d.intervenant.nom}` : '—',
    ], i % 2 === 0)
    styleStatus(ws, row.number, 7, d.statut)
    styleMoney(ws, row.number, 5)
    styleMoney(ws, row.number, 6)
    styleDate(ws, row.number, 8)
    styleDate(ws, row.number, 9)
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', totalHT, totalTTC, `${acceptes} accepté(s) / ${devis.length}`, '', '', ''])
  styleMoney(ws, tr.number, 5)
  styleMoney(ws, tr.number, 6)
}

// ── Feuille Factures ──────────────────────────────────────────────────────────

function sheetFactures(wb: any, factures: Facture[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Factures')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Numéro', 'Client', 'Email', 'Activité', 'Total HT (€)', 'Total TTC (€)', 'Statut', 'Date émission', 'Date paiement']
  const ncols = headers.length

  colWidths(ws, [14, 22, 26, 14, 14, 14, 14, 14, 14])
  addTitleBlock(ws, 'Factures', `Export du ${today()} · ${empresa}${byUser} · ${factures.length} factures`, ncols)

  const totalHT    = factures.reduce((s, f) => s + (f.montant_ht  || 0), 0)
  const totalTTC   = factures.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const payees     = factures.filter(f => f.statut_paiement === 'payee')
  const impayees   = factures.filter(f => f.statut_paiement === 'impayee')
  const montPaye   = payees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const montImpaye = impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0)

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'Total factures', factures.length, ncols)
  addKpi(ws, 'CA HT', eur(totalHT), ncols)
  addKpi(ws, 'CA TTC', eur(totalTTC), ncols)
  addKpi(ws, 'Factures payées', payees.length, ncols)
  addKpi(ws, 'Montant payé', eur(montPaye), ncols)
  addKpi(ws, 'Factures impayées', impayees.length, ncols)
  addKpi(ws, 'Montant impayé', eur(montImpaye), ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  factures.forEach((f, i) => {
    const row = addDataRow(ws, [
      f.numero,
      `${f.client?.nom || ''} ${f.client?.prenom || ''}`.trim() || '—',
      f.client?.email || '—',
      f.devis?.activite || '—',
      f.montant_ht  || 0,
      f.montant_ttc || 0,
      L_FACT[f.statut_paiement] || f.statut_paiement,
      fmtD(f.date_emission),
      fmtD(f.date_paiement),
    ], i % 2 === 0)
    styleStatus(ws, row.number, 7, f.statut_paiement)
    styleMoney(ws, row.number, 5)
    styleMoney(ws, row.number, 6)
    styleDate(ws, row.number, 8)
    styleDate(ws, row.number, 9)
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', totalHT, totalTTC, `${payees.length} payée(s) / ${factures.length}`, '', ''])
  styleMoney(ws, tr.number, 5)
  styleMoney(ws, tr.number, 6)
}

// ── Feuille Clients ───────────────────────────────────────────────────────────

function sheetClients(wb: any, clients: Client[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Clients')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Nom', 'Prénom', 'Téléphone', 'Email', 'Adresse', 'Type', 'Date création']
  const ncols = headers.length

  colWidths(ws, [20, 18, 16, 28, 34, 15, 14])
  addTitleBlock(ws, 'Clients', `Export du ${today()} · ${empresa}${byUser} · ${clients.length} clients`, ncols)

  const particuliers = clients.filter(c => c.type === 'particulier').length
  const pros = clients.length - particuliers

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'Total clients', clients.length, ncols)
  addKpi(ws, 'Particuliers', particuliers, ncols)
  addKpi(ws, 'Professionnels', pros, ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  clients.forEach((c, i) => {
    const row = addDataRow(ws, [
      c.nom || '—',
      c.prenom || '—',
      c.telephone || '—',
      c.email || '—',
      c.adresse_intervention || '—',
      c.type === 'particulier' ? 'Particulier' : 'Professionnel',
      fmtD(c.created_at),
    ], i % 2 === 0)
    styleDate(ws, row.number, 7)
    const typeCell = ws.getCell(row.number, 6)
    if (c.type === 'particulier') {
      typeCell.fill = solidFill('DBEAFE'); typeCell.font = fnt({ size: 10, color: '1E40AF' })
    } else {
      typeCell.fill = solidFill('EDE9FE'); typeCell.font = fnt({ size: 10, color: '5B21B6' })
    }
    typeCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  addTotalsRow(ws, [`${clients.length} client(s)`, '', '', '', '', `${particuliers} part. · ${pros} pro.`, ''])
}

// ── Feuille Commissions ───────────────────────────────────────────────────────

function sheetCommissions(wb: any, items: CommissionItem[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Commissions')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Intervenant', 'Facture', 'Intervention', 'Client', 'CA TTC (€)', 'Matériel (€)', 'Base comm. (€)', '% Comm.', 'Commission (€)', 'Reste entr. (€)', 'Date paiement', 'Comm. reçue']
  const ncols = headers.length

  colWidths(ws, [22, 14, 14, 22, 14, 12, 14, 10, 14, 14, 14, 13])
  addTitleBlock(ws, 'Commissions intervenants', `Export du ${today()} · ${empresa}${byUser} · ${items.length} entrées`, ncols)

  const caTTC    = items.reduce((s, c) => s + c.montant_ttc, 0)
  const matTot   = items.reduce((s, c) => s + c.cout_pieces, 0)
  const baseTot  = items.reduce((s, c) => s + c.base_commissionnable, 0)
  const commTot  = items.reduce((s, c) => s + c.commission_intervenant, 0)
  const resteTot = items.reduce((s, c) => s + c.reste_entreprise, 0)
  const recues   = items.filter(c => c.recue).length

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'CA TTC total', eur(caTTC), ncols)
  addKpi(ws, 'Matériel total', eur(matTot), ncols)
  addKpi(ws, 'Base commissionnable', eur(baseTot), ncols)
  addKpi(ws, 'Commissions dues', eur(commTot), ncols)
  addKpi(ws, 'Reste entreprise', eur(resteTot), ncols)
  addKpi(ws, 'Commissions reçues', recues, ncols)
  addKpi(ws, 'Commissions non reçues', items.length - recues, ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  items.forEach((c, i) => {
    const row = addDataRow(ws, [
      c.intervenant ? `${c.intervenant.prenom} ${c.intervenant.nom}` : '—',
      c.facture_numero || '—',
      c.intervention_numero || '—',
      c.client ? `${c.client.nom} ${c.client.prenom}`.trim() : '—',
      c.montant_ttc || 0,
      c.cout_pieces || 0,
      c.base_commissionnable || 0,
      `${c.commission_pct} %`,
      c.commission_intervenant || 0,
      c.reste_entreprise || 0,
      fmtD(c.date_paiement),
      c.recue ? 'Oui' : 'Non',
    ], i % 2 === 0)
    ;[5, 6, 7, 9, 10].forEach(col => styleMoney(ws, row.number, col))
    styleDate(ws, row.number, 11)
    const rCell = ws.getCell(row.number, 12)
    rCell.fill = solidFill(c.recue ? 'D1FAE5' : 'FEE2E2')
    rCell.font = fnt({ size: 10, color: c.recue ? '065F46' : '991B1B', bold: true })
    rCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', caTTC, matTot, baseTot, '', commTot, resteTot, '', `${recues}/${items.length} reçues`])
  ;[5, 6, 7, 9, 10].forEach(col => styleMoney(ws, tr.number, col))
}

// ── Feuille Journal ───────────────────────────────────────────────────────────

function extractNv(j: JournalEntry) {
  const nv = (j.new_value || {}) as Record<string, any>
  const ov = (j.old_value || {}) as Record<string, any>
  const get = (k: string) => nv[k] ?? ov[k] ?? ''
  return {
    numero: get('numero'),
    statut: get('statut') || get('statut_paiement'),
    client: [get('nom'), get('prenom')].filter(Boolean).join(' ') || get('client_nom'),
    email: get('email'),
    telephone: get('telephone'),
    adresse: get('adresse_intervention') || get('adresse'),
    montant: get('total_ttc') || get('montant_ttc') || get('montant') || 0,
    type: get('type'),
    description: get('description'),
  }
}

function sheetJournal(wb: any, journal: JournalEntry[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Journal')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Date', 'Heure', 'Utilisateur', 'Action', 'Table', 'N° Document', 'Statut', 'Client', 'Email', 'Téléphone', 'Adresse', 'Montant TTC (€)', 'Type', 'Description', 'Note']
  const ncols = headers.length

  colWidths(ws, [12, 8, 18, 14, 14, 14, 12, 20, 24, 14, 28, 14, 12, 28, 28])
  addTitleBlock(ws, "Journal d'activité", `Export du ${today()} · ${empresa}${byUser} · ${journal.length} entrées`, ncols)

  const byAction = journal.reduce<Record<string, number>>((acc, j) => {
    acc[j.action] = (acc[j.action] || 0) + 1; return acc
  }, {})

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'Total entrées', journal.length, ncols)
  Object.entries(byAction).forEach(([a, n]) => addKpi(ws, L_ACTION[a] || a, n, ncols))
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  journal.forEach((j, idx) => {
    const f = extractNv(j)
    const d = new Date(j.created_at)
    const row = addDataRow(ws, [
      d.toLocaleDateString('fr-FR'),
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      j.user_nom || '—',
      L_ACTION[j.action] || j.action,
      L_TABLE[j.table_name] || j.table_name,
      f.numero || '—',
      f.statut || '—',
      f.client || '—',
      f.email || '—',
      f.telephone || '—',
      f.adresse || '—',
      f.montant || 0,
      f.type || '—',
      f.description || '—',
      j.description || '—',
    ], idx % 2 === 0)
    styleStatus(ws, row.number, 4, j.action)
    if (typeof f.montant === 'number' && f.montant > 0) styleMoney(ws, row.number, 12)
    styleDate(ws, row.number, 1)
  })

  addTotalsRow(ws, [`${journal.length} entrée(s)`, ...Array(ncols - 1).fill('')])
}

// ── Feuille Interventions ─────────────────────────────────────────────────────

function sheetInterventions(wb: any, interventions: Intervention[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Interventions')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const byUser = ctx.user ? ` · Par : ${ctx.user.prenom} ${ctx.user.nom}` : ''
  const headers = ['Numéro', 'Date', 'Client', 'Téléphone', 'Adresse', 'Intervenant', 'Activité', 'Statut', 'Montant TTC (€)', 'Description']
  const ncols = headers.length

  colWidths(ws, [14, 13, 22, 16, 30, 22, 14, 13, 14, 32])
  addTitleBlock(ws, 'Interventions', `Export du ${today()} · ${empresa}${byUser} · ${interventions.length} interventions`, ncols)

  const terminees  = interventions.filter(i => i.statut === 'termine').length
  const enCours    = interventions.filter(i => i.statut === 'en_cours').length
  const totalTTC   = interventions.reduce((s, i) => s + (i.montant_ttc || 0), 0)

  addSummaryHeader(ws, 'Résumé', ncols)
  addKpi(ws, 'Total', interventions.length, ncols)
  addKpi(ws, 'Terminées', terminees, ncols)
  addKpi(ws, 'En cours', enCours, ncols)
  addKpi(ws, 'Montant TTC total', eur(totalTTC), ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  interventions.forEach((inter, i) => {
    const client = inter.client as any
    const interv = inter.intervenant as any
    const row = addDataRow(ws, [
      inter.numero || '—',
      fmtD(inter.created_at),
      client ? `${client.nom || ''} ${client.prenom || ''}`.trim() : '—',
      client?.telephone || '—',
      inter.adresse || '—',
      interv ? `${interv.prenom || ''} ${interv.nom || ''}`.trim() : '—',
      inter.type || '—',
      L_INTER[inter.statut] || inter.statut,
      inter.montant_ttc || 0,
      inter.description || '—',
    ], i % 2 === 0)
    styleStatus(ws, row.number, 8, inter.statut === 'accepte' ? 'accepte_inter' : inter.statut)
    styleMoney(ws, row.number, 9)
    styleDate(ws, row.number, 2)
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', '', '', '', `${terminees} terminée(s)`, totalTTC, ''])
  styleMoney(ws, tr.number, 9)
}

// ── Feuille Dashboard ─────────────────────────────────────────────────────────

function sheetDashboard(wb: any, data: AllExportData, ctx: ExportContext) {
  const ws = wb.addWorksheet('Dashboard')
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const user = ctx.user ? `${ctx.user.prenom} ${ctx.user.nom}` : ''
  const ncols = 3
  colWidths(ws, [34, 22, 16])

  // Grand titre
  ws.addRow(['KAYTEK INTER — Tableau de bord', '', ''])
  const rt = ws.lastRow; rt.height = 44
  ws.mergeCells(rt.number, 1, rt.number, ncols)
  const ct = ws.getCell(rt.number, 1)
  ct.font = fnt({ bold: true, size: 20, color: P.headerText })
  ct.fill = solidFill(P.headerBg)
  ct.alignment = { vertical: 'middle', horizontal: 'center' }

  ws.addRow([empresa, '', ''])
  const re = ws.lastRow; re.height = 26
  ws.mergeCells(re.number, 1, re.number, ncols)
  const ce = ws.getCell(re.number, 1)
  ce.font = fnt({ italic: true, size: 13, color: 'BFD3E8' })
  ce.fill = solidFill(P.subBg)
  ce.alignment = { vertical: 'middle', horizontal: 'center' }

  ws.addRow([`Généré le ${today()}${user ? ` · Par : ${user}` : ''}`, '', ''])
  const rm = ws.lastRow; rm.height = 20
  ws.mergeCells(rm.number, 1, rm.number, ncols)
  const cm = ws.getCell(rm.number, 1)
  cm.font = fnt({ italic: true, size: 10, color: '8EB5D4' })
  cm.fill = solidFill(P.subBg)
  cm.alignment = { vertical: 'middle', horizontal: 'center' }

  spacer(ws)

  const devis        = data.devis        || []
  const factures     = data.factures     || []
  const clients      = data.clients      || []
  const commissions  = data.commissions  || []
  const journal      = data.journal      || []
  const interventions = data.interventions || []

  function section(title: string) {
    ws.addRow([title, '', ''])
    const r = ws.lastRow; r.height = 26
    ws.mergeCells(r.number, 1, r.number, ncols)
    const c = ws.getCell(r.number, 1)
    c.font = fnt({ bold: true, size: 12, color: P.headerText })
    c.fill = solidFill(P.headerBg)
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  }

  function kpi(label: string, value: string | number, accent = false) {
    ws.addRow([label, value, ''])
    const r = ws.lastRow; r.height = 22
    const c1 = ws.getCell(r.number, 1)
    const c2 = ws.getCell(r.number, 2)
    ws.mergeCells(r.number, 2, r.number, ncols)
    c1.font = fnt({ size: 10, color: '4B5563' })
    c1.fill = solidFill(P.summaryBg)
    c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 3 }
    c2.font = fnt({ bold: true, size: 11, color: accent ? '065F46' : P.headerBg })
    c2.fill = solidFill(accent ? 'D1FAE5' : P.summaryBg)
    c2.alignment = { vertical: 'middle', horizontal: 'right' }
    const bd = { bottom: { style: 'thin', color: { argb: argb(P.borderLight) } } }
    c1.border = bd; c2.border = bd
  }

  // Devis
  if (devis.length > 0) {
    const totalHT  = devis.reduce((s, d) => s + (d.total_ht  || 0), 0)
    const totalTTC = devis.reduce((s, d) => s + (d.total_ttc || 0), 0)
    const acceptes = devis.filter(d => d.statut === 'accepte').length
    const taux = `${(devis.length ? acceptes / devis.length * 100 : 0).toFixed(1)} %`
    section('Devis')
    kpi('Nombre de devis', devis.length)
    kpi('Total HT', eur(totalHT))
    kpi('Total TTC', eur(totalTTC))
    kpi('Devis acceptés', acceptes, acceptes > 0)
    kpi("Taux d'acceptation", taux, acceptes > 0)
    spacer(ws)
  }

  // Factures
  if (factures.length > 0) {
    const caHT       = factures.reduce((s, f) => s + (f.montant_ht  || 0), 0)
    const caTTC      = factures.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const payees     = factures.filter(f => f.statut_paiement === 'payee')
    const impayees   = factures.filter(f => f.statut_paiement === 'impayee')
    const montPaye   = payees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const montImpaye = impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const panier     = payees.length ? montPaye / payees.length : 0
    section('Factures')
    kpi('Nombre de factures', factures.length)
    kpi('CA HT', eur(caHT))
    kpi('CA TTC', eur(caTTC))
    kpi('Factures payées', payees.length, payees.length > 0)
    kpi('Montant payé', eur(montPaye), montPaye > 0)
    kpi('Factures impayées', impayees.length, impayees.length === 0)
    kpi('Montant impayé', eur(montImpaye), montImpaye === 0)
    kpi('Panier moyen', eur(panier))
    spacer(ws)
  }

  // Clients
  if (clients.length > 0) {
    const particuliers = clients.filter(c => c.type === 'particulier').length
    section('Clients')
    kpi('Nombre de clients', clients.length)
    kpi('Particuliers', particuliers)
    kpi('Professionnels', clients.length - particuliers)
    spacer(ws)
  }

  // Interventions
  if (interventions.length > 0) {
    const totalTTC  = interventions.reduce((s, i) => s + (i.montant_ttc || 0), 0)
    const terminees = interventions.filter(i => i.statut === 'termine').length
    section('Interventions')
    kpi("Nombre d'interventions", interventions.length)
    kpi('Terminées', terminees, terminees > 0)
    kpi('En cours', interventions.filter(i => i.statut === 'en_cours').length)
    kpi('Montant TTC total', eur(totalTTC))
    spacer(ws)
  }

  // Commissions
  if (commissions.length > 0) {
    const caTTC    = commissions.reduce((s, c) => s + c.montant_ttc, 0)
    const commTot  = commissions.reduce((s, c) => s + c.commission_intervenant, 0)
    const resteTot = commissions.reduce((s, c) => s + c.reste_entreprise, 0)
    const recues   = commissions.filter(c => c.recue).length
    section('Commissions')
    kpi('CA TTC facturé', eur(caTTC))
    kpi('Total commissions', eur(commTot))
    kpi('Reste entreprise', eur(resteTot), resteTot > 0)
    kpi('Commissions reçues', recues, recues > 0)
    kpi('Commissions non reçues', commissions.length - recues)
    spacer(ws)
  }

  // Journal
  if (journal.length > 0) {
    const creations = journal.filter(j => j.action === 'creation').length
    const modifs    = journal.filter(j => j.action === 'modification').length
    const supps     = journal.filter(j => j.action === 'suppression').length
    section("Journal d'activité")
    kpi('Total entrées', journal.length)
    kpi('Créations', creations, creations > 0)
    kpi('Modifications', modifs)
    kpi('Suppressions', supps)
    spacer(ws)
  }
}

// ── Synthèse mensuelle (pour rapport complet) ─────────────────────────────────

function sheetSynthese(wb: any, data: AllExportData) {
  const ws = wb.addWorksheet('Synthèse mensuelle')
  const devis        = data.devis        || []
  const factures     = data.factures     || []
  const interventions = data.interventions || []
  const commissions  = data.commissions  || []

  const headers = ['Mois', 'Interventions', 'Devis', 'Devis acceptés', 'Factures', 'Factures payées', 'CA TTC (€)', 'Commissions (€)', 'Reste entreprise (€)']
  const ncols = headers.length

  colWidths(ws, [18, 14, 10, 14, 10, 16, 14, 16, 18])
  addTitleBlock(ws, 'Synthèse mensuelle', `Export du ${today()}`, ncols)
  spacer(ws)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow + 1)
  autofilter(ws, hRow, ncols)

  // Calculer la plage de mois
  const allDates = [
    ...interventions.map(i => new Date(i.created_at)),
    ...devis.map(d => new Date(d.created_at)),
    ...factures.map(f => new Date(f.created_at)),
  ]
  if (!allDates.length) return

  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())))
  const months: Array<{ y: number; m: number }> = []
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  const nowEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
  while (cur < nowEnd) {
    months.push({ y: cur.getFullYear(), m: cur.getMonth() })
    cur.setMonth(cur.getMonth() + 1)
  }
  months.reverse()

  months.forEach((mo, i) => {
    const mStart = new Date(mo.y, mo.m, 1)
    const mEnd   = new Date(mo.y, mo.m + 1, 1)
    const inR = (iso: string) => { const d = new Date(iso); return d >= mStart && d < mEnd }

    const nbInter    = interventions.filter(i => inR(i.created_at)).length
    const nbDevis    = devis.filter(d => inR(d.created_at)).length
    const nbDevisOk  = devis.filter(d => inR(d.created_at) && d.statut === 'accepte').length
    const nbFact     = factures.filter(f => inR(f.created_at)).length
    const payeesFact = factures.filter(f => f.statut_paiement === 'payee' && !!f.date_paiement && inR(f.date_paiement))
    const nbFactPay  = payeesFact.length
    const caFact     = payeesFact.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const monthComm  = commissions.filter(c => !!c.date_paiement && inR(c.date_paiement))
    const commInt    = monthComm.reduce((s, c) => s + c.commission_intervenant, 0)
    const reste      = monthComm.reduce((s, c) => s + c.reste_entreprise, 0)

    const label = mStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const row = addDataRow(ws, [
      label.charAt(0).toUpperCase() + label.slice(1),
      nbInter, nbDevis, nbDevisOk, nbFact, nbFactPay, caFact, commInt, reste
    ], i % 2 === 0)
    styleMoney(ws, row.number, 7)
    styleMoney(ws, row.number, 8)
    styleMoney(ws, row.number, 9)
  })
}

// ── Fonctions publiques ───────────────────────────────────────────────────────

export async function exportDevisPremium(devis: Devis[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetDevis(wb, devis, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `devis-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportFacturesPremium(factures: Facture[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetFactures(wb, factures, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `factures-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportClientsPremium(clients: Client[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetClients(wb, clients, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `clients-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportCommissionsPremium(items: CommissionItem[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetCommissions(wb, items, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `commissions-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportInterventionsPremium(interventions: Intervention[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetInterventions(wb, interventions, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `interventions-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportJournalPremium(journal: JournalEntry[], ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetJournal(wb, journal, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `journal-${new Date().toISOString().split('T')[0]}.xlsx`)
}

export async function exportRapportComplet(data: AllExportData, ctx: ExportContext = {}) {
  const { wb } = await newWorkbook()
  sheetDashboard(wb, data, ctx)
  if ((data.devis?.length || 0) > 0)        sheetDevis(wb, data.devis!, ctx)
  if ((data.factures?.length || 0) > 0)     sheetFactures(wb, data.factures!, ctx)
  if ((data.clients?.length || 0) > 0)      sheetClients(wb, data.clients!, ctx)
  if ((data.commissions?.length || 0) > 0)  sheetCommissions(wb, data.commissions!, ctx)
  if ((data.interventions?.length || 0) > 0) sheetInterventions(wb, data.interventions!, ctx)
  if ((data.journal?.length || 0) > 0)      sheetJournal(wb, data.journal!, ctx)
  sheetSynthese(wb, data)
  downloadBuffer(await wb.xlsx.writeBuffer(), `rapport-complet-${new Date().toISOString().split('T')[0]}.xlsx`)
}
