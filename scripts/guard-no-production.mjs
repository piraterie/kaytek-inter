#!/usr/bin/env node
// scripts/guard-no-production.mjs
// Câblé sur le hook npm `predev` (voir package.json) — npm exécute
// automatiquement ce script AVANT `npm run dev`, y compris lorsque `npm
// run dev` est lancé indirectement en sous-processus (ex. Playwright
// webServer.command dans playwright.config.ts) : comportement standard du
// cycle de vie npm, pas une convention propre à ce dépôt.
//
// Résout VITE_SUPABASE_URL exactement comme Vite le ferait (.env,
// .env.local, .env.[mode], .env.[mode].local) et refuse de démarrer si
// cette URL correspond au projet Supabase de production. Avant cette
// correction, rien ne bloquait `npm run dev` de pointer vers la
// production si .env.local était mal configuré.
import { guardViteEnvOrExit } from './lib/production-guard.mjs'

guardViteEnvOrExit('npm run dev (serveur de développement local, aussi utilisé par playwright.config.ts comme webServer)')
