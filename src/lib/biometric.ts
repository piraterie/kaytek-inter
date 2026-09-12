// src/lib/biometric.ts
const CRED_KEY = 'kaytek-biometric-cred'
const EMAIL_KEY = 'kaytek-biometric-email'

// Hint passé à l'authenticateur ET verrou de secours côté navigateur (AbortController).
// Sur certains navigateurs/OS mobiles (notamment Chrome Android quand le Credential
// Manager/Play Services est dans un état incohérent, ou quand allowCredentials ne
// correspond à aucun identifiant connu de la plateforme), navigator.credentials.get()/
// create() peut ne jamais se résoudre NI rejeter — le `timeout` de l'objet publicKey
// n'est qu'une suggestion que les authenticateurs plateforme ignorent fréquemment.
const DEFAULT_TIMEOUT_MS = 25000

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Uint8Array.from(atob(padded + '='.repeat(pad)), c => c.charCodeAt(0))
}

// `typeof PublicKeyCredential !== 'undefined'` prouve seulement que le navigateur
// connaît la SYNTAXE de l'API WebAuthn — pas qu'un authenticateur plateforme
// (empreinte/visage) est réellement présent, activé et fonctionnel sur cet
// appareil. Sur Android en particulier, `PublicKeyCredential` est défini même
// sans empreinte enregistrée dans les paramètres système ou avec un Credential
// Manager/Play Services cassé — appeler create()/get() dans cet état est
// justement la situation où Chrome-sur-Android est connu pour bloquer
// indéfiniment la promesse (voir les rapports Chromium sur ce sujet). La bonne
// méthode de détection est asynchrone : isUserVerifyingPlatformAuthenticatorAvailable().
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !('credentials' in navigator) || typeof PublicKeyCredential === 'undefined') {
    return false
  }
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    // Navigateur ancien sans cette méthode : on retombe sur la détection basique
    // plutôt que de désactiver la biométrie partout.
    return true
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export function hasBiometricRegistered(): boolean {
  return !!localStorage.getItem(CRED_KEY)
}

export function getBiometricEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

// 'ok'            : assertion WebAuthn réussie
// 'unavailable'   : API WebAuthn absente ou authenticateur plateforme non disponible
// 'no-credential' : aucune empreinte enregistrée sur cet appareil
// 'timeout'       : l'authenticateur n'a jamais répondu — notre timeout local a coupé
// 'denied'        : annulation utilisateur OU échec natif (WebAuthn fusionne volontairement
//                    ces deux cas dans NotAllowedError pour des raisons de confidentialité —
//                    impossible de les distinguer côté site, donc on ne les traite jamais
//                    comme une preuve que l'empreinte enregistrée est invalide)
export type BiometricAuthResult = 'ok' | 'unavailable' | 'no-credential' | 'timeout' | 'denied'

export async function registerBiometric(
  userId: string,
  displayName: string,
  email: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<boolean> {
  if (!(await isBiometricAvailable())) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const cred = await navigator.credentials.create({
      signal: controller.signal,
      publicKey: {
        challenge,
        rp: { name: 'Kaytek Inter', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: email,
          displayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: timeoutMs,
      },
    }) as PublicKeyCredential | null

    if (!cred) return false
    localStorage.setItem(CRED_KEY, toB64(cred.rawId))
    localStorage.setItem(EMAIL_KEY, email)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function authenticateWithBiometric(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BiometricAuthResult> {
  if (!(await isBiometricAvailable())) return 'unavailable'
  const stored = localStorage.getItem(CRED_KEY)
  if (!stored) return 'no-credential'

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

  try {
    const credId = fromB64(stored)
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const assertion = await navigator.credentials.get({
      signal: controller.signal,
      publicKey: {
        challenge: challenge as BufferSource,
        allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
        userVerification: 'required',
        timeout: timeoutMs,
      },
    })
    return assertion ? 'ok' : 'denied'
  } catch {
    // Notre propre abort déclenche une AbortError — on la reconnaît via `timedOut`
    // plutôt que par le nom de l'exception, qui peut varier selon le navigateur.
    return timedOut ? 'timeout' : 'denied'
  } finally {
    clearTimeout(timer)
  }
}

export function clearBiometric(): void {
  localStorage.removeItem(CRED_KEY)
  localStorage.removeItem(EMAIL_KEY)
}
