// guide/setup/seed-demo-data.ts
// Crée les comptes démo et les données nécessaires aux scénarios Playwright du guide.
// Commande : npx tsx guide/setup/seed-demo-data.ts
//
// Prérequis :
//   - .env.guide avec SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
//   - npx tsx (inclus via ts-node ou vite/tsx)

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

// ── Charge .env.guide ────────────────────────────────────────────────────────
function loadEnv(file: string) {
  const p = path.resolve(file)
  if (!existsSync(p)) { console.warn(`⚠ ${file} introuvable — utilise les variables d'environnement shell`); return }
  readFileSync(p, 'utf-8').split('\n').forEach(l => {
    if (!l.trim() || l.startsWith('#')) return
    const idx = l.indexOf('='); if (idx === -1) return
    const k = l.slice(0, idx).trim()
    const v = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (k && !process.env[k]) process.env[k] = v
  })
}
loadEnv('.env.guide')

const SUPABASE_URL              = process.env.SUPABASE_URL              || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ADMIN_EMAIL               = process.env.GUIDE_ADMIN_EMAIL         || 'admin@kaytek.test'
const ADMIN_PASSWORD            = process.env.GUIDE_ADMIN_PASSWORD       || 'KaytekAdmin2024!'
const INTERVENANT_EMAIL         = process.env.GUIDE_INTERVENANT_EMAIL   || 'intervenant@kaytek.test'
const INTERVENANT_PASSWORD      = process.env.GUIDE_INTERVENANT_PASSWORD || 'KaytekInter2024!'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis dans .env.guide')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getOrgId(): Promise<string> {
  const { data, error } = await admin.from('organisations').select('id').eq('slug', 'kaytek-inter').single()
  if (error || !data) throw new Error(`Organisation kaytek-inter introuvable : ${error?.message}`)
  return data.id
}

async function upsertUser(
  email: string,
  password: string,
  role: 'admin' | 'intervenant',
  orgId: string,
  extraProfile: Record<string, unknown> = {}
): Promise<string> {
  // Vérifier si l'utilisateur existe déjà
  const { data: existing } = await admin.auth.admin.listUsers()
  const found = existing?.users?.find((u: any) => u.email === email)

  let userId: string

  if (found) {
    console.log(`  ↻ Utilisateur existant : ${email}`)
    userId = found.id
    // Mettre à jour le mot de passe
    await admin.auth.admin.updateUserById(userId, { password })
  } else {
    console.log(`  + Création : ${email}`)
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data?.user) throw new Error(`Échec création ${email} : ${error?.message}`)
    userId = data.user.id
  }

  // Upsert du profil
  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    email,
    role,
    organisation_id: orgId,
    nom: role === 'admin' ? 'Demo' : 'Demo',
    prenom: role === 'admin' ? 'Admin' : 'Intervenant',
    telephone: role === 'admin' ? '0600000001' : '0600000002',
    commission_pct: role === 'intervenant' ? 30 : 0,
    actif: true,
    can_create_documents: role === 'intervenant' ? true : false,
    can_bypass_validation: false,
    welcome_dismissed: false,
    ...extraProfile,
  }, { onConflict: 'id' })

  if (profileError) throw new Error(`Échec upsert profil ${email} : ${profileError.message}`)
  return userId
}

async function ensureClient(orgId: string) {
  const { data: existing } = await admin
    .from('clients')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('nom', 'Dupont')
    .eq('prenom', 'Jean')
    .maybeSingle()

  if (existing) {
    console.log('  ↻ Client démo déjà existant')
    return existing.id
  }

  const { data, error } = await admin.from('clients').insert({
    organisation_id: orgId,
    nom: 'Dupont',
    prenom: 'Jean',
    telephone: '0612345678',
    email: 'jean.dupont@demo.fr',
    adresse_intervention: '15 Rue de la Paix',
    cp_intervention: '75001',
    ville_intervention: 'Paris',
    type: 'particulier',
    notes_internes: 'Client de démonstration — ne pas supprimer',
    archive: false,
  }).select('id').single()

  if (error || !data) throw new Error(`Échec création client démo : ${error?.message}`)
  console.log('  + Client démo créé')
  return data.id
}

async function ensureIntervention(orgId: string, clientId: string, intervenantId: string) {
  const { data: existing } = await admin
    .from('interventions')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('description', 'Remplacement serrure porte principale — Démonstration')
    .maybeSingle()

  if (existing) {
    console.log('  ↻ Intervention démo déjà existante')
    return existing.id
  }

  const { data, error } = await admin.from('interventions').insert({
    organisation_id: orgId,
    client_id: clientId,
    intervenant_id: intervenantId,
    type: 'serrurerie',
    statut: 'accepte',
    urgence: false,
    adresse: '15 Rue de la Paix, 75001 Paris',
    description: 'Remplacement serrure porte principale — Démonstration',
    date_prevue: new Date(Date.now() + 86400000).toISOString(),
    montant_ttc: 250,
    notes_admin: 'Intervention de démonstration',
  }).select('id').single()

  if (error || !data) throw new Error(`Échec création intervention démo : ${error?.message}`)
  console.log('  + Intervention démo créée')
  return data.id
}

async function ensureDevis(orgId: string, clientId: string, intervenantId: string) {
  const { data: existing } = await admin
    .from('devis')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('notes', 'Devis de démonstration — ne pas supprimer')
    .maybeSingle()

  if (existing) {
    console.log('  ↻ Devis démo déjà existant')
    return existing.id
  }

  const { data, error } = await admin.from('devis').insert({
    organisation_id: orgId,
    client_id: clientId,
    intervenant_id: intervenantId,
    statut: 'brouillon',
    lignes: [
      { description: 'Main d\'œuvre serrurerie', quantite: 1, prix_unitaire_ht: 120, tva_pct: 20 },
      { description: 'Serrure 3 points haute sécurité', quantite: 1, prix_unitaire_ht: 85, tva_pct: 20 },
    ],
    remise_pct: 0,
    valide_jusqu_au: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    notes: 'Devis de démonstration — ne pas supprimer',
  }).select('id').single()

  if (error || !data) throw new Error(`Échec création devis démo : ${error?.message}`)
  console.log('  + Devis démo créé')
  return data.id
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱  Seed données démo — Centre d\'aide Kaytek Inter\n')

  const orgId = await getOrgId()
  console.log(`✓ Organisation : ${orgId}\n`)

  console.log('── Comptes utilisateurs ──')
  const adminId       = await upsertUser(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin', orgId)
  const intervenantId = await upsertUser(INTERVENANT_EMAIL, INTERVENANT_PASSWORD, 'intervenant', orgId)

  console.log('\n── Données de démonstration ──')
  const clientId = await ensureClient(orgId)
  await ensureIntervention(orgId, clientId, intervenantId)
  await ensureDevis(orgId, clientId, intervenantId)

  console.log('\n✅  Seed terminé !\n')
  console.log(`   Admin       : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log(`   Intervenant : ${INTERVENANT_EMAIL} / ${INTERVENANT_PASSWORD}`)
  console.log('\nLancer les enregistrements : npx playwright test --config=playwright.guide.config.ts\n')
}

main().catch(err => {
  console.error('\n❌ Erreur :', err.message)
  process.exit(1)
})
