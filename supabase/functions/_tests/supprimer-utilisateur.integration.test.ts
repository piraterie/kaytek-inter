// supabase/functions/_tests/supprimer-utilisateur.integration.test.ts
//
// Test d'intégration de l'Edge Function supprimer-utilisateur contre une pile
// Supabase LOCALE réelle (GoTrue + PostgREST). Tous les comptes visés sont
// jetables (créés puis nettoyés ici) ; les appelants admin-a / admin-b sont les
// comptes de test locaux du seed.
//
// Prérequis : `supabase start` + `node scripts/seed-local-test-accounts.mjs`.
// Exécution : npm run test:delete-user-integration
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const l of Deno.readTextFileSync(file).split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue
      const i = l.indexOf('=')
      if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* fichier absent */ }
  return out
}

const env = loadEnv('.env.test')
const URL_ = env.SUPABASE_TEST_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  throw new Error(`SUPABASE_TEST_URL doit être une pile locale (reçu: ${URL_ || 'vide'})`)
}
Deno.env.set('SUPABASE_URL', URL_)
Deno.env.set('SUPABASE_ANON_KEY', env.SUPABASE_TEST_ANON_KEY)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_TEST_SERVICE_ROLE_KEY)

const { handleSupprimerUtilisateur } = await import('../supprimer-utilisateur/index.ts')

const admin = createClient(URL_, env.SUPABASE_TEST_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = () => createClient(URL_, env.SUPABASE_TEST_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function jwtFor(email: string, password: string): Promise<string> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`connexion ${email} impossible: ${error?.message}`)
  return data.session.access_token
}
async function orgOf(email: string): Promise<string> {
  const { data } = await admin.from('profiles').select('organisation_id').eq('email', email).single()
  return data!.organisation_id as string
}

const ADMIN_A = env.TEST_ADMIN_A_EMAIL ?? env.TEST_ADMIN_EMAIL
const ADMIN_B = env.TEST_ADMIN_B_EMAIL
const ORG_A = await orgOf(ADMIN_A)
const ORG_B = await orgOf(ADMIN_B)
const adminAJwt = await jwtFor(ADMIN_A, env.TEST_ADMIN_A_PASSWORD ?? env.TEST_ADMIN_PASSWORD)
const adminBJwt = await jwtFor(ADMIN_B, env.TEST_ADMIN_B_PASSWORD)
const { data: { user: adminAUser } } = await anon().auth.getUser(adminAJwt)

const stamp = Date.now()
const PASSWORD = 'Jetable2026x'
const created: string[] = []

async function disposable(tag: string, role: 'admin' | 'intervenant' | 'assistant', org: string, actif = true): Promise<{ id: string; email: string }> {
  const email = `del-${tag}-${stamp}@kaytek.test`
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`)
  created.push(data.user.id)
  const { error: pErr } = await admin.from('profiles').insert({ id: data.user.id, email, nom: 'Jetable', prenom: tag, role, organisation_id: org, actif })
  if (pErr) throw new Error(`profil ${tag}: ${pErr.message}`)
  return { id: data.user.id, email }
}

const victimA = await disposable('victim-a', 'intervenant', ORG_A)
const assistantVictimA = await disposable('assist-victim-a', 'assistant', ORG_A)
const adminA2 = await disposable('admin-a2', 'admin', ORG_A)
const assistantA = await disposable('assistant-a', 'assistant', ORG_A)
const intervenantA = await disposable('interv-a', 'intervenant', ORG_A)
const inactiveAdminA = await disposable('admin-inactif', 'admin', ORG_A, false)
const victimB = await disposable('victim-b', 'intervenant', ORG_B)

function call(body: unknown, jwt?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  return handleSupprimerUtilisateur(new Request('http://local/supprimer-utilisateur', {
    method: 'POST', headers, body: JSON.stringify(body),
  })).then(async (r) => ({ status: r.status, body: await r.json() }))
}

async function exists(id: string): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(id)
  const { data: p } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
  return !!data?.user && !!p
}

const opts = { sanitizeOps: false, sanitizeResources: false }

Deno.test({ name: 'sans connexion → 401, rien supprimé', ...opts, fn: async () => {
  assertEquals((await call({ userId: victimA.id }, null)).status, 401)
  assertEquals((await call({ userId: victimA.id }, 'jeton-invalide')).status, 401)
  assert(await exists(victimA.id))
}})

Deno.test({ name: 'assistant et intervenant appelants → 403, rien supprimé', ...opts, fn: async () => {
  const r1 = await call({ userId: victimA.id }, await jwtFor(assistantA.email, PASSWORD))
  const r2 = await call({ userId: victimA.id }, await jwtFor(intervenantA.email, PASSWORD))
  assertEquals([r1.status, r2.status], [403, 403])
  assert(await exists(victimA.id))
}})

Deno.test({ name: 'administrateur désactivé → 403, rien supprimé', ...opts, fn: async () => {
  const r = await call({ userId: victimA.id }, await jwtFor(inactiveAdminA.email, PASSWORD))
  assertEquals(r.status, 403)
  assert(await exists(victimA.id))
}})

Deno.test({ name: 'admin d\'une autre entreprise → 404, rien supprimé (organisation_id de la requête ignoré)', ...opts, fn: async () => {
  const r = await call({ userId: victimA.id }, adminBJwt)
  assertEquals(r.status, 404)
  const spoof = await call({ userId: victimA.id, organisation_id: ORG_A, organisationId: ORG_A }, adminBJwt)
  assertEquals(spoof.status, 404)
  assert(await exists(victimA.id))
  // et dans l'autre sens
  assertEquals((await call({ userId: victimB.id }, adminAJwt)).status, 404)
  assert(await exists(victimB.id))
}})

Deno.test({ name: 'auto-suppression et cible administrateur → 403, rien supprimé', ...opts, fn: async () => {
  assertEquals((await call({ userId: adminAUser!.id }, adminAJwt)).status, 403)
  assert(await exists(adminAUser!.id))
  assertEquals((await call({ userId: adminA2.id }, adminAJwt)).status, 403)
  assert(await exists(adminA2.id))
}})

Deno.test({ name: 'identifiant invalide → 400 ; inconnu → 404', ...opts, fn: async () => {
  assertEquals((await call({ userId: 'pas-un-uuid' }, adminAJwt)).status, 400)
  assertEquals((await call({}, adminAJwt)).status, 400)
  assertEquals((await call({ userId: crypto.randomUUID() }, adminAJwt)).status, 404)
}})

Deno.test({ name: 'suppression légitime : admin supprime un intervenant puis un assistant de son entreprise', ...opts, fn: async () => {
  for (const v of [victimA, assistantVictimA]) {
    const r = await call({ userId: v.id }, adminAJwt)
    assertEquals([r.status, r.body], [200, { error: null }])
    assertEquals(await exists(v.id), false, 'compte et profil supprimés')
  }
}})

Deno.test({ name: 'nettoyage des comptes jetables', ...opts, fn: async () => {
  for (const id of created) {
    await admin.from('devices').delete().eq('user_id', id)
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
}})
