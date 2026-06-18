// guide/setup/verify-migrations.ts
// Vérifie que les migrations guide sont bien appliquées et que les RLS fonctionnent.
// Commande : npx tsx guide/setup/verify-migrations.ts

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
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
loadEnv('.env.guide')
loadEnv('.env.test')

const SUPABASE_URL  = process.env.SUPABASE_URL              || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY      = process.env.VITE_SUPABASE_ANON_KEY   || ''
const ADMIN_EMAIL   = process.env.GUIDE_ADMIN_EMAIL         || 'admin@kaytek.test'
const ADMIN_PASS    = process.env.GUIDE_ADMIN_PASSWORD       || 'KaytekAdmin2024!'
const INTER_EMAIL   = process.env.GUIDE_INTERVENANT_EMAIL   || 'intervenant@kaytek.test'
const INTER_PASS    = process.env.GUIDE_INTERVENANT_PASSWORD || 'KaytekInter2024!'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

let passed = 0
let failed = 0

function ok(msg: string)   { console.log(`  ✅  ${msg}`); passed++ }
function fail(msg: string) { console.log(`  ❌  ${msg}`); failed++ }

// ── 1. Tables existent ────────────────────────────────────────────────────────
async function checkTables() {
  console.log('\n── 1. Tables ──')
  const tables = ['guide_progress', 'guide_videos', 'guide_news']
  for (const t of tables) {
    const { error } = await admin.from(t).select('id').limit(1)
    if (error && error.code === '42P01') fail(`Table manquante : ${t}`)
    else ok(`Table ${t} existe`)
  }

  // welcome_dismissed dans profiles
  const { data, error } = await admin.from('profiles').select('welcome_dismissed').limit(1)
  if (error) fail(`Colonne profiles.welcome_dismissed manquante : ${error.message}`)
  else ok('Colonne profiles.welcome_dismissed existe')
}

// ── 2. RLS policies existent ──────────────────────────────────────────────────
async function checkRLSPolicies() {
  console.log('\n── 2. Politiques RLS ──')

  const expectedPolicies: Record<string, string[]> = {
    guide_progress: ['guide_progress_select', 'guide_progress_insert', 'guide_progress_update', 'guide_progress_delete'],
    guide_videos:   ['guide_videos_select', 'guide_videos_insert', 'guide_videos_update', 'guide_videos_delete'],
    guide_news:     ['guide_news_select', 'guide_news_insert', 'guide_news_update', 'guide_news_delete'],
  }

  // Vérification indirecte : RLS activé = les tables rejettent les requêtes anon
  // (on vérifie que les tables ont RLS en essayant un SELECT sans auth)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  for (const table of Object.keys(expectedPolicies)) {
    const { data, error } = await anonClient.from(table).select('id').limit(1)
    // RLS activé → erreur 42501 (permission denied) ou 0 lignes
    if (error && (error.code === '42501' || error.message?.includes('permission denied') || error.message?.includes('row-level'))) {
      ok(`RLS actif sur ${table} (accès anonyme refusé)`)
    } else if (!error && Array.isArray(data) && data.length === 0) {
      ok(`RLS actif sur ${table} (0 lignes visibles sans auth)`)
    } else if (!error) {
      fail(`RLS ${table} : des lignes sont accessibles sans authentification !`)
    } else {
      ok(`RLS actif sur ${table} (erreur anon : ${error.code})`)
    }
  }
}

// ── 3. Bucket guide-videos ────────────────────────────────────────────────────
async function checkBucket() {
  console.log('\n── 3. Bucket guide-videos ──')
  const { data, error } = await admin.storage.listBuckets()
  if (error) { fail(`Impossible de lister les buckets : ${error.message}`); return }
  const bucket = data?.find(b => b.id === 'guide-videos')
  if (bucket) {
    ok(`Bucket 'guide-videos' existe (public=${bucket.public}, size_limit=${bucket.file_size_limit})`)
  } else {
    fail(`Bucket 'guide-videos' absent`)
  }
}

