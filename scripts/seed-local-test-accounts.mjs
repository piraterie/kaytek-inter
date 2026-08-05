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

async function ensureParametresEntreprise(orgId, raisonSociale, extra = {}) {
  const { data: existing } = await svc.from('parametres_entreprise').select('id').eq('organisation_id', orgId).maybeSingle()
  if (existing) {
    if (Object.keys(extra).length) await svc.from('parametres_entreprise').update(extra).eq('id', existing.id)
    return
  }
  const { error } = await svc.from('parametres_entreprise').insert({
    organisation_id: orgId, raison_sociale: raisonSociale,
    telephone: '0100000000', email: `contact@${raisonSociale.toLowerCase().replace(/\s+/g, '-')}.test`,
    adresse: '1 rue de Test', code_postal: '75001', ville: 'Paris', siret: '00000000000000',
    ...extra,
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

// ── Données Google (Ads/GBP) — LOCAL UNIQUEMENT, aucun secret/token réel :
// access_token_secret_id/refresh_token_secret_id restent NULL (aucune
// valeur Vault créée), ce qui suffit pour que l'UI affiche l'état
// "connecté" avec un compte/établissement déjà sélectionné (paths testés :
// pages stats, historique demandes d'avis, isolation cross-org) — les
// synchronisations réelles vers l'API Google ne sont PAS exercées par ces
// lignes (voir tests/e2e/*.spec.ts pour les mocks de fetch nécessaires
// aux boutons "Synchroniser").
async function ensureMockGoogleAdsConnection(orgId, customerId) {
  const { data: existing } = await svc.from('google_ads_connections').select('id').eq('organisation_id', orgId).maybeSingle()
  const row = {
    organisation_id: orgId, google_customer_id: customerId, google_login_customer_id: null,
    customer_descriptive_name: `Compte Ads Test ${customerId}`, is_manager_account: false,
    currency_code: 'EUR', time_zone: 'Europe/Paris', status: 'connected',
    google_account_email: 'ads-test@kaytek.test',
    // token_expires_at LOIN dans le futur : sans ceci, ensureFreshAccessToken
    // (appelé par google-oauth-status à chaque chargement de page) tente un
    // renouvellement, échoue faute de refresh_token_secret_id réel, et
    // repasse silencieusement le statut à 'expired' — bug reproduit et
    // corrigé pendant l'écriture des tests e2e (voir rapport pré-déploiement).
    token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    connected_at: new Date().toISOString(), selected_at: new Date().toISOString(),
    // Non-null : simule un compte déjà synchronisé au moins une fois — sans
    // ceci, GoogleAdsPage affiche désormais volontairement son état bloquant
    // "jamais synchronisé" (jamais de tableau à zéro trompeur), ce qui casse
    // les tests e2e qui vérifient le rendu du tableau de bord lui-même.
    last_synced_at: new Date().toISOString(),
  }
  if (existing) { await svc.from('google_ads_connections').update(row).eq('id', existing.id); return }
  const { error } = await svc.from('google_ads_connections').insert(row)
  if (error) throw new Error(`google_ads_connections ${orgId}: ${error.message}`)
}

async function ensureMockGbpConnection(orgId, placeId) {
  const { data: existing } = await svc.from('gbp_connections').select('id').eq('organisation_id', orgId).maybeSingle()
  const row = {
    organisation_id: orgId, google_location_id: `locations/${placeId}`, google_account_id: 'accounts/test-account',
    account_name: 'Compte GBP Test', location_title: 'Établissement Test', location_address: '1 rue de Test, 75001 Paris',
    location_open_status: 'OPEN', location_phone: '0100000000', location_website: 'https://exemple-test.fr',
    place_id: placeId, status: 'connected', google_account_email: 'gbp-test@kaytek.test',
    token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    connected_at: new Date().toISOString(), selected_at: new Date().toISOString(),
    // Voir commentaire équivalent dans ensureMockGoogleAdsConnection —
    // GooglePerformancePage/GoogleReviewsPage bloquent désormais l'affichage
    // tant qu'aucune synchronisation n'a jamais réussi.
    last_synced_at: new Date().toISOString(),
  }
  if (existing) { await svc.from('gbp_connections').update(row).eq('id', existing.id); return }
  const { error } = await svc.from('gbp_connections').insert(row)
  if (error) throw new Error(`gbp_connections ${orgId}: ${error.message}`)
}

async function ensureTestClient(orgId, adminId, { email, nom = 'Client', prenom = 'Test', telephone = '0600000000' }) {
  const query = svc.from('clients').select('id').eq('organisation_id', orgId).eq('nom', nom).eq('prenom', prenom)
  const { data: existing } = await query.maybeSingle()
  if (existing) return existing.id
  const { data, error } = await svc.from('clients').insert({
    organisation_id: orgId, nom, prenom, type: 'particulier', email: email ?? null, telephone, created_by: adminId,
  }).select('id').single()
  if (error) throw new Error(`client ${orgId}: ${error.message}`)
  return data.id
}

async function ensurePaidFacture(orgId, clientId, adminId, numero = 'TEST-PAYEE-001') {
  const { data: existing } = await svc.from('factures').select('id').eq('organisation_id', orgId).eq('numero', numero).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await svc.from('factures').insert({
    organisation_id: orgId, numero, client_id: clientId,
    statut_paiement: 'payee', montant_ht: 100, tva_montant: 20, montant_ttc: 120,
    date_paiement: new Date().toISOString().slice(0, 10), created_by: adminId,
  }).select('id').single()
  if (error) throw new Error(`facture ${orgId}: ${error.message}`)
  return data.id
}

// Facture NON payée (nom trompeur conservé pour rester à côté d'ensurePaidFacture
// dans le diff — corrige : il s'agit ici d'une facture "impayee" de départ,
// que le test e2e fait passer à "payee" lui-même via l'UI).
async function ensurePaidFactureButUnpaid(orgId, clientId, adminId, numero) {
  const { data: existing } = await svc.from('factures').select('id').eq('organisation_id', orgId).eq('numero', numero).maybeSingle()
  if (existing) {
    // Idempotence entre deux exécutions de test : remet la facture à
    // "impayee" si un run précédent l'avait déjà marquée payée.
    await svc.from('factures').update({ statut_paiement: 'impayee', date_paiement: null }).eq('id', existing.id)
    await svc.from('review_requests').delete().eq('facture_id', existing.id)
    return existing.id
  }
  const { data, error } = await svc.from('factures').insert({
    organisation_id: orgId, numero, client_id: clientId,
    statut_paiement: 'impayee', montant_ht: 100, tva_montant: 20, montant_ttc: 120,
    created_by: adminId,
  }).select('id').single()
  if (error) throw new Error(`facture ${orgId}: ${error.message}`)
  return data.id
}

async function ensureReviewRequest(orgId, factureId, clientId, adminId) {
  const { data: existing } = await svc.from('review_requests').select('id').eq('facture_id', factureId).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await svc.from('review_requests').insert({
    organisation_id: orgId, facture_id: factureId, client_id: clientId, created_by: adminId,
    delivery_status: 'sent', sent_at: new Date().toISOString(), scheduled_send_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw new Error(`review_request ${factureId}: ${error.message}`)
  return data.id
}

async function main() {
  const orgAId = await upsertOrg('test-org-a-local', 'Test Org A (local)')
  const orgBId = await upsertOrg('test-org-b-local', 'Test Org B (local)')
  // avis_google_actif/mode='manuel' sur org A UNIQUEMENT — nécessaire pour
  // que la modale de demande d'avis apparaisse après le passage d'une
  // facture à "payée" dans les tests e2e (org B reste désactivée, aucune
  // demande d'avis ne doit jamais s'y déclencher).
  await ensureParametresEntreprise(orgAId, 'Test Org A Local', {
    avis_google_actif: true, avis_google_mode: 'manuel', avis_google_delai: 'immediat',
  })
  await ensureParametresEntreprise(orgBId, 'Test Org B Local')

  const adminAId = await upsertUser(process.env.TEST_ADMIN_A_EMAIL, process.env.TEST_ADMIN_A_PASSWORD)
  await upsertProfile({ id: adminAId, email: process.env.TEST_ADMIN_A_EMAIL, nom: 'Admin', prenom: 'A', role: 'admin', organisationId: orgAId })
  await ensureActiveSubscription(adminAId, orgAId)

  const intervenantAId = await upsertUser(process.env.TEST_INTERVENANT_A_EMAIL, process.env.TEST_INTERVENANT_A_PASSWORD)
  await upsertProfile({ id: intervenantAId, email: process.env.TEST_INTERVENANT_A_EMAIL, nom: 'Intervenant', prenom: 'A', role: 'intervenant', organisationId: orgAId })

  const adminBId = await upsertUser(process.env.TEST_ADMIN_B_EMAIL, process.env.TEST_ADMIN_B_PASSWORD)
  await upsertProfile({ id: adminBId, email: process.env.TEST_ADMIN_B_EMAIL, nom: 'Admin', prenom: 'B', role: 'admin', organisationId: orgBId })
  await ensureActiveSubscription(adminBId, orgBId)

  // ── Données Google (Ads/GBP), client, facture payée — org A uniquement.
  // Org B reste volontairement SANS aucune donnée Google : les tests
  // d'isolation cross-org vérifient qu'admin B ne voit ni les connexions,
  // ni les avis, ni les statistiques d'org A.
  // Client avec e-mail : une facture DÉJÀ payée avec sa demande d'avis déjà
  // créée et ENVOYÉE (teste la prévention du double envoi — la contrainte
  // UNIQUE(facture_id) refuse une 2e demande pour la même facture — et
  // l'historique des demandes). Client DÉDIÉ, distinct de celui utilisé par
  // TEST-IMPAYEE-001 ci-dessous : depuis l'ajout du garde-fou de fréquence
  // (trg_review_requests_guard, par client_id), partager le même client
  // ferait bloquer FREQUENCE_BLOQUEE le test du chemin nominal "Envoyer
  // maintenant"/"Programmer" à cause de CET historique déjà envoyé, sans
  // rapport avec ce que ces tests-là exercent.
  const clientAId = await ensureTestClient(orgAId, adminAId, { email: 'client-test@kaytek.test', nom: 'Client', prenom: 'Test' })
  const facturePayeeId = await ensurePaidFacture(orgAId, clientAId, adminAId, 'TEST-PAYEE-001')
  await ensureReviewRequest(orgAId, facturePayeeId, clientAId, adminAId)

  // Client avec e-mail, SANS historique de demande d'avis : une facture NON
  // payée (le test e2e clique "Marquer payée" et observe la modale de
  // demande d'avis, puis "Envoyer maintenant"/"Programmer" — chemin nominal,
  // ne doit jamais être bloqué par le garde-fou de fréquence).
  const clientImpayeeId = await ensureTestClient(orgAId, adminAId, { email: 'client-impayee-test@kaytek.test', nom: 'ClientImpayee', prenom: 'Test' })
  const factureImpayeeId = await ensurePaidFactureButUnpaid(orgAId, clientImpayeeId, adminAId, 'TEST-IMPAYEE-001')

  // Client SANS e-mail : facture non payée, pour tester que le passage à
  // "payée" ne plante jamais et ne déclenche aucun envoi (garde-fou
  // trigger côté base — voir trg_review_requests_require_email).
  const clientSansEmailId = await ensureTestClient(orgAId, adminAId, { email: null, nom: 'SansEmail', prenom: 'Client', telephone: null })
  await ensurePaidFactureButUnpaid(orgAId, clientSansEmailId, adminAId, 'TEST-IMPAYEE-SANSMAIL-001')

  await ensureMockGoogleAdsConnection(orgAId, '1234567890')
  await ensureMockGbpConnection(orgAId, 'ChIJ_TEST_PLACE_ID_LOCAL')

  console.log('[seed-local] OK — admin A, intervenant A, admin B prêts (org A/B, abonnements actifs, clients + factures + connexions Google mock sur org A).')
}

main().catch((err) => { console.error('[seed-local] ÉCHEC —', err.message); process.exit(1) })
