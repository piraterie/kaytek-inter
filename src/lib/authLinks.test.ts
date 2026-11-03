// src/lib/authLinks.test.ts
// Régression — invitation qui atterrissait sur /login (ou ouvrait l'app sans
// mot de passe) et liens de réinitialisation : lecture des différents formats
// de liens, redirection du Guard, validation et messages d'erreur.
import { describe, it, expect } from 'vitest'
import { parseAuthLink, authLinkRedirect, passwordProblem, authErrorMessage, LINK_INVALID_MESSAGE } from './authLinks'

describe('parseAuthLink', () => {
  it('lit un lien applicatif token_hash (invitation)', () => {
    expect(parseAuthLink('?token_hash=abc&type=invite', '')).toEqual({ kind: 'token_hash', tokenHash: 'abc', type: 'invite' })
  })
  it('lit un lien applicatif token_hash (réinitialisation)', () => {
    expect(parseAuthLink('?token_hash=abc&type=recovery', '')).toEqual({ kind: 'token_hash', tokenHash: 'abc', type: 'recovery' })
  })
  it('refuse un type de jeton non prévu (magiclink, signup…)', () => {
    expect(parseAuthLink('?token_hash=abc&type=magiclink', '').kind).toBe('error')
    expect(parseAuthLink('?token_hash=abc', '').kind).toBe('error')
  })
  it('lit un ancien lien implicite (#access_token)', () => {
    expect(parseAuthLink('', '#access_token=x&refresh_token=y&type=invite')).toEqual({ kind: 'implicit', type: 'invite' })
  })
  it('lit un code PKCE', () => {
    expect(parseAuthLink('?code=123', '')).toEqual({ kind: 'code', code: '123' })
  })
  it('détecte un lien expiré / déjà utilisé renvoyé par Supabase', () => {
    expect(parseAuthLink('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ kind: 'error', code: 'otp_expired' })
  })
  it('aucun lien', () => {
    expect(parseAuthLink('', '')).toEqual({ kind: 'none' })
  })
})

describe('authLinkRedirect (Guard)', () => {
  it('ancien lien d\'invitation sur la racine → /activation, hash conservé', () => {
    expect(authLinkRedirect({ search: '', hash: '#access_token=x&type=invite' })).toBe('/activation#access_token=x&type=invite')
  })
  it('ancien lien de réinitialisation sur la racine → /reset-password', () => {
    expect(authLinkRedirect({ search: '', hash: '#access_token=x&type=recovery' })).toBe('/reset-password#access_token=x&type=recovery')
  })
  it('lien expiré sur la racine → page explicite plutôt que /login', () => {
    expect(authLinkRedirect({ search: '', hash: '#error=access_denied&error_code=otp_expired&error_description=x' }))
      .toBe('/activation#error=access_denied&error_code=otp_expired&error_description=x')
  })
  it('navigation normale → aucune redirection', () => {
    expect(authLinkRedirect({ search: '', hash: '' })).toBeNull()
    expect(authLinkRedirect({ search: '?push_open=1', hash: '' })).toBeNull()
    expect(authLinkRedirect({ search: '?error=oauth', hash: '' })).toBeNull()
  })
  it('n\'accepte aucun paramètre de rôle ou d\'organisation', () => {
    // Les paramètres supplémentaires sont transmis tels quels à la page mais
    // n'ont aucun effet : seul le mot de passe est envoyé à Supabase.
    expect(parseAuthLink('?token_hash=abc&type=invite&role=admin&organisation_id=x', ''))
      .toEqual({ kind: 'token_hash', tokenHash: 'abc', type: 'invite' })
  })
})

describe('passwordProblem', () => {
  it('trop court', () => expect(passwordProblem('a1', 'a1')).toMatch(/au moins 8/))
  it('sans chiffre', () => expect(passwordProblem('abcdefgh', 'abcdefgh')).toMatch(/lettre et un chiffre/))
  it('confirmation différente', () => expect(passwordProblem('abcdefg1', 'abcdefg2')).toMatch(/ne correspondent pas/))
  it('valide', () => expect(passwordProblem('Kaytek2026', 'Kaytek2026')).toBeNull())
})

describe('authErrorMessage', () => {
  it('jeton expiré / déjà utilisé', () => {
    expect(authErrorMessage({ code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe(LINK_INVALID_MESSAGE)
  })
  it('même mot de passe', () => {
    expect(authErrorMessage({ code: 'same_password' })).toMatch(/différent/)
  })
  it('mot de passe faible', () => {
    expect(authErrorMessage({ code: 'weak_password', message: 'Password is known to be weak' })).toMatch(/trop faible/)
  })
  it('limite de fréquence', () => {
    expect(authErrorMessage({ status: 429, message: 'rate limit' })).toMatch(/Trop de tentatives/)
  })
  it('erreur inconnue : message générique sans détail technique', () => {
    const m = authErrorMessage({ message: 'pq: relation "x" does not exist' })
    expect(m).not.toMatch(/relation|pq/)
  })
})
