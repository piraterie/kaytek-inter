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
// mot de passe.
//
// MAIS (2026-09-12) : ces méthodes "tout-en-un" laissent le serveur choisir le
// paramètre WebAuthn `userVerification` des options envoyées au navigateur, et
// le serveur GoTrue de Supabase le fixe à 'preferred' (vérifié directement via
// POST /auth/v1/passkeys/authentication/options — champ non configurable, ni
// dans le Dashboard, ni dans config.toml, ni dans le code source de GoTrue :
// voir WebAuthnConfiguration dans supabase/auth n'a que RPID/RPDisplayName/
// RPOrigins/ChallengeExpiryDuration). Avec 'preferred', l'authenticateur PEUT
// s'appuyer sur la seule présence de l'utilisateur sans exiger empreinte/PIN —
// c'est ce qui explique les connexions parfois accordées sans aucune validation
// biométrique perçue. On utilise donc le flux en DEUX ÉTAPES documenté par le
// SDK (startAuthentication/verifyAuthentication et startRegistration/
// verifyRegistration) pour construire nous-mêmes les options WebAuthn envoyées
// au navigateur, en y forçant `userVerification: 'required'` — le serveur reste
// seul responsable du challenge et de la vérification de signature, seule la
// contrainte de vérification utilisateur est renforcée côté client, ce qui est
// un durcissement (jamais un affaiblissement) de la politique du serveur.
import { supabase } from './supabase/client'
import type { Session, User } from '@supabase/supabase-js'

// Indice purement cosmétique — sert uniquement à décider si on propose le
// bouton passkey en premier sur cet appareil. Ce n'est PAS un credential et sa
// présence/absence ne accorde ni ne retire jamais d'accès : la seule chose qui
// authentifie réellement, c'est la vérification serveur de la signature.
const PASSKEY_HINT_KEY = 'kaytek-passkey-registered'

const DEFAULT_TIMEOUT_MS = 15000

export class TimeoutError extends Error {
  constructor(label: string) { super(`TIMEOUT:${label}`); this.name = 'TimeoutError' }
}

// Timeout indépendant de toute coopération du navigateur, de supabase-js ou du
// serveur — contrairement à un AbortSignal transmis à une API tierce, ce
// setTimeout se déclenche TOUJOURS après `ms`, que la promesse sous-jacente
// (fetch réseau, cérémonie WebAuthn, etc.) respecte ou non un mécanisme
// d'annulation.
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

function base64urlToBuffer(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Uint8Array.from(atob(padded + '='.repeat(pad)), c => c.charCodeAt(0))
}

// Convertit les options JSON du serveur (base64url) en objet exploitable par
// navigator.credentials.create(), en y imposant userVerification: 'required'.
// Utilise le parseur natif du navigateur (WebAuthn Level 3, Chrome/Safari
// récents) quand disponible ; repli manuel sinon — même stratégie que le SDK
// Supabase lui-même pour son propre usage interne.
function buildCreationOptions(json: any): PublicKeyCredentialCreationOptions {
  const base: PublicKeyCredentialCreationOptions =
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function'
      ? PublicKeyCredential.parseCreationOptionsFromJSON(json)
      : {
          ...json,
          challenge: base64urlToBuffer(json.challenge),
          user: { ...json.user, id: base64urlToBuffer(json.user.id) },
          excludeCredentials: (json.excludeCredentials || []).map((c: any) => ({ ...c, id: base64urlToBuffer(c.id) })),
        }
  return { ...base, authenticatorSelection: { ...base.authenticatorSelection, userVerification: 'required' } }
}

function buildRequestOptions(json: any): PublicKeyCredentialRequestOptions {
  const base: PublicKeyCredentialRequestOptions =
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
      ? PublicKeyCredential.parseRequestOptionsFromJSON(json)
      : {
          ...json,
          challenge: base64urlToBuffer(json.challenge),
          allowCredentials: (json.allowCredentials || []).map((c: any) => ({ ...c, id: base64urlToBuffer(c.id) })),
        }
  return { ...base, userVerification: 'required' }
}

// Sérialise le credential renvoyé par le navigateur au format JSON attendu par
// le serveur (base64url) — utilise le sérialiseur natif (credential.toJSON(),
// WebAuthn Level 3) quand disponible ; repli manuel sinon.
function bufferToBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function serializeCredential(cred: PublicKeyCredential): any {
  if (typeof (cred as any).toJSON === 'function') return (cred as any).toJSON()
  const response = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse
  const isRegistration = typeof response.attestationObject !== 'undefined'
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: isRegistration
      ? {
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          attestationObject: bufferToBase64url(response.attestationObject),
          transports: response.getTransports?.() ?? [],
        }
      : {
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          authenticatorData: bufferToBase64url(response.authenticatorData),
          signature: bufferToBase64url(response.signature),
          userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
        },
  }
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
  // est indispensable : si notre abort() fait échouer la cérémonie AVANT que le
  // rejet de withTimeout ne se propage (course entre deux timers), l'erreur
  // renvoyée a le même code qu'une vraie annulation utilisateur — sans ce
  // drapeau, un timeout serait donc affiché à tort comme un rejet natif.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

  try {
    const { data: startData, error: startError } = await withTimeout(
      supabase.auth.passkey.startRegistration(),
      timeoutMs,
      'startRegistration'
    )
    if (startError) {
      if ('status' in startError && startError.status === 401) return 'no-session'
      return 'error'
    }
    if (!startData) return 'error'

    const publicKey = buildCreationOptions(startData.options)
    const credential = await navigator.credentials.create({ signal: controller.signal, publicKey }) as PublicKeyCredential | null
    if (!credential) return 'error'

    const { data, error } = await withTimeout(
      supabase.auth.passkey.verifyRegistration({
        challengeId: startData.challenge_id,
        credential: serializeCredential(credential),
      }),
      timeoutMs,
      'verifyRegistration'
    )
    if (error) {
      if (timedOut) return 'timeout'
      if ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED') return 'denied'
      return 'error'
    }
    if (!data) return 'error'
    localStorage.setItem(PASSKEY_HINT_KEY, '1')
    return 'ok'
  } catch {
    // Couvre notre propre abort ainsi que tout rejet natif de
    // navigator.credentials.create() (annulation, échec de l'authenticateur) —
    // WebAuthn ne permet pas de les distinguer de façon fiable, voir plus haut.
    return timedOut ? 'timeout' : 'denied'
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
    const { data: startData, error: startError } = await withTimeout(
      supabase.auth.passkey.startAuthentication(),
      timeoutMs,
      'startAuthentication'
    )
    if (startError || !startData) return { status: 'error' }

    // C'est ICI que se jouait le bug rapporté : signInWithPasskey() laissait le
    // serveur (userVerification: 'preferred') décider si l'appareil devait
    // exiger une validation biométrique/PIN. buildRequestOptions() force
    // 'required' — la cérémonie WebAuthn ne peut plus se résoudre sur la seule
    // présence de l'utilisateur, quel que soit ce que le serveur a suggéré.
    const publicKey = buildRequestOptions(startData.options)
    const credential = await navigator.credentials.get({ signal: controller.signal, publicKey }) as PublicKeyCredential | null
    if (!credential) return { status: 'denied' }

    const { data, error } = await withTimeout(
      supabase.auth.passkey.verifyAuthentication({
        challengeId: startData.challenge_id,
        credential: serializeCredential(credential),
      }),
      timeoutMs,
      'verifyAuthentication'
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
  } catch {
    return { status: timedOut ? 'timeout' : 'denied' }
  } finally {
    clearTimeout(timer)
  }
}
