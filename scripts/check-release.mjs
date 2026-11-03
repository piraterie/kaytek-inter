#!/usr/bin/env node
// scripts/check-release.mjs
// Garde-fou exécuté par Vercel avant chaque build (vercel.json → buildCommand).
//
// Le frontend est déployé par `vercel deploy` depuis un dossier local, sans
// intégration Git : un déploiement lancé depuis un dossier/une branche en
// retard sur la production (ce qui s'est produit : la prod du 2026-09-22
// venait d'un autre worktree que la branche de travail) retirerait
// silencieusement des correctifs déjà en ligne. Ce script refuse le build si
// le code envoyé ne contient pas les jalons de la version de production.
//
// Ajouter ici un jalon à chaque correctif critique mis en production.
import { existsSync, readFileSync } from 'node:fs'

const MILESTONES = [
  // 2026-11-03 — invitation / mot de passe oublié / inscription (fix/auth-invite-reset)
  { file: 'src/components/auth/PasswordSetupScreen.tsx', label: 'écran Activer mon compte / Nouveau mot de passe' },
  { file: 'src/lib/authLinks.ts', contains: 'token_hash', label: 'liens d\'invitation token_hash' },
  { file: 'src/lib/supabase/auth.ts', contains: 'demander-reinitialisation', label: 'mot de passe oublié via Brevo' },
  { file: 'src/lib/supabase/auth.ts', contains: 'Adresse e-mail ou mot de passe incorrect', label: 'message de connexion en français' },
  { file: 'supabase/migrations/20261103000000_handle_new_user_server_only_org.sql', label: 'faille d\'inscription (migration)' },
  { file: 'supabase/migrations/20261103000100_member_permissions_hardening.sql', label: 'droits assistant/intervenant (migration)' },
  { file: 'supabase/migrations/20261103000200_enforce_can_create_documents.sql', label: 'can_create_documents côté serveur (migration)' },
  { file: 'supabase/functions/supprimer-utilisateur/index.ts', contains: 'DELETABLE_ROLES', label: 'suppression d'utilisateur limitée à sa propre entreprise' },
  { file: 'supabase/functions/dynamic-api/index.ts', contains: 'Fonction supprimée', label: 'dynamic-api neutralisée' },
  // 2026-09-22 — tableau de bord Google Ads (style/color-palette @ c3892b4)
  { file: 'src/pages/googleAds/Overview.tsx', label: 'tableau de bord Google Ads' },
  { file: 'supabase/migrations/20260921120000_google_ads_intraday_tables.sql', label: 'Google Ads intraday' },
]

const missing = MILESTONES.filter(({ file, contains }) =>
  !existsSync(file) || (contains && !readFileSync(file, 'utf-8').includes(contains)))

if (missing.length) {
  console.error('\n[check-release] DÉPLOIEMENT REFUSÉ — ce dossier est en retard sur la production.')
  console.error('Éléments absents :')
  for (const m of missing) console.error(`  - ${m.label} (${m.file})`)
  console.error('\nDéployez depuis la branche fix/auth-invite-reset (ou une branche qui la contient).\n')
  process.exit(1)
}
console.log(`[check-release] OK — ${MILESTONES.length} jalons de production présents.`)
