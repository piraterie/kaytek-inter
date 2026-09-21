// src/pages/googleAds/AccountSection.tsx — « Compte connecté » : bloc compact repliable.
// Résumé sur une ligne (« Compte ····9574 · EUR · Europe/Paris »), détails à l'ouverture.
// Infos déjà fournies par le statut de connexion (aucun nouvel appel) ; aucune ligne n'est
// affichée si la donnée correspondante est absente.
import { ChevronDown } from 'lucide-react'
import type { GoogleConnectionInfo } from '@/lib/hooks/googleIntegrations'
import { maskCustomerId } from '@/lib/googleAdsMetrics'
import { Section } from './ui'

export function accountSummary(info: GoogleConnectionInfo): string {
  return [maskCustomerId(info.google_customer_id) ? `Compte ${maskCustomerId(info.google_customer_id)}` : 'Compte', info.currency_code, info.time_zone].filter(Boolean).join(' · ')
}

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
      <details className="card gads-account-card">
        <summary className="gads-acc-sum">
          <span className="gads-acc-line">{accountSummary(info)}</span>
          <ChevronDown size={16} className="gads-acc-chev" aria-hidden="true" />
        </summary>
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
      </details>
    </Section>
  )
}
