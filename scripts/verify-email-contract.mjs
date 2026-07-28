#!/usr/bin/env node
// scripts/verify-email-contract.mjs
// Câblé sur le hook npm "prebuild" (même mécanisme que guard-no-production.mjs
// sur "predev" — npm l'exécute automatiquement avant `npm run build`). Un
// échec ici interrompt le build AVANT de produire un frontend qui appellerait
// un endpoint inexistant, ou une Edge Function dont le typage est cassé —
// exactement la classe de régression qui a cassé l'envoi de devis en
// production le 2026-07-28 (backend durci déployé sans mise à jour du
// frontend correspondante, jamais détecté avant qu'un utilisateur ne tombe
// dessus).
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

let hasError = false
function fail(message) {
  console.error(`[verify-email-contract] ✗ ${message}`)
  hasError = true
}
function ok(message) {
  console.log(`[verify-email-contract] ✓ ${message}`)
}
function warn(message) {
  console.warn(`[verify-email-contract] ⚠ ${message}`)
}

// ── 1. Chaque supabase.functions.invoke('<nom>') a un dossier Edge Function
// correspondant — "aucun endpoint inexistant". Scanne tout src/, pas
// seulement envoyer-email : un typo ou une fonction supprimée/renommée sur
// N'IMPORTE QUEL appel doit être détecté ici, pas seulement au clic.
function checkInvokedFunctionsExist() {
  const srcDir = path.join(ROOT, 'src')
  const invokedNames = new Set()
  const invokeRe = /supabase\.functions\.invoke(?:<[^>]*>)?\(\s*['"]([\w-]+)['"]/g

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const content = readFileSync(full, 'utf-8')
      for (const match of content.matchAll(invokeRe)) invokedNames.add(match[1])
    }
  }
  walk(srcDir)

  if (invokedNames.size === 0) {
    fail("Aucun appel supabase.functions.invoke(...) trouvé dans src/ — le détecteur a probablement un problème de pattern, pas le projet (vérifier invokeRe dans ce script).")
    return
  }

  for (const name of [...invokedNames].sort()) {
    const fnPath = path.join(ROOT, 'supabase', 'functions', name, 'index.ts')
    if (existsSync(fnPath)) {
      ok(`Edge Function '${name}' — dossier trouvé (supabase/functions/${name}/index.ts)`)
    } else {
      fail(`Edge Function '${name}' invoquée depuis le frontend mais introuvable : supabase/functions/${name}/index.ts n'existe pas.`)
    }
  }
}

// ── 2. deno check sur envoyer-email/index.ts (et ses dépendances _shared/,
// résolues automatiquement par Deno via les imports) — "aucun import cassé".
// Dégradé en avertissement (jamais bloquant) si le CLI Deno n'est pas
// installé : c'est le cas de la plupart des environnements de build frontend
// (ex. Vercel) qui n'ont pas besoin de Deno pour construire le frontend Vite.
// La CI GitHub Actions dédiée (email-contract-ci.yml), elle, installe
// systématiquement Deno et rend cette vérification réellement bloquante.
function checkDenoTypes() {
  const target = path.join(ROOT, 'supabase', 'functions', 'envoyer-email', 'index.ts')
  try {
    execFileSync('deno', ['check', target], { stdio: 'pipe', cwd: ROOT })
    ok('deno check — envoyer-email/index.ts (et ses dépendances _shared/) compile sans erreur')
  } catch (err) {
    if (err.code === 'ENOENT') {
      warn("Deno CLI introuvable — vérification 'deno check' ignorée dans cet environnement (installez Deno pour l'activer localement ; la CI l'exécute toujours).")
      return
    }
    fail(`deno check a échoué sur envoyer-email/index.ts :\n${(err.stdout?.toString() || '') + (err.stderr?.toString() || '') || err.message}`)
  }
}

// ── 3. Variables d'environnement Deno.env.get('X') documentées — "les
// variables d'environnement obligatoires existent". Vérifie qu'elles sont
// DOCUMENTÉES dans supabase/functions/.env.example, pas qu'elles sont
// réellement définies en production (voir docs/email-sending-architecture.md
// — vérifier la présence réelle en prod nécessiterait un token Supabase en
// CI, décision distincte non prise ici).
function checkEnvVarsDocumented() {
  const fnPath = path.join(ROOT, 'supabase', 'functions', 'envoyer-email', 'index.ts')
  const sharedDir = path.join(ROOT, 'supabase', 'functions', '_shared')
  const sources = [readFileSync(fnPath, 'utf-8')]
  for (const entry of readdirSync(sharedDir)) {
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      sources.push(readFileSync(path.join(sharedDir, entry), 'utf-8'))
    }
  }

  const envVarRe = /Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g
  const referenced = new Set()
  for (const src of sources) for (const m of src.matchAll(envVarRe)) referenced.add(m[1])

  // Auto-injectées par le runtime Supabase Edge Functions — jamais à
  // documenter/redéfinir (voir supabase/functions/.env.example, en-tête).
  const autoInjected = new Set(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'])

  const envExamplePath = path.join(ROOT, 'supabase', 'functions', '.env.example')
  const envExample = existsSync(envExamplePath) ? readFileSync(envExamplePath, 'utf-8') : ''

  for (const name of [...referenced].sort()) {
    if (autoInjected.has(name)) continue
    if (envExample.includes(name)) {
      ok(`Variable d'environnement '${name}' — documentée dans supabase/functions/.env.example`)
    } else {
      fail(`Variable d'environnement '${name}' utilisée (Deno.env.get) dans envoyer-email/index.ts ou supabase/functions/_shared/ mais non documentée dans supabase/functions/.env.example.`)
    }
  }
}

checkInvokedFunctionsExist()
checkDenoTypes()
checkEnvVarsDocumented()

if (hasError) {
  console.error('\n[verify-email-contract] Échec — voir les erreurs ci-dessus. Build interrompu.')
  process.exit(1)
}
console.log('\n[verify-email-contract] OK — toutes les vérifications sont passées.')
