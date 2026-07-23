#!/usr/bin/env node
// scripts/test-security-preflight.mjs
// Correction 6 (TEST-01) — garde central obligatoire, exécuté avant
// TOUTE suite de sécurité (SQL, RLS/Playwright, Storage, Edge
// Functions, concurrence). Réutilisable comme module (runPreflight)
// et exécutable directement (npm run test:security:preflight).
//
// Ce script ne journalise JAMAIS une clé, un mot de passe ou un token —
// uniquement des noms de variables et des hostnames (jamais les URLs
// complètes, qui peuvent contenir des identifiants pour SUPABASE_TEST_DB_URL).
//
// AUCUN mécanisme de contournement n'existe : ALLOW_PRODUCTION_TESTS,
// FORCE_SECURITY_TESTS, SKIP_PRODUCTION_GUARD (ou toute variable
// équivalente) sont explicitement détectées et provoquent un refus —
// leur simple présence dans l'environnement est traitée comme une
// tentative de contournement, qu'elles soient vraies ou fausses.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadSecurityTestEnv } from './lib/load-env.mjs'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// Référence de projet Supabase déjà publique dans ce dépôt (visible en
// clair dans supabase/migrations/20260708000008_security_phase1_critical_
// hardening.sql, correctif SEC-06 — une URL de projet Supabase n'est
// jamais un secret, seules les clés le sont) — filet de sécurité
// supplémentaire, indépendant de la lecture des fichiers .env ci-dessous.
const KNOWN_PRODUCTION_REF = 'dimrukkxehcwzemslwiz'

const FORBIDDEN_BYPASS_VARS = ['ALLOW_PRODUCTION_TESTS', 'FORCE_SECURITY_TESTS', 'SKIP_PRODUCTION_GUARD']

const BASE_REQUIRED_VARS = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_DB_URL',
]

function fail(detail) {
  console.error('REFUS : les tests de sécurité ne peuvent jamais être exécutés contre la production.')
  if (detail) console.error(`  → ${detail}`)
  process.exit(1)
}

function extractHostname(urlLike) {
  if (!urlLike) return null
  try {
    return new URL(urlLike).hostname.toLowerCase()
  } catch {
    // Chaînes de connexion Postgres non conformes à WHATWG URL dans de
    // rares cas — extraction de secours par expression régulière.
    const m = /@([^:/?#]+)/.exec(urlLike)
    return m ? m[1].toLowerCase() : null
  }
}

function isLocalHostname(host) {
  return !!host && LOCAL_HOSTNAMES.has(host)
}

// Lit UNIQUEMENT le hostname des fichiers .env réels locaux (jamais leur
// contenu affiché) pour les ajouter à la liste des hôtes explicitement
// interdits — ces fichiers ne sont ni modifiés ni committés par ce script.
function collectForbiddenHostnamesFromRealEnvFiles() {
  const forbidden = new Set()
  for (const file of ['.env.production', '.env.local', '.env.beta-test', '.env.test']) {
    if (!existsSync(file)) continue
    let content
    try { content = readFileSync(file, 'utf-8') } catch { continue }
    const match = /VITE_SUPABASE_URL\s*=\s*["']?([^"'\r\n]+)/.exec(content)
    const host = extractHostname(match?.[1]?.trim())
    if (host && !isLocalHostname(host)) forbidden.add(host)
  }
  return forbidden
}

function rejectBypassVars() {
  for (const name of FORBIDDEN_BYPASS_VARS) {
    if (process.env[name] !== undefined) {
      fail(`La variable ${name} n'a aucun effet : aucun mécanisme de contournement de ce garde n'existe dans ce projet, sa seule présence est refusée.`)
    }
  }
}

function assertAllowedHost(varName, forbiddenHosts) {
  const value = process.env[varName]
  if (!value) return // absence gérée séparément par requireEnv()
  const host = extractHostname(value)
  if (!host) fail(`${varName} n'a pas pu être interprétée comme une URL/chaîne de connexion valide.`)
  if (host.includes(KNOWN_PRODUCTION_REF)) {
    fail(`${varName} correspond au projet Supabase de production connu de ce dépôt — interdit sans exception.`)
  }
  if (forbiddenHosts.has(host)) {
    fail(`${varName} correspond à l'hôte détecté dans un fichier .env réel local (.env.production/.env.local/.env.test/.env.beta-test) — interdit.`)
  }
  if (!isLocalHostname(host)) {
    fail(`${varName} ne pointe pas vers un hôte local. Seuls localhost/127.0.0.1/::1 sont autorisés — aucune liste blanche distante n'existe dans cette correction ; un futur projet Supabase de test devra être ajouté séparément, après validation explicite.`)
  }
}

export function requireEnv(names) {
  const missing = names.filter(n => {
    const v = process.env[n]
    return v === undefined || v.trim() === ''
  })
  if (missing.length > 0) {
    console.error('ÉCHEC preflight — variable(s) obligatoire(s) manquante(s) (valeurs jamais journalisées) :')
    missing.forEach(n => console.error(`  - ${n}`))
    console.error('Voir .env.test.example pour la liste complète. Aucune suite de sécurité ne peut être déclarée réussie sans ces variables.')
    process.exit(1)
  }
}

export function runPreflight(extraRequiredVars = []) {
  loadSecurityTestEnv()
  rejectBypassVars()

  const required = [...new Set([...BASE_REQUIRED_VARS, ...extraRequiredVars])]
  requireEnv(required)

  const forbiddenHosts = collectForbiddenHostnamesFromRealEnvFiles()
  assertAllowedHost('SUPABASE_TEST_URL', forbiddenHosts)
  assertAllowedHost('SUPABASE_TEST_DB_URL', forbiddenHosts)

  console.log('[preflight] OK — hôte local confirmé, variables obligatoires présentes.')
  console.log(`[preflight] SUPABASE_TEST_URL hostname : ${extractHostname(process.env.SUPABASE_TEST_URL)}`)
  console.log(`[preflight] SUPABASE_TEST_DB_URL hostname : ${extractHostname(process.env.SUPABASE_TEST_DB_URL)}`)
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  runPreflight()
}
