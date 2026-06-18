// guide/setup/create-auth-files.ts
// Génère les fichiers de session guide/.auth/admin.json et guide/.auth/intervenant.json
// en signant directement via le client Supabase JS (sans navigateur).
//
// Utilisé comme globalSetup dans playwright.guide.config.ts
// Peut aussi être lancé manuellement : npx tsx guide/setup/create-auth-files.ts

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'

function loadEnv(file: string) {
  const p = path.resolve(file)
  if (!existsSync(p)) return
  readFileSync(p, 'utf-8').split('\n').forEach(l => {
    if (!l.trim() || l.startsWith('#')) return
    const idx = l.indexOf('='); if (idx === -1) return
    const k = l.slice(0, idx).trim()
    const v = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (k && !process.env[k]) process.env[k] = v
  })
}

// Clé localStorage utilisée par le client Supabase de l'app (voir src/lib/supabase/client.ts)
function storageKey(_url: string): string {
  return 'kaytek-auth'
}

// Format storageState attendu par Playwright
function buildStorageState(supabaseUrl: string, session: any): object {
  return {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:5173',
        localStorage: [
          {
            name: storageKey(supabaseUrl),
            value: JSON.stringify({
              access_token:  session.access_token,
              token_type:    session.token_type ?? 'bearer',
              expires_in:    3600,
              expires_at:    session.expires_at,
              refresh_token: session.refresh_token,
              user:          session.user,
            }),
          },
        ],
      },
    ],
  }
}

async function createAuthFile(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
  dest: string
): Promise<void> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`Connexion échouée pour ${email} : ${error?.message || 'session nulle'}`)
  }
  const state = buildStorageState(supabaseUrl, data.session)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, JSON.stringify(state, null, 2))
  console.log(`  ✅  ${email}`)
  await client.auth.signOut()
}

// Export par défaut pour Playwright globalSetup
export default async function setup() {
  loadEnv('.env.guide')
  loadEnv('.env.test')

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || ''
  const ADMIN_EMAIL  = process.env.GUIDE_ADMIN_EMAIL         || 'admin@kaytek.test'
  const ADMIN_PASS   = process.env.GUIDE_ADMIN_PASSWORD       || 'KaytekAdmin2024!'
  const INTER_EMAIL  = process.env.GUIDE_INTERVENANT_EMAIL   || 'intervenant@kaytek.test'
  const INTER_PASS   = process.env.GUIDE_INTERVENANT_PASSWORD || 'KaytekInter2024!'
  const ADMIN_FILE   = path.resolve('guide', '.auth', 'admin.json')
  const INTER_FILE   = path.resolve('guide', '.auth', 'intervenant.json')

  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis')
  }

  console.log('\n🔑  Authentification des comptes démo guide...')
  await createAuthFile(SUPABASE_URL, ANON_KEY, ADMIN_EMAIL,  ADMIN_PASS,  ADMIN_FILE)
  await createAuthFile(SUPABASE_URL, ANON_KEY, INTER_EMAIL,  INTER_PASS,  INTER_FILE)
  console.log('    Sessions créées.\n')
}

// Exécution directe (npx tsx ...)
if (process.argv[1] && process.argv[1].endsWith('create-auth-files.ts')) {
  setup().catch(err => { console.error('\n❌', err.message); process.exit(1) })
}