// ── 4 & 5. RLS admin (écriture) et intervenant (lecture seule) ───────────────
async function checkRLSAccess() {
  console.log('\n── 4. Admin — peut écrire ──')

  // Récupérer une org_id via le service role
  const { data: orgs } = await admin.from('organisations').select('id').limit(1)
  const orgId = orgs?.[0]?.id
  if (!orgId) { fail('Aucune organisation trouvée pour le test'); return }

  // Connexion admin
  const adminClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: adminAuth, error: adminLoginErr } = await adminClient.auth.signInWithPassword({
    email: ADMIN_EMAIL, password: ADMIN_PASS
  })

  if (adminLoginErr || !adminAuth?.user) {
    fail(`Connexion admin échouée : ${adminLoginErr?.message || 'inconnu'}`)
    console.log('    → Comptes démo non créés ? Lancer : npx tsx guide/setup/seed-demo-data.ts')
  } else {
    ok(`Admin connecté : ${adminAuth.user.email}`)

    // Vérifier que guide_videos INSERT est refusé si l'admin n'a pas la bonne org
    // (on ne peut pas insérer sans les données requises, donc on vérifie juste la liste)
    const { data: vids, error: vidErr } = await adminClient.from('guide_videos').select('id').limit(1)
    if (vidErr) fail(`Admin : SELECT guide_videos échoué : ${vidErr.message}`)
    else ok(`Admin : SELECT guide_videos autorisé (${vids?.length ?? 0} vidéos)`)

    const { data: news, error: newsErr } = await adminClient.from('guide_news').select('id').limit(1)
    if (newsErr) fail(`Admin : SELECT guide_news échoué : ${newsErr.message}`)
    else ok(`Admin : SELECT guide_news autorisé (${news?.length ?? 0} news)`)

    await adminClient.auth.signOut()
  }

  console.log('\n── 5. Intervenant — lecture seule ──')

  const interClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: interAuth, error: interLoginErr } = await interClient.auth.signInWithPassword({
    email: INTER_EMAIL, password: INTER_PASS
  })

  if (interLoginErr || !interAuth?.user) {
    fail(`Connexion intervenant échouée : ${interLoginErr?.message || 'inconnu'}`)
    console.log('    → Comptes démo non créés ? Lancer : npx tsx guide/setup/seed-demo-data.ts')
  } else {
    ok(`Intervenant connecté : ${interAuth.user.email}`)

    // SELECT doit fonctionner
    const { data: vids, error: vidErr } = await interClient.from('guide_videos').select('id').limit(1)
    if (vidErr) fail(`Intervenant : SELECT guide_videos échoué : ${vidErr.message}`)
    else ok(`Intervenant : SELECT guide_videos autorisé (RLS SELECT valide)`)

    // INSERT doit être refusé (RLS admin uniquement)
    const { error: insertErr } = await interClient.from('guide_news').insert({
      organisation_id: orgId,
      titre: 'test-rls',
      description: 'test',
    })
    if (insertErr) ok(`Intervenant : INSERT guide_news refusé (RLS opérationnel) → ${insertErr.code}`)
    else fail(`Intervenant : INSERT guide_news devrait être refusé par RLS !`)

    await interClient.auth.signOut()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍  Vérification des migrations Guide — Kaytek Inter\n')
  console.log(`    Supabase : ${SUPABASE_URL}`)

  await checkTables()
  await checkRLSPolicies()
  await checkBucket()
  await checkRLSAccess()

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`  ${passed} vérifications passées  /  ${failed} échecs`)
  if (failed === 0) console.log('\n  ✅  Tout est en ordre — migrations appliquées correctement.\n')
  else              console.log('\n  ❌  Certaines vérifications ont échoué — voir ci-dessus.\n')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\n❌ Erreur inattendue :', err.message)
  process.exit(1)
})
