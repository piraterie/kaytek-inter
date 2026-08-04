// supabase/functions/_shared/google-oauth.ts
// Module partagé par les 4 Edge Functions OAuth Google (Phase 2) :
// google-oauth-start, google-oauth-callback, google-oauth-disconnect,
// google-oauth-status. Convention _shared inédite dans ce dépôt (les
// autres Edge Functions sont autonomes) — justifiée ici par le volume de
// logique commune (signature/vérification du state, authentification
// admin, wrappers Vault) qui serait sinon dupliquée 4 fois.
//
// RÈGLE ABSOLUE : ce fichier ne journalise JAMAIS un access_token, un
// refresh_token, un client_secret ou une valeur de secret Vault — ni en
// clair, ni tronqué, ni dans un message d'erreur. Seuls des identifiants
// non sensibles (organisation_id, provider, longueur d'une chaîne) sont
// journalisables.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Configuration ──────────────────────────────────────────────────────
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
export const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

export const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
export const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
export const GOOGLE_OAUTH_REDIRECT_URI = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') ?? ''
export const GOOGLE_OAUTH_STATE_SECRET = Deno.env.get('GOOGLE_OAUTH_STATE_SECRET') ?? ''
export const GOOGLE_ADS_DEVELOPER_TOKEN = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ?? ''
export const GOOGLE_OAUTH_FRONTEND_SUCCESS_URL = Deno.env.get('GOOGLE_OAUTH_FRONTEND_SUCCESS_URL') ?? ''
export const GOOGLE_OAUTH_FRONTEND_ERROR_URL = Deno.env.get('GOOGLE_OAUTH_FRONTEND_ERROR_URL') ?? ''

// Base publique du frontend (sans chemin) pour construire le lien de
// désinscription inclus dans les e-mails de demande d'avis — dédié plutôt
// que dérivé de GOOGLE_OAUTH_FRONTEND_SUCCESS_URL, pour ne jamais dépendre
// d'une hypothèse sur la forme de cette URL (avec/sans chemin, etc.).
export const GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL = Deno.env.get('GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL') ?? ''

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── Fournisseurs supportés ──────────────────────────────────────────────
export type GoogleProvider = 'google_ads' | 'google_business'

export function isValidProvider(v: unknown): v is GoogleProvider {
  return v === 'google_ads' || v === 'google_business'
}

// Scopes OpenID toujours demandés (identité du compte connecté, affichage
// uniquement — jamais utilisés pour une décision d'autorisation interne,
// qui reste toujours dérivée de auth.uid()/profiles côté Supabase).
export const OPENID_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

// Scopes spécifiques par produit — jamais combinés dans une seule
// autorisation (voir phase-2-oauth-report.md §Séparation Ads/GBP) : une
// organisation peut connecter l'un sans l'autre.
export const PROVIDER_SCOPES: Record<GoogleProvider, string[]> = {
  google_ads: ['https://www.googleapis.com/auth/adwords'],
  google_business: ['https://www.googleapis.com/auth/business.manage'],
}

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

