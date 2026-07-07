// src/pages/DeleteAccountPage.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import KaytekLogo from '@/components/KaytekLogo'

const CONTACT_EMAIL = 'contact@kaytekinter.fr'

const S: Record<string, React.CSSProperties> = {
  section: { marginBottom: 32 },
  divider: { borderTop: '1px solid #f1f5f9', margin: '0 0 32px 0' },
  h2: { fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 10, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 },
  badge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', fontSize: 13, flexShrink: 0 },
  p: { fontSize: 14, color: '#475569', lineHeight: 1.75, margin: '0 0 10px 0' },
  ul: { margin: '8px 0', paddingLeft: 20, fontSize: 14, color: '#475569', lineHeight: 1.75 },
}

function langTab(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: active ? 700 : 400,
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    color: active ? '#2563eb' : '#94a3b8',
    cursor: 'pointer', fontFamily: 'inherit',
  }
}

function Section({ n, icon, title, children }: { n: number; icon: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <div style={S.section}>
        <h2 style={S.h2}>
          <span style={S.badge}>{n}</span>
          <span style={{ fontSize: 16 }}>{icon}</span>
          {title}
        </h2>
        {children}
      </div>
      <div style={S.divider} />
    </>
  )
}

function CheckList({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {items.map(item => (
        <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 13px', background: '#f8fafc', borderRadius: 9 }}>
          <span style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
          <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{item}</span>
        </div>
      ))}
    </div>
  )
}

