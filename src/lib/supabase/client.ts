// src/lib/supabase/client.ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!url || !key) console.error('Variables Supabase manquantes dans .env.local')

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
