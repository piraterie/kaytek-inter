// src/pages/googleAds/AccountSection.tsx — « Compte connecté » : infos utiles déjà
// fournies par le statut de connexion (aucun nouvel appel). Aucune ligne n'est
// affichée si la donnée correspondante est absente.
import type { GoogleConnectionInfo } from '@/lib/hooks/googleIntegrations'
import { maskCustomerId } from '@/lib/googleAdsMetrics'
import { Section } from './ui'

export function AccountSection({ info, onManage }: { info: GoogleConnectionInfo; onManage: () => void }) {
  const rows: { k: string; v: string }[] = []
  if (info.customer_descriptive_name) rows.push({ k: 'Nom du compte', v: info.customer_descriptive_name })
  const id = maskCustomerId(info.google_customer_id)
  if (id) rows.push({ k: 'Identifiant', v: id })
  if (typeof info.is_manager_account === 'boolean') rows.push({ k: 'Type', v: info.is_manager_account ? 'Compte manager' : 'Compte client' })
  if (info.currency_code) rows.push({ k: 'Devise', v: info.currency_code })
  if (info.time_zone) rows.push({ k: 'Fuseau horaire', v: info.time_zone })
  if (info.google_account_email) rows.push({ k: 'Compte Google', v: info.google_account_email })
  if (info.connected_at) rows.push({ k: 'Connecté le', v: new Date(info.connected_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) })

  return (
    <Section id="account" title="Compte connecté">
      <div className="card">
        {rows.length > 0 && (
          <div className="gads-kv">
            {rows.map((r) => (
              <div key={r.k} className="gads-kv-row"><span className="k">{r.k}</span><span className="val">{r.v}</span></div>
            ))}
          </div>
        )}
        <div className="gads-account-foot">
          <button className="btn-secondary btn-sm" onClick={onManage}>Gérer la connexion</button>
        </div>
      </div>
    </Section>
  )
}
