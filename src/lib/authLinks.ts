// src/lib/authLinks.ts
// Lecture des liens d'invitation / de réinitialisation et messages d'erreur
// associés. Logique pure (sans supabase-js) pour être testée directement —
// voir authLinks.test.ts.
//
// Formats rencontrés :
//  - lien applicatif actuel : /activation|/reset-password?token_hash=…&type=invite|recovery
//    (envoyé par les Edge Functions inviter-intervenant / demander-reinitialisation ;
//    le jeton n'est vérifié qu'à la validation du formulaire) ;
//  - anciens e-mails : redirection Supabase avec #access_token=…&type=invite|recovery
//    (session déjà posée par le SDK), éventuellement sur la racine du Site URL ;
//  - flux PKCE : ?code=… ;
//  - lien refusé par Supabase : #error=…&error_code=otp_expired&error_description=…

export type OtpLinkType = 'invite' | 'recovery'

export type AuthLink =
  | { kind: 'token_hash'; tokenHash: string; type: OtpLinkType }
  | { kind: 'implicit'; type: OtpLinkType | null }
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' }

function params(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  h.forEach((v, k) => { if (!merged.has(k)) merged.set(k, v) })
  return merged
}

function asOtpType(v: string | null): OtpLinkType | null {
  return v === 'invite' || v === 'recovery' ? v : null
}

export function parseAuthLink(search: string, hash: string): AuthLink {
  const p = params(search, hash)
  const errorCode = p.get('error_code') || p.get('error')
  if (errorCode) return { kind: 'error', code: errorCode }

  const tokenHash = p.get('token_hash')
  const type = asOtpType(p.get('type'))
  // Seuls invite/recovery sont acceptés : un autre type (magiclink, signup,
  // email_change…) n'a rien à faire sur ces pages.
  if (tokenHash) return type ? { kind: 'token_hash', tokenHash, type } : { kind: 'error', code: 'invalid_type' }

  if (p.get('access_token')) return { kind: 'implicit', type }
  const code = p.get('code')
  if (code) return { kind: 'code', code }
  return { kind: 'none' }
}

// Filet de sécurité du Guard : un ancien lien Supabase peut atterrir sur
// n'importe quel chemin protégé (racine du Site URL) — on l'envoie vers la
// bonne page AVANT toute redirection vers /login ou /dashboard (une session
// issue du lien suffirait sinon à ouvrir l'application sans mot de passe).
export function authLinkRedirect(initial: { search: string; hash: string }): string | null {
  const link = parseAuthLink(initial.search, initial.hash)
  const suffix = `${initial.search}${initial.hash}`
  if (link.kind === 'implicit' && link.type) {
    return `${link.type === 'recovery' ? '/reset-password' : '/activation'}${suffix}`
  }
  if (link.kind === 'token_hash') {
    return `${link.type === 'recovery' ? '/reset-password' : '/activation'}${suffix}`
  }
  // Lien refusé par Supabase (expiré, déjà utilisé) : on affiche une page
  // explicite plutôt qu'un /login muet. Uniquement pour les erreurs portées
  // par le hash d'une redirection d'auth (error_description), pour ne pas
  // détourner d'autres paramètres ?error= de l'application.
  if (link.kind === 'error' && initial.hash.includes('error_description')) {
    return `/activation${initial.hash}`
  }
  return null
}

// Une fois l'écran de mot de passe affiché, le lien capturé au chargement est
// considéré comme traité : le Guard ne doit plus y renvoyer (ex. retour vers
// /dashboard après activation alors que l'URL d'arrivée était /dashboard#…).
let authLinkHandled = false
export function markAuthLinkHandled() { authLinkHandled = true }
export function isAuthLinkHandled() { return authLinkHandled }

export const MIN_PASSWORD_LENGTH = 8

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.'
  if (password !== confirm) return 'Les deux mots de passe ne correspondent pas.'
  return null
}

export const LINK_INVALID_MESSAGE = 'Ce lien est invalide, a expiré ou a déjà été utilisé.'

// Traduit une erreur Supabase Auth en message simple, sans détail interne.
// Les codes viennent de GoTrue (error.code), le message anglais sert de repli.
export function authErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = (error?.code || '').toLowerCase()
  const msg = (error?.message || '').toLowerCase()
  if (['otp_expired', 'otp_disabled', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier', 'invalid_type', 'access_denied'].includes(code)
    || msg.includes('expired') || (msg.includes('invalid') && msg.includes('token')) || msg.includes('link is invalid')) {
    return LINK_INVALID_MESSAGE
  }
  if (code === 'same_password' || msg.includes('should be different')) return 'Choisissez un mot de passe différent de l’ancien.'
  if (code === 'weak_password' || msg.includes('weak') || msg.includes('password should')) {
    return 'Mot de passe trop faible : choisissez-en un plus long, avec lettres et chiffres, et évitez les mots de passe courants.'
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) {
    return 'Trop de tentatives. Patientez quelques minutes puis réessayez.'
  }
  if (code === 'session_not_found' || code === 'session_expired' || msg.includes('auth session missing')) {
    return 'Votre session a expiré. Rouvrez le lien reçu par e-mail ou demandez-en un nouveau.'
  }
  return 'Une erreur est survenue. Réessayez dans quelques instants.'
}
