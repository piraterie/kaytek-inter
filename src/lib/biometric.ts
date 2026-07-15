// src/lib/biometric.ts
import { Capacitor } from '@capacitor/core'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'

const CRED_KEY  = 'kaytek-biometric-cred'
const EMAIL_KEY = 'kaytek-biometric-email'

// ── WebAuthn helpers (web only) ───────────────────────────────────────────────
function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Uint8Array.from(atob(padded + '='.repeat(pad)), c => c.charCodeAt(0))
}

// ── Availability ─────────────────────────────────────────────────────────────

/**
 * Returns true if biometric authentication is available on this device.
 * Uses native Capacitor plugin on Android/iOS, WebAuthn on web.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await BiometricAuth.checkBiometry()
      return result.isAvailable
    } catch {
      return false
    }
  }
  // Web: WebAuthn (FIDO2)
  return typeof window !== 'undefined'
    && 'credentials' in navigator
    && typeof PublicKeyCredential !== 'undefined'
}

export function hasBiometricRegistered(): boolean {
  return !!localStorage.getItem(CRED_KEY)
}

export function getBiometricEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

// ── Register ─────────────────────────────────────────────────────────────────

/**
 * Enrolls biometric authentication for the given user.
 * Native: prompts biometric once to confirm enrollment, stores email + flag.
 * Web: creates a WebAuthn (FIDO2) credential.
 */
export async function registerBiometric(
  userId: string,
  displayName: string,
  email: string
): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      await BiometricAuth.authenticate({
        reason: 'Activer la connexion par empreinte digitale',
        cancelTitle: 'Annuler',
        androidTitle: 'Kaytek Inter',
        androidSubtitle: 'Confirmer pour activer la connexion rapide',
        allowDeviceCredential: true,
      })
      // Biometric confirmed — store enrollment flag + email
      localStorage.setItem(CRED_KEY, 'native')
      localStorage.setItem(EMAIL_KEY, email)
      return true
    } catch {
      return false
    }
  }

  // Web: WebAuthn
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const cred = await navigator.credentials.create({
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
        timeout: 60000,
      },
    }) as PublicKeyCredential | null

    if (!cred) return false
    localStorage.setItem(CRED_KEY, toB64(cred.rawId))
    localStorage.setItem(EMAIL_KEY, email)
    return true
  } catch {
    return false
  }
}

// ── Authenticate ──────────────────────────────────────────────────────────────

/**
 * Verifies the user's biometric.
 * Native: uses the device fingerprint/face sensor.
 * Web: uses WebAuthn stored credential.
 */
export async function authenticateWithBiometric(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    if (!localStorage.getItem(CRED_KEY)) return false
    try {
      await BiometricAuth.authenticate({
        reason: 'Connexion à Kaytek Inter',
        cancelTitle: 'Annuler',
        androidTitle: 'Kaytek Inter',
        androidSubtitle: 'Identifiez-vous pour continuer',
        allowDeviceCredential: true,
      })
      return true
    } catch {
      return false
    }
  }

  // Web: WebAuthn
  const stored = localStorage.getItem(CRED_KEY)
  if (!stored) return false
  try {
    const credId = fromB64(stored)
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
        userVerification: 'required',
        timeout: 60000,
      },
    })
    return !!assertion
  } catch {
    return false
  }
}

export function clearBiometric(): void {
  localStorage.removeItem(CRED_KEY)
  localStorage.removeItem(EMAIL_KEY)
}
