// src/lib/hooks/googleIntegrations.ts
// Connexions Google Ads / Google Business Profile — Phase 2 (OAuth réel).
// Le frontend n'appelle QUE les Edge Functions (google-oauth-start/
// -status/-disconnect) : jamais d'accès direct aux tables
// google_ads_connections/gbp_connections, jamais de token manipulé ici.
// google-oauth-callback n'est jamais appelé depuis ce fichier — Google y
// redirige directement le navigateur.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'

const orgId = () => useAuthStore.getState().user?.organisation_id

// ── Appel aux Edge Functions Google protégées (admin) ────────────────────
// `supabase.functions.invoke` attache normalement le JWT de session
// implicitement, mais cette injection dépend de l'hydratation asynchrone
// de la session côté client — juste après la redirection plein-page du
// callback OAuth (retour depuis accounts.google.com), la session peut ne
// pas encore être restaurée au moment du premier appel, ce qui produit un
// appel sans header Authorization (rejeté par la gateway Supabase avec
// UNAUTHORIZED_NO_AUTH_HEADER). On récupère donc explicitement la session
// courante et on force le header Authorization à chaque appel.
async function invokeGoogleFunction<T>(
  name: string, body?: Record<string, unknown>,
): Promise<{ data: T | null; error: Error | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return { data: null, error: new Error('Session expirée — reconnectez-vous.') }
  }
  const { data, error } = await supabase.functions.invoke<T>(name, {
    ...(body ? { body } : {}),
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  return { data: data ?? null, error }
}

export type GoogleProvider = 'google_ads' | 'google_business'
export type GoogleConnectionStatus = 'disconnected' | 'connected' | 'expired' | 'revoked'

export interface GoogleConnectionInfo {
  status: GoogleConnectionStatus
  connected_at?: string | null
  last_synced_at?: string | null
  last_error?: string | null
  updated_at?: string | null
  google_account_email?: string | null
  selected_at?: string | null
  // Google Ads uniquement
  google_customer_id?: string | null
  google_login_customer_id?: string | null
  customer_descriptive_name?: string | null
  is_manager_account?: boolean | null
  currency_code?: string | null
  time_zone?: string | null
  // Google Business Profile uniquement
  google_location_id?: string | null
  google_account_id?: string | null
  account_name?: string | null
  location_title?: string | null
  location_address?: string | null
  location_open_status?: string | null
}

// ── Découverte et sélection de comptes (Phase 3) ─────────────────────────
export type AdsAccountsErrorReason =
  | 'not_connected' | 'needs_reconnect' | 'developer_token_missing'
  | 'developer_token_unapproved' | 'api_not_enabled' | 'insufficient_permission' | 'google_error'

export interface AdsAccountInfo {
  customerId: string
  resourceName: string
  descriptiveName: string | null
  status: string | null
  currencyCode: string | null
  timeZone: string | null
  isManager: boolean
  managerCustomerId: string | null
  infoIncomplete: boolean
}

export type AdsAccountsResponse =
  | { ok: true; accounts: AdsAccountInfo[] }
  | { ok: false; reason: AdsAccountsErrorReason; detail?: string }

export interface GbpLocationInfo {
  accountResourceName: string
  accountName: string | null
  accountType: string | null
  locationResourceName: string
  storeCode: string | null
  title: string | null
  address: string | null
  phone: string | null
  openStatus: string | null
  mapsUri: string | null
  verificationStatus: 'unknown'
}

export type GbpLocationsErrorReason =
  | 'not_connected' | 'needs_reconnect' | 'api_not_enabled' | 'insufficient_permission' | 'google_error'

export type GbpLocationsResponse =
  | { ok: true; accounts: { accountResourceName: string; accountName: string | null; accountType: string | null; locations: GbpLocationInfo[] }[] }
  | { ok: false; reason: GbpLocationsErrorReason; detail?: string }

// Liste les comptes Ads accessibles — appelé à la demande (bouton
// "Charger mes comptes"), jamais automatiquement au chargement de la page
// (évite un appel Google Ads API à chaque visite de /parametres/integrations).
export function useLoadGoogleAdsAccounts() {
  return useMutation<AdsAccountsResponse>({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<AdsAccountsResponse>('google-ads-list-accounts')
      if (error) throw error
      if (!data) throw new Error('Réponse vide')
      return data
    },
  })
}

export function useLoadGoogleBusinessLocations() {
  return useMutation<GbpLocationsResponse>({
    mutationFn: async () => {
      const { data, error } = await invokeGoogleFunction<GbpLocationsResponse>('google-business-list-locations')
      if (error) throw error
      if (!data) throw new Error('Réponse vide')
      return data
    },
  })
}

export function useSelectGoogleAdsAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (customerId: string) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; error?: string }>(
        'google-select-connection', { provider: 'google_ads', customerId },
      )
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Association impossible')
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-oauth-status'] }),
  })
}

export function useSelectGoogleBusinessLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { accountResourceName: string; locationResourceName: string }) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; error?: string }>(
        'google-select-connection', { provider: 'google_business', ...params },
      )
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Association impossible')
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-oauth-status'] }),
  })
}

export interface GoogleOAuthStatusResponse {
  google_ads: GoogleConnectionInfo
  google_business: GoogleConnectionInfo
  error?: string
}

// ── Statut des deux connexions (organisation de l'utilisateur courant) ──
export function useGoogleOAuthStatus() {
  const org = orgId()
  return useQuery<GoogleOAuthStatusResponse>({
    queryKey: ['google-oauth-status', org],
    queryFn: async () => {
      const { data, error } = await invokeGoogleFunction<GoogleOAuthStatusResponse>('google-oauth-status')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as GoogleOAuthStatusResponse
    },
    enabled: !!org,
    // Statut susceptible de changer côté serveur (renouvellement de
    // token, expiration) — revalidation raisonnable sans être agressive.
    staleTime: 30_000,
  })
}

// ── Démarrer la connexion : retourne l'URL Google à ouvrir (redirection
// pleine page — jamais de popup manipulant un token, jamais de token
// dans cette réponse). ───────────────────────────────────────────────────
export function useConnectGoogle() {
  return useMutation({
    mutationFn: async (provider: GoogleProvider) => {
      const { data, error } = await invokeGoogleFunction<{ authUrl?: string; error?: string }>(
        'google-oauth-start', { provider },
      )
      if (error) throw error
      if (!data?.authUrl) throw new Error(data?.error || 'Impossible de démarrer la connexion Google')
      return data.authUrl
    },
  })
}

// ── Déconnexion ──────────────────────────────────────────────────────────
export function useDisconnectGoogle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (provider: GoogleProvider) => {
      const { data, error } = await invokeGoogleFunction<{ ok?: boolean; error?: string }>(
        'google-oauth-disconnect', { provider },
      )
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Déconnexion impossible')
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-oauth-status'] }),
  })
}
