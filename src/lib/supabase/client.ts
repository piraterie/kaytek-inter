// src/lib/supabase/client.ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!url || !key) console.error('Variables Supabase manquantes dans .env.local')

// URL d'arrivée figée AVANT createClient() : avec detectSessionInUrl, le SDK
// consomme puis efface de façon asynchrone le hash (#access_token=…&type=invite)
// des anciens liens d'invitation/réinitialisation — le lire plus tard dans un
// rendu React le trouverait déjà vidé (voir Guard dans App.tsx).
export const initialAuthUrl = typeof window !== 'undefined'
  ? { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }
  : { pathname: '/', search: '', hash: '' }

export const supabase = createClient(url, key, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'kaytek-auth',
    // Active supabase.auth.signInWithPasskey()/registerPasskey() — API "experimental"
    // du SDK, mais qui délègue la vérification WebAuthn et l'émission de session au
    // serveur GoTrue lui-même (voir src/lib/biometric.ts). Nécessite aussi que le
    // projet Supabase ait les passkeys activés côté serveur (Dashboard → Authentication),
    // sans quoi ces appels échouent proprement avec passkeys_enabled=false.
    experimental: { passkey: true },
  },
  realtime: { params: { eventsPerSecond: 10 } }
})

export default supabase
