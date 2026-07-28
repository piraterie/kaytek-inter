#!/usr/bin/env node
// scripts/seed-security-fixtures.mjs
// Correction 6 (TEST-01) — amorce les comptes/organisations dédiés à la
// suite de sécurité sur une instance Supabase LOCALE fraîchement démarrée
// (garde anti-production réutilisée). Idempotent : peut être exécuté
// plusieurs fois de suite (CI) sans dupliquer ni échouer.
//
// VALIDATION-FINALE : étendu pour créer aussi un minimum de données
// métier (client/intervention/devis/facture pour l'org A, un client pour
// l'org B) — schéma désormais vérifié (colonnes/contraintes inspectées
// directement sur la base locale). Sans ces fixtures, les scénarios
// Storage/concurrence qui en dépendent se contentaient de WARNer (non
// bloquant, mais non probant) faute de données ; avec elles, ces
// scénarios s'exécutent réellement. Chaque insertion est idempotente
// (vérifie l'existence avant de créer) et n'utilise que des données
// manifestement fictives.
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = [
  'TEST_ADMIN_A_EMAIL', 'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL', 'TEST_ADMIN_B_PASSWORD',
  'TEST_INTERVENANT_A_EMAIL', 'TEST_INTERVENANT_A_PASSWORD',
]

// Exportées (en plus d'être utilisées par main() ci-dessous) pour être
// réutilisées par scripts/lib/seed-email-fixtures.mjs (tests d'intégration
// envoi email) — aucun changement de comportement, uniquement le mot-clé
// "export" ajouté sur les fonctions déjà existantes.
export async function upsertOrg(serviceClient, slug, nom) {
  const { data: existing } = await serviceClient.from('organisations').select('id').eq('slug', slug).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await serviceClient
    .from('organisations')
    .insert({ slug, nom, plan: 'pro', actif: true })
    .select('id')
    .single()
  if (error) throw new Error(`Création organisation ${slug} impossible : ${error.message}`)
  return data.id
}

// subscriptions.user_id est la clé primaire (une ligne par utilisateur, pas
// par organisation) — doit donc être créée APRÈS le compte admin, avec à la
// fois user_id ET organisation_id renseignés dans le même INSERT : le
// trigger on_subscription_provision_organisation (provision_subscriber_
// organisation(), migration 20260710000001) court-circuite immédiatement
// dès que NEW.organisation_id IS NOT NULL, donc ne tente jamais de créer une
// organisation concurrente pour ce user_id.
export async function ensureActiveSubscription(serviceClient, userId, orgId) {
  const { data: existing } = await serviceClient.from('subscriptions').select('user_id').eq('user_id', userId).maybeSingle()
  if (existing) {
    await serviceClient.from('subscriptions').update({ subscription_status: 'active', organisation_id: orgId }).eq('user_id', userId)
    return
  }
  const { error } = await serviceClient.from('subscriptions').insert({ user_id: userId, organisation_id: orgId, subscription_status: 'active' })
  if (error) throw new Error(`Création subscription pour user ${userId} (org ${orgId}) impossible : ${error.message}`)
}

export async function upsertAuthUser(serviceClient, email, password) {
  const { data: existingProfile } = await serviceClient.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existingProfile) return existingProfile.id

  const { data: created, error } = await serviceClient.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error) throw new Error(`Création utilisateur auth ${email} impossible : ${error.message}`)
  return created.user.id
}

export async function upsertProfile(serviceClient, { id, email, nom, prenom, role, organisationId }) {
  // welcome_dismissed: true — sans quoi la modale de bienvenue ("Bienvenue
  // sur Kaytek Inter") s'affiche à la première connexion de tout compte de
  // test fraîchement créé et intercepte les clics (élément overlay au-dessus
  // du bouton "+ Ajouter"), faisant échouer 02-isolation-create.spec.ts
  // (TimeoutError sur locator.click, sans rapport avec l'isolation testée).
  const { error } = await serviceClient.from('profiles').upsert({
    id, email, nom, prenom, role, organisation_id: organisationId, actif: true, welcome_dismissed: true,
  }, { onConflict: 'id' })
  if (error) throw new Error(`Upsert profil ${email} impossible : ${error.message}`)
}

