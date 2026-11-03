// tests/helpers/authLinks.ts
// Fabrique de liens d'invitation / de réinitialisation pour les tests
// navigateur, contre la pile Supabase LOCALE. Utilise le même appel serveur
// que les Edge Functions (auth.admin.generateLink) et le même format de lien
// applicatif (/activation|/reset-password?token_hash=…&type=…) — la logique
// des fonctions elles-mêmes est couverte par npm run test:auth-integration.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_ = process.env.SUPABASE_TEST_URL ?? ''
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? ''

export function assertLocalStack() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_) || !SERVICE) {
    throw new Error('Ces tests exigent une pile Supabase locale (SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY dans .env.test)')
  }
}

let _admin: SupabaseClient | null = null
export function adminClient(): SupabaseClient {
  assertLocalStack()
  _admin ??= createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  return _admin
}

export async function orgOf(email: string): Promise<string> {
  const { data, error } = await adminClient().from('profiles').select('organisation_id').eq('email', email).single()
  if (error || !data) throw new Error(`profil ${email} introuvable`)
  return data.organisation_id as string
}

export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@kaytek.test`

/** Crée un compte invité (profil via le trigger handle_new_user) et renvoie le lien applicatif + l'action_link Supabase brut. */
export async function createInvite(opts: { email: string; role: 'intervenant' | 'assistant'; organisationId: string }) {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: 'invite', email: opts.email,
    options: { data: { nom: 'E2E', prenom: opts.role, role: opts.role, organisation_id: opts.organisationId } },
  })
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink invite: ${error?.message}`)
  // Comme inviter-intervenant : le profil (rôle + organisation) est écrit par le
  // serveur, handle_new_user() ignorant les métadonnées utilisateur.
  const { error: pErr } = await adminClient().from('profiles').upsert(
    { id: data.user.id, email: opts.email, nom: 'E2E', prenom: opts.role, role: opts.role, organisation_id: opts.organisationId, actif: true },
    { onConflict: 'id' },
  )
  if (pErr) throw new Error(`profil invité: ${pErr.message}`)
  return {
    userId: data.user.id,
    appPath: `/activation?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`,
    actionLink: data.properties.action_link,
  }
}

export async function createRecovery(email: string) {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: 'recovery', email })
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink recovery: ${error?.message}`)
  return `/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`
}

/** Compte déjà actif (mot de passe connu) dans l'organisation donnée. */
export async function createActiveUser(opts: { email: string; password: string; role: 'intervenant' | 'assistant'; organisationId: string }) {
  const { data, error } = await adminClient().auth.admin.createUser({
    email: opts.email, password: opts.password, email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`)
  const { error: pErr } = await adminClient().from('profiles').insert(
    { id: data.user.id, email: opts.email, nom: 'E2E', prenom: opts.role, role: opts.role, organisation_id: opts.organisationId, actif: true },
  )
  if (pErr) throw new Error(`profil: ${pErr.message}`)
  return data.user.id
}

export async function roleAndOrg(userId: string) {
  const { data } = await adminClient().from('profiles').select('role, organisation_id').eq('id', userId).single()
  return data as { role: string; organisation_id: string } | null
}

export async function deleteUsers(ids: string[]) {
  for (const id of ids) {
    await adminClient().from('devices').delete().eq('user_id', id)
    await adminClient().from('profiles').delete().eq('id', id)
    await adminClient().auth.admin.deleteUser(id)
  }
}

/**
 * Ancien format d'e-mail : suit l'action_link Supabase (/auth/v1/verify) sans
 * le navigateur et renvoie l'URL de redirection (#access_token=…&type=…),
 * recalée sur l'URL de l'application de test — reproduit l'arrivée sur la
 * racine du Site URL constatée en production.
 */
export async function followLegacyLink(actionLink: string, baseURL: string): Promise<string> {
  const res = await fetch(actionLink, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (!location) throw new Error(`pas de redirection (HTTP ${res.status})`)
  const u = new URL(location)
  return `${baseURL}/${u.hash}`
}
