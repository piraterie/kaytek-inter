// src/lib/exportPremium.ts
import type { Devis, Facture, Client, Intervention, JournalEntry, ParametresEntreprise } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  accentBlue:  '2563EB',
  evenBg:      'F8FAFC',
  oddBg:       'FFFFFF',
  totalsBg:    '1E3A5F',
  totalsText:  'FFFFFF',
  borderLight: 'E2E8F0',
  borderHdr:   '1E3A5F',
}

// KPI card color presets — { bg, fg }
const K = {
  blue:    { bg: 'EFF6FF', fg: '1E40AF' },
  green:   { bg: 'F0FDF4', fg: '15803D' },
  emerald: { bg: 'DCFCE7', fg: '166534' },
  amber:   { bg: 'FFFBEB', fg: '92400E' },
  purple:  { bg: 'F5F3FF', fg: '5B21B6' },
  red:     { bg: 'FEF2F2', fg: '991B1B' },
  gray:    { bg: 'F9FAFB', fg: '374151' },
  slate:   { bg: 'F1F5F9', fg: '475569' },
  orange:  { bg: 'FFF7ED', fg: 'C2410C' },
}

type KpiCard = { label: string; value: string | number; icon: string; bg: string; fg: string }

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

// ── Libellés (avec emojis) ────────────────────────────────────────────────────

const L_DEVIS: Record<string, string> = {
  en_attente_validation: '⏳ A valider',
  brouillon:             'Brouillon',
  envoye:                'Envoye',
  accepte:               'Accepte',
  refuse:                'Refuse',
  expire:                'Expire',
}
const L_FACT: Record<string, string> = {
  en_attente_validation: '⏳ A valider',
  impayee:               'Impayee',
  payee:                 'Payee',
  acompte:               'Acompte',
  partiel:               'Partiel',
  annulee:               'Annulee',
  en_attente:            '⏳ En attente',
}
const L_INTER: Record<string, string> = {
  en_attente:  '⏳ En attente',
  accepte:     'Acceptee',
  refuse:      'Refusee',
  en_cours:    'En cours',
  termine:     'Terminee',
  annule:      'Annulee',
  facture:     'Facturee',
}
const L_ACTION: Record<string, string> = {
  creation:     'Creation',
  modification: 'Modification',
  suppression:  'Suppression',
  paiement:     'Paiement',
}
const L_TABLE: Record<string, string> = {
  devis: 'Devis', factures: 'Factures', interventions: 'Interventions',
  clients: 'Clients', utilisateurs: 'Utilisateurs', commissions: 'Commissions',
}

// ── Formatters ────────────────────────────────────────────────────────────────

const eur = (n?: number | null) =>
  `${(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`

const fmtD = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR') : '-'

const todayFull = () => {
  const d = new Date()
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' a ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadBuffer(buf: unknown, filename: string) {
  const blob = new Blob([buf as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── ExcelJS factory ───────────────────────────────────────────────────────────

async function newWorkbook() {
  const mod = await import('exceljs') as any
  const EJS = mod.default ?? mod
  const wb = new EJS.Workbook()
  wb.creator = 'Kaytek Inter'
  wb.created = new Date()
  return { wb }
}

// ── Style primitives ──────────────────────────────────────────────────────────

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
  const s = { style: 'thin' as const, color: { argb: argb(hex) } }
  return { top: s, left: s, bottom: s, right: s }
}

function colWidths(ws: WS, widths: number[]) {
  ws.columns = widths.map(w => ({ width: w }))
}

function setupPrint(ws: WS) {
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
}

// ── En-tête premium (3 lignes + barre accent) ─────────────────────────────────

function addHeaderBlock(ws: WS, sheetTitle: string, ctx: ExportContext, ncols: number) {
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const user = ctx.user ? `${ctx.user.prenom} ${ctx.user.nom}` : null

  const merge = (rowN: number) => {
    if (ncols > 1) ws.mergeCells(rowN, 1, rowN, ncols)
  }

  ws.addRow(Array(ncols).fill(''))
  const r1 = ws.lastRow; r1.height = 46; merge(r1.number)
  const c1 = ws.getCell(r1.number, 1)
  c1.value = 'KAYTEK INTER'
  c1.font = { name: 'Calibri', bold: true, size: 22, color: { argb: argb(P.headerText) } }
  c1.fill = solidFill(P.headerBg)
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }

  ws.addRow(Array(ncols).fill(''))
  const r2 = ws.lastRow; r2.height = 24; merge(r2.number)
  const c2 = ws.getCell(r2.number, 1)
  c2.value = sheetTitle
  c2.font = fnt({ bold: true, size: 13, color: 'BFD3E8' })
  c2.fill = solidFill(P.subBg)
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }

  const meta = [
    `Entreprise : ${empresa}`,
    user ? `Par : ${user}` : null,
    `Date : ${todayFull()}`,
    'Kaytek Inter',
  ].filter(Boolean).join('   |   ')

  ws.addRow(Array(ncols).fill(''))
  const r3 = ws.lastRow; r3.height = 18; merge(r3.number)
  const c3 = ws.getCell(r3.number, 1)
  c3.value = meta
  c3.font = fnt({ italic: true, size: 9, color: '8EB5D4' })
  c3.fill = solidFill(P.subBg)
  c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }

  ws.addRow(Array(ncols).fill(''))
  const rAcc = ws.lastRow; rAcc.height = 4; merge(rAcc.number)
  ws.getCell(rAcc.number, 1).fill = solidFill(P.accentBlue)
}

