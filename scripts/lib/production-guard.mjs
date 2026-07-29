// scripts/lib/production-guard.mjs
// Garde anti-production PARTAGÉ — source unique de vérité pour la
// référence de projet Supabase de production, réutilisée par :
//   - scripts/test-security-preflight.mjs (suite de sécurité, garde le
//     plus strict : exige un hôte LOCAL, pas seulement "pas production")
//   - scripts/guard-no-production.mjs (predev — `npm run dev`)
//   - playwright.config.ts (suite fonctionnelle E2E, tests/e2e,
//     tests/responsive, tests/beta)
//
// Avant cette correction, seule la suite de sécurité (playwright.security.
// config.ts, scripts/test-security-*) était protégée. `npm run dev` et la
// suite Playwright fonctionnelle (playwright.config.ts) démarraient sans
// aucune vérification et pouvaient donc pointer vers la production si
// .env.local était mal configuré (c'était le cas avant cette correction).
//
// Ne journalise JAMAIS une clé ou un token — uniquement des hostnames.
import { loadEnv } from 'vite'

// Référence de projet Supabase de production — déjà publique dans ce
// dépôt (visible en clair dans plusieurs migrations existantes, voir
// scripts/check-no-hardcoded-production-secrets.mjs). Une référence de
// projet Supabase n'est jamais un secret en soi, seules les clés le sont.
export const KNOWN_PRODUCTION_REF = 'dimrukkxehcwzemslwiz'

export function extractHostname(urlLike) {
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

export function isProductionHost(hostname) {
  return !!hostname && hostname.includes(KNOWN_PRODUCTION_REF)
}

// Lève une exception (jamais un simple `return false`) si `value`
// correspond à la production — un appelant qui oublierait de vérifier un
// booléen de retour laisserait passer silencieusement une régression ;
// une exception nécessite un `try/catch` explicite pour être ignorée.
export function assertNotProduction(varName, value, context) {
  const host = extractHostname(value)
  if (isProductionHost(host)) {
    console.error(`[guard:no-production] REFUS — ${varName} correspond au projet Supabase de PRODUCTION (réf. ${KNOWN_PRODUCTION_REF}).`)
    console.error(`  Contexte : ${context}`)
    console.error('  Aucune exécution locale (dev, tests E2E, seed, migration) ne peut cibler la production — aucune exception.')
    throw new Error(`assertNotProduction: ${varName} pointe vers la production (hostname=${host})`)
  }
}

// Résout VITE_SUPABASE_URL exactement comme le ferait Vite au démarrage
// du serveur de dev (.env, .env.local, .env.[mode], .env.[mode].local,
// avec la même priorité) — pour que le garde vérifie la valeur réellement
// utilisée, pas une approximation.
export function resolveViteSupabaseUrl(root = process.cwd()) {
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const env = loadEnv(mode, root, '')
  return env.VITE_SUPABASE_URL
}

// Point d'entrée commun pour `npm run dev` (predev) et playwright.config.ts
// (suite fonctionnelle) : résout VITE_SUPABASE_URL comme Vite le ferait,
// refuse et arrête le processus (exit 1) si c'est la production.
export function guardViteEnvOrExit(context) {
  const url = resolveViteSupabaseUrl()
  try {
    assertNotProduction('VITE_SUPABASE_URL', url, context)
  } catch (err) {
    console.error(`[guard:no-production] ${err.message}`)
    process.exit(1)
  }
  const host = extractHostname(url) || '(URL absente)'
  console.log(`[guard:no-production] OK — ${context} : VITE_SUPABASE_URL ne pointe pas vers la production (hôte : ${host}).`)
  return url
}
