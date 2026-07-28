# Envoi de devis/factures par email — architecture et protections

## Pourquoi ce document existe

Deux incidents de production le même jour (2026-07-28) :

1. `EmailDevisModal.tsx` affichait un message générique (« Impossible d'envoyer le devis ») qui masquait la vraie erreur serveur.
2. L'Edge Function `envoyer-email` a été durcie (`documentType`/`documentId` obligatoires, isolation multi-tenant) et déployée — mais le frontend correspondant n'a jamais été fusionné dans `main`. Résultat : chaque tentative d'envoi échouait en `400 Bad Request`, silencieusement, pendant des jours.

Aucun de ces deux incidents n'a été détecté avant qu'un utilisateur ne tombe dessus. Ce document décrit les protections mises en place pour que ce type de dérive frontend↔backend soit détecté **avant** la mise en production, pas après.

## Le contrat — une seule définition, pas deux comparées

**Révision 2026-07-28 (v2) : le contrat est maintenant un fichier réellement partagé, pas deux fichiers comparés par un test.** La v1 (deux fichiers + test de dérive comparant les noms de champs par regex) fonctionnait mais restait fragile : elle ne comparait que des noms de champs, pas les types/limites/règles, et rien n'empêchait physiquement un développeur pressé de modifier un seul des deux fichiers.

Analyse des options envisagées :

| Option | Verdict |
|---|---|
| 1. Fichier TS réellement partagé entre Vite et Deno | **Retenue** — voir ci-dessous |
| 2. Génération automatique d'un contrat depuis l'autre | Rejetée — ajoute un outil de génération et une étape "vérifier que le généré est à jour" pour un bénéfice inférieur à l'option 1 |
| 3. JSON Schema unique | Rejetée — nécessite quand même de régénérer des types TS des deux côtés ; zod fait déjà ce travail nativement |
| 4. Deux fichiers + comparaison structurelle robuste (types/limites/règles, pas juste les noms) | Rejetée au profit de l'option 1 — une vraie source unique élimine la classe de bug entière, une comparaison même parfaite ne fait que la détecter après coup |

**Solution retenue** : [`supabase/functions/_shared/emailContract.ts`](../supabase/functions/_shared/emailContract.ts) est la **seule définition** de `EnvoyerEmailPayloadSchema` (zod) dans tout le dépôt. [`src/lib/email/contract.ts`](../src/lib/email/contract.ts) ne fait plus que le réexporter :

```ts
export * from '../../../supabase/functions/_shared/emailContract.ts'
```

Pourquoi le fichier canonique vit côté `supabase/functions/_shared/` et pas côté `src/` : c'est la seule direction sans risque de déploiement. Le bundler de déploiement Supabase (`supabase functions deploy`) ne supporte officiellement que les imports internes à `supabase/functions/` — un fichier canonique placé dans `src/` et importé depuis l'Edge Function aurait été un pari sur le comportement du bundler, invérifiable sans déployer (interdit dans ce chantier). À l'inverse, Vite/esbuild (frontend) n'a **aucune** restriction sur l'origine des fichiers importés — l'import inverse (frontend → `supabase/functions/_shared/`) est sans risque et vérifiable entièrement en local (`tsc --noEmit`, `vitest`, `vite build`).

Le seul obstacle restant était la résolution du spécificateur `"zod"` : Vite le résout via `node_modules`, Deno ne le fait pas nativement. Résolu par [`supabase/functions/deno.json`](../supabase/functions/deno.json) :
```json
{ "nodeModulesDir": "auto", "imports": { "zod": "npm:zod@^3.23.8" } }
```
Deno résout alors `import { z } from 'zod'` exactement comme Vite, sans changer une seule ligne de code applicatif. `deno.json` est délibérément placé dans `supabase/functions/` (pas à la racine du dépôt) : le placer à la racine faisait échouer la résolution `npm:web-push` pré-existante de `send-push/index.ts` (Deno se met à scruter le `package.json` racine et tout son arbre de dépendances frontend, sans rapport) — vérifié et corrigé en pratique pendant ce chantier, pas une supposition.

`EmailDevisModal.tsx` et `FacturesPage.tsx` restent les deux seuls appelants de [`envoyerEmail()`](../src/lib/supabase/auth.ts) (`src/lib/supabase/auth.ts`), typé sur `EnvoyerEmailPayload`. Si un champ obligatoire est ajouté au schéma, TypeScript refuse de compiler tout appel qui ne le fournit pas — et comme il n'y a plus qu'une définition, il n'y a plus de second fichier à oublier de mettre à jour.

Les noms de champs sur le fil (`to`, `html`, `pdfBase64`, `pdfFilename`, `documentType`, `documentId`) restent volontairement inchangés par rapport à ce qui est déjà en production.

### Preuve que la source unique fonctionne réellement des deux côtés

[`src/lib/email/contract.test.ts`](../src/lib/email/contract.test.ts) contient un test qui importe le module canonique par les **deux chemins** (réexport frontend et chemin direct vers `supabase/functions/_shared/emailContract.ts`) et vérifie par égalité de référence (`toBe`, pas `toEqual`) que ce sont littéralement le même objet — pas une copie synchronisée. Si quelqu'un réintroduit une redéfinition locale (copier-coller au lieu de réexporter), ce test échoue immédiatement.

Ce test tourne dans `npm run test:unit` (hook pre-push + deux workflows CI). `deno check`/`deno test` sur `supabase/functions/envoyer-email/index.ts` et `_shared/emailContract.test.ts` prouvent indépendamment que le même fichier compile et s'exécute côté Deno.

## Validation — mêmes règles, une seule implémentation

| Vérification | Statut HTTP si échec |
|---|---|
| `to` présent et email valide | 400 |
| `subject`, `html` présents | 400 |
| `documentType` (`devis`\|`facture`) présent | 400 |
| `documentId` présent | 400 |
| `pdfBase64` non vide | 400 |
| `pdfBase64` ≤ `MAX_PDF_BYTES` (10 Mo) | 413 |
| `pdfFilename` présent, extension `.pdf` | 400 |

`validateEnvoyerEmailBody()` (backend) et `validateEnvoyerEmailPayload()` (frontend) appellent tous les deux `EnvoyerEmailPayloadSchema.safeParse()` — le même schéma, la même exécution de règles. Le frontend valide avant l'appel réseau pour un retour immédiat ; le backend revalide indépendamment (le frontend ne peut jamais être fait confiance : bug, ancien bundle en cache, appel direct de l'API).

