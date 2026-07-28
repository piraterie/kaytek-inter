// supabase/functions/_shared/validateEntreprise.ts
// Validation stricte du contact professionnel utilisé comme Reply-To Brevo.
// Partagée par envoyer-email et inviter-intervenant — aucun fallback
// silencieux : si l'entreprise n'a pas un nom et un email valides, l'appelant
// doit bloquer l'envoi avant tout appel à l'API Brevo.
import { isValidEmail } from './emailContract.ts'

export interface EntrepriseReplyTo {
  name: string
  email: string
}

export function validateEntrepriseReplyTo(
  entreprise: { raison_sociale?: string | null; email?: string | null } | null | undefined
): EntrepriseReplyTo | null {
  const name = entreprise?.raison_sociale?.trim() ?? ''
  const email = entreprise?.email?.trim() ?? ''
  if (!name || !isValidEmail(email)) return null
  return { name, email }
}

export const REPLY_TO_INVALID_MESSAGE =
  "Renseignez une adresse email professionnelle valide dans les paramètres de votre entreprise avant d'envoyer cet email."
