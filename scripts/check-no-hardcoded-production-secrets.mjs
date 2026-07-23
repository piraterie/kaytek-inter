#!/usr/bin/env node
// scripts/check-no-hardcoded-production-secrets.mjs
// Correction MIG-01B — contrôle statique local recherchant, dans
// supabase/migrations/*.sql, toute référence à la production codée en
// dur : référence de projet distant connue, URL d'Edge Function
// distante, jeton ressemblant à un JWT, mentions "anon key"/
// "service_role", URL Supabase distante générique.
//
// Ne journalise JAMAIS la valeur trouvée en clair au-delà des quelques
// caractères nécessaires pour identifier la ligne — n'envoie ni ne
// contacte rien : lecture de fichiers locaux uniquement.
//
// Distingue explicitement trois catégories (jamais une seule liste
// plate) :
//   1. Présence HISTORIQUE attendue — dans l'une des migrations déjà
//      existantes avant Correction MIG-01, jamais modifiées (voir
//      KNOWN_HISTORICAL_FILES ci-dessous). Informationnel, non bloquant.
//   2. État final neutralisé — la nouvelle migration de durcissement
//      (20260727000001) ne doit contenir AUCUNE occurrence active de
//      ces motifs (sa requête de vérification interne construit la
//      référence dynamiquement pour ne jamais la faire apparaître en
//      clair dans le fichier lui-même — vérifié explicitement ici).
//   3. Nouvelle occurrence interdite — toute correspondance dans un
//      fichier qui n'est ni dans la liste historique connue ni la
//      migration de durcissement elle-même. Bloquant (exit 1).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = 'supabase/migrations'

// Les 4 migrations déjà existantes, jamais modifiées par cette
// correction (règle absolue : ne modifie aucune des 107 migrations
// existantes), connues pour contenir la référence de production et/ou
// un jeton anon codés en dur — voir audit-kaytek-inter/corrections/
// analyse-mig-01-bootstrap-migrations.md, section 4.
const KNOWN_HISTORICAL_FILES = new Set([
  '20260605000000_push_subscriptions.sql',
  '20260610000032_fix_notify_push_search_path.sql',
  '20260708000001_fix_pg_net_notification_body_type.sql',
  '20260708000008_security_phase1_critical_hardening.sql',
])

// Migration de durcissement introduite par MIG-01B — ne doit contenir
// AUCUNE occurrence active des motifs recherchés (sa vérification
// interne construit la référence dynamiquement pour l'éviter).
const HARDENING_MIGRATION_FILE = '20260727000001_remove_hardcoded_push_endpoint.sql'

// Référence de projet Supabase de production déjà publique dans ce
// dépôt (visible dans les migrations historiques ci-dessus) — jamais
// reproduite en clair dans CE script, construite dynamiquement, pour ne
// jamais introduire une occurrence supplémentaire du motif recherché.
const KNOWN_PRODUCTION_REF = ['d', 'imrukkxehcwzemslwiz'].join('')

const PATTERNS = [
  { label: 'référence de projet de production connue', regex: new RegExp(KNOWN_PRODUCTION_REF, 'i') },
  { label: 'URL Edge Function Supabase distante', regex: /supabase\.co\/functions\/v1/i },
  { label: 'URL Supabase distante générique (*.supabase.co)', regex: /https?:\/\/[a-z0-9-]+\.supabase\.co/i },
  { label: 'jeton ressemblant à un JWT (header base64url)', regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  // NB : le rôle Postgres "service_role" (GRANT/REVOKE) est un identifiant
  // légitime omniprésent dans tout ce dépôt — le rechercher comme simple
  // mot produirait des centaines de faux positifs sans rapport avec un
  // secret codé en dur. On ne recherche donc que la locution à deux mots
  // "anon key" (peu probable hors d'un commentaire décrivant un secret),
  // jamais l'identifiant de rôle seul.
  { label: 'mention "anon key" (secret potentiellement décrit en clair)', regex: /\banon key\b/i },
]

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const hits = []
  content.split('\n').forEach((line, idx) => {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        hits.push({ label: pattern.label, lineNumber: idx + 1 })
      }
    }
  })
  return hits
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

  const historical = []
  const hardeningIssues = []
  const forbidden = []

  for (const file of files) {
    const hits = scanFile(path.join(MIGRATIONS_DIR, file))
    if (hits.length === 0) continue

    if (KNOWN_HISTORICAL_FILES.has(file)) {
      historical.push({ file, hits })
    } else if (file === HARDENING_MIGRATION_FILE) {
      hardeningIssues.push({ file, hits })
    } else {
      forbidden.push({ file, hits })
    }
  }

  console.log('[check:no-hardcoded-secrets] Résultat par catégorie :\n')

  console.log(`1. Présence historique attendue (informationnel, non bloquant) — ${historical.length} fichier(s) :`)
  for (const { file, hits } of historical) {
    const isKnown = KNOWN_HISTORICAL_FILES.has(file)
    console.log(`   - ${file} (${hits.length} occurrence(s))${isKnown ? '' : ' — INATTENDU'}`)
  }
  // Vérifie que TOUS les fichiers historiques connus contiennent bien au moins une occurrence
  // (confirme qu'on cherche les bons motifs) — sinon avertissement (pas bloquant, juste informatif).
  for (const known of KNOWN_HISTORICAL_FILES) {
    if (!historical.some(h => h.file === known) && files.includes(known)) {
      console.log(`   ! ${known} attendu dans la liste historique mais aucune occurrence détectée — motifs de recherche à revérifier`)
    }
  }

  console.log(`\n2. Migration de durcissement (${HARDENING_MIGRATION_FILE}) — doit être vide :`)
  if (hardeningIssues.length === 0) {
    console.log('   OK — aucune occurrence active détectée.')
  } else {
    for (const { hits } of hardeningIssues) {
      hits.forEach(h => console.log(`   ÉCHEC ligne ${h.lineNumber} : ${h.label}`))
    }
  }

  console.log(`\n3. Nouvelles occurrences interdites — ${forbidden.length} fichier(s) :`)
  for (const { file, hits } of forbidden) {
    hits.forEach(h => console.log(`   ÉCHEC ${file}:${h.lineNumber} : ${h.label}`))
  }
  if (forbidden.length === 0) {
    console.log('   OK — aucune nouvelle occurrence hors de l\'historique connu.')
  }

  console.log('\n[check:no-hardcoded-secrets] Rappel : le secret historique (jeton anon) présent dans les')
  console.log('4 fichiers ci-dessus reste dans Git et doit être considéré comme compromis/à faire tourner')
  console.log('côté production si ce jeton est encore valide — aucune rotation distante n\'est effectuée ici.')

  if (hardeningIssues.length > 0 || forbidden.length > 0) {
    console.error('\n[check:no-hardcoded-secrets] ÉCHEC.')
    process.exit(1)
  }
  console.log('\n[check:no-hardcoded-secrets] OK.')
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  main()
}