**Changement de comportement assumé** : `pdfBase64`/`pdfFilename` sont désormais **obligatoires** côté backend (ils ne l'étaient pas avant — la fonction acceptait en théorie un email sans pièce jointe, une capacité jamais utilisée par aucun appelant réel). Resserrement délibéré lors de cette refonte, pas un effet de bord silencieux.

## Gestion des erreurs — ne jamais afficher un message générique

`supabase.functions.invoke()` remonte une réponse HTTP non-2xx comme `FunctionsHttpError`, dont `.message` est un texte générique fixe (« Edge Function returned a non-2xx status code »). Le vrai message métier vit dans le corps JSON de la réponse (`error.context`).

[`extractFunctionErrorMessage()`](../src/lib/supabase/auth.ts) lit ce corps une seule fois et retombe sur le message générique uniquement si le corps est illisible ou ne contient pas de champ `error`. `EmailDevisModal.tsx` et `FacturesPage.tsx` affichent toujours `response.error` tel quel à l'utilisateur, jamais un texte fixe masquant la cause — et journalisent systématiquement l'erreur complète via `console.error`.

## Logging structuré (Edge Function)

[`logEnvoyerEmailEvent()`](../supabase/functions/_shared/emailContract.ts) journalise, à chaque étape (refus, rejet de validation, échec Brevo/réseau, succès) :

- `documentType`, `documentId`, `organisationId`
- statut HTTP renvoyé à l'appelant
- temps de réponse (`responseTimeMs`)
- taille du PDF (`pdfSizeBytes`)
- code d'erreur structuré (`errorCode`)

**Jamais journalisé** : clé API Brevo, JWT/en-tête `Authorization`, contenu du PDF, contenu HTML de l'email, ni l'adresse email du destinataire.

## Tests — quatre paliers

| Palier | Commande | Ce qu'il couvre | Réseau réel ? |
|---|---|---|---|
| Unitaire frontend | `npm run test:unit` | Schéma, validation, dérive de contrat, génération PDF (multi-pages/CGV longues) | Non |
| Unitaire backend | `npm run test:deno` | Validation, construction payload Brevo, **erreur Brevo simulée**, **erreur réseau simulée** (fetch injecté) | Non — jamais un octet vers api.brevo.com |
| Intégration | `npm run test:integration:email` | Contrat + isolation multi-tenant + paramètres entreprise contre un vrai Supabase local (Docker) | Non (voir limite ci-dessous) |
| Smoke test réel | `npm run smoke:email` | Envoi réel via Brevo, PDF joint, réception | **Oui — manuel uniquement** |

### Scénarios couverts (correspondance avec la demande d'audit)

✓ devis · ✓ facture · ✓ documentType absent · ✓ documentId absent · ✓ email invalide · ✓ PDF vide (frontend) · ✓ PDF > limite (frontend + backend + intégration) · ✓ document inexistant · ✓ document d'une autre organisation · ✓ erreur Brevo simulée (Deno) · ✓ erreur réseau simulée (Deno)

**« utilisateur sans organisation »** — reformulé en pratique. `profiles.organisation_id` est `NOT NULL` (migration `20260610000002_profiles_organisation_id.sql`) : un profil existant a toujours une organisation. Le seul état atteignable est un utilisateur authentifié **sans ligne `profiles`** du tout (JWT valide, profil manquant — ex. échec de provisioning). `scripts/test-email-integration.mjs` teste ce chemin réel (résultat : `403 Accès non autorisé`, pas `403 Aucune organisation associée à ce compte` — ce second message est du code défensif actuellement inatteignable, laissé tel quel).

### Limite assumée — pas d'envoi Brevo réel en CI

Aucune clé Brevo de test/sandbox n'est disponible pour les tests automatisés. `test:integration:email` vérifie que les requêtes légitimes franchissent **toutes** les validations internes (contrat, isolation, paramètres entreprise, Reply-To) jusqu'à l'appel Brevo — qui échoue proprement avec `BREVO_API_KEY non configuré` en environnement de test, plutôt que d'être réellement exercé. C'est documenté comme une limite, jamais présenté comme un envoi réussi. Seul `smoke:email` envoie un email réel, et seulement sur déclenchement manuel explicite.

## Vérifications avant build (`scripts/verify-email-contract.mjs`)

Câblé sur `npm run prebuild` (hook npm automatique avant `build`, même mécanisme que `guard-no-production.mjs` sur `predev`). Trois vérifications :

1. Chaque `supabase.functions.invoke('<nom>')` trouvé dans `src/` a un dossier `supabase/functions/<nom>/index.ts` correspondant.
2. `deno check` passe sur `envoyer-email/index.ts` et ses dépendances `_shared/` — dégradé en avertissement (non bloquant) si le CLI Deno est absent (ex. build Vercel, qui n'installe pas Deno pour construire un frontend Vite).
3. Les variables `Deno.env.get('X')` référencées sont documentées dans `supabase/functions/.env.example`.

Ce script ne vérifie **pas** que les secrets sont réellement définis en production (nécessiterait un token Supabase en CI — décision distincte, non prise ici).

## Hook Git pre-push (`.husky/pre-push`)

Exécuté avant chaque `git push` local (~15-30s) : `typecheck` → `test:unit` → `verify-email-contract.mjs`. Volontairement léger — la suite complète (intégration, build, sécurité) tourne en CI, pas en local, pour ne pas ralentir excessivement chaque push. Un échec bloque le push.

Installé via `husky` (`"prepare": "husky"` dans `package.json`, exécuté automatiquement par `npm install`).

## CI (`.github/workflows/email-contract-ci.yml`)

Déclenché sur chaque pull request vers `main` (+ déclenchement manuel). Étapes, dans l'ordre, chacune bloquante :

1. Typecheck
2. ESLint (module email uniquement — voir plus bas)
3. `deno check` + `deno test` (Edge Function)
4. `vitest` (incl. dérive de contrat)
5. Démarrage Supabase local (Docker) + migrations
6. Tests d'intégration (`test:integration:email`)
7. Build production (inclut la vérification prebuild)

Complète `.github/workflows/security-tests.yml` (isolation multi-tenant générale) sans le modifier.

### Rendre cette CI réellement bloquante à la fusion

GitHub n'empêche pas par défaut de fusionner une PR dont une CI échoue. Pour l'imposer : **Settings → Branches → Branch protection rules → `main` → Require status checks to pass before merging**, puis cocher `email-contract-ci` (et `security-tests` si ce n'est pas déjà fait). Action manuelle réservée à un admin du dépôt — non effectuée automatiquement par cette correction.

## ESLint — périmètre volontairement restreint

Ce dépôt n'avait aucune configuration ESLint avant ce chantier. [`eslint.config.js`](../eslint.config.js) en ajoute une, mais `npm run lint` ne cible que les fichiers du module email (voir la liste dans le script `lint` de `package.json`) — l'étendre à tout le dépôt ferait remonter des avertissements sans rapport et rendrait la porte CI immédiatement rouge pour des raisons hors sujet. `@typescript-eslint/no-explicit-any` est en avertissement (non bloquant — motif `catch (e: any)` déjà répandu dans ce module) ; `no-unused-vars` et `no-unused-expressions` sont bloquants.

## Risques résiduels

- **Smoke test non automatique après déploiement Preview.** L'automatiser exige un compte de test dédié (organisation complète, devis/facture réels) et une adresse destinataire de test, fournis comme secrets CI/Vercel — décision et mise en place à faire séparément avec l'accord du propriétaire du projet.
- **Présence réelle des secrets en production non vérifiée automatiquement.** `verify-email-contract.mjs` vérifie qu'une variable est *documentée*, pas qu'elle est *définie* dans le projet Supabase de production (nécessiterait un token d'accès Supabase stocké comme secret CI).
- **Protection de branche GitHub non activée automatiquement** (voir section CI ci-dessus) — sans elle, une PR peut être fusionnée malgré un échec CI.
- **ESLint scopé au seul module email** — le reste du dépôt n'est pas couvert (choix assumé, voir section ESLint).
- **`inviter-intervenant/index.ts`** partage `_shared/validateEntreprise.ts` (donc bénéficie indirectement de `isValidEmail()` centralisé) mais n'a pas été aligné sur le contrat `emailContract.ts` — hors périmètre de ce chantier (dédié à l'envoi de devis/factures), documenté comme amélioration future possible.

## Améliorations futures possibles

- Étendre `verify-email-contract.mjs` pour vérifier la présence réelle des secrets en production (nécessite un token Supabase CI dédié, avec l'accord explicite du propriétaire du projet).
- Automatiser `smoke-test-email-send.mjs` après chaque déploiement Preview Vercel (deploy hook ou GitHub Actions `deployment_status`), une fois un compte de test dédié disponible.
- Étendre le pattern `_shared/emailContract.ts` (contrat + validation + logging structuré) aux autres Edge Functions métier (`inviter-intervenant`, `send-reminders`, `send-push`, `send-telegram`).
- Élargir ESLint au reste du dépôt progressivement, fichier par fichier, plutôt qu'en un seul chantier.
