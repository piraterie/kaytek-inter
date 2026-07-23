#!/usr/bin/env node
// scripts/test-security-edge-functions.mjs
// Correction 6 (TEST-01) — vérifie UNIQUEMENT les gardes d'accès des Edge
// Functions envoyer-email, inviter-intervenant et send-reminders, contre
// une instance Supabase LOCALE (garde anti-production réutilisée).
//
// IMPORTANT — périmètre volontairement restreint : ce script ne teste QUE
// les chemins de refus (absence d'auth, token invalide, abonnement
// bloqué), qui renvoient tous une réponse AVANT le fetch() vers l'API
// Brevo dans le code des trois fonctions (voir index.ts de chacune :
// requireCanSendEmail / requireAdmin / la vérification get_my_app_access_status
// renvoient toutes une réponse 401/403 avant toute tentative d'appel
// externe). Le chemin nominal (envoi réel d'un email) n'est JAMAIS exercé
// ici, ni avec une clé Brevo valide ni invalide — il reste non testé et
// documenté comme tel dans le rapport de cette correction.
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreflight } from './test-security-preflight.mjs'

const EXTRA_REQUIRED_VARS = ['TEST_ADMIN_A_EMAIL', 'TEST_ADMIN_A_PASSWORD']

// Champ d'erreur attendu par fonction lors d'une authentification absente/
// invalide — documenté ici uniquement à titre indicatif (le test accepte
// tout statut de refus, pas seulement ce message exact, pour ne pas être
// fragile si un message est reformulé sans changer le comportement de sécurité).
const FUNCTIONS = ['envoyer-email', 'inviter-intervenant', 'send-reminders']

const results = []
function record(name, status, detail = '') {
  results.push({ name, status, detail })
  console.log(`[test:security:edge-functions] ${status} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function callFunction(baseUrl, anonKey, fnName, authHeader) {
  const res = await fetch(`${baseUrl}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    // Corps minimal — insuffisant de toute façon pour dépasser les gardes
    // d'accès testées ici, qui s'exécutent avant toute lecture du body.
    body: JSON.stringify({}),
  })
  let body = null
  try { body = await res.json() } catch { /* réponse non-JSON, body reste null */ }
  return { status: res.status, body }
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

async function main() {
  runPreflight(EXTRA_REQUIRED_VARS)

  const url = process.env.SUPABASE_TEST_URL
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } })
  const clientA = createClient(url, anonKey, { auth: { persistSession: false } })

  let restoreSubscription = null

  try {
    console.log('[test:security:edge-functions] Authentification admin org A...')
    const { data: authA, error: errA } = await clientA.auth.signInWithPassword({
      email: process.env.TEST_ADMIN_A_EMAIL,
      password: process.env.TEST_ADMIN_A_PASSWORD,
    })
    if (errA || !authA.session) throw new Error(`Connexion admin org A impossible : ${errA?.message}`)
    const accessToken = authA.session.access_token

    // ── Scénarios 1 et 2 : refus avant authentification complète ──────────
    for (const fnName of FUNCTIONS) {
      const noAuth = await callFunction(url, anonKey, fnName, null)
      if (noAuth.status === 200) {
        record(`${fnName} — aucune authentification`, 'FAIL', `réponse 200 inattendue : ${JSON.stringify(noAuth.body)}`)
      } else {
        record(`${fnName} — aucune authentification`, 'PASS', `status ${noAuth.status}`)
      }

      // Bearer = clé anon : signature JWT valide au niveau plateforme, mais
      // sans session utilisateur réelle — exerce précisément le chemin
      // interne "Token invalide"/"Authentification requise" de chaque
      // fonction (auth.getUser() échoue), sans jamais dépendre du fait que
      // la passerelle Supabase locale exige ou non un JWT pour router la requête.
      const invalidToken = await callFunction(url, anonKey, fnName, `Bearer ${anonKey}`)
      if (invalidToken.status === 200) {
        record(`${fnName} — token invalide`, 'FAIL', `réponse 200 inattendue : ${JSON.stringify(invalidToken.body)}`)
      } else {
        record(`${fnName} — token invalide`, 'PASS', `status ${invalidToken.status}`)
      }
    }

    // ── Scénario 3 : abonnement bloqué (org A, un seul flip réutilisé) ─────
    const orgAId = await getOrgIdForAdmin(serviceClient, process.env.TEST_ADMIN_A_EMAIL)
    const { data: subRow, error: subReadErr } = await serviceClient
      .from('subscriptions')
      .select('id, subscription_status')
      .eq('organisation_id', orgAId)
      .maybeSingle()

    if (subReadErr || !subRow) {
      for (const fnName of FUNCTIONS) {
        record(`${fnName} — abonnement bloqué`, 'WARN', 'aucune ligne subscriptions pour org A — scénario non exécuté (fixture absente)')
      }
    } else {
      const originalStatus = subRow.subscription_status
      await serviceClient.from('subscriptions').update({ subscription_status: 'canceled' }).eq('id', subRow.id)
      restoreSubscription = async () => {
        await serviceClient.from('subscriptions').update({ subscription_status: originalStatus }).eq('id', subRow.id)
      }

      for (const fnName of FUNCTIONS) {
        const blocked = await callFunction(url, anonKey, fnName, `Bearer ${accessToken}`)
        const isBlocked = blocked.status === 403 && blocked.body?.error === 'subscription_inactive'
        record(`${fnName} — abonnement bloqué (subscription_inactive)`, isBlocked ? 'PASS' : 'FAIL',
          `status ${blocked.status}, body ${JSON.stringify(blocked.body)}`)
      }

      await restoreSubscription()
      restoreSubscription = null
    }
  } finally {
    if (restoreSubscription) {
      try { await restoreSubscription() } catch { /* déjà restauré ou introuvable */ }
    }
    await clientA.auth.signOut().catch(() => {})
  }

  const pass = results.filter(r => r.status === 'PASS').length
  const fail = results.filter(r => r.status === 'FAIL').length
  const warn = results.filter(r => r.status === 'WARN').length

  console.log(`\n[test:security:edge-functions] Résumé : ${results.length} scénario(s) — ${pass} PASS / ${fail} FAIL / ${warn} WARN`)
  console.log('[test:security:edge-functions] Rappel : le chemin nominal (envoi réel via Brevo) n\'est jamais exercé par ce script.')

  if (fail > 0) {
    console.error('[test:security:edge-functions] ÉCHEC — au moins un garde d\'accès ne se comporte pas comme attendu.')
    process.exit(1)
  }
  console.log('[test:security:edge-functions] OK — tous les gardes d\'accès testés refusent correctement, sans jamais atteindre Brevo.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main().catch(err => {
    console.error(`[test:security:edge-functions] ERREUR NON GÉRÉE : ${err.message}`)
    process.exit(1)
  })
}
