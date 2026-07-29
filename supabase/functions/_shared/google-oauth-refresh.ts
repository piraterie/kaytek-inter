// supabase/functions/_shared/google-oauth-refresh.ts — Phase 2
//
// Helper serveur centralisé de renouvellement des access tokens Google.
// Jamais appelé depuis le frontend, jamais de token retourné à l'appelant
// de ce module — uniquement un statut. Pas de tâche planifiée (pg_cron)
// pour l'instant : appelé à la demande depuis google-oauth-status (seule
// nécessité démontrée en Phase 2 — voir phase-2-oauth-report.md).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  connectionsTable, vaultReadSecret, vaultUpdateSecret,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_TOKEN_ENDPOINT,
  type GoogleProvider,
} from './google-oauth.ts'

// Marge de sécurité : renouvelle avant l'expiration réelle pour ne
// jamais renvoyer un token sur le point d'expirer à un appelant.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

export type RefreshResult =
  | { status: 'fresh' }
  | { status: 'refreshed' }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect'; reason: string }
  | { status: 'error'; reason: string }

interface GoogleRefreshResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

// Lit l'état de la connexion et renouvelle l'access token si nécessaire.
// Ne renvoie JAMAIS de valeur de token à l'appelant — uniquement un
// statut ('fresh' | 'refreshed' | ...). Un appelant qui a besoin de la
// valeur réelle doit lire le secret Vault lui-même (service_role
// uniquement), jamais via ce helper.
export async function ensureFreshAccessToken(
  svc: SupabaseClient, provider: GoogleProvider, organisationId: string,
): Promise<RefreshResult> {
  const table = connectionsTable(provider)
  const { data: connection, error } = await svc
    .from(table)
    .select('id, status, access_token_secret_id, refresh_token_secret_id, token_expires_at')
    .eq('organisation_id', organisationId)
    .maybeSingle()

  if (error) return { status: 'error', reason: 'lecture_connexion_echouee' }
  if (!connection || connection.status === 'disconnected') return { status: 'not_connected' }

  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return { status: 'fresh' }
  }

  if (!connection.refresh_token_secret_id) {
    await svc.from(table).update({ status: 'expired', last_error: 'refresh_token_absent' }).eq('organisation_id', organisationId)
    return { status: 'needs_reconnect', reason: 'refresh_token_absent' }
  }

  let refreshTokenValue: string | null
  try {
    refreshTokenValue = await vaultReadSecret(svc, connection.refresh_token_secret_id)
  } catch {
    return { status: 'error', reason: 'lecture_vault_echouee' }
  }
  if (!refreshTokenValue) {
    await svc.from(table).update({ status: 'expired', last_error: 'refresh_token_illisible' }).eq('organisation_id', organisationId)
    return { status: 'needs_reconnect', reason: 'refresh_token_illisible' }
  }

  let tokenRes: Response
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshTokenValue,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    })
  } catch {
    return { status: 'error', reason: 'reseau_google_indisponible' }
  }

  const json = (await tokenRes.json()) as GoogleRefreshResponse

  if (!tokenRes.ok || !json.access_token) {
    // invalid_grant = refresh_token révoqué/expiré côté Google — la
    // connexion nécessite une reconnexion complète, pas un simple retry.
    const reason = json.error ?? `http_${tokenRes.status}`
    const needsReconnect = json.error === 'invalid_grant'
    await svc.from(table).update({
      status: needsReconnect ? 'expired' : connection.status,
      last_error: reason,
    }).eq('organisation_id', organisationId)
    return needsReconnect ? { status: 'needs_reconnect', reason } : { status: 'error', reason }
  }

  try {
    await vaultUpdateSecret(svc, connection.access_token_secret_id!, json.access_token)
  } catch {
    return { status: 'error', reason: 'ecriture_vault_echouee' }
  }

  const newExpiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString()
  await svc.from(table).update({
    token_expires_at: newExpiresAt,
    last_synced_at: new Date().toISOString(),
    last_error: null,
    status: 'connected',
  }).eq('organisation_id', organisationId)

  return { status: 'refreshed' }
}
