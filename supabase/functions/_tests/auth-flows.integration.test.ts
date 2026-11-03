// supabase/functions/_tests/auth-flows.integration.test.ts
//
// Test d'intégration des Edge Functions inviter-intervenant et
// demander-reinitialisation contre une pile Supabase LOCALE réelle (GoTrue +
// PostgREST + trigger handle_new_user). Seul l'appel à l'API Brevo est
// simulé, pour capturer l'e-mail et le lien qu'il contient.
//
// Prérequis : `supabase start` + `node scripts/seed-local-test-accounts.mjs`.
// Exécution : npm run test:auth-integration
// Garde : refuse de s'exécuter si SUPABASE_TEST_URL n'est pas locale.
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
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
const ANON = env.SUPABASE_TEST_ANON_KEY
const SERVICE = env.SUPABASE_TEST_SERVICE_ROLE_KEY

Deno.env.set('SUPABASE_URL', URL_)
Deno.env.set('SUPABASE_ANON_KEY', ANON)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
Deno.env.set('BREVO_API_KEY', 'fake-brevo-key-never-real')
Deno.env.set('EMAIL_FROM', 'Kaytek Inter <noreply@kaytek.test>')
Deno.env.set('APP_URL', 'https://app.kaytekinter.fr')

// Brevo simulé, tout le reste part vers la pile locale.
const sent: Array<{ to: string; subject: string; html: string }> = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (u.startsWith('https://api.brevo.com/')) {
    const body = JSON.parse(String(init?.body ?? '{}'))
    sent.push({ to: body.to?.[0]?.email, subject: body.subject, html: body.htmlContent })
    return new Response(JSON.stringify({ messageId: 'test' }), { status: 201 })
  }
  return realFetch(input as any, init)
}) as typeof fetch

const { handleInviterIntervenant } = await import('../inviter-intervenant/index.ts')
const { handleDemanderReinitialisation } = await import('../demander-reinitialisation/index.ts')

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = () => createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

async function jwtFor(email: string, password: string): Promise<string> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`connexion ${email} impossible: ${error?.message}`)
  return data.session.access_token
}

const ADMIN_A_EMAIL = env.TEST_ADMIN_A_EMAIL ?? env.TEST_ADMIN_EMAIL
const adminJwt = await jwtFor(ADMIN_A_EMAIL, env.TEST_ADMIN_A_PASSWORD ?? env.TEST_ADMIN_PASSWORD)
const { data: adminProfile } = await admin.from('profiles').select('organisation_id').eq('email', ADMIN_A_EMAIL).single()
const ORG_A = adminProfile!.organisation_id as string

const created: string[] = []
const stamp = Date.now()
const addr = (tag: string) => `it-${tag}-${stamp}@kaytek.test`

function invite(body: Record<string, unknown>, opts: { jwt?: string; origin?: string } = {}) {
  return handleInviterIntervenant(new Request('http://local/inviter-intervenant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.jwt ?? adminJwt}`, 'Content-Type': 'application/json', Origin: opts.origin ?? 'http://localhost:5173' },
    body: JSON.stringify(body),
  })).then(async (r) => ({ status: r.status, body: await r.json() }))
}

function reset(email: unknown, origin = 'http://localhost:5173') {
  return handleDemanderReinitialisation(new Request('http://local/demander-reinitialisation', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email }),
  })).then(async (r) => ({ status: r.status, body: await r.json() }))
}

function lastLink(): URL {
  const html = sent.at(-1)!.html
  const m = html.match(/href="([^"]+)"/)
  assert(m, 'lien absent du mail')
  return new URL(m[1].replace(/&amp;/g, '&'))
}

async function profileOf(email: string) {
  const { data } = await admin.from('profiles').select('id, role, organisation_id, actif, commission_pct').eq('email', email).maybeSingle()
  if (data?.id && !created.includes(data.id)) created.push(data.id)
  return data
}

const opts = { sanitizeOps: false, sanitizeResources: false }

Deno.test({ name: 'invitation assistant — profil serveur correct, lien /activation token_hash valide', ...opts, fn: async () => {
  const email = addr('assistant')
  const r = await invite({ email, nom: 'Test', prenom: 'Assistant', role: 'assistant' })
  assertEquals(r.body, { error: null, kind: 'invite' })
  const link = lastLink()
  assertEquals(sent.at(-1)!.to, email)
  assertEquals(link.origin + link.pathname, 'http://localhost:5173/activation')
  assertEquals(link.searchParams.get('type'), 'invite')
  const p = await profileOf(email)
  assertEquals([p?.role, p?.organisation_id, p?.actif], ['assistant', ORG_A, true])
  // Le jeton du mail ouvre bien une session pour CETTE personne.
  const { data, error } = await anon().auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'invite' })
  assertEquals(error, null)
  assertEquals(data.user?.email, email)
  // Réutilisation du même lien : refusée.
  const again = await anon().auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'invite' })
  assert(again.error, 'un lien déjà utilisé doit être refusé')
}})

Deno.test({ name: 'invitation intervenant — rôle et commission', ...opts, fn: async () => {
  const email = addr('interv')
  const r = await invite({ email, nom: 'Test', prenom: 'Interv', role: 'intervenant', commission_pct: 25 })
  assertEquals(r.body.error, null)
  const p = await profileOf(email)
  assertEquals([p?.role, p?.organisation_id, p?.commission_pct], ['intervenant', ORG_A, 25])
}})