// Version de l'API Google Ads utilisée par les appels REST (Phase 3) — les
// versions Google Ads API sont dépréciées régulièrement (cycle ~ trimestriel) :
// à revérifier périodiquement contre https://developers.google.com/google-ads/api/docs/release-notes.
export const GOOGLE_ADS_API_VERSION = 'v17'
export const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`

// Endpoints Google Business Profile (Phase 3) — deux APIs distinctes
// (Account Management + Business Information), non versionnées aussi
// agressivement que Google Ads.
export const GBP_ACCOUNT_MANAGEMENT_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1'
export const GBP_BUSINESS_INFORMATION_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'

// ── Nettoyage d'un message d'erreur avant persistance/log (Phase 2+) —
// retire tout fragment ressemblant à un access/refresh token Google avant
// toute écriture dans google_oauth_events.detail ou tout console.error.
// Règle absolue partagée par tout le code Google : jamais de token/secret,
// même tronqué, dans un log ou un rapport. ─────────────────────────────
export function sanitizeErrorDetail(raw: string, maxLen = 1000): string {
  return raw
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9._-]+/g, '[REDACTED_REFRESH_TOKEN]')
    .slice(0, maxLen)
}

// ── Authentification admin actif (JWT Supabase → profil → organisation) ─
// Organisation TOUJOURS dérivée de auth.uid() via profiles — jamais d'un
// organisation_id fourni par le frontend (règle absolue #13/#14).
export type AdminAuthResult =
  | { ok: true; userId: string; organisationId: string }
  | { ok: false; status: number; error: string }

export async function requireActiveAdmin(req: Request): Promise<AdminAuthResult> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Authentification requise' }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return { ok: false, status: 401, error: 'Session invalide' }

  const svc = serviceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('role, organisation_id, actif')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.actif) return { ok: false, status: 403, error: 'Compte inactif' }
  if (profile.role !== 'admin') return { ok: false, status: 403, error: 'Réservé aux administrateurs actifs' }
  if (!profile.organisation_id) return { ok: false, status: 403, error: 'Organisation introuvable pour ce compte' }

  return { ok: true, userId: user.id, organisationId: profile.organisation_id as string }
}

// ── State OAuth : signé (HMAC-SHA256), expirant, vérifié en base pour
// l'usage unique (nonce). La signature seule ne suffit pas à empêcher un
// rejeu avant expiration — d'où la table google_oauth_states consommée
// (consumed_at) dès validation réussie, avant l'échange du code. ────────
export interface StatePayload {
  nonce: string
  org: string
  provider: GoogleProvider
  uid: string
  exp: number // epoch ms
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const bin = atob(withPad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  // `as BufferSource` : TypeScript (lib.dom récente) distingue
  // Uint8Array<ArrayBuffer> de Uint8Array<ArrayBufferLike> de façon plus
  // stricte que le runtime WebCrypto lui-même — ces valeurs sont
  // toujours des Uint8Array adossés à un ArrayBuffer classique en
  // pratique (jamais un SharedArrayBuffer), l'assertion est donc sûre.
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64) as BufferSource)
  return `${payloadB64}.${base64url(new Uint8Array(sig))}`
}

export type VerifyStateResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'format_invalide' | 'signature_invalide' | 'payload_illisible' | 'expire' }

export async function verifyState(token: string, secret: string): Promise<VerifyStateResult> {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'format_invalide' }
  const [payloadB64, sigB64] = parts

  const key = await hmacKey(secret)
  // crypto.subtle.verify() effectue une comparaison en temps constant —
  // jamais de comparaison manuelle de chaînes pour une signature.
  const valid = await crypto.subtle.verify(
    'HMAC', key,
    base64urlToBytes(sigB64) as BufferSource,
    new TextEncoder().encode(payloadB64) as BufferSource,
  )
  if (!valid) return { ok: false, reason: 'signature_invalide' }

  let payload: StatePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64)))
  } catch {
    return { ok: false, reason: 'payload_illisible' }
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return { ok: false, reason: 'expire' }
  if (!payload.nonce || !payload.org || !payload.uid || !isValidProvider(payload.provider)) {
    return { ok: false, reason: 'payload_illisible' }
  }
  return { ok: true, payload }
}

// ── Wrappers Vault (public.google_oauth_vault_*, service_role uniquement,
// voir migration 20260728000006) — jamais d'accès direct au schéma vault
// depuis une Edge Function (non exposé par PostgREST), jamais de log de
// la valeur transmise. ───────────────────────────────────────────────────
export async function vaultCreateSecret(
  svc: SupabaseClient, secret: string, name?: string, description = '',
): Promise<string> {
  const { data, error } = await svc.rpc('google_oauth_vault_create', {
    p_secret: secret, p_name: name ?? null, p_description: description,
  })
  if (error) throw new Error(`vault_create_failed: ${error.message}`)
  return data as string
}

export async function vaultUpdateSecret(svc: SupabaseClient, secretId: string, secret: string): Promise<void> {
  const { error } = await svc.rpc('google_oauth_vault_update', { p_secret_id: secretId, p_secret: secret })
  if (error) throw new Error(`vault_update_failed: ${error.message}`)
}

export async function vaultReadSecret(svc: SupabaseClient, secretId: string): Promise<string | null> {
  const { data, error } = await svc.rpc('google_oauth_vault_read', { p_secret_id: secretId })
  if (error) throw new Error(`vault_read_failed: ${error.message}`)
  return (data as string) ?? null
}

export async function vaultDeleteSecret(svc: SupabaseClient, secretId: string): Promise<void> {
  const { error } = await svc.rpc('google_oauth_vault_delete', { p_secret_id: secretId })
  if (error) throw new Error(`vault_delete_failed: ${error.message}`)
}

// ── Table cible (google_ads_connections | gbp_connections) par provider ─
export function connectionsTable(provider: GoogleProvider): 'google_ads_connections' | 'gbp_connections' {
  return provider === 'google_ads' ? 'google_ads_connections' : 'gbp_connections'
}

// ── Audit (deny-all, service_role uniquement — voir migration Phase 1) ──
export async function logOAuthEvent(
  svc: SupabaseClient, organisationId: string | null, provider: GoogleProvider, eventType: string, detail?: string,
): Promise<void> {
  await svc.from('google_oauth_events').insert({
    organisation_id: organisationId, provider, event_type: eventType, detail: detail ?? null,
  })
}
