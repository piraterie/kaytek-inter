// src/lib/facturation.ts
// Règles d'échéance de paiement des factures, par métier (`devis.activite`
// / `interventions.type`). La serrurerie est une intervention d'urgence
// payée sur place : aucun délai commercial de 30 jours ne doit s'appliquer,
// contrairement aux autres métiers (vitrerie, plomberie, électricité,
// chauffagiste) qui conservent le délai standard.

const ACTIVITES_PAIEMENT_IMMEDIAT = new Set(['serrurerie'])

export function isPaiementImmediat(activite?: string | null): boolean {
  return !!activite && ACTIVITES_PAIEMENT_IMMEDIAT.has(activite)
}

const DELAI_PAIEMENT_DEFAUT_JOURS = 30

// Retourne la date d'échéance (format 'YYYY-MM-DD') à appliquer à une
// facture selon le métier de l'intervention/devis d'origine.
export function calculerEcheanceFacture(activite: string | null | undefined, dateEmission: Date = new Date()): string {
  const echeance = isPaiementImmediat(activite)
    ? new Date(dateEmission)
    : new Date(dateEmission.getTime() + DELAI_PAIEMENT_DEFAUT_JOURS * 86400000)
  return echeance.toISOString().split('T')[0]
}
