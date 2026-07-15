// src/pages/ConfidentialitePage.tsx
import { Link } from 'react-router-dom'
import KaytekLogo from '@/components/KaytekLogo'

const SECTION_STYLE: React.CSSProperties = {
  marginBottom: 32,
}

const H2_STYLE: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#1e293b',
  marginBottom: 10,
  marginTop: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const P_STYLE: React.CSSProperties = {
  fontSize: 14,
  color: '#475569',
  lineHeight: 1.75,
  margin: '0 0 10px 0',
}

const UL_STYLE: React.CSSProperties = {
  margin: '8px 0',
  paddingLeft: 20,
  fontSize: 14,
  color: '#475569',
  lineHeight: 1.75,
}

const BADGE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: '#eff6ff',
  color: '#2563eb',
  fontSize: 13,
  flexShrink: 0,
}

const DIVIDER_STYLE: React.CSSProperties = {
  borderTop: '1px solid #f1f5f9',
  margin: '0 0 32px 0',
}

export default function ConfidentialitePage() {
  const lastUpdate = '24 juin 2026'

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
        <Link
          to="/login"
          style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
        >
          ← Se connecter
        </Link>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 740, margin: '0 auto', padding: '28px 16px 64px' }}>

        {/* Title card */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: '28px 28px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 8px 32px rgba(0,0,0,0.05)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              🔒
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: 0, letterSpacing: '-0.02em' }}>
                Politique de confidentialité
              </h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                Dernière mise à jour : {lastUpdate}
              </p>
            </div>
          </div>
          <p style={{ ...P_STYLE, margin: 0, background: '#f8fafc', borderRadius: 10, padding: '12px 14px', borderLeft: '3px solid #2563eb' }}>
            Kaytek Inter s'engage à protéger la vie privée et les données personnelles de ses utilisateurs.
            Cette politique explique quelles données sont collectées, comment elles sont utilisées et quels sont vos droits.
          </p>
        </div>

        {/* Main card */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: '28px 28px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 8px 32px rgba(0,0,0,0.05)',
        }}>

          {/* 1. Responsable du traitement */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>1</span>
              Responsable du traitement
            </h2>
            <p style={P_STYLE}>
              Le responsable du traitement des données collectées via l'application Kaytek Inter est :
            </p>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#374151', lineHeight: 1.75 }}>
              <strong>Kaytek Inter</strong><br />
              Email : <a href="mailto:contact@kaytekinter.fr" style={{ color: '#2563eb', textDecoration: 'none' }}>contact@kaytekinter.fr</a><br />
              Site : kaytekinter.fr
            </div>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 2. Données collectées */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>2</span>
              Données personnelles collectées
            </h2>
            <p style={P_STYLE}>
              Dans le cadre de l'utilisation de l'application, nous collectons les données suivantes :
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '👤', label: 'Données d\'identité', detail: 'Nom, prénom' },
                { icon: '📧', label: 'Coordonnées', detail: 'Adresse email, numéro de téléphone' },
                { icon: '🔑', label: 'Informations de connexion', detail: 'Adresse email utilisée pour l\'authentification, mot de passe (chiffré)' },
                { icon: '🏠', label: 'Données clients', detail: 'Coordonnées des clients (nom, adresse, téléphone, email) saisies par les utilisateurs' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 10 }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 3. Comptes utilisateurs */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>3</span>
              Comptes utilisateurs
            </h2>
            <p style={P_STYLE}>
              L'accès à l'application nécessite la création d'un compte utilisateur. Ce compte est créé par l'administrateur de l'entreprise et associé à une adresse email professionnelle.
            </p>
            <ul style={UL_STYLE}>
              <li>Les comptes sont nominatifs et non partagés.</li>
              <li>Le mot de passe est chiffré et n'est jamais stocké en clair.</li>
              <li>L'application intègre une protection automatique contre les tentatives d'accès non autorisées.</li>
              <li>Une déconnexion automatique intervient après 30 minutes d'inactivité.</li>
              <li>La gestion des appareils autorisés est disponible dans le profil utilisateur (maximum 2 appareils actifs).</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 4. Photos d'interventions */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>4</span>
              Photos d'interventions
            </h2>
            <p style={P_STYLE}>
              L'application permet aux intervenants de joindre des photos lors de la réalisation de chantiers.
            </p>
            <ul style={UL_STYLE}>
              <li>Les photos sont stockées de façon sécurisée sur notre infrastructure (Supabase Storage).</li>
              <li>L'accès est strictement limité aux utilisateurs de l'entreprise autorisés.</li>
              <li>Les photos ne sont pas partagées publiquement ni utilisées à des fins commerciales.</li>
              <li>Elles peuvent contenir des images de lieux d'intervention (façades, portes, vitrages, etc.).</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 5. Documents PDF */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>5</span>
              Documents PDF (devis et factures)
            </h2>
            <p style={P_STYLE}>
              L'application génère et stocke des devis et factures au format PDF contenant des données personnelles (nom, adresse, coordonnées des clients).
            </p>
            <ul style={UL_STYLE}>
              <li>Ces documents sont accessibles via un lien sécurisé à usage unique, partageable avec le client concerné.</li>
              <li>Le lien de partage peut être révoqué à tout moment par l'administrateur.</li>
              <li>Les documents ne sont pas indexés par les moteurs de recherche.</li>
              <li>Les données figurant dans ces documents correspondent aux informations fournies par le client lors de la prise de commande.</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 6. Notifications push */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>6</span>
              Notifications push
            </h2>
            <p style={P_STYLE}>
              L'application peut envoyer des notifications push sur votre appareil afin de vous alerter d'événements importants (nouvelle intervention, message, etc.).
            </p>
            <ul style={UL_STYLE}>
              <li>L'activation des notifications push requiert votre consentement explicite.</li>
              <li>Vous pouvez désactiver les notifications à tout moment depuis les paramètres de votre navigateur ou appareil.</li>
              <li>Les tokens de notification sont associés à votre compte et à votre appareil. Ils sont supprimés lors de la déconnexion.</li>
              <li>Aucune donnée de localisation n'est collectée via les notifications.</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 7. Messagerie interne */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>7</span>
              Messagerie interne
            </h2>
            <p style={P_STYLE}>
              L'application dispose d'un système de messagerie interne permettant aux membres de l'équipe de communiquer entre eux.
            </p>
            <ul style={UL_STYLE}>
              <li>Les messages sont visibles uniquement par les participants de la conversation.</li>
              <li>Les messages sont stockés de façon sécurisée sur notre infrastructure.</li>
              <li>La messagerie est strictement réservée à l'usage professionnel interne de l'entreprise.</li>
              <li>Les messages ne sont ni analysés ni transmis à des tiers.</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 8. Hébergement */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>8</span>
              Hébergement des données
            </h2>
            <p style={P_STYLE}>
              L'ensemble des données de l'application est hébergé par <strong>Supabase</strong>, une plateforme cloud conforme aux standards de sécurité internationaux.
            </p>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#475569', lineHeight: 1.75 }}>
              <strong>Supabase, Inc.</strong> — Infrastructure cloud sécurisée<br />
              Les serveurs utilisés sont situés dans l'Union Européenne (région eu-central-1 – Francfort, Allemagne).<br />
              Supabase est conforme au RGPD et certifié SOC 2 Type II.
            </div>
            <p style={{ ...P_STYLE, marginTop: 10 }}>
              Les données ne sont pas revendues, partagées ou transmises à des tiers à des fins commerciales ou publicitaires.
            </p>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 9. Sécurité */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>9</span>
              Sécurité des données
            </h2>
            <p style={P_STYLE}>
              Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données :
            </p>
            <ul style={UL_STYLE}>
              <li>Chiffrement des communications via HTTPS (TLS 1.3).</li>
              <li>Authentification sécurisée avec protection contre les attaques par force brute.</li>
              <li>Contrôle d'accès basé sur les rôles (admin / intervenant).</li>
              <li>Isolation des données entre utilisateurs grâce aux politiques de sécurité au niveau des lignes (Row-Level Security).</li>
              <li>Mots de passe chiffrés avec bcrypt — jamais stockés en clair.</li>
              <li>Journalisation des actions sensibles pour détecter toute utilisation anormale.</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 10. Durée de conservation */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>10</span>
              Durée de conservation
            </h2>
            <p style={P_STYLE}>
              Les données sont conservées pour la durée nécessaire à la fourniture du service et au respect des obligations légales :
            </p>
            <ul style={UL_STYLE}>
              <li><strong>Comptes utilisateurs :</strong> conservés tant que le compte est actif.</li>
              <li><strong>Documents comptables (devis, factures) :</strong> conservés 10 ans conformément aux obligations légales françaises.</li>
              <li><strong>Photos d'interventions :</strong> conservées jusqu'à suppression explicite par un administrateur.</li>
              <li><strong>Messages :</strong> conservés tant que les utilisateurs concernés sont actifs.</li>
              <li><strong>Logs d'activité :</strong> conservés 12 mois.</li>
            </ul>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 11. Vos droits */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>11</span>
              Vos droits (RGPD)
            </h2>
            <p style={P_STYLE}>
              Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez des droits suivants :
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '👁', label: 'Droit d\'accès', detail: 'Obtenir une copie des données personnelles vous concernant.' },
                { icon: '✏️', label: 'Droit de rectification', detail: 'Corriger des données inexactes ou incomplètes.' },
                { icon: '🗑', label: 'Droit à l\'effacement', detail: 'Demander la suppression de vos données personnelles (« droit à l\'oubli »).' },
                { icon: '⏸', label: 'Droit à la limitation', detail: 'Limiter le traitement de vos données dans certains cas.' },
                { icon: '📦', label: 'Droit à la portabilité', detail: 'Recevoir vos données dans un format structuré et lisible par machine.' },
                { icon: '✋', label: 'Droit d\'opposition', detail: 'Vous opposer au traitement de vos données pour des motifs légitimes.' },
              ].map(right => (
                <div key={right.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{right.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{right.label}</div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>{right.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ ...P_STYLE, marginTop: 14 }}>
              Pour exercer l'un de ces droits, notamment le <strong>droit de suppression de vos données</strong>, contactez-nous à l'adresse ci-dessous.
              Nous nous engageons à traiter votre demande dans un délai de <strong>30 jours</strong>.
            </p>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 12. Cookies */}
          <div style={SECTION_STYLE}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>12</span>
              Cookies et stockage local
            </h2>
            <p style={P_STYLE}>
              L'application utilise le stockage local du navigateur (<em>localStorage</em> et <em>sessionStorage</em>) pour des fonctionnalités techniques essentielles :
            </p>
            <ul style={UL_STYLE}>
              <li>Maintien de la session de connexion.</li>
              <li>Préférences d'affichage (thème clair/sombre, vue compacte).</li>
              <li>Mémorisation de l'appareil pour la biométrie (optionnel).</li>
            </ul>
            <p style={P_STYLE}>
              Aucun cookie publicitaire ou de traçage tiers n'est utilisé.
            </p>
          </div>

          <div style={DIVIDER_STYLE} />

          {/* 13. Contact */}
          <div style={{ ...SECTION_STYLE, marginBottom: 0 }}>
            <h2 style={H2_STYLE}>
              <span style={BADGE_STYLE}>13</span>
              Contact
            </h2>
            <p style={P_STYLE}>
              Pour toute question relative à cette politique de confidentialité, à l'exercice de vos droits ou à la suppression de vos données, contactez-nous :
            </p>
            <div style={{ background: '#eff6ff', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 28 }}>✉️</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>Kaytek Inter — Délégué à la protection des données</div>
                <a
                  href="mailto:contact@kaytekinter.fr"
                  style={{ fontSize: 15, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
                >
                  contact@kaytekinter.fr
                </a>
              </div>
            </div>
            <p style={{ ...P_STYLE, marginTop: 14, fontSize: 12, color: '#94a3b8' }}>
              Vous avez également le droit d'introduire une réclamation auprès de la CNIL (Commission Nationale de l'Informatique et des Libertés) — <em>www.cnil.fr</em>
            </p>
          </div>

        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: '#cbd5e1' }}>
          © {new Date().getFullYear()} Kaytek Inter ·{' '}
          <a href="/delete-account" style={{ color: '#94a3b8', textDecoration: 'none' }}>Suppression de compte</a>
          {' · '}
          <a href="mailto:contact@kaytekinter.fr" style={{ color: '#94a3b8', textDecoration: 'none' }}>contact@kaytekinter.fr</a>
        </div>
      </div>
    </div>
  )
}