function WarningList({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {items.map(item => (
        <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 13px', background: '#fffbeb', borderRadius: 9, border: '1px solid #fde68a' }}>
          <span style={{ color: '#d97706', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>!</span>
          <span style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>{item}</span>
        </div>
      ))}
    </div>
  )
}

function FrContent() {
  return (
    <>
      <Section n={1} icon="✉️" title="Comment demander la suppression">
        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '16px 18px', marginBottom: 12 }}>
          <p style={{ ...S.p, margin: 0, fontWeight: 500, color: '#1e40af' }}>
            Pour demander la suppression de votre compte Kaytek Inter et des données associées,
            envoyez un email à{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#2563eb', fontWeight: 700 }}>
              {CONTACT_EMAIL}
            </a>
            {' '}avec l'objet : <strong>Suppression de compte</strong>.
          </p>
        </div>
        <p style={S.p}>
          Nous vous confirmerons la prise en charge de votre demande dans les meilleurs délais.
          Votre compte sera supprimé dans un délai maximum de <strong>30 jours</strong>.
        </p>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Suppression%20de%20compte`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 20px', borderRadius: 10,
            background: '#2563eb', color: '#fff',
            fontSize: 14, fontWeight: 700, textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(37,99,235,.25)',
          }}
        >
          ✉️ Envoyer la demande par email
        </a>
      </Section>

      <Section n={2} icon="🗑" title="Données supprimées sur demande">
        <p style={S.p}>
          Lors de la suppression de votre compte, les données suivantes seront définitivement effacées :
        </p>
        <CheckList items={[
          'Compte utilisateur et identifiants de connexion',
          'Profil utilisateur (nom, prénom, email, téléphone)',
          'Messages internes envoyés et reçus',
          'Photos d\'intervention liées au compte',
          'Fichiers et documents attachés au compte lorsque c\'est possible',
          'Tokens de notifications push',
          'Appareils enregistrés',
        ]} />
      </Section>

      <Section n={3} icon="📋" title="Données conservées pour obligations légales">
        <p style={S.p}>
          Certaines données peuvent être conservées au-delà de la suppression du compte
          afin de respecter nos obligations légales et fiscales :
        </p>
        <WarningList items={[
          'Factures émises — conservées 10 ans (obligation légale française)',
          'Devis et documents comptables — conservés 10 ans',
          'Historiques nécessaires aux obligations fiscales ou légales en vigueur',
        ]} />
        <p style={{ ...S.p, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
          Ces données sont conservées uniquement dans le strict respect du Code de commerce français
          et du RGPD (article 17, alinéa 3).
        </p>
      </Section>

      <Section n={4} icon="⏱" title="Délai de traitement">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
          <span style={{ fontSize: 32, flexShrink: 0 }}>30</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>jours maximum</div>
            <div style={{ fontSize: 13, color: '#15803d', marginTop: 2 }}>à compter de la réception de votre demande</div>
          </div>
        </div>
        <p style={{ ...S.p, marginTop: 12 }}>
          Un email de confirmation vous sera envoyé à l'issue du traitement de votre demande.
        </p>
      </Section>

      <div style={S.section}>
        <h2 style={S.h2}>
          <span style={S.badge}>5</span>
          <span style={{ fontSize: 16 }}>📬</span>
          Contact
        </h2>
        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
            Pour toute question relative à la suppression de vos données :
          </div>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontSize: 15, fontWeight: 700, color: '#2563eb', textDecoration: 'none' }}>
            {CONTACT_EMAIL}
          </a>
        </div>
        <p style={{ ...S.p, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
          Vous pouvez également exercer vos droits auprès de la <strong>CNIL</strong> (Commission Nationale
          de l'Informatique et des Libertés) — www.cnil.fr
        </p>
      </div>
    </>
  )
}

function EnContent() {
  return (
    <>
      <Section n={1} icon="✉️" title="How to request account deletion">
        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '16px 18px', marginBottom: 12 }}>
          <p style={{ ...S.p, margin: 0, fontWeight: 500, color: '#1e40af' }}>
            To request deletion of your Kaytek Inter account and associated data, please email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#2563eb', fontWeight: 700 }}>
              {CONTACT_EMAIL}
            </a>
            {' '}with the subject: <strong>Account deletion request</strong>.
          </p>
        </div>
        <p style={S.p}>
          We will confirm receipt of your request as soon as possible.
          Your account will be deleted within a maximum of <strong>30 days</strong>.
        </p>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Account%20deletion%20request`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 20px', borderRadius: 10,
            background: '#2563eb', color: '#fff',
            fontSize: 14, fontWeight: 700, textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(37,99,235,.25)',
          }}
        >
          ✉️ Send deletion request by email
        </a>
      </Section>

      <Section n={2} icon="🗑" title="Data deleted upon request">
        <p style={S.p}>
          Upon account deletion, the following data will be permanently erased:
        </p>
        <CheckList items={[
          'User account and login credentials',
          'User profile (name, email, phone number)',
          'Internal messages sent and received',
          'Intervention photos linked to the account',
          'Files and documents attached to the account where possible',
          'Push notification tokens',
          'Registered devices',
        ]} />
      </Section>

      <Section n={3} icon="📋" title="Data retained for legal obligations">
        <p style={S.p}>
          Some data may be retained after account deletion to comply with our legal and fiscal obligations:
        </p>
        <WarningList items={[
          'Invoices — retained for 10 years (French legal obligation)',
          'Quotes and accounting documents — retained for 10 years',
          'Records required by applicable tax or legal obligations',
        ]} />
        <p style={{ ...S.p, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
          This data is retained solely in compliance with the French Commercial Code
          and GDPR (Article 17, paragraph 3).
        </p>
      </Section>

      <Section n={4} icon="⏱" title="Processing time">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
          <span style={{ fontSize: 32, flexShrink: 0 }}>30</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>days maximum</div>
            <div style={{ fontSize: 13, color: '#15803d', marginTop: 2 }}>from the date your request is received</div>
          </div>
        </div>
        <p style={{ ...S.p, marginTop: 12 }}>
          A confirmation email will be sent to you once your request has been processed.
        </p>
      </Section>

      <div style={S.section}>
        <h2 style={S.h2}>
          <span style={S.badge}>5</span>
          <span style={{ fontSize: 16 }}>📬</span>
          Contact
        </h2>
        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
            For any questions regarding the deletion of your data:
          </div>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontSize: 15, fontWeight: 700, color: '#2563eb', textDecoration: 'none' }}>
            {CONTACT_EMAIL}
          </a>
        </div>
        <p style={{ ...S.p, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
          You may also lodge a complaint with the French data protection authority
          (<strong>CNIL</strong>) at www.cnil.fr
        </p>
      </div>
    </>
  )
}

function BillingualCard() {
  const [lang, setLang] = useState<'fr' | 'en'>('fr')

  return (
    <div style={{
      background: '#fff', borderRadius: 16,
      boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 8px 32px rgba(0,0,0,0.05)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9' }}>
        <button onClick={() => setLang('fr')} style={langTab(lang === 'fr')}>
          🇫🇷 Français
        </button>
        <button onClick={() => setLang('en')} style={langTab(lang === 'en')}>
          🇬🇧 English
        </button>
      </div>
      <div style={{ padding: '28px 28px' }}>
        {lang === 'fr' ? <FrContent /> : <EnContent />}
      </div>
    </div>
  )
}

export default function DeleteAccountPage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <KaytekLogo size={26} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', flex: 1 }}>Kaytek Inter</span>
        <Link to="/login" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
          ← Se connecter
        </Link>
      </div>

      <div style={{ maxWidth: 740, margin: '0 auto', padding: '28px 16px 64px' }}>

        {/* Title card */}
        <div style={{
          background: '#fff', borderRadius: 16, padding: '28px 28px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 8px 32px rgba(0,0,0,0.05)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              🗑️
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: 0, letterSpacing: '-0.02em' }}>
                Suppression de compte
              </h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                Account deletion · Kaytek Inter
              </p>
            </div>
          </div>
          <p style={{ ...S.p, margin: 0, background: '#f8fafc', borderRadius: 10, padding: '12px 14px', borderLeft: '3px solid #2563eb' }}>
            Vous avez le droit de demander la suppression de votre compte et de vos données personnelles à tout moment.
            <br />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              You have the right to request deletion of your account and personal data at any time.
            </span>
          </p>
        </div>

        <BillingualCard />

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: '#cbd5e1' }}>
          © {new Date().getFullYear()} Kaytek Inter ·{' '}
          <a href="/confidentialite" style={{ color: '#94a3b8', textDecoration: 'none' }}>Confidentialité</a>
          {' · '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#94a3b8', textDecoration: 'none' }}>{CONTACT_EMAIL}</a>
        </div>
      </div>
    </div>
  )
}
