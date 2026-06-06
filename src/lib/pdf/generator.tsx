// src/lib/pdf/generator.tsx
import { pdf, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Devis, Facture, ParametresEntreprise } from '@/types'

const fmt = (d?: string) => { try { return d ? format(new Date(d), 'dd/MM/yyyy', { locale: fr }) : '—' } catch { return '—' } }
const eur = (n?: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

// ── THEMES ──────────────────────────────────────────────────────
const THEMES: Record<number, { primary: string; accent: string; accentDark: string }> = {
  0: { primary: '#1e3a5f', accent: '#e85d04', accentDark: '#c44b00' },   // Navy + Orange (modèle principal)
  1: { primary: '#1d4ed8', accent: '#f59e0b', accentDark: '#d97706' },   // Bleu + Ambre
  2: { primary: '#111827', accent: '#6366f1', accentDark: '#4f46e5' },   // Noir + Violet
  3: { primary: '#065f46', accent: '#10b981', accentDark: '#059669' },   // Vert
  4: { primary: '#6d28d9', accent: '#f97316', accentDark: '#ea580c' },   // Violet + Orange
}

const base = StyleSheet.create({
  page:    { fontFamily: 'Helvetica', fontSize: 9, color: '#1a1a1a', backgroundColor: '#fff' },
  bold:    { fontFamily: 'Helvetica-Bold' },
  row:     { flexDirection: 'row' },
  muted:   { fontSize: 8, color: '#6b7280', lineHeight: 1.7 },
  upper:   { textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 7 },
  footer:  { position: 'absolute', bottom: 24, left: 44, right: 44 },
  ftxt:    { fontSize: 7, color: '#9ca3af', textAlign: 'center', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6, lineHeight: 1.5 },
})

// ── HEADER ──────────────────────────────────────────────────────
function Header({ type, numero, date, valide, params, accent, primary }: {
  type: string; numero: string; date: string; valide?: string
  params: ParametresEntreprise; accent: string; primary: string
}) {
  return (
    <View style={{ margin: -44, marginBottom: 0 }}>
      {/* Bande principale */}
      <View style={[base.row, { backgroundColor: primary, minHeight: 100 }]}>
        {/* Gauche : infos société */}
        <View style={{ flex: 1, padding: 32, paddingRight: 20 }}>
          {params.logo_url
            ? <Image src={params.logo_url} style={{ width: 44, height: 44, borderRadius: 8, marginBottom: 10 }} />
            : <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: accent, marginBottom: 10, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={[base.bold, { color: '#fff', fontSize: 20 }]}>{(params.raison_sociale || 'K')[0]}</Text>
              </View>
          }
          <Text style={[base.bold, { color: '#fff', fontSize: 13, marginBottom: 3 }]}>{params.raison_sociale || 'Entreprise'}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 8, lineHeight: 1.6 }}>
            {params.adresse ? params.adresse + '\n' : ''}{params.code_postal} {params.ville}
            {params.siret ? '\nSIRET : ' + params.siret : ''}
          </Text>
        </View>
        {/* Droite : titre document + numéro */}
        <View style={{ width: 185, backgroundColor: 'rgba(0,0,0,0.18)', padding: 32, paddingLeft: 20, justifyContent: 'space-between' }}>
          <Text style={[base.bold, { color: '#fff', fontSize: 30, letterSpacing: 1 }]}>{type}</Text>
          <View>
            <View style={[base.row, { justifyContent: 'space-between', marginBottom: 3 }]}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 8 }}>Numéro</Text>
              <Text style={[base.bold, { color: '#fff', fontSize: 8 }]}>{numero}</Text>
            </View>
            <View style={[base.row, { justifyContent: 'space-between', marginBottom: 3 }]}>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 8 }}>Date</Text>
              <Text style={[base.bold, { color: '#fff', fontSize: 8 }]}>{date}</Text>
            </View>
            {valide && (
              <View style={[base.row, { justifyContent: 'space-between' }]}>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 8 }}>Valide jusqu'au</Text>
                <Text style={[base.bold, { color: accent, fontSize: 8 }]}>{valide}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      {/* Bande accent */}
      <View style={{ backgroundColor: accent, height: 5 }} />
    </View>
  )
}

