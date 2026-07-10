// src/lib/biometric.ts
const CRED_KEY = 'kaytek-biometric-cred'
const EMAIL_KEY = 'kaytek-biometric-email'

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Uint8Array.from(atob(padded + '='.repeat(pad)), c => c.charCodeAt(0))
}

export function isBiometricAvailable(): boolean {
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

export async function registerBiometric(
  userId: string,
  displayName: string,
  email: string
): Promise<boolean> {
  if (!isBiometricAvailable()) return false
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

export async function authenticateWithBiometric(): Promise<boolean> {
  if (!isBiometricAvailable()) return false
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
