#!/usr/bin/env node
// scripts/seed-local-test-accounts.mjs
// Amorce les comptes minimaux nécessaires pour que tests/auth.setup.ts
// puisse se connecter (admin + intervenant org A, admin org B) sur une
// instance Supabase LOCALE fraîchement réinitialisée (`supabase db
// reset` n'exécute aucun seed.sql — ce dépôt n'en a pas). Idempotent :
// vérifie l'existence avant de créer, peut être relancé sans dupliquer.
//
// Garde anti-production : refuse de s'exécuter si SUPABASE_TEST_URL ne
// pointe pas vers un hôte local.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

function loadEnvFile(file) {
  if (!existsSync(file)) return
  readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).forEach((l) => {
    const idx = l.indexOf('=')
    if (idx === -1) return
    const k = l.slice(0, idx).trim()
    const v = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (k && !process.env[k]) process.env[k] = v
  })
}
loadEnvFile('.env.test')

const url = process.env.SUPABASE_TEST_URL
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('[seed-local] SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY manquants (.env.test).')
  process.exit(1)
}
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`[seed-local] REFUS — SUPABASE_TEST_URL pointe vers un hôte non local (${host}).`)
  process.exit(1)
}

const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

async function upsertOrg(slug, nom) {
  const { data: existing } = await svc.from('organisations').select('id').eq('slug', slug).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await svc.from('organisations').insert({ slug, nom, plan: 'pro', actif: true }).select('id').single()
  if (error) throw new Error(`org ${slug}: ${error.message}`)
  return data.id
}

async function upsertUser(email, password) {
  const { data: existing } = await svc.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`auth user ${email}: ${error.message}`)
  return data.user.id
}

async function upsertProfile({ id, email, nom, prenom, role, organisationId }) {
  const { error } = await svc.from('profiles').upsert(
    { id, email, nom, prenom, role, organisation_id: organisationId, actif: true, welcome_dismissed: true },
    { onConflict: 'id' }
  )
  if (error) throw new Error(`profile ${email}: ${error.message}`)
}

async function ensureParametresEntreprise(orgId, raisonSociale) {
  const { data: existing } = await svc.from('parametres_entreprise').select('id').eq('organisation_id', orgId).maybeSingle()
  if (existing) return
  const { error } = await svc.from('parametres_entreprise').insert({
    organisation_id: orgId, raison_sociale: raisonSociale,
    telephone: '0100000000', email: `contact@${raisonSociale.toLowerCase().replace(/\s+/g, '-')}.test`,
    adresse: '1 rue de Test', code_postal: '75001', ville: 'Paris', siret: '00000000000000',
  })
  if (error) throw new Error(`parametres_entreprise ${orgId}: ${error.message}`)
}

async function ensureActiveSubscription(userId, orgId) {
  const { data: existing } = await svc.from('subscriptions').select('user_id').eq('user_id', userId).maybeSingle()
  if (existing) {
    await svc.from('subscriptions').update({ subscription_status: 'active', organisation_id: orgId }).eq('user_id', userId)
    return
  }
  const { error } = await svc.from('subscriptions').insert({ user_id: userId, organisation_id: orgId, subscription_status: 'active' })
  if (error) throw new Error(`subscription ${userId}: ${error.message}`)
}

async function main() {
  const orgAId = await upsertOrg('test-org-a-local', 'Test Org A (local)')
  const orgBId = await upsertOrg('test-org-b-local', 'Test Org B (local)')
  await ensureParametresEntreprise(orgAId, 'Test Org A Local')
  await ensureParametresEntreprise(orgBId, 'Test Org B Local')

  const adminAId = await upsertUser(process.env.TEST_ADMIN_A_EMAIL, process.env.TEST_ADMIN_A_PASSWORD)
  await upsertProfile({ id: adminAId, email: process.env.TEST_ADMIN_A_EMAIL, nom: 'Admin', prenom: 'A', role: 'admin', organisationId: orgAId })
  await ensureActiveSubscription(adminAId, orgAId)

  const intervenantAId = await upsertUser(process.env.TEST_INTERVENANT_A_EMAIL, process.env.TEST_INTERVENANT_A_PASSWORD)
  await upsertProfile({ id: intervenantAId, email: process.env.TEST_INTERVENANT_A_EMAIL, nom: 'Intervenant', prenom: 'A', role: 'intervenant', organisationId: orgAId })

  const adminBId = await upsertUser(process.env.TEST_ADMIN_B_EMAIL, process.env.TEST_ADMIN_B_PASSWORD)
  await upsertProfile({ id: adminBId, email: process.env.TEST_ADMIN_B_EMAIL, nom: 'Admin', prenom: 'B', role: 'admin', organisationId: orgBId })
  await ensureActiveSubscription(adminBId, orgBId)

  if (process.env.TEST_ASSISTANT_A_EMAIL && process.env.TEST_ASSISTANT_A_PASSWORD) {
    const assistantAId = await upsertUser(process.env.TEST_ASSISTANT_A_EMAIL, process.env.TEST_ASSISTANT_A_PASSWORD)
    await upsertProfile({ id: assistantAId, email: process.env.TEST_ASSISTANT_A_EMAIL, nom: 'Assistant', prenom: 'A', role: 'assistant', organisationId: orgAId })
  }

  console.log('[seed-local] OK — admin A, intervenant A, admin B (+ assistant A si défini) prêts (org A/B, abonnements actifs).')
}

main().catch((err) => { console.error('[seed-local] ÉCHEC —', err.message); process.exit(1) })