async function ensureParametresEntreprise(serviceClient, orgId, raisonSociale) {
  const { data: existing } = await serviceClient.from('parametres_entreprise').select('id').eq('organisation_id', orgId).maybeSingle()
  if (existing) return
  const { error } = await serviceClient.from('parametres_entreprise').insert({ organisation_id: orgId, raison_sociale: raisonSociale })
  if (error) throw new Error(`Création parametres_entreprise pour org ${orgId} impossible : ${error.message}`)
}

export async function ensureClient(serviceClient, { orgId, nom, createdBy }) {
  const { data: existing } = await serviceClient.from('clients').select('id').eq('organisation_id', orgId).eq('nom', nom).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await serviceClient.from('clients')
    .insert({ organisation_id: orgId, nom, type: 'particulier', created_by: createdBy })
    .select('id').single()
  if (error) throw new Error(`Création client ${nom} impossible : ${error.message}`)
  return data.id
}

// Fixtures métier org A uniquement — nécessaires pour que les scénarios
// Storage (S1, intervention-photos) et concurrence (numérotation devis/
// factures, commission) s'exécutent réellement au lieu de WARNer faute de
// données. Org B ne reçoit qu'un client (donnée distincte minimale pour
// vérifier l'isolation, non utilisée par les runners automatisés — ceux-ci
// n'exigent que des fixtures pour org A).
export async function ensureOrgABusinessFixtures(serviceClient, orgAId, adminAId, intervenantAId) {
  const clientAId = await ensureClient(serviceClient, { orgId: orgAId, nom: 'SecurityTest Client A', createdBy: adminAId })

  let { data: interventionRow } = await serviceClient
    .from('interventions').select('id').eq('organisation_id', orgAId).eq('client_id', clientAId).maybeSingle()
  if (!interventionRow) {
    const { data, error } = await serviceClient.from('interventions').insert({
      organisation_id: orgAId, client_id: clientAId, intervenant_id: intervenantAId ?? adminAId,
      type: 'serrurerie', statut: 'termine', montant_ttc: 200, created_by: adminAId,
    }).select('id').single()
    if (error) throw new Error(`Création intervention de sécurité (org A) impossible : ${error.message}`)
    interventionRow = data
  }

  const { data: devisExisting } = await serviceClient
    .from('devis').select('id').eq('organisation_id', orgAId).eq('client_id', clientAId).maybeSingle()
  if (!devisExisting) {
    const { error } = await serviceClient.from('devis').insert({
      organisation_id: orgAId, client_id: clientAId, intervention_id: interventionRow.id,
      activite: 'serrurerie', created_by: adminAId,
    })
    if (error) throw new Error(`Création devis de sécurité (org A) impossible : ${error.message}`)
  }

  const { data: factureExisting } = await serviceClient
    .from('factures').select('id').eq('organisation_id', orgAId).eq('client_id', clientAId).maybeSingle()
  if (!factureExisting) {
    const { error } = await serviceClient.from('factures').insert({
      organisation_id: orgAId, client_id: clientAId, intervention_id: interventionRow.id,
      statut_paiement: 'impayee', montant_ttc: 200, created_by: adminAId,
    })
    if (error) throw new Error(`Création facture de sécurité (org A) impossible : ${error.message}`)
  }
}

// Buckets exercés par scripts/test-security-storage.mjs (S1-S7) — jamais
// créés par une migration (les migrations ne posent que les policies RLS
// sur storage.objects, pas les lignes storage.buckets elles-mêmes) : sur
// une base locale fraîche, ils n'existent tout simplement pas encore.
// 'logos' est volontairement public (voir commentaire "bucket public" dans
// 20260610000030_storage_rls_phase8.sql — aucune policy SELECT n'y est
// définie, la lecture publique passe par le flag bucket.public). Les
// autres restent privés (accès uniquement via les policies RLS testées).
const REQUIRED_BUCKETS = [
  { id: 'intervention-photos', public: false },
  { id: 'signatures', public: false },
  { id: 'chat-media', public: false },
  { id: 'logos', public: true },
]

