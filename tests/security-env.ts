// tests/security-env.ts
// Correction 6 (TEST-01) — garde d'environnement obligatoire pour les
// tests Playwright de sécurité (tests/multi-tenant/*.spec.ts).
//
// Contrairement à l'ancien mécanisme :
//   test.skip(!process.env.TEST_ADMIN_B_EMAIL, '...')
// qui ignorait silencieusement toute la suite (Playwright la rapporte
// comme "skipped", code de sortie 0 si aucun autre test n'échoue),
// requireSecurityTestEnv() est appelée en tête de fichier, EN DEHORS de
// tout test.describe/test — un throw() synchrone à ce niveau interrompt
// la COLLECTE du fichier de test lui-même : Playwright rapporte alors une
// erreur de chargement de fichier (pas un skip), et le run global échoue
// (code de sortie non nul), quel que soit le résultat des autres fichiers.
//
// N'utilise QUE les variables dédiées à la suite de sécurité — jamais de
// repli vers VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ni vers les
// comptes de la suite Playwright fonctionnelle (TEST_ADMIN_EMAIL,
// TEST_INTERVENANT_EMAIL — utilisés uniquement par tests/e2e/*).

const REQUIRED_SECURITY_TEST_VARS = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'TEST_ADMIN_A_EMAIL',
  'TEST_ADMIN_A_PASSWORD',
  'TEST_ADMIN_B_EMAIL',
  'TEST_ADMIN_B_PASSWORD',
] as const

export function requireSecurityTestEnv(): void {
  const missing = REQUIRED_SECURITY_TEST_VARS.filter((name) => {
    const v = process.env[name]
    return v === undefined || v.trim() === ''
  })

  if (missing.length > 0) {
    throw new Error(
      `Suite de sécurité multi-tenant impossible à exécuter — variable(s) obligatoire(s) manquante(s) : ${missing.join(', ')}. ` +
      `Voir .env.test.example. Cette suite ne doit JAMAIS être ignorée silencieusement (Correction 6 / TEST-01) : ` +
      `une configuration incomplète doit faire échouer la commande, jamais produire un résultat "skipped".`
    )
  }
}