// ── Cartes KPI (2 par ligne, fond coloré, grande valeur) ─────────────────────

function addKpiCards(ws: WS, cards: KpiCard[], ncols: number) {
  const half = Math.floor(ncols / 2)

  for (let i = 0; i < cards.length; i += 2) {
    const L = cards[i]
    const R = i + 1 < cards.length ? cards[i + 1] : null
    const colsL = R ? half : ncols   // odd last card → full width

    // ── Label row ──
    ws.addRow(Array(ncols).fill(''))
    const rLab = ws.lastRow; rLab.height = 17

    if (colsL > 1) ws.mergeCells(rLab.number, 1, rLab.number, colsL)
    const cLL = ws.getCell(rLab.number, 1)
    cLL.value = L.icon + '  ' + L.label
    cLL.font = fnt({ size: 9, color: L.fg })
    cLL.fill = solidFill(L.bg)
    cLL.alignment = { vertical: 'bottom', horizontal: 'left', indent: 2 }

    if (R) {
      if (ncols > half + 1) ws.mergeCells(rLab.number, half + 1, rLab.number, ncols)
      const cRL = ws.getCell(rLab.number, half + 1)
      cRL.value = R.icon + '  ' + R.label
      cRL.font = fnt({ size: 9, color: R.fg })
      cRL.fill = solidFill(R.bg)
      cRL.alignment = { vertical: 'bottom', horizontal: 'left', indent: 2 }
      cRL.border = { left: { style: 'medium' as const, color: { argb: 'FFFFFFFF' } } }
    }

    // ── Value row ──
    ws.addRow(Array(ncols).fill(''))
    const rVal = ws.lastRow; rVal.height = 34

    if (colsL > 1) ws.mergeCells(rVal.number, 1, rVal.number, colsL)
    const cLV = ws.getCell(rVal.number, 1)
    cLV.value = L.value
    cLV.font = { name: 'Calibri', bold: true, size: 18, color: { argb: argb(L.fg) } }
    cLV.fill = solidFill(L.bg)
    cLV.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }
    cLV.border = { bottom: { style: 'thin' as const, color: { argb: argb(P.borderLight) } } }

    if (R) {
      if (ncols > half + 1) ws.mergeCells(rVal.number, half + 1, rVal.number, ncols)
      const cRV = ws.getCell(rVal.number, half + 1)
      cRV.value = R.value
      cRV.font = { name: 'Calibri', bold: true, size: 18, color: { argb: argb(R.fg) } }
      cRV.fill = solidFill(R.bg)
      cRV.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }
      cRV.border = {
        left: { style: 'medium' as const, color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin' as const, color: { argb: argb(P.borderLight) } },
      }
    }

    // Tiny gap between card pairs
    if (i + 2 < cards.length) {
      ws.addRow(Array(ncols).fill(''))
      const rGap = ws.lastRow; rGap.height = 3
      if (ncols > 1) ws.mergeCells(rGap.number, 1, rGap.number, ncols)
      ws.getCell(rGap.number, 1).fill = solidFill('F1F5F9')
    }
  }
}

// ── Tableau : en-tête, données, totaux ───────────────────────────────────────

function addHeaderRow(ws: WS, headers: string[]) {
  ws.addRow(headers)
  const r = ws.lastRow; r.height = 28
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
  const r = ws.lastRow; r.height = 22
  r.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.fill = solidFill(isEven ? P.evenBg : P.oddBg)
    cell.border = thinBorder(P.borderLight)
    cell.alignment = { vertical: 'middle' }
  })
  return r
}