// ── CLIENT SECTION ──────────────────────────────────────────────
function ClientSection({ clientNom, clientPhone, clientEmail, clientAdresse, right }: {
  clientNom: string; clientPhone?: string; clientEmail?: string; clientAdresse?: string
  right?: React.ReactNode
}) {
  return (
    <View style={[base.row, { marginTop: 24, marginBottom: 18, justifyContent: 'space-between' }]}>
      <View style={{ backgroundColor: '#f8fafc', borderRadius: 6, padding: 14, flex: 1, marginRight: 12, borderLeftWidth: 3, borderLeftColor: '#e85d04' }}>
        <Text style={[base.bold, base.upper, { color: '#6b7280', marginBottom: 6 }]}>Facturé à</Text>
        <Text style={[base.bold, { fontSize: 11, marginBottom: 3 }]}>{clientNom}</Text>
        {clientPhone && <Text style={base.muted}>{clientPhone}</Text>}
        {clientEmail && <Text style={base.muted}>{clientEmail}</Text>}
        {clientAdresse && <Text style={base.muted}>{clientAdresse}</Text>}
      </View>
      {right && <View style={{ width: 170 }}>{right}</View>}
    </View>
  )
}

// ── LIGNES TABLE ────────────────────────────────────────────────
function LignesTable({ lignes, accent, primary }: { lignes: Devis['lignes']; accent: string; primary: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      {/* Header */}
      <View style={[base.row, { backgroundColor: primary, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 10 }]}>
        <Text style={[base.bold, { color: '#fff', width: 26, fontSize: 8 }]}>N°</Text>
        <Text style={[base.bold, { color: '#fff', flex: 1, fontSize: 8 }]}>Désignation</Text>
        <Text style={[base.bold, { color: '#fff', width: 64, textAlign: 'right', fontSize: 8 }]}>P.U. HT</Text>
        <Text style={[base.bold, { color: '#fff', width: 32, textAlign: 'center', fontSize: 8 }]}>Qté</Text>
        <Text style={[base.bold, { color: '#fff', width: 44, textAlign: 'center', fontSize: 8 }]}>TVA</Text>
        <Text style={[base.bold, { color: accent, width: 64, textAlign: 'right', fontSize: 8 }]}>Total TTC</Text>
      </View>
      {/* Rows */}
      {lignes.map((l, i) => (
        <View key={i} style={[base.row, {
          paddingVertical: 7, paddingHorizontal: 10,
          backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc',
          borderBottomWidth: 1, borderBottomColor: '#e5e7eb'
        }]}>
          <Text style={{ width: 26, color: '#9ca3af', fontSize: 8 }}>{i + 1}</Text>
          <Text style={{ flex: 1 }}>{l.description}</Text>
          <Text style={{ width: 64, textAlign: 'right' }}>{eur(l.prix_ht)}</Text>
          <Text style={{ width: 32, textAlign: 'center', color: '#6b7280' }}>{l.quantite}</Text>
          <Text style={{ width: 44, textAlign: 'center', color: '#6b7280' }}>{l.tva_pct}%</Text>
          <Text style={[base.bold, { width: 64, textAlign: 'right' }]}>{eur(l.total_ttc)}</Text>
        </View>
      ))}
    </View>
  )
}