async function ensureStorageBuckets(serviceClient) {
  const { data: existing, error: listErr } = await serviceClient.storage.listBuckets()
  if (listErr) throw new Error(`Listage des buckets Storage impossible : ${listErr.message}`)
  const existingIds = new Set((existing ?? []).map(b => b.id))

  for (const bucket of REQUIRED_BUCKETS) {
    if (existingIds.has(bucket.id)) continue
    const { error } = await serviceClient.storage.createBucket(bucket.id, { public: bucket.public })
    if (error) throw new Error(`Création du bucket Storage ${bucket.id} impossible : ${error.message}`)
  }
}

async function main() {
  runPreflight(EXTRA_REQUIRED_VARS)

  const url = process.env.SUPABASE_TEST_URL
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } })

  console.log('[seed:security] Buckets Storage requis par la suite de sécurité...')
  await ensureStorageBuckets(serviceClient)

  console.log('[seed:security] Organisations...')
  const orgAId = await upsertOrg(serviceClient, 'security-test-org-a', 'Security Test Org A')
  const orgBId = await upsertOrg(serviceClient, 'security-test-org-b', 'Security Test Org B')

  console.log('[seed:security] Comptes admin A / admin B / intervenant A...')
  const adminAId = await upsertAuthUser(serviceClient, process.env.TEST_ADMIN_A_EMAIL, process.env.TEST_ADMIN_A_PASSWORD)
  await upsertProfile(serviceClient, { id: adminAId, email: process.env.TEST_ADMIN_A_EMAIL, nom: 'SecurityTest', prenom: 'AdminA', role: 'admin', organisationId: orgAId })

  const adminBId = await upsertAuthUser(serviceClient, process.env.TEST_ADMIN_B_EMAIL, process.env.TEST_ADMIN_B_PASSWORD)
  await upsertProfile(serviceClient, { id: adminBId, email: process.env.TEST_ADMIN_B_EMAIL, nom: 'SecurityTest', prenom: 'AdminB', role: 'admin', organisationId: orgBId })

  let intervenantAId = null
  if (process.env.TEST_INTERVENANT_A_EMAIL && process.env.TEST_INTERVENANT_A_PASSWORD) {
    intervenantAId = await upsertAuthUser(serviceClient, process.env.TEST_INTERVENANT_A_EMAIL, process.env.TEST_INTERVENANT_A_PASSWORD)
    await upsertProfile(serviceClient, { id: intervenantAId, email: process.env.TEST_INTERVENANT_A_EMAIL, nom: 'SecurityTest', prenom: 'IntervenantA', role: 'intervenant', organisationId: orgAId })
  }

  console.log('[seed:security] Abonnements actifs (admin A / admin B)...')
  await ensureActiveSubscription(serviceClient, adminAId, orgAId)
  await ensureActiveSubscription(serviceClient, adminBId, orgBId)

  console.log('[seed:security] Paramètres entreprise minimaux (A/B)...')
  await ensureParametresEntreprise(serviceClient, orgAId, 'Security Test Org A')
  await ensureParametresEntreprise(serviceClient, orgBId, 'Security Test Org B')

  console.log('[seed:security] Fixtures métier org A (client/intervention/devis/facture) + client org B (isolation)...')
  await ensureOrgABusinessFixtures(serviceClient, orgAId, adminAId, intervenantAId)
  await ensureClient(serviceClient, { orgId: orgBId, nom: 'SecurityTest Client B', createdBy: adminBId })

  console.log('[seed:security] OK — organisations, abonnements, comptes et fixtures métier de sécurité prêts.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main().catch(err => {
    console.error(`[seed:security] ERREUR : ${err.message}`)
    process.exit(1)
  })
}
