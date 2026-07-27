// src/lib/clientIdentity.ts
// Normalisation des coordonnées client pour l'affichage dans les devis et
// factures (aperçu, PDF, e-mail) — helper unique réutilisé partout au
// lieu de dupliquer la logique dans chaque écran/modèle.
//
// Le champ `adresse_intervention` d'un client est une chaîne déjà
// complète issue de l'autocomplétion d'adresse (api-adresse.data.gouv.fr,
// voir src/components/AddressAutocomplete.tsx) — elle contient
// typiquement "numéro rue, code postal ville" en un seul bloc. Les
// colonnes séparées `cp_intervention`/`ville_intervention` existent dans
// le schéma mais ne sont aujourd'hui jamais renseignées par aucun
// formulaire de l'application (vérifié) : ce helper les utilise si elles
// sont présentes (site déjà à jour ou import externe) sans jamais
// supposer qu'elles le sont.
import type { Client, ClientDocumentIdentity } from '@/types'

export type { ClientDocumentIdentity }

function clean(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\s+/g, ' ').trim()
}

// Construit l'identité à partir d'une fiche client "vivante" (jointure
// clients, colonnes réelles du schéma — voir src/types/index.ts).
// Utilisé pour un document en cours de création (pas encore de snapshot)
// et comme repli pour les documents historiques sans snapshot.
export function buildClientIdentity(client: Partial<Client> | null | undefined): ClientDocumentIdentity | null {
  if (!client) return null
  const companyName = clean(client.raison_sociale) || undefined
  const contactName = clean([client.prenom, client.nom].filter(Boolean).join(' ')) || undefined
  const displayName = companyName || contactName || clean(client.nom) || '—'

  return {
    displayName,
    companyName,
    // Le nom de contact n'est affiché séparément que pour un professionnel
    // (société en displayName) — pour un particulier, displayName EST déjà
    // le nom du contact, pas la peine de le répéter.
    contactName: companyName ? contactName : undefined,
    addressLine1: clean(client.adresse_facturation) || clean(client.adresse_intervention) || undefined,
    postalCode: clean(client.cp_intervention) || undefined,
    city: clean(client.ville_intervention) || undefined,
    email: clean(client.email) || undefined,
    phone: clean(client.telephone) || undefined,
  }
}

// Priorité stricte : snapshot enregistré sur le document > fiche client
// (repli, uniquement pour les documents créés avant l'introduction du
// snapshot) > rien. Ne recrée jamais une adresse depuis une valeur non
// fiable si un snapshot existe déjà.
export function resolveClientIdentity(
  snapshot: unknown,
  client: Partial<Client> | null | undefined,
): ClientDocumentIdentity | null {
  if (snapshot && typeof snapshot === 'object' && 'displayName' in (snapshot as object)) {
    return snapshot as ClientDocumentIdentity
  }
  return buildClientIdentity(client)
}

// Lignes d'adresse SEULES (sans nom) — pour les emplacements où le nom
// est déjà affiché séparément (ex. ClientSection du PDF).
export function formatAddressLines(identity: ClientDocumentIdentity | null | undefined): string[] {
  if (!identity) return []
  const lines: string[] = []
  if (identity.addressLine1) lines.push(clean(identity.addressLine1))
  if (identity.addressLine2) lines.push(clean(identity.addressLine2))
  const cityLine = clean([identity.postalCode, identity.city].filter(Boolean).join(' '))
  if (cityLine) lines.push(cityLine)
  if (identity.country) lines.push(clean(identity.country))
  return lines.filter(Boolean)
}

// Bloc complet (nom/société + adresse) — pour un rendu autonome type
// "Facturé à" sans en-tête de nom séparé.
export function formatFullIdentityBlock(identity: ClientDocumentIdentity | null | undefined): string[] {
  if (!identity) return []
  const lines: string[] = []
  if (identity.companyName) lines.push(identity.companyName)
  if (identity.contactName) lines.push(identity.contactName)
  if (!identity.companyName && !identity.contactName) lines.push(identity.displayName)
  lines.push(...formatAddressLines(identity))
  return lines.filter(Boolean)
}