// ── TOTALS ──────────────────────────────────────────────────────
function Totals({ ht, tva, remisePct, remise, ttc, accent }: {
  ht: number; tva: number; remisePct?: number; remise?: number; ttc: number; accent: string
}) {
  return (
    <View style={{ alignItems: 'flex-end', marginBottom: 16 }}>
      <View style={{ width: 220, backgroundColor: '#f8fafc', borderRadius: 6, padding: 14 }}>
        <View style={[base.row, { justifyContent: 'space-between', marginBottom: 5 }]}>
          <Text style={base.muted}>Sous-total HT</Text>
          <Text>{eur(ht)}</Text>
        </View>
        <View style={[base.row, { justifyContent: 'space-between', marginBottom: 5 }]}>
          <Text style={base.muted}>TVA</Text>
          <Text>{eur(tva)}</Text>
        </View>
        {!!remisePct && (
          <View style={[base.row, { justifyContent: 'space-between', marginBottom: 5 }]}>
            <Text style={{ fontSize: 8, color: '#dc2626' }}>Remise ({remisePct}%)</Text>
            <Text style={{ color: '#dc2626' }}>-{eur(remise)}</Text>
          </View>
        )}
        <View style={[base.row, { justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1.5, borderTopColor: '#e5e7eb', marginTop: 4 }]}>
          <Text style={[base.bold, { fontSize: 11 }]}>Total TTC</Text>
          <Text style={[base.bold, { fontSize: 14, color: accent }]}>{eur(ttc)}</Text>
        </View>
      </View>
    </View>
  )
}

