#!/usr/bin/env node
// scripts/test-security-concurrency.mjs
// Correction 6 (TEST-01) — tests de concurrence réelle contre une instance
// Supabase LOCALE uniquement (garde anti-production réutilisée). Exécute
// plusieurs requêtes PostgREST strictement simultanées (Promise.all —
// chaque appel HTTP ouvre sa propre connexion/transaction côté Postgres)
// pour vérifier que les mécanismes atomiques des Corrections 4 et 5 ne
// produisent jamais de doublon ni d'erreur de contrainte sous concurrence.
//
// N'utilise que le client service_role : on teste ici l'atomicité au
// niveau base de données (fonctions SECURITY DEFINER + contraintes),
// pas la RLS elle-même (déjà couverte par les autres suites). Toutes les
// lignes créées pour ces tests sont supprimées explicitement en fin de
// script (finally), qu'il y ait échec ou succès.
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = ['TEST_ADMIN_A_EMAIL']
const CONCURRENT_INSERTS = 5

const results = []
function record(name, status, detail = '') {
  results.push({ name, status, detail })
  console.log(`[test:security:concurrency] ${status} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function getOrgIdForAdmin(serviceClient, email) {
  const { data, error } = await serviceClient
    .from('profiles')
    .select('organisation_id')
    .eq('email', email)
    .single()
  if (error || !data) throw new Error(`Impossible de résoudre l'organisation pour ${email} : ${error?.message ?? 'profil introuvable'}`)
  return data.organisation_id
}

// Clone une ligne existante (schéma-agnostique : ne suppose aucune colonne
// précise au-delà de celles explicitement neutralisées) pour servir de
// point de départ à une insertion concurrente — évite de deviner les
// colonnes NOT NULL exactes de devis/factures.
function buildInsertPayload(template, overrides = {}) {
  const { id, numero, created_at, updated_at, ...rest } = template
  return { ...rest, ...overrides }
}

async function testNumberingConcurrency(serviceClient, table, orgId) {
  const { data: template } = await serviceClient
    .from(table)
    .select('*')
    .eq('organisation_id', orgId)
    .limit(1)
    .maybeSingle()

  if (!template) {
    record(`numérotation concurrente — ${table}`, 'WARN', `aucune ligne existante pour org A dans ${table} — fixture absente, scénario non exécuté`)
    return
  }

  const payload = buildInsertPayload(template)
  const inserts = Array.from({ length: CONCURRENT_INSERTS }, () =>
    serviceClient.from(table).insert(payload).select('id, numero').single()
  )

  const settled = await Promise.allSettled(inserts)
  const createdIds = []
  const numeros = []
  let errorCount = 0

  for (const s of settled) {
    if (s.status === 'fulfilled' && !s.value.error && s.value.data) {
      createdIds.push(s.value.data.id)
      numeros.push(s.value.data.numero)
    } else {
      errorCount++
    }
  }

  // Nettoyage immédiat, avant assertion, pour ne jamais laisser de lignes
  // de test même si l'assertion ci-dessous échoue.
  if (createdIds.length > 0) {
    await serviceClient.from(table).delete().in('id', createdIds)
  }

  const uniqueNumeros = new Set(numeros)
  if (errorCount > 0) {
    record(`numérotation concurrente — ${table}`, 'FAIL', `${errorCount}/${CONCURRENT_INSERTS} insertion(s) concurrente(s) ont échoué (contrainte UNIQUE violée ou erreur inattendue)`)
  } else if (uniqueNumeros.size !== CONCURRENT_INSERTS) {
    record(`numérotation concurrente — ${table}`, 'FAIL', `${CONCURRENT_INSERTS} insertions réussies mais seulement ${uniqueNumeros.size} numero(s) distinct(s) — doublon généré sous concurrence`)
  } else {
    record(`numérotation concurrente — ${table}`, 'PASS', `${CONCURRENT_INSERTS} insertions simultanées, ${uniqueNumeros.size} numero(s) distinct(s), 0 erreur`)
  }
}

async function testCommissionConcurrency(serviceClient, orgId) {
  const { data: interventionRow } = await serviceClient
    .from('interventions')
    .select('id')
    .eq('organisation_id', orgId)
    .not('intervenant_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!interventionRow) {
    record('création commission concurrente', 'WARN', 'aucune intervention avec intervenant assigné pour org A — fixture absente, scénario non exécuté')
    return
  }

  const { data: factureTemplate } = await serviceClient
    .from('factures')
    .select('*')
    .eq('organisation_id', orgId)
    .limit(1)
    .maybeSingle()

  if (!factureTemplate) {
    record('création commission concurrente', 'WARN', 'aucune facture existante pour org A — fixture absente, scénario non exécuté')
    return
  }

  const payload = buildInsertPayload(factureTemplate, {
    intervention_id: interventionRow.id,
    statut_paiement: 'a_payer',
  })

  const { data: factureCreated, error: createErr } = await serviceClient
    .from('factures')
    .insert(payload)
    .select('id')
    .single()

  if (createErr || !factureCreated) {
    record('création commission concurrente', 'WARN', `préparation impossible — création facture de test a échoué : ${createErr?.message}`)
    return
  }
  const factureId = factureCreated.id

  try {
    // N transitions concurrentes et identiques vers 'payee' sur la MÊME
    // facture — le trigger ne doit calculer la commission qu'une seule
    // fois (idempotence via l'INSERT ... ON CONFLICT ... DO UPDATE de
        // calculate_commission_for_facture), jamais créer de doublon ni
    // renvoyer d'erreur de contrainte.
    const updates = Array.from({ length: CONCURRENT_INSERTS }, () =>
      serviceClient.from('factures').update({ statut_paiement: 'payee' }).eq('id', factureId).select('id')
    )
    const settled = await Promise.allSettled(updates)
    const errorCount = settled.filter(s => s.status !== 'fulfilled' || s.value.error).length

    const { data: commissionRows, error: readErr } = await serviceClient
      .from('commissions')
      .select('id')
      .eq('facture_id', factureId)

    if (errorCount > 0) {
      record('création commission concurrente', 'FAIL', `${errorCount}/${CONCURRENT_INSERTS} transition(s) concurrente(s) ont échoué`)
    } else if (readErr) {
      record('création commission concurrente', 'FAIL', `lecture des commissions impossible après la course : ${readErr.message}`)
    } else if ((commissionRows?.length ?? 0) !== 1) {
      record('création commission concurrente', 'FAIL', `${commissionRows?.length ?? 0} ligne(s) commissions trouvée(s) pour 1 facture (attendu exactement 1)`)
    } else {
      record('création commission concurrente', 'PASS', `${CONCURRENT_INSERTS} transitions simultanées vers 'payee', exactement 1 ligne commissions créée`)
    }

    if (commissionRows?.length) {
      await serviceClient.from('commissions').delete().in('id', commissionRows.map(r => r.id))
    }
  } finally {
    await serviceClient.from('factures').delete().eq('id', factureId)
  }
}

// FACT-02 — course devis→facture : caractérisation UNIQUEMENT, jamais
// bloquante (exclue explicitement du pass/fail de cette correction). Le
// mécanisme exact de transformation devis→facture est un enchaînement
// multi-étapes côté frontend (marquage "envoyé" puis création de la
// ligne facture) et n'a pas de fonction SECURITY DEFINER unique et
// idempotente équivalente à next_document_number()/calculate_commission_
// for_facture() à date de cette correction — le caractériser précisément
// nécessite d'abord d'identifier ce mécanisme exact (hors périmètre de
// cette correction, voir rapport). On se contente ici de le documenter
// explicitement plutôt que de fabriquer un résultat.
function characterizeFact02() {
  record('FACT-02 — course devis→facture (non bloquant)', 'WARN',
    'non caractérisé dans cette correction — le mécanisme exact de transformation devis→facture (multi-étapes frontend) n\'a pas été identifié ici ; voir rapport de Correction 6, section limites connues')
}

async function main() {
  runPreflight(EXTRA_REQUIRED_VARS)

  const url = process.env.SUPABASE_TEST_URL
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } })

  const orgAId = await getOrgIdForAdmin(serviceClient, process.env.TEST_ADMIN_A_EMAIL)

  await testNumberingConcurrency(serviceClient, 'devis', orgAId)
  await testNumberingConcurrency(serviceClient, 'factures', orgAId)
  await testCommissionConcurrency(serviceClient, orgAId)
  characterizeFact02()

  const blocking = results.filter(r => r.name !== 'FACT-02 — course devis→facture (non bloquant)')
  const pass = blocking.filter(r => r.status === 'PASS').length
  const fail = blocking.filter(r => r.status === 'FAIL').length
  const warn = blocking.filter(r => r.status === 'WARN').length

  console.log(`\n[test:security:concurrency] Résumé (hors FACT-02, non bloquant) : ${blocking.length} scénario(s) — ${pass} PASS / ${fail} FAIL / ${warn} WARN`)

  if (fail > 0) {
    console.error('[test:security:concurrency] ÉCHEC — au moins un mécanisme atomique ne résiste pas à la concurrence.')
    process.exit(1)
  }
  console.log('[test:security:concurrency] OK — aucune violation d\'atomicité détectée sur les scénarios exécutés (FACT-02 exclu, non bloquant).')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main().catch(err => {
    console.error(`[test:security:concurrency] ERREUR NON GÉRÉE : ${err.message}`)
    process.exit(1)
  })
}
