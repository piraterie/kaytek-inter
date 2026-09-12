// src/lib/biometric.ts
//
// Connexion par empreinte/passkey — architecture native Supabase.
//
// L'ancienne implémentation stockait un identifiant de credential WebAuthn en
// localStorage et se contentait de vérifier l'assertion CÔTÉ CLIENT (aucune
// vérification de signature serveur), avant d'aller voir si une session
// Supabase antérieure traînait encore en localStorage. Deux défauts de fond :
//   1. Ce n'était pas une authentification réelle — juste un déverrouillage
//      local d'un état déjà là. Si la session Supabase sous-jacente n'existait
//      plus (déconnexion, expiration, changement d'appareil), l'empreinte ne
//      pouvait STRUCTURELLEMENT rien faire d'autre qu'échouer, quel que soit
//      son propre succès.
//   2. Rien ne garantissait que le credential WebAuthn appartenait bien à
//      l'utilisateur ciblé : sans vérification serveur de la signature, un
//      empreinte valide localement ne prouve rien à Supabase.
//
// `supabase.auth.registerPasskey()` / `signInWithPasskey()` (API "experimental"
// du SDK, mais qui délègue tout le travail cryptographique et l'émission de
// session au serveur GoTrue) corrigent les deux : le serveur génère le challenge,
// vérifie la signature WebAuthn, et — seulement si elle est valide — émet une
// vraie session Supabase (refresh token inclus), exactement comme un login par
// mot de passe. Il n'y a plus de "session éventuellement encore valide" à aller
// chercher après coup.
import { supabase } from './supabase/client'
import type { Session, User } from '@supabase/supabase-js'

// Indice purement cosmétique — sert uniquement à décider si on propose le
// bouton passkey en premier sur cet appareil. Ce n'est PAS un credential et sa
// présence/absence ne accorde ni ne retire jamais d'accès : la seule chose qui
// authentifie réellement, c'est la vérification serveur dans signInWithPasskey().
const PASSKEY_HINT_KEY = 'kaytek-passkey-registered'

const DEFAULT_TIMEOUT_MS = 15000

export class TimeoutError extends Error {
  constructor(label: string) { super(`TIMEOUT:${label}`); this.name = 'TimeoutError' }
}

// Timeout indépendant de toute coopération du navigateur, de supabase-js ou du
// serveur — contrairement à un AbortSignal transmis à une API tierce, ce
// setTimeout se déclenche TOUJOURS après `ms`, que la promesse sous-jacente
// (fetch réseau, cérémonie WebAuthn, etc.) respecte ou non un mécanisme
// d'annulation. C'est la garantie qui manquait dans les versions précédentes :
// signInWithPasskey() effectue en interne un fetch (challenge) → cérémonie
// WebAuthn → fetch (vérification) ; un `signal` ne couvre que le milieu de cette
// chaîne, jamais les deux appels réseau qui l'encadrent.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) }
    )
  })
}

// `typeof PublicKeyCredential !== 'undefined'` prouve seulement que le navigateur
// connaît la SYNTAXE de l'API WebAuthn — pas qu'un authenticateur plateforme
// (empreinte/visage) est réellement présent, activé et fonctionnel. La bonne
// méthode de détection est asynchrone : isUserVerifyingPlatformAuthenticatorAvailable().
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !('credentials' in navigator) || typeof PublicKeyCredential === 'undefined') {
    return false
  }
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return true
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// Vérifie que le PROJET Supabase (pas seulement le SDK) a les passkeys activés
// — Dashboard → Authentication. Sans ce garde, on proposerait un bouton qui
// échouerait à coup sûr tant que ce n'est pas activé côté serveur. Résultat mis
// en cache pour la durée de la session (le paramètre ne change pas en cours de
// route) — /auth/v1/settings est un endpoint public, aucune authentification
// requise, sûr à interroger avant même toute connexion.
let serverEnabledCache: boolean | null = null
export async function arePasskeysServerEnabled(): Promise<boolean> {
  if (serverEnabledCache !== null) return serverEnabledCache
  try {
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY
    const res = await withTimeout(
      fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }),
      5000,
      'passkeySettings'
    )
    if (!res.ok) { serverEnabledCache = false; return false }
    const data = await res.json()
    serverEnabledCache = data?.passkeys_enabled === true
    return serverEnabledCache
  } catch {
    serverEnabledCache = false
    return false
  }
}