function addTotalsRow(ws: WS, vals: (string | number | null | undefined)[]) {
  ws.addRow(vals)
  const r = ws.lastRow; r.height = 26
  r.eachCell({ includeEmpty: true }, (cell: any) => {
    cell.font = fnt({ bold: true, size: 10, color: P.totalsText })
    cell.fill = solidFill(P.totalsBg)
    cell.border = {
      top:    { style: 'medium' as const, color: { argb: argb('2563EB') } },
      bottom: { style: 'medium' as const, color: { argb: argb('2563EB') } },
      left:   { style: 'thin'   as const, color: { argb: argb(P.headerBg) } },
      right:  { style: 'thin'   as const, color: { argb: argb(P.headerBg) } },
    }
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
  cell.numFmt = '#,##0.00 [$EUR]'
  cell.alignment = { vertical: 'middle', horizontal: 'right' }
}

function styleDate(ws: WS, rowN: number, colN: number) {
  ws.getCell(rowN, colN).alignment = { vertical: 'middle', horizontal: 'center' }
}

function freeze(ws: WS, hRow: number) {
  ws.views = [{ state: 'frozen', ySplit: hRow }]
}

function autofilter(ws: WS, hRow: number, ncols: number) {
  ws.autoFilter = { from: { row: hRow, column: 1 }, to: { row: hRow, column: ncols } }
}

function spacer(ws: WS, h = 8) {
  ws.addRow([])
  ws.getRow(ws.lastRow.number).height = h
}

// ── Section header (pour Dashboard) ──────────────────────────────────────────

function addSectionHeader(ws: WS, label: string, ncols: number) {
  ws.addRow(Array(ncols).fill(''))
  const r = ws.lastRow; r.height = 26
  if (ncols > 1) ws.mergeCells(r.number, 1, r.number, ncols)
  const c = ws.getCell(r.number, 1)
  c.value = label
  c.font = fnt({ bold: true, size: 11, color: P.headerText })
  c.fill = solidFill(P.headerBg)
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 }
}

// ── Feuille Devis ─────────────────────────────────────────────────────────────

function sheetDevis(wb: any, devis: Devis[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Devis')
  const headers = ['Numero', 'Client', 'Email', 'Activite', 'Total HT', 'Total TTC', 'Statut', 'Date', 'Valide jusqu\'au', 'Intervenant']
  const ncols = headers.length

  colWidths(ws, [14, 22, 26, 14, 14, 14, 16, 13, 16, 22])
  setupPrint(ws)
  addHeaderBlock(ws, 'Export Devis', ctx, ncols)
  spacer(ws, 6)

  const totalHT    = devis.reduce((s, d) => s + (d.total_ht  || 0), 0)
  const totalTTC   = devis.reduce((s, d) => s + (d.total_ttc || 0), 0)
  const acceptes   = devis.filter(d => d.statut === 'accepte').length
  const envoyes    = devis.filter(d => d.statut === 'envoye').length
  const brouillons = devis.filter(d => d.statut === 'brouillon').length
  const refuses    = devis.filter(d => d.statut === 'refuse').length
  const taux       = devis.length ? `${(acceptes / devis.length * 100).toFixed(1)} %` : '-'

  addKpiCards(ws, [
    { icon: '📄', label: 'Total devis',        value: devis.length,  ...K.blue    },
    { icon: '💰', label: 'Total TTC',           value: eur(totalTTC), ...K.green   },
    { icon: '📊', label: "Taux d'acceptation", value: taux,          ...K.amber   },
    { icon: '✅', label: 'Acceptes',            value: acceptes,      ...K.emerald },
    { icon: '📬', label: 'Envoyes',             value: envoyes,       ...K.blue    },
    { icon: '📝', label: 'Brouillons',          value: brouillons,    ...K.gray    },
    { icon: '🔴', label: 'Refuses',             value: refuses,       ...K.red     },
    { icon: '💵', label: 'Total HT',            value: eur(totalHT),  ...K.slate   },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  devis.forEach((d, i) => {
    const row = addDataRow(ws, [
      d.numero,
      `${d.client?.nom || ''} ${d.client?.prenom || ''}`.trim() || '-',
      d.client?.email || '-',
      d.activite || '-',
      d.total_ht  || 0,
      d.total_ttc || 0,
      L_DEVIS[d.statut] || d.statut,
      fmtD(d.created_at),
      fmtD(d.valide_jusqu_au),
      d.intervenant ? `${d.intervenant.prenom} ${d.intervenant.nom}` : '-',
    ], i % 2 === 0)
    styleStatus(ws, row.number, 7, d.statut)
    styleMoney(ws, row.number, 5)
    styleMoney(ws, row.number, 6)
    styleDate(ws, row.number, 8)
    styleDate(ws, row.number, 9)
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', totalHT, totalTTC, `${acceptes} / ${devis.length} accepte(s)`, '', '', ''])
  styleMoney(ws, tr.number, 5)
  styleMoney(ws, tr.number, 6)
}

// ── Feuille Factures ──────────────────────────────────────────────────────────

function sheetFactures(wb: any, factures: Facture[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Factures')
  const headers = ['Numero', 'Client', 'Email', 'Activite', 'Total HT', 'Total TTC', 'Statut', 'Date emission', 'Date paiement']
  const ncols = headers.length

  colWidths(ws, [14, 22, 26, 14, 14, 14, 14, 14, 14])
  setupPrint(ws)
  addHeaderBlock(ws, 'Export Factures', ctx, ncols)
  spacer(ws, 6)

  const totalHT    = factures.reduce((s, f) => s + (f.montant_ht  || 0), 0)
  const totalTTC   = factures.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const payees     = factures.filter(f => f.statut_paiement === 'payee')
  const impayees   = factures.filter(f => f.statut_paiement === 'impayee')
  const montPaye   = payees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const montImpaye = impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const panier     = payees.length ? montPaye / payees.length : 0

  addKpiCards(ws, [
    { icon: '🧾', label: 'Total factures',   value: factures.length, ...K.blue    },
    { icon: '💰', label: 'CA TTC',           value: eur(totalTTC),   ...K.green   },
    { icon: '✅', label: 'Payees',           value: payees.length,   ...K.emerald },
    { icon: '💵', label: 'Montant paye',     value: eur(montPaye),   ...K.emerald },
    { icon: '⚠️', label: 'Impayees',        value: impayees.length, ...K.red     },
    { icon: '❌', label: 'Montant impaye',   value: eur(montImpaye), ...K.red     },
    { icon: '📈', label: 'Panier moyen',     value: eur(panier),     ...K.amber   },
    { icon: '📊', label: 'CA HT',            value: eur(totalHT),    ...K.slate   },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  factures.forEach((f, i) => {
    const row = addDataRow(ws, [
      f.numero,
      `${f.client?.nom || ''} ${f.client?.prenom || ''}`.trim() || '-',
      f.client?.email || '-',
      f.devis?.activite || '-',
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

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', totalHT, totalTTC, `${payees.length} / ${factures.length} payee(s)`, '', ''])
  styleMoney(ws, tr.number, 5)
  styleMoney(ws, tr.number, 6)
}

// ── Feuille Clients ───────────────────────────────────────────────────────────

function sheetClients(wb: any, clients: Client[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Clients')
  const headers = ['Nom', 'Prenom', 'Telephone', 'Email', 'Adresse', 'Type', 'Date creation']
  const ncols = headers.length

  colWidths(ws, [20, 18, 16, 28, 34, 15, 14])
  setupPrint(ws)
  addHeaderBlock(ws, 'Export Clients', ctx, ncols)
  spacer(ws, 6)

  const particuliers = clients.filter(c => c.type === 'particulier').length
  const pros         = clients.length - particuliers

  addKpiCards(ws, [
    { icon: '👥', label: 'Total clients',  value: clients.length, ...K.blue   },
    { icon: '👤', label: 'Particuliers',   value: particuliers,   ...K.slate  },
    { icon: '🏢', label: 'Professionnels', value: pros,           ...K.purple },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  clients.forEach((c, i) => {
    const row = addDataRow(ws, [
      c.nom || '-',
      c.prenom || '-',
      c.telephone || '-',
      c.email || '-',
      c.adresse_intervention || '-',
      c.type === 'particulier' ? 'Particulier' : 'Professionnel',
      fmtD(c.created_at),
    ], i % 2 === 0)
    styleDate(ws, row.number, 7)
    const typeCell = ws.getCell(row.number, 6)
    if (c.type === 'particulier') {
      typeCell.fill = solidFill('DBEAFE'); typeCell.font = fnt({ size: 10, color: '1E40AF', bold: true })
    } else {
      typeCell.fill = solidFill('EDE9FE'); typeCell.font = fnt({ size: 10, color: '5B21B6', bold: true })
    }
    typeCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  addTotalsRow(ws, [`${clients.length} client(s)`, '', '', '', '', `${particuliers} part. - ${pros} pro.`, ''])
}

// ── Feuille Commissions ───────────────────────────────────────────────────────

function sheetCommissions(wb: any, items: CommissionItem[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Commissions')
  const headers = ['Intervenant', 'Facture', 'Intervention', 'Client', 'CA TTC', 'Materiel', 'Base comm.', '% Comm.', 'Commission', 'Reste entr.', 'Date paiement', 'Comm. recue']
  const ncols = headers.length

  colWidths(ws, [22, 14, 14, 22, 14, 12, 14, 10, 14, 14, 14, 13])
  setupPrint(ws)
  addHeaderBlock(ws, 'Export Commissions Intervenants', ctx, ncols)
  spacer(ws, 6)

  const caTTC    = items.reduce((s, c) => s + c.montant_ttc, 0)
  const matTot   = items.reduce((s, c) => s + c.cout_pieces, 0)
  const baseTot  = items.reduce((s, c) => s + c.base_commissionnable, 0)
  const commTot  = items.reduce((s, c) => s + c.commission_intervenant, 0)
  const resteTot = items.reduce((s, c) => s + c.reste_entreprise, 0)
  const recues   = items.filter(c => c.recue).length

  addKpiCards(ws, [
    { icon: '💰', label: 'CA TTC facture',      value: eur(caTTC),    ...K.green   },
    { icon: '💼', label: 'Commissions dues',     value: eur(commTot),  ...K.blue    },
    { icon: '🔧', label: 'Base commissionnable', value: eur(baseTot),  ...K.slate   },
    { icon: '🏢', label: 'Reste entreprise',     value: eur(resteTot), ...K.emerald },
    { icon: '✅', label: 'Comm. recues',         value: recues,        ...K.emerald },
    { icon: '⏳', label: 'Comm. non recues',     value: items.length - recues, ...K.amber },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  items.forEach((c, i) => {
    const row = addDataRow(ws, [
      c.intervenant ? `${c.intervenant.prenom} ${c.intervenant.nom}` : '-',
      c.facture_numero || '-',
      c.intervention_numero || '-',
      c.client ? `${c.client.nom} ${c.client.prenom}`.trim() : '-',
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
    rCell.fill   = solidFill(c.recue ? 'D1FAE5' : 'FEE2E2')
    rCell.font   = fnt({ size: 10, color: c.recue ? '065F46' : '991B1B', bold: true })
    rCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', caTTC, matTot, baseTot, '', commTot, resteTot, '', `${recues}/${items.length} recues`])
  ;[5, 6, 7, 9, 10].forEach(col => styleMoney(ws, tr.number, col))
}

// ── Feuille Interventions ─────────────────────────────────────────────────────

function sheetInterventions(wb: any, interventions: Intervention[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Interventions')
  const headers = ['Numero', 'Date', 'Client', 'Telephone', 'Adresse', 'Intervenant', 'Activite', 'Statut', 'Montant TTC', 'Description']
  const ncols = headers.length

  colWidths(ws, [14, 13, 22, 16, 30, 22, 14, 14, 14, 32])
  setupPrint(ws)
  addHeaderBlock(ws, 'Export Interventions', ctx, ncols)
  spacer(ws, 6)

  const terminees = interventions.filter(i => i.statut === 'termine').length
  const enCours   = interventions.filter(i => i.statut === 'en_cours').length
  const annulees  = interventions.filter(i => i.statut === 'annule').length
  const totalTTC  = interventions.reduce((s, i) => s + (i.montant_ttc || 0), 0)

  addKpiCards(ws, [
    { icon: '🚨', label: 'Total interventions', value: interventions.length, ...K.blue    },
    { icon: '💰', label: 'Montant TTC total',   value: eur(totalTTC),        ...K.green   },
    { icon: '✅', label: 'Terminees',           value: terminees,             ...K.emerald },
    { icon: '🔄', label: 'En cours',            value: enCours,               ...K.amber   },
    { icon: '⚪', label: 'Annulees',            value: annulees,              ...K.gray    },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  interventions.forEach((inter, i) => {
    const client = inter.client as any
    const interv = inter.intervenant as any
    const row = addDataRow(ws, [
      inter.numero || '-',
      fmtD(inter.created_at),
      client ? `${client.nom || ''} ${client.prenom || ''}`.trim() : '-',
      client?.telephone || '-',
      inter.adresse || '-',
      interv ? `${interv.prenom || ''} ${interv.nom || ''}`.trim() : '-',
      inter.type || '-',
      L_INTER[inter.statut] || inter.statut,
      inter.montant_ttc || 0,
      inter.description || '-',
    ], i % 2 === 0)
    styleStatus(ws, row.number, 8, inter.statut === 'accepte' ? 'accepte_inter' : inter.statut)
    styleMoney(ws, row.number, 9)
    styleDate(ws, row.number, 2)
  })

  const tr = addTotalsRow(ws, ['TOTAUX', '', '', '', '', '', '', `${terminees} terminee(s)`, totalTTC, ''])
  styleMoney(ws, tr.number, 9)
}

// ── Feuille Journal ───────────────────────────────────────────────────────────

function extractNv(j: JournalEntry) {
  const nv = (j.new_value || {}) as Record<string, any>
  const ov = (j.old_value || {}) as Record<string, any>
  const get = (k: string) => nv[k] ?? ov[k] ?? ''
  return {
    numero:      get('numero'),
    statut:      get('statut') || get('statut_paiement'),
    client:      [get('nom'), get('prenom')].filter(Boolean).join(' ') || get('client_nom'),
    email:       get('email'),
    telephone:   get('telephone'),
    adresse:     get('adresse_intervention') || get('adresse'),
    montant:     get('total_ttc') || get('montant_ttc') || get('montant') || 0,
    type:        get('type'),
    description: get('description'),
  }
}

function sheetJournal(wb: any, journal: JournalEntry[], ctx: ExportContext) {
  const ws = wb.addWorksheet('Journal')
  const headers = ['Date', 'Heure', 'Utilisateur', 'Action', 'Table', 'N° Document', 'Statut', 'Client', 'Email', 'Telephone', 'Adresse', 'Montant TTC', 'Type', 'Description', 'Note']
  const ncols = headers.length

  colWidths(ws, [12, 8, 18, 16, 14, 14, 12, 20, 24, 14, 28, 14, 12, 28, 28])
  setupPrint(ws)
  addHeaderBlock(ws, "Journal d'activite", ctx, ncols)
  spacer(ws, 6)

  const creations = journal.filter(j => j.action === 'creation').length
  const modifs    = journal.filter(j => j.action === 'modification').length
  const supps     = journal.filter(j => j.action === 'suppression').length
  const paims     = journal.filter(j => j.action === 'paiement').length

  addKpiCards(ws, [
    { icon: '📋', label: 'Total entrees',  value: journal.length, ...K.blue    },
    { icon: '✅', label: 'Creations',      value: creations,      ...K.emerald },
    { icon: '✏️', label: 'Modifications', value: modifs,         ...K.blue    },
    { icon: '🗑️', label: 'Suppressions',  value: supps,          ...K.red     },
    { icon: '💵', label: 'Paiements',      value: paims,          ...K.green   },
  ], ncols)

  spacer(ws, 10)
  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

  journal.forEach((j, idx) => {
    const f = extractNv(j)
    const d = new Date(j.created_at)
    const row = addDataRow(ws, [
      d.toLocaleDateString('fr-FR'),
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      j.user_nom || '-',
      L_ACTION[j.action] || j.action,
      L_TABLE[j.table_name] || j.table_name,
      f.numero || '-',
      f.statut || '-',
      f.client || '-',
      f.email || '-',
      f.telephone || '-',
      f.adresse || '-',
      f.montant || 0,
      f.type || '-',
      f.description || '-',
      j.description || '-',
    ], idx % 2 === 0)
    styleStatus(ws, row.number, 4, j.action)
    if (typeof f.montant === 'number' && f.montant > 0) styleMoney(ws, row.number, 12)
    styleDate(ws, row.number, 1)
  })

  addTotalsRow(ws, [`${journal.length} entree(s)`, ...Array(ncols - 1).fill('')])
}

// ── Feuille Dashboard ultra-premium ──────────────────────────────────────────

function sheetDashboard(wb: any, data: AllExportData, ctx: ExportContext) {
  const ws = wb.addWorksheet('Dashboard')
  const ncols = 6
  const empresa = ctx.params?.raison_sociale || 'Kaytek Inter'
  const user = ctx.user ? `${ctx.user.prenom} ${ctx.user.nom}` : null

  colWidths(ws, [18, 18, 14, 18, 18, 14])
  setupPrint(ws)

  // ── Grand titre dashboard ──
  ws.addRow(Array(ncols).fill(''))
  const rt = ws.lastRow; rt.height = 50
  ws.mergeCells(rt.number, 1, rt.number, ncols)
  const ct = ws.getCell(rt.number, 1)
  ct.value = 'KAYTEK INTER'
  ct.font = { name: 'Calibri', bold: true, size: 26, color: { argb: argb(P.headerText) } }
  ct.fill = solidFill(P.headerBg)
  ct.alignment = { vertical: 'middle', horizontal: 'center' }

  ws.addRow(Array(ncols).fill(''))
  const rs = ws.lastRow; rs.height = 26
  ws.mergeCells(rs.number, 1, rs.number, ncols)
  const cs = ws.getCell(rs.number, 1)
  cs.value = 'TABLEAU DE BORD'
  cs.font = fnt({ bold: true, size: 14, color: 'BFD3E8' })
  cs.fill = solidFill(P.subBg)
  cs.alignment = { vertical: 'middle', horizontal: 'center' }

  ws.addRow(Array(ncols).fill(''))
  const rm = ws.lastRow; rm.height = 18
  ws.mergeCells(rm.number, 1, rm.number, ncols)
  const cm = ws.getCell(rm.number, 1)
  const meta = [empresa, user ? `Par : ${user}` : null, `${todayFull()}`].filter(Boolean).join('   |   ')
  cm.value = meta
  cm.font = fnt({ italic: true, size: 9, color: '8EB5D4' })
  cm.fill = solidFill(P.subBg)
  cm.alignment = { vertical: 'middle', horizontal: 'center' }

  ws.addRow(Array(ncols).fill(''))
  const rAcc = ws.lastRow; rAcc.height = 4
  ws.mergeCells(rAcc.number, 1, rAcc.number, ncols)
  ws.getCell(rAcc.number, 1).fill = solidFill(P.accentBlue)

  spacer(ws, 10)

  const devis        = data.devis        || []
  const factures     = data.factures     || []
  const clients      = data.clients      || []
  const commissions  = data.commissions  || []
  const journal      = data.journal      || []
  const interventions = data.interventions || []

  // ── Devis ──
  if (devis.length > 0) {
    const totalHT  = devis.reduce((s, d) => s + (d.total_ht  || 0), 0)
    const totalTTC = devis.reduce((s, d) => s + (d.total_ttc || 0), 0)
    const acceptes = devis.filter(d => d.statut === 'accepte').length
    const envoyes  = devis.filter(d => d.statut === 'envoye').length
    const taux     = `${(devis.length ? acceptes / devis.length * 100 : 0).toFixed(1)} %`
    addSectionHeader(ws, 'Devis', ncols)
    addKpiCards(ws, [
      { icon: '📄', label: 'Total devis',        value: devis.length,  ...K.blue    },
      { icon: '💰', label: 'Total TTC',           value: eur(totalTTC), ...K.green   },
      { icon: '📊', label: "Taux d'acceptation", value: taux,          ...K.amber   },
      { icon: '✅', label: 'Acceptes',            value: acceptes,      ...K.emerald },
      { icon: '📬', label: 'Envoyes',             value: envoyes,       ...K.blue    },
      { icon: '💵', label: 'Total HT',            value: eur(totalHT),  ...K.slate   },
    ], ncols)
    spacer(ws, 10)
  }

  // ── Factures ──
  if (factures.length > 0) {
    const caTTC    = factures.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const payees   = factures.filter(f => f.statut_paiement === 'payee')
    const impayees = factures.filter(f => f.statut_paiement === 'impayee')
    const montPaye = payees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const montImp  = impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const panier   = payees.length ? montPaye / payees.length : 0
    addSectionHeader(ws, 'Factures', ncols)
    addKpiCards(ws, [
      { icon: '🧾', label: 'Total factures', value: factures.length, ...K.blue    },
      { icon: '💰', label: 'CA TTC',         value: eur(caTTC),      ...K.green   },
      { icon: '✅', label: 'Payees',         value: payees.length,   ...K.emerald },
      { icon: '💵', label: 'Montant paye',   value: eur(montPaye),   ...K.emerald },
      { icon: '⚠️', label: 'Impayees',      value: impayees.length, ...K.red     },
      { icon: '📈', label: 'Panier moyen',   value: eur(panier),     ...K.amber   },
    ], ncols)
    spacer(ws, 10)

    // Mini-table répartition factures
    if (impayees.length > 0) {
      addSectionHeader(ws, 'Repartition factures', ncols)
      const hdrRow = addHeaderRow(ws, ['Statut', 'Nombre', 'Montant TTC', '', '', ''])
      autofilter(ws, hdrRow, 3)
      const statGroups = [
        { label: 'Payees',   count: payees.length,   amount: montPaye },
        { label: 'Impayees', count: impayees.length, amount: montImp  },
      ]
      statGroups.forEach((g, i) => {
        const row = addDataRow(ws, [g.label, g.count, g.amount, '', '', ''], i % 2 === 0)
        styleMoney(ws, row.number, 3)
      })
      spacer(ws, 10)
    }
  }

  // ── Clients + Interventions ──
  if (clients.length > 0 || interventions.length > 0) {
    addSectionHeader(ws, 'Clients & Interventions', ncols)
    const cards: KpiCard[] = []
    if (clients.length > 0) {
      const part = clients.filter(c => c.type === 'particulier').length
      cards.push({ icon: '👥', label: 'Total clients',  value: clients.length, ...K.blue   })
      cards.push({ icon: '🏢', label: 'Professionnels', value: clients.length - part, ...K.purple })
    }
    if (interventions.length > 0) {
      const terminees = interventions.filter(i => i.statut === 'termine').length
      const enCours   = interventions.filter(i => i.statut === 'en_cours').length
      const totalTTC  = interventions.reduce((s, i) => s + (i.montant_ttc || 0), 0)
      cards.push({ icon: '🚨', label: 'Interventions', value: interventions.length, ...K.blue    })
      cards.push({ icon: '💰', label: 'Montant TTC',   value: eur(totalTTC),        ...K.green   })
      cards.push({ icon: '✅', label: 'Terminees',     value: terminees,             ...K.emerald })
      cards.push({ icon: '🔄', label: 'En cours',      value: enCours,               ...K.amber   })
    }
    addKpiCards(ws, cards, ncols)
    spacer(ws, 10)
  }

  // ── Commissions ──
  if (commissions.length > 0) {
    const caTTC    = commissions.reduce((s, c) => s + c.montant_ttc, 0)
    const commTot  = commissions.reduce((s, c) => s + c.commission_intervenant, 0)
    const resteTot = commissions.reduce((s, c) => s + c.reste_entreprise, 0)
    const recues   = commissions.filter(c => c.recue).length
    addSectionHeader(ws, 'Commissions', ncols)
    addKpiCards(ws, [
      { icon: '💰', label: 'CA TTC facture',  value: eur(caTTC),    ...K.green   },
      { icon: '💼', label: 'Commissions dues', value: eur(commTot),  ...K.blue    },
      { icon: '🏢', label: 'Reste entreprise', value: eur(resteTot), ...K.emerald },
      { icon: '✅', label: 'Comm. recues',     value: `${recues} / ${commissions.length}`, ...K.emerald },
    ], ncols)
    spacer(ws, 10)
  }

  // ── Journal ──
  if (journal.length > 0) {
    const cre  = journal.filter(j => j.action === 'creation').length
    const mod  = journal.filter(j => j.action === 'modification').length
    const supp = journal.filter(j => j.action === 'suppression').length
    addSectionHeader(ws, "Journal d'activite", ncols)
    addKpiCards(ws, [
      { icon: '📋', label: 'Total entrees',  value: journal.length, ...K.blue    },
      { icon: '✅', label: 'Creations',      value: cre,            ...K.emerald },
      { icon: '✏️', label: 'Modifications', value: mod,            ...K.blue    },
      { icon: '🗑️', label: 'Suppressions',  value: supp,           ...K.red     },
    ], ncols)
  }
}

// ── Feuille Synthèse mensuelle ─────────────────────────────────────────────────

function sheetSynthese(wb: any, data: AllExportData, ctx: ExportContext) {
  const ws = wb.addWorksheet('Synthese mensuelle')
  const devis        = data.devis        || []
  const factures     = data.factures     || []
  const interventions = data.interventions || []
  const commissions  = data.commissions  || []
  const headers = ['Mois', 'Interventions', 'Devis', 'Devis acceptes', 'Factures', 'Fact. payees', 'CA TTC', 'Commissions', 'Reste entreprise']
  const ncols = headers.length

  colWidths(ws, [18, 14, 10, 14, 10, 14, 14, 14, 18])
  setupPrint(ws)
  addHeaderBlock(ws, 'Synthese mensuelle', ctx, ncols)
  spacer(ws, 10)

  const hRow = addHeaderRow(ws, headers)
  freeze(ws, hRow)
  autofilter(ws, hRow, ncols)

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

    const nbInter   = interventions.filter(i => inR(i.created_at)).length
    const nbDevis   = devis.filter(d => inR(d.created_at)).length
    const nbDevisOk = devis.filter(d => inR(d.created_at) && d.statut === 'accepte').length
    const nbFact    = factures.filter(f => inR(f.created_at)).length
    const payeesM   = factures.filter(f => f.statut_paiement === 'payee' && !!f.date_paiement && inR(f.date_paiement))
    const caFact    = payeesM.reduce((s, f) => s + (f.montant_ttc || 0), 0)
    const commM     = commissions.filter(c => !!c.date_paiement && inR(c.date_paiement))
    const commInt   = commM.reduce((s, c) => s + c.commission_intervenant, 0)
    const reste     = commM.reduce((s, c) => s + c.reste_entreprise, 0)

    const label = mStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const row = addDataRow(ws, [
      label.charAt(0).toUpperCase() + label.slice(1),
      nbInter, nbDevis, nbDevisOk, nbFact, payeesM.length, caFact, commInt, reste,
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
  if ((data.devis?.length        || 0) > 0) sheetDevis(wb, data.devis!, ctx)
  if ((data.factures?.length     || 0) > 0) sheetFactures(wb, data.factures!, ctx)
  if ((data.clients?.length      || 0) > 0) sheetClients(wb, data.clients!, ctx)
  if ((data.commissions?.length  || 0) > 0) sheetCommissions(wb, data.commissions!, ctx)
  if ((data.interventions?.length || 0) > 0) sheetInterventions(wb, data.interventions!, ctx)
  if ((data.journal?.length      || 0) > 0) sheetJournal(wb, data.journal!, ctx)
  sheetSynthese(wb, data, ctx)
  downloadBuffer(await wb.xlsx.writeBuffer(), `rapport-complet-${new Date().toISOString().split('T')[0]}.xlsx`)
}
