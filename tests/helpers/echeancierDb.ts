// tests/helpers/echeancierDb.ts
// Client Supabase service-role pour la suite Phase 5 (échéanciers/paiements) —
// utilisé UNIQUEMENT pour : (a) préparer des fixtures (client + devis) avant
// de piloter la fonctionnalité réelle via le navigateur, (b) vérifier l'état
// réellement écrit en base après une action UI (jamais pour se substituer à
// l'action UI elle-même), (c) nettoyer les données créées par cette suite.
// Garde anti-production : refuse de s'exécuter si l'URL n'est pas locale.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_TEST_URL || process.env.VITE_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || ''

if (!url || !serviceKey) {
  throw new Error('[echeancierDb] SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY manquants (.env.test).')
}
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error(`[echeancierDb] REFUS — hôte non local (${host}). Cette suite ne doit jamais s'exécuter contre un environnement distant.`)
}

export const dbAdmin = createClient(url, serviceKey, { auth: { persistSession: false } })

const anonKey = process.env.SUPABASE_TEST_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

// Client authentifié comme un vrai utilisateur (RLS pleinement appliquée) —
// utilisé pour vérifier qu'une tentative d'écriture cross-organisation est
// réellement refusée par la base, pas seulement absente de l'UI.
export async function createUserClient(email: string, password: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`[echeancierDb] connexion ${email} échouée: ${error.message}`)
  return client
}

// Préfixe unique par exécution — permet un balayage de sécurité en toute fin
// de suite en plus du nettoyage ciblé par id fait à chaque test.
export const RUN_MARKER = `PWTEST5-${Date.now()}`

export async function getOrgId(slug: 'test-org-a-local' | 'test-org-b-local'): Promise<string> {
  const { data, error } = await dbAdmin.from('organisations').select('id').eq('slug', slug).single()
  if (error || !data) throw new Error(`[echeancierDb] organisation ${slug} introuvable — lancer scripts/seed-local-test-accounts.mjs`)
  return data.id
}

export async function getProfileId(email: string): Promise<string> {
  const { data, error } = await dbAdmin.from('profiles').select('id').eq('email', email).single()
  if (error || !data) throw new Error(`[echeancierDb] profil ${email} introuvable`)
  return data.id
}

export interface TestDevisFixture {
  clientId: string
  devisId: string
  devisNumero: string
}

// Crée un client + devis directement en base (service role, hors RLS) —
// équivalent au raccourci déjà utilisé pendant les Phases 1-4 pour isoler
// les tests de l'échéancier de la mécanique (déjà couverte par
// tests/e2e/03-devis.spec.ts) de création d'un devis classique.
export async function createTestDevis(opts: {
  orgId: string
  createdBy: string
  clientNom: string
  totalHt: number
  tvaMontant: number
  totalTtc: number
  statut?: string
  numeroSuffix: string
}): Promise<TestDevisFixture> {
  const { data: client, error: cErr } = await dbAdmin.from('clients').insert({
    organisation_id: opts.orgId,
    nom: `${RUN_MARKER}-${opts.clientNom}`,
    prenom: 'Test',
    type: 'particulier',
    email: `${RUN_MARKER}-${opts.clientNom}@test.local`.toLowerCase().replace(/\s+/g, '-'),
    telephone: '0600000000',
    created_by: opts.createdBy,
  }).select('id').single()
  if (cErr || !client) throw new Error(`[echeancierDb] création client échouée: ${cErr?.message}`)

  const { data: devis, error: dErr } = await dbAdmin.from('devis').insert({
    organisation_id: opts.orgId,
    client_id: client.id,
    numero: `PWTEST-${opts.numeroSuffix}-${Date.now()}`,
    statut: opts.statut || 'accepte',
    lignes: [],
    total_ht: opts.totalHt,
    tva_montant: opts.tvaMontant,
    total_ttc: opts.totalTtc,
    created_by: opts.createdBy,
  }).select('id, numero').single()
  if (dErr || !devis) throw new Error(`[echeancierDb] création devis échouée: ${dErr?.message}`)

  return { clientId: client.id, devisId: devis.id, devisNumero: devis.numero }
}

// Nettoyage ciblé, ordre FK-safe — jamais de suppression large (toujours
// scopée aux ids passés explicitement par l'appelant).
export async function cleanupTestDevis(devisIds: string[], clientIds: string[]) {
  if (devisIds.length === 0 && clientIds.length === 0) return
  if (devisIds.length > 0) {
    const { data: echeanciers } = await dbAdmin.from('echeanciers').select('id').in('devis_id', devisIds)
    const echeancierIds = (echeanciers || []).map(e => e.id)
    if (echeancierIds.length > 0) {
      await dbAdmin.from('journal_echeancier').delete().in('echeancier_id', echeancierIds)
      await dbAdmin.from('relances_paiement').delete().in('echeancier_id', echeancierIds)
    }
    await dbAdmin.from('paiements').delete().in('devis_id', devisIds)
    await dbAdmin.from('echeances').update({ facture_id: null }).in('devis_id', devisIds)
    await dbAdmin.from('factures').delete().in('devis_id', devisIds)
    await dbAdmin.from('echeances').delete().in('devis_id', devisIds)
    if (echeancierIds.length > 0) await dbAdmin.from('echeanciers').delete().in('id', echeancierIds)
    await dbAdmin.from('devis').delete().in('id', devisIds)
  }
  if (clientIds.length > 0) {
    await dbAdmin.from('clients').delete().in('id', clientIds)
  }
}

// Balayage de sécurité en fin de suite : supprime tout ce qui porte le
// marqueur de cette exécution et qui n'aurait pas été nettoyé par un test
// individuel (ex. test échoué avant son afterEach). Scopé strictement au
// RUN_MARKER de cette exécution — ne touche jamais aux données d'une autre
// exécution ni aux comptes de test eux-mêmes.
export async function sweepRunMarker() {
  const { data: clients } = await dbAdmin.from('clients').select('id').like('nom', `${RUN_MARKER}%`)
  const clientIds = (clients || []).map(c => c.id)
  if (clientIds.length === 0) return
  const { data: devisRows } = await dbAdmin.from('devis').select('id').in('client_id', clientIds)
  const devisIds = (devisRows || []).map(d => d.id)
  await cleanupTestDevis(devisIds, clientIds)
}