export function hasPasskeyHint(): boolean {
  return localStorage.getItem(PASSKEY_HINT_KEY) === '1'
}

export function clearPasskeyHint(): void {
  localStorage.removeItem(PASSKEY_HINT_KEY)
}

// 'ok'                   : passkey enregistrée avec succès
// 'unavailable'          : pas d'authenticateur plateforme fonctionnel sur cet appareil
// 'not-supported-by-server' : passkeys désactivés sur ce projet Supabase
// 'no-session'           : registerPasskey() exige une session active (on ne peut
//                          associer une passkey qu'à un compte déjà authentifié)
// 'timeout'              : ni le réseau ni la cérémonie WebAuthn n'ont répondu à temps
// 'denied'               : annulation utilisateur OU échec natif (WebAuthn fusionne
//                          volontairement ces deux cas pour des raisons de
//                          confidentialité — impossible de les distinguer côté site)
export type PasskeyRegisterResult =
  | 'ok' | 'unavailable' | 'not-supported-by-server' | 'no-session' | 'timeout' | 'denied' | 'error'

export async function registerPasskey(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PasskeyRegisterResult> {
  if (!(await isBiometricAvailable())) return 'unavailable'
  if (!(await arePasskeysServerEnabled())) return 'not-supported-by-server'

  // L'AbortController est une courtoisie envers le navigateur (annuler une
  // cérémonie WebAuthn encore affichée si notre propre timeout se déclenche
  // avant elle) — la garantie de déblocage vient de withTimeout ci-dessous,
  // pas de ce signal, que rien n'oblige un navigateur/OS à honorer. `timedOut`
  // est indispensable : si notre abort() fait échouer signInWithPasskey() AVANT
  // que le rejet de withTimeout ne se propage (course entre deux timers), l'erreur
  // renvoyée par le SDK a le même code ERROR_CEREMONY_ABORTED qu'une vraie
  // annulation utilisateur — sans ce drapeau, un timeout serait donc affiché à
  // tort comme "empreinte non reconnue".
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

  try {
    const { data, error } = await withTimeout(
      supabase.auth.registerPasskey({ options: { signal: controller.signal } }),
      timeoutMs,
      'registerPasskey'
    )
    if (error) {
      if (timedOut) return 'timeout'
      if ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED') return 'denied'
      if ('status' in error && error.status === 401) return 'no-session'
      return 'error'
    }
    if (!data) return 'error'
    localStorage.setItem(PASSKEY_HINT_KEY, '1')
    return 'ok'
  } catch (err) {
    return timedOut || err instanceof TimeoutError ? 'timeout' : 'error'
  } finally {
    clearTimeout(timer)
  }
}

export type PasskeySignInResult =
  | { status: 'ok'; session: Session; user: User }
  | { status: 'unavailable' | 'not-supported-by-server' | 'timeout' | 'denied' | 'error' }

export async function signInWithPasskey(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PasskeySignInResult> {
  if (!(await isBiometricAvailable())) return { status: 'unavailable' }
  if (!(await arePasskeysServerEnabled())) return { status: 'not-supported-by-server' }

  // Voir le commentaire équivalent dans registerPasskey() : `timedOut` évite de
  // classer par erreur notre propre timeout comme un rejet natif ("empreinte
  // non reconnue") lorsque notre abort() gagne la course contre withTimeout.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPasskey({ options: { signal: controller.signal } }),
      timeoutMs,
      'signInWithPasskey'
    )
    if (error) {
      if (timedOut) return { status: 'timeout' }
      if ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED') return { status: 'denied' }
      return { status: 'error' }
    }
    if (!data?.session || !data?.user) return { status: 'error' }
    // Authentification réelle confirmée par le serveur : on peut maintenant
    // renforcer l'indice local (utile si l'enregistrement avait eu lieu sur un
    // autre appareil/navigateur synchronisé, ex. passkey iCloud/Google).
    localStorage.setItem(PASSKEY_HINT_KEY, '1')
    return { status: 'ok', session: data.session, user: data.user }
  } catch (err) {
    return { status: timedOut || err instanceof TimeoutError ? 'timeout' : 'error' }
  } finally {
    clearTimeout(timer)
  }
}