Deno.test({ name: 'renvoi d\'une invitation en attente — nouveau lien invite, ancien invalidé', ...opts, fn: async () => {
  const email = addr('pending')
  await invite({ email, nom: 'Test', prenom: 'Pending', role: 'intervenant' })
  const first = lastLink().searchParams.get('token_hash')!
  const r = await invite({ email, nom: 'Test', prenom: 'Pending', role: 'intervenant' })
  assertEquals(r.body, { error: null, kind: 'invite' })
  const second = lastLink().searchParams.get('token_hash')!
  assert(first !== second)
  const old = await anon().auth.verifyOtp({ token_hash: first, type: 'invite' })
  assert(old.error, 'l\'ancien lien doit être invalidé par le renvoi')
  const fresh = await anon().auth.verifyOtp({ token_hash: second, type: 'invite' })
  assertEquals(fresh.error, null)
  await profileOf(email)
}})

Deno.test({ name: 'renvoi à un compte déjà activé — lien recovery vers /activation, rôle inchangé', ...opts, fn: async () => {
  const email = addr('assistant')
  const r = await invite({ email, nom: 'Test', prenom: 'Assistant', role: 'assistant' })
  assertEquals(r.body, { error: null, kind: 'recovery' })
  const link = lastLink()
  assertEquals(link.pathname, '/activation')
  assertEquals(link.searchParams.get('type'), 'recovery')
  assertEquals((await profileOf(email))?.role, 'assistant')
  const { error } = await anon().auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'recovery' })
  assertEquals(error, null)
}})

Deno.test({ name: 'refus : rôle admin, administrateur existant, autre organisation, non-admin', ...opts, fn: async () => {
  const before = sent.length
  assertStringIncludes((await invite({ email: addr('esc'), nom: 'X', prenom: 'Y', role: 'admin' })).body.error, 'Rôle invalide')
  assertStringIncludes((await invite({ email: ADMIN_A_EMAIL, nom: 'X', prenom: 'Y', role: 'intervenant' })).body.error, 'administrateur')
  assertEquals((await profileOf(ADMIN_A_EMAIL))?.role, 'admin')
  const otherOrg = env.TEST_ADMIN_B_EMAIL
  assertStringIncludes((await invite({ email: otherOrg, nom: 'X', prenom: 'Y', role: 'intervenant' })).body.error, 'autre organisation')
  const intervJwt = await jwtFor(env.TEST_INTERVENANT_A_EMAIL ?? env.TEST_INTERVENANT_EMAIL, env.TEST_INTERVENANT_A_PASSWORD ?? env.TEST_INTERVENANT_PASSWORD)
  assertEquals((await invite({ email: addr('x'), nom: 'X', prenom: 'Y' }, { jwt: intervJwt })).status, 403)
  assertEquals(sent.length, before, 'aucun mail ne doit partir')
}})

Deno.test({ name: 'origine forgée — le lien pointe vers APP_URL, jamais vers le site tiers', ...opts, fn: async () => {
  const email = addr('origin')
  await invite({ email, nom: 'Test', prenom: 'Origin', role: 'intervenant' }, { origin: 'https://attaquant.example' })
  assertEquals(lastLink().origin, 'https://app.kaytekinter.fr')
  await profileOf(email)
}})

Deno.test({ name: 'mot de passe oublié — adresse inconnue : même réponse, aucun mail', ...opts, fn: async () => {
  const before = sent.length
  const r = await reset(`inconnu-${stamp}@kaytek.test`)
  assertEquals([r.status, r.body], [200, { error: null }])
  assertEquals(sent.length, before)
}})

Deno.test({ name: 'mot de passe oublié — compte existant : lien /reset-password, anti-flood, jeton valide', ...opts, fn: async () => {
  const email = addr('interv')
  const r = await reset(email.toUpperCase())
  assertEquals([r.status, r.body], [200, { error: null }])
  const link = lastLink()
  assertEquals(sent.at(-1)!.to, email)
  assertEquals(link.pathname, '/reset-password')
  assertEquals(link.searchParams.get('type'), 'recovery')
  const count = sent.length
  const again = await reset(email)
  assertEquals([again.status, again.body], [200, { error: null }])
  assertEquals(sent.length, count, 'deuxième demande immédiate ignorée (anti-flood)')
  const { error } = await anon().auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'recovery' })
  assertEquals(error, null)
}})

Deno.test({ name: 'mot de passe oublié — compte désactivé : aucun mail ; adresse invalide : 400', ...opts, fn: async () => {
  const email = addr('origin')
  await admin.from('profiles').update({ actif: false }).eq('email', email)
  const before = sent.length
  assertEquals((await reset(email)).body, { error: null })
  assertEquals(sent.length, before)
  assertEquals((await reset('pas-une-adresse')).status, 400)
}})

Deno.test({ name: 'faille d\'inscription — un signUp public avec organisation_id ne rejoint aucune entreprise', ...opts, fn: async () => {
  const email = addr('signup')
  const { data, error } = await anon().auth.signUp({
    email, password: 'Inscription2026x',
    options: { data: { organisation_id: ORG_A, role: 'assistant', nom: 'Pirate', prenom: 'Test' } },
  })
  assertEquals(error, null)
  const userId = data.user!.id
  created.push(userId)
  const { data: p } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
  assertEquals(p, null, 'aucun profil membre ne doit être créé depuis des métadonnées utilisateur')
}})

Deno.test({ name: 'nettoyage des comptes créés', ...opts, fn: async () => {
  for (const id of created) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
}})
