// src/lib/pdf/generator.ts
import { pdf, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Devis, Facture, ParametresEntreprise } from '@/types'

const fmt = (d?: string) => { try { return d ? format(new Date(d), 'dd/MM/yyyy', { locale: fr }) : '-' } catch { return '-' } }
const eur = (n?: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const S = StyleSheet.create({
  page:    { padding: 44, fontFamily: 'Helvetica', fontSize: 9, color: '#111' },
  row:     { flexDirection: 'row', justifyContent: 'space-between' },
  bold:    { fontFamily: 'Helvetica-Bold' },
  muted:   { fontSize: 8, color: '#666', lineHeight: 1.6 },
  title:   { fontSize: 22, fontFamily: 'Helvetica-Bold' },
  th:      { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  tdRow:   { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', fontSize: 9 },
  tRow:    { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginBottom: 3 },
  tLabel:  { fontSize: 9, color: '#666', width: 90, textAlign: 'right' },
  tVal:    { fontSize: 9, width: 70, textAlign: 'right' },
  sigBox:  { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, marginTop: 14, height: 70 },
  footer:  { position: 'absolute', bottom: 28, left: 44, right: 44 },
  ftxt:    { fontSize: 7, color: '#999', textAlign: 'center', lineHeight: 1.5, borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingTop: 7 }
})

const THEMES: Record<number, { bg: string; fg: string; accent: string }> = {
  0: { bg: '#f0f0f2', fg: '#111', accent: '#111' },
  1: { bg: '#2563eb', fg: '#fff', accent: '#2563eb' },
  2: { bg: '#111',   fg: '#fff', accent: '#111' },
  3: { bg: '#ea580c',fg: '#fff', accent: '#ea580c' },
  4: { bg: '#16a34a',fg: '#fff', accent: '#16a34a' }
}

function Lines({ lignes }: { lignes: Devis['lignes'] }) {
  return (
    <View style={{ marginVertical: 12 }}>
      <View style={[S.row, { paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: '#ddd' }]}>
        <Text style={[S.th, { flex: 1 }]}>Designation</Text>
        <Text style={[S.th, { width: 34, textAlign: 'center' }]}>Qte</Text>
        <Text style={[S.th, { width: 60, textAlign: 'right' }]}>P.U. HT</Text>
        <Text style={[S.th, { width: 34, textAlign: 'center' }]}>TVA</Text>
        <Text style={[S.th, { width: 64, textAlign: 'right' }]}>TTC</Text>
      </View>
      {lignes.map((l, i) => (
        <View key={i} style={[S.tdRow, i % 2 === 1 ? { backgroundColor: '#fafafa' } : {}]}>
          <Text style={{ flex: 1 }}>{l.description}</Text>
          <Text style={{ width: 34, textAlign: 'center' }}>{l.quantite}</Text>
          <Text style={{ width: 60, textAlign: 'right' }}>{eur(l.prix_ht)}</Text>
          <Text style={{ width: 34, textAlign: 'center' }}>{l.tva_pct}%</Text>
          <Text style={[S.bold, { width: 64, textAlign: 'right' }]}>{eur(l.total_ttc)}</Text>
        </View>
      ))}
    </View>
  )
}

function Totals({ ht, tva, remisePct, remise, ttc, accent }: { ht: number; tva: number; remisePct?: number; remise?: number; ttc: number; accent: string }) {
  return (
    <View style={{ alignItems: 'flex-end', marginTop: 8 }}>
      <View style={S.tRow}><Text style={S.tLabel}>Sous-total HT</Text><Text style={S.tVal}>{eur(ht)}</Text></View>
      <View style={S.tRow}><Text style={S.tLabel}>TVA</Text><Text style={S.tVal}>{eur(tva)}</Text></View>
      {!!remisePct && (
        <View style={S.tRow}>
          <Text style={[S.tLabel, { color: '#dc2626' }]}>Remise ({remisePct}%)</Text>
          <Text style={[S.tVal, { color: '#dc2626' }]}>-{eur(remise)}</Text>
        </View>
      )}
      <View style={[S.tRow, { paddingTop: 5, borderTopWidth: 1, borderTopColor: '#ddd', marginTop: 4 }]}>
        <Text style={[S.tLabel, S.bold, { fontSize: 11 }]}>Total TTC</Text>
        <Text style={[S.tVal, S.bold, { fontSize: 14, color: accent }]}>{eur(ttc)}</Text>
      </View>
    </View>
  )
}

export async function generateDevisPDF(devis: Devis, params: ParametresEntreprise, modeleId = 0): Promise<Blob> {
  const { bg, fg, accent } = THEMES[modeleId] || THEMES[0]
  const muteColor = fg === '#fff' ? 'rgba(255,255,255,0.72)' : '#666'
  const doc = (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={[S.row, { backgroundColor: bg, margin: -44, padding: 44, marginBottom: 20 }]}>
          <View>
            {params.logo_url ? <Image src={params.logo_url} style={{ width: 46, height: 46, borderRadius: 8 }} /> : null}
            <Text style={[S.bold, { fontSize: 13, color: fg, marginTop: 8 }]}>{params.raison_sociale}</Text>
            <Text style={[S.muted, { color: muteColor }]}>
              {params.adresse}{'\n'}{params.code_postal} {params.ville}{'\n'}SIRET: {params.siret}
            </Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={[S.title, { color: fg }]}>DEVIS</Text>
            <Text style={[S.muted, { color: muteColor, textAlign: 'right' }]}>
              {devis.numero}{'\n'}{fmt(devis.created_at)}
              {devis.valide_jusqu_au ? '\nValable jusqu au ' + fmt(devis.valide_jusqu_au) : ''}
            </Text>
          </View>
        </View>
        <View style={[S.row, { marginBottom: 16 }]}>
          <View>
            <Text style={[S.muted, { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }]}>Client</Text>
            <Text style={S.bold}>{devis.client?.nom} {devis.client?.prenom}</Text>
            <Text style={S.muted}>{devis.client?.telephone}{'\n'}{devis.client?.email}{'\n'}{devis.client?.adresse_intervention}</Text>
          </View>
          {devis.intervenant ? (
            <View style={{ textAlign: 'right' }}>
              <Text style={[S.muted, { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }]}>Intervenant</Text>
              <Text style={[S.bold, { textAlign: 'right' }]}>{devis.intervenant.prenom} {devis.intervenant.nom}</Text>
            </View>
          ) : null}
        </View>
        <Lines lignes={devis.lignes} />
        <Totals ht={devis.total_ht} tva={devis.tva_montant} remisePct={devis.remise_pct} remise={devis.remise_montant} ttc={devis.total_ttc} accent={accent} />
        {devis.notes ? (
          <View style={{ backgroundColor: '#f7f7f7', borderRadius: 6, padding: 10, marginTop: 12 }}>
            <Text style={[S.muted, { marginBottom: 3 }]}>Notes</Text>
            <Text style={{ fontSize: 9 }}>{devis.notes}</Text>
          </View>
        ) : null}
        <View style={S.sigBox}>
          <Text style={S.muted}>Signature client - bon pour accord</Text>
          {devis.signature_url ? (
            <>
              <Image src={devis.signature_url} style={{ height: 38, marginTop: 4 }} />
              <Text style={[S.muted, { marginTop: 3 }]}>Signe le {fmt(devis.signe_le)}</Text>
            </>
          ) : (
            <Text style={[S.muted, { marginTop: 10, color: '#bbb' }]}>A signer</Text>
          )}
        </View>
        <View style={S.footer}>
          <Text style={S.ftxt}>{[params.cgv, params.rc_pro ? 'RC Pro: ' + params.rc_pro : ''].filter(Boolean).join(' - ')}</Text>
        </View>
      </Page>
    </Document>
  )
  return pdf(doc).toBlob()
}

export async function generateFacturePDF(facture: Facture, devis: Devis | null, params: ParametresEntreprise): Promise<Blob> {
  const lignes = devis?.lignes || []
  const doc = (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={[S.row, { marginBottom: 20 }]}>
          <View>
            {params.logo_url ? <Image src={params.logo_url} style={{ width: 46, height: 46, borderRadius: 8 }} /> : null}
            <Text style={[S.bold, { fontSize: 13, marginTop: 8 }]}>{params.raison_sociale}</Text>
            <Text style={S.muted}>{params.adresse} - {params.code_postal} {params.ville}{'\n'}SIRET: {params.siret}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={S.title}>FACTURE</Text>
            <Text style={[S.muted, { textAlign: 'right' }]}>
              {facture.numero}{'\n'}Date: {fmt(facture.date_emission)}
              {facture.date_echeance ? '\nEcheance: ' + fmt(facture.date_echeance) : ''}
            </Text>
          </View>
        </View>
        <View style={[S.row, { marginBottom: 16 }]}>
          <View>
            <Text style={[S.muted, { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }]}>Facture a</Text>
            <Text style={S.bold}>{facture.client?.nom} {facture.client?.prenom}</Text>
            <Text style={S.muted}>{facture.client?.telephone}{'\n'}{facture.client?.email}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={[S.muted, { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }]}>Statut</Text>
            <Text style={[S.bold, { color: facture.statut_paiement === 'payee' ? '#16a34a' : '#dc2626', textAlign: 'right' }]}>
              {facture.statut_paiement === 'payee' ? 'PAYEE' : facture.statut_paiement.toUpperCase()}
            </Text>
          </View>
        </View>
        {lignes.length > 0 ? <Lines lignes={lignes} /> : null}
        <Totals ht={devis?.total_ht || facture.montant_ht} tva={devis?.tva_montant || facture.tva_montant} ttc={facture.montant_ttc} accent="#111" />
        {params.iban ? (
          <View style={{ backgroundColor: '#f7f7f7', borderRadius: 6, padding: 10, marginTop: 12 }}>
            <Text style={[S.muted, { marginBottom: 3 }]}>Coordonnees bancaires</Text>
            <Text style={{ fontSize: 9 }}>IBAN: {params.iban}{params.bic ? '  BIC: ' + params.bic : ''}</Text>
          </View>
        ) : null}
        <View style={S.footer}><Text style={S.ftxt}>{params.cgv || ''}</Text></View>
      </Page>
    </Document>
  )
  return pdf(doc).toBlob()
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