// ── DEVIS PDF ────────────────────────────────────────────────────
export async function generateDevisPDF(devis: Devis, params: ParametresEntreprise, modeleId = 0): Promise<Blob> {
  const { primary, accent } = THEMES[modeleId] || THEMES[0]
  const clientNom = [devis.client?.nom, devis.client?.prenom].filter(Boolean).join(' ') || '—'

  const doc = (
    <Document>
      <Page size="A4" style={[base.page, { padding: 44 }]}>
        <Header type="DEVIS" numero={devis.numero} date={fmt(devis.created_at)} valide={devis.valide_jusqu_au ? fmt(devis.valide_jusqu_au) : undefined} params={params} accent={accent} primary={primary} />

        <ClientSection
          clientNom={clientNom}
          clientPhone={devis.client?.telephone}
          clientEmail={devis.client?.email}
          clientAdresse={devis.client?.adresse_intervention}
          right={devis.intervenant ? (
            <View style={{ backgroundColor: '#f8fafc', borderRadius: 6, padding: 14, borderLeftWidth: 3, borderLeftColor: primary }}>
              <Text style={[base.bold, base.upper, { color: '#6b7280', marginBottom: 6 }]}>Intervenant</Text>
              <Text style={[base.bold, { fontSize: 10 }]}>{devis.intervenant.prenom} {devis.intervenant.nom}</Text>
            </View>
          ) : null}
        />

        {devis.lignes?.length > 0
          ? <LignesTable lignes={devis.lignes} accent={accent} primary={primary} />
          : <View style={{ padding: 20, backgroundColor: '#f8fafc', borderRadius: 6, marginBottom: 16 }}><Text style={base.muted}>Aucune ligne</Text></View>
        }

        <Totals ht={devis.total_ht} tva={devis.tva_montant} remisePct={devis.remise_pct} remise={devis.remise_montant} ttc={devis.total_ttc} accent={accent} />

        {/* Notes / Conditions — avant la signature */}
        {devis.notes?.trim() ? (
          <View style={{ backgroundColor: '#fefce8', borderRadius: 6, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#f59e0b' }}>
            <Text style={[base.bold, base.upper, { color: '#92400e', marginBottom: 6, fontSize: 8 }]}>Notes et conditions particulières</Text>
            <Text style={{ fontSize: 9, color: '#374151', lineHeight: 1.7 }}>{devis.notes.trim()}</Text>
          </View>
        ) : null}

        {/* Signature — signature_client (base64) stocké par DevisApercuPage */}
        {(() => {
          const d = devis as any
          const sigImg  = d.signature_client || devis.signature_url
          const sigDate = d.signature_date   || devis.signe_le
          const sigPar  = d.signe_par        || devis.signe_par
          return (
            <View style={{ borderWidth: 1, borderColor: sigImg ? '#86efac' : '#e5e7eb', borderRadius: 6, padding: 12, minHeight: 80, marginBottom: 14 }}>
              <Text style={[base.bold, base.upper, { color: '#6b7280', marginBottom: 6 }]}>Signature client — bon pour accord</Text>
              {sigImg
                ? <>
                    <Image src={sigImg} style={{ height: 52, marginTop: 4, objectFit: 'contain' }} />
                    <Text style={[base.muted, { marginTop: 4 }]}>
                      {'Signé le ' + fmt(sigDate) + (sigPar ? ' par ' + sigPar : '')}
                    </Text>
                  </>
                : <Text style={{ color: '#d1d5db', fontSize: 8, marginTop: 14 }}>À signer</Text>
              }
            </View>
          )
        })()}

        <View style={base.footer}>
          <Text style={base.ftxt}>{[params.cgv, params.rc_pro ? 'RC Pro : ' + params.rc_pro : ''].filter(Boolean).join('  ·  ')}</Text>
        </View>
      </Page>
    </Document>
  )
  return pdf(doc).toBlob()
}

// ── FACTURE PDF ──────────────────────────────────────────────────
export async function generateFacturePDF(facture: Facture, devis: Devis | null, params: ParametresEntreprise): Promise<Blob> {
  const { primary, accent } = THEMES[0]
  const lignes = devis?.lignes || []
  const clientNom = [facture.client?.nom, facture.client?.prenom].filter(Boolean).join(' ') || '—'
  const estPayee = facture.statut_paiement === 'payee'

  const doc = (
    <Document>
      <Page size="A4" style={[base.page, { padding: 44 }]}>
        <Header type="FACTURE" numero={facture.numero} date={fmt(facture.date_emission)} valide={facture.date_echeance ? 'Échéance : ' + fmt(facture.date_echeance) : undefined} params={params} accent={estPayee ? '#16a34a' : accent} primary={primary} />

        <ClientSection
          clientNom={clientNom}
          clientPhone={facture.client?.telephone}
          clientEmail={facture.client?.email}
          right={
            <View style={{ backgroundColor: estPayee ? '#dcfce7' : '#fef2f2', borderRadius: 6, padding: 14, borderLeftWidth: 3, borderLeftColor: estPayee ? '#16a34a' : '#dc2626' }}>
              <Text style={[base.bold, base.upper, { color: estPayee ? '#15803d' : '#991b1b', marginBottom: 6 }]}>Statut paiement</Text>
              <Text style={[base.bold, { fontSize: 12, color: estPayee ? '#16a34a' : '#dc2626' }]}>
                {estPayee ? '✓ PAYÉE' : facture.statut_paiement.toUpperCase()}
              </Text>
              {facture.date_paiement && <Text style={{ fontSize: 8, color: '#15803d', marginTop: 3 }}>le {fmt(facture.date_paiement)}</Text>}
              {facture.mode_paiement && <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>{facture.mode_paiement}</Text>}
            </View>
          }
        />

        {lignes.length > 0
          ? <LignesTable lignes={lignes} accent={estPayee ? '#16a34a' : accent} primary={primary} />
          : null
        }

        <Totals ht={devis?.total_ht ?? facture.montant_ht} tva={devis?.tva_montant ?? facture.tva_montant} ttc={facture.montant_ttc} accent={estPayee ? '#16a34a' : accent} />

        {/* Coordonnées bancaires */}
        {params.iban && (
          <View style={{ backgroundColor: '#f8fafc', borderRadius: 6, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: primary }}>
            <Text style={[base.bold, base.upper, { color: '#6b7280', marginBottom: 6 }]}>Coordonnées bancaires</Text>
            <Text style={{ fontSize: 9, lineHeight: 1.6 }}>
              IBAN : {params.iban}{params.bic ? '   ·   BIC : ' + params.bic : ''}
            </Text>
          </View>
        )}

        {/* Notes */}
        {facture.notes && (
          <View style={{ backgroundColor: '#fefce8', borderRadius: 6, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#f59e0b' }}>
            <Text style={[base.bold, base.upper, { color: '#92400e', marginBottom: 4 }]}>Notes</Text>
            <Text style={{ fontSize: 9, color: '#78350f', lineHeight: 1.6 }}>{facture.notes}</Text>
          </View>
        )}

        <View style={base.footer}>
          <Text style={base.ftxt}>{params.cgv || 'Merci pour votre confiance.'}</Text>
        </View>
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
