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
    storageKey: 'kaytek-auth'
  },
  realtime: { params: { eventsPerSecond: 10 } }
})

export default supabase
