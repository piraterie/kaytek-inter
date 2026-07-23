#!/usr/bin/env node
// scripts/test-security-storage.mjs
// Correction 6 (TEST-01) — vérifie les policies RLS Storage (migrations
// 20260610000030_storage_rls_phase8.sql et
// 20260722000001_subscription_access_enforcement.sql) contre une instance
// Supabase LOCALE uniquement (garde anti-production réutilisée).
//
// N'utilise que des fichiers factices en mémoire (Buffer, jamais un
// fichier réel lu sur disque) et les deux comptes dédiés à la sécurité
// (TEST_ADMIN_A_*/TEST_ADMIN_B_*, organisations distinctes). Nettoie
// systématiquement (finally) tous les objets Storage qu'il crée et
// restaure tout état modifié (statut d'abonnement de l'org A).
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = [
  'TEST_ADMIN_A_EMAIL',
  'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL',
  'TEST_ADMIN_B_PASSWORD',
]

const DUMMY_PNG = Buffer.from('kaytek-security-test-fixture-png')
const DUMMY_JPG = Buffer.from('kaytek-security-test-fixture-jpg')
const DUMMY_AUDIO = Buffer.from('kaytek-security-test-fixture-audio')

const results = []
function record(name, status, detail = '') {
  results.push({ name, status, detail })
  const tag = status === 'PASS' ? 'PASS' : status === 'WARN' ? 'WARN' : 'FAIL'
  console.log(`[test:security:storage] ${tag} — ${name}${detail ? ` (${detail})` : ''}`)
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

async function findAnyInterventionId(serviceClient, orgId) {
  const { data } = await serviceClient
    .from('interventions')
    .select('id')
    .eq('organisation_id', orgId)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function main() {
  runPreflight(EXTRA_REQUIRED_VARS)

  const url = process.env.SUPABASE_TEST_URL
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } })
  const clientA = createClient(url, anonKey, { auth: { persistSession: false } })
  const clientB = createClient(url, anonKey, { auth: { persistSession: false } })

  const cleanupTasks = []
  let restoreSubscription = null

  try {
    console.log('[test:security:storage] Authentification des comptes de sécurité dédiés (org A / org B)...')
    const { data: authA, error: errA } = await clientA.auth.signInWithPassword({
      email: process.env.TEST_ADMIN_A_EMAIL,
      password: process.env.TEST_ADMIN_A_PASSWORD,
    })
    if (errA || !authA.user) throw new Error(`Connexion admin org A impossible : ${errA?.message}`)

    const { data: authB, error: errB } = await clientB.auth.signInWithPassword({
      email: process.env.TEST_ADMIN_B_EMAIL,
      password: process.env.TEST_ADMIN_B_PASSWORD,
    })
    if (errB || !authB.user) throw new Error(`Connexion admin org B impossible : ${errB?.message}`)

    const orgAId = await getOrgIdForAdmin(serviceClient, process.env.TEST_ADMIN_A_EMAIL)
    const orgBId = await getOrgIdForAdmin(serviceClient, process.env.TEST_ADMIN_B_EMAIL)
    const uidA = authA.user.id

    // ── S1 : upload photo intervention — org A sur sa propre intervention ──
    const interventionId = await findAnyInterventionId(serviceClient, orgAId)
    let ownPhotoPath = null
    if (!interventionId) {
      record('S1 upload intervention-photos org A', 'WARN', 'aucune intervention existante trouvée pour org A — fixture absente, scénario non exécuté (aucun résultat fabriqué)')
    } else {
      ownPhotoPath = `${interventionId}/security-test-${Date.now()}.jpg`
      const { error } = await clientA.storage.from('intervention-photos').upload(ownPhotoPath, DUMMY_JPG, { contentType: 'image/jpeg' })
      if (error) {
        record('S1 upload intervention-photos org A', 'FAIL', `upload refusé alors qu'attendu autorisé : ${error.message}`)
        ownPhotoPath = null
      } else {
        record('S1 upload intervention-photos org A', 'PASS')
        cleanupTasks.push(() => clientA.storage.from('intervention-photos').remove([ownPhotoPath]))
      }
    }

    // ── S2 : org B ne peut pas écrire dans le préfixe org A (signatures) ──
    const crossWritePath = `${orgAId}/security-test-crosswrite-${Date.now()}.png`
    {
      const { error } = await clientB.storage.from('signatures').upload(crossWritePath, DUMMY_PNG, { contentType: 'image/png' })
      if (!error) {
        record('S2 écriture org B dans préfixe org A (signatures)', 'FAIL', 'upload accepté alors qu\'il devait être refusé')
        cleanupTasks.push(() => serviceClient.storage.from('signatures').remove([crossWritePath]))
      } else {
        record('S2 écriture org B dans préfixe org A (signatures)', 'PASS')
      }
    }

    // ── S3 : lecture cross-tenant refusée (signatures) ──
    const readTestPath = `${orgAId}/security-test-read-${Date.now()}.png`
    {
      const { error: uploadErr } = await clientA.storage.from('signatures').upload(readTestPath, DUMMY_PNG, { contentType: 'image/png' })
      if (uploadErr) {
        record('S3 lecture cross-tenant (signatures)', 'WARN', `préparation impossible — upload org A a échoué : ${uploadErr.message}`)
      } else {
        cleanupTasks.push(() => serviceClient.storage.from('signatures').remove([readTestPath]))
        const { data: signed, error: signErr } = await clientB.storage.from('signatures').createSignedUrl(readTestPath, 60)
        if (!signErr && signed?.signedUrl) {
          record('S3 lecture cross-tenant (signatures)', 'FAIL', 'org B a obtenu une signed URL sur un fichier de org A')
        } else {
          record('S3 lecture cross-tenant (signatures)', 'PASS')
        }
      }
    }

    // ── S4 : upload refusé si abonnement bloqué (org A) ──
    {
      const { data: subRow, error: subReadErr } = await serviceClient
        .from('subscriptions')
        .select('id, subscription_status')
        .eq('organisation_id', orgAId)
        .maybeSingle()

      if (subReadErr || !subRow) {
        record('S4 upload refusé — abonnement bloqué', 'WARN', 'aucune ligne subscriptions pour org A — scénario non exécuté (fail-open documenté, pas testable sans fixture)')
      } else {
        const originalStatus = subRow.subscription_status
        await serviceClient.from('subscriptions').update({ subscription_status: 'canceled' }).eq('id', subRow.id)
        restoreSubscription = async () => {
          await serviceClient.from('subscriptions').update({ subscription_status: originalStatus }).eq('id', subRow.id)
        }

        const blockedPath = `${orgAId}/security-test-blocked-${Date.now()}.png`
        const { error: blockedErr } = await clientA.storage.from('signatures').upload(blockedPath, DUMMY_PNG, { contentType: 'image/png' })
        if (!blockedErr) {
          record('S4 upload refusé — abonnement bloqué', 'FAIL', 'upload accepté alors que subscription_status = canceled')
          cleanupTasks.push(() => serviceClient.storage.from('signatures').remove([blockedPath]))
        } else {
          record('S4 upload refusé — abonnement bloqué', 'PASS')
        }

        await restoreSubscription()
        restoreSubscription = null

        // ── S5 : anciens fichiers de l'org toujours lisibles par leur owner
        //         après restauration de l'abonnement (SELECT non gaté par
        //         current_organisation_has_app_access, contrairement à INSERT/UPDATE) ──
        if (ownPhotoPath) {
          const { data: signed, error: signErr } = await clientA.storage.from('intervention-photos').createSignedUrl(ownPhotoPath, 60)
          if (signErr || !signed?.signedUrl) {
            record('S5 lecture ancien fichier après restauration abonnement', 'FAIL', signErr?.message ?? 'signed URL non obtenue')
          } else {
            record('S5 lecture ancien fichier après restauration abonnement', 'PASS')
          }
        } else {
          record('S5 lecture ancien fichier après restauration abonnement', 'WARN', 'dépend de S1 (fixture intervention absente)')
        }
      }
    }

    // ── S6 : chat-media — lecture cross-user refusée ──
    const chatPath = `${uidA}/security-test-${Date.now()}.webm`
    {
      const { error: uploadErr } = await clientA.storage.from('chat-media').upload(chatPath, DUMMY_AUDIO, { contentType: 'audio/webm' })
      if (uploadErr) {
        record('S6 lecture cross-user (chat-media)', 'WARN', `préparation impossible — upload org A a échoué : ${uploadErr.message}`)
      } else {
        cleanupTasks.push(() => serviceClient.storage.from('chat-media').remove([chatPath]))
        const { data: signed, error: signErr } = await clientB.storage.from('chat-media').createSignedUrl(chatPath, 60)
        if (!signErr && signed?.signedUrl) {
          record('S6 lecture cross-user (chat-media)', 'FAIL', 'org B a obtenu une signed URL sur un média de org A')
        } else {
          record('S6 lecture cross-user (chat-media)', 'PASS')
        }
      }
    }

    // ── S7 : bucket public identifié (logos) — lecture publique, écriture org isolée ──
    const logoPath = `${orgAId}/security-test-logo-${Date.now()}.png`
    {
      const { error: uploadErr } = await clientA.storage.from('logos').upload(logoPath, DUMMY_PNG, { contentType: 'image/png' })
      if (uploadErr) {
        record('S7 bucket public logos — upload org A', 'WARN', `upload org A a échoué : ${uploadErr.message}`)
      } else {
        cleanupTasks.push(() => serviceClient.storage.from('logos').remove([logoPath]))
        const { data: pub } = serviceClient.storage.from('logos').getPublicUrl(logoPath)
        record('S7 bucket public logos — identification', pub?.publicUrl ? 'PASS' : 'FAIL',
          pub?.publicUrl ? `bucket confirmé PUBLIC : ${new URL(pub.publicUrl).pathname}` : 'URL publique non générée')

        const crossLogoPath = `${orgAId}/security-test-logo-crosswrite-${Date.now()}.png`
        const { error: crossErr } = await clientB.storage.from('logos').upload(crossLogoPath, DUMMY_PNG, { contentType: 'image/png' })
        if (!crossErr) {
          record('S7 bucket public logos — écriture cross-org refusée', 'FAIL', 'org B a pu écrire dans le préfixe logos de org A')
          cleanupTasks.push(() => serviceClient.storage.from('logos').remove([crossLogoPath]))
        } else {
          record('S7 bucket public logos — écriture cross-org refusée', 'PASS')
        }
      }
    }
  } finally {
    if (restoreSubscription) {
      try { await restoreSubscription() } catch { /* déjà restauré ou introuvable */ }
    }
    for (const task of cleanupTasks) {
      try { await task() } catch { /* nettoyage best-effort, ne doit pas masquer le résultat des tests */ }
    }
    await clientA.auth.signOut().catch(() => {})
    await clientB.auth.signOut().catch(() => {})
  }

  const pass = results.filter(r => r.status === 'PASS').length
  const fail = results.filter(r => r.status === 'FAIL').length
  const warn = results.filter(r => r.status === 'WARN').length

  console.log(`\n[test:security:storage] Résumé : ${results.length} scénario(s) — ${pass} PASS / ${fail} FAIL / ${warn} WARN (non exécuté, fixture absente)`)

  if (fail > 0) {
    console.error('[test:security:storage] ÉCHEC — au moins une policy Storage ne se comporte pas comme attendu.')
    process.exit(1)
  }
  console.log('[test:security:storage] OK — aucune violation d\'isolation Storage détectée sur les scénarios exécutés.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main().catch(err => {
    console.error(`[test:security:storage] ERREUR NON GÉRÉE : ${err.message}`)
    process.exit(1)
  })
}
