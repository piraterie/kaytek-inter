// scripts/lib/load-env.mjs
// Correction 6 (TEST-01) — chargeur .env minimal partagé par tous les
// scripts de sécurité (preflight, runners SQL/Storage/Edge Functions/
// concurrence) et par playwright.security.config.ts.
//
// Ne modifie jamais process.env pour une clé déjà définie (une variable
// déjà exportée dans le shell appelant a toujours priorité) — mêmes
// règles que le loadEnvFile() déjà utilisé par playwright.config.ts,
// dupliqué ici volontairement pour ne jamais toucher à ce fichier
// existant (utilisé par les suites fonctionnelles, hors périmètre de
// cette correction).
//
// Ne journalise JAMAIS une valeur — uniquement des noms de clés.

import { existsSync, readFileSync } from 'node:fs'

export function loadEnvFile(path) {
  if (!existsSync(path)) return
  readFileSync(path, 'utf-8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .forEach(l => {
      const idx = l.indexOf('=')
      if (idx === -1) return
      const key = l.slice(0, idx).trim()
      const value = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (key && process.env[key] === undefined) process.env[key] = value
    })
}

// Charge .env.test — seul fichier réel concerné par cette correction
// (voir section 4 de l'autorisation : .env.test.example est le seul
// fichier d'exemple modifié ; .env.test lui-même n'est jamais touché
// par cette correction, un contributeur doit y ajouter lui-même les
// nouvelles variables SUPABASE_TEST_*/TEST_ADMIN_*_EMAIL documentées).
export function loadSecurityTestEnv() {
  loadEnvFile('.env.test')
}
