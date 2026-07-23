# Reprise de validation locale (Corrections 1 à 6) sur un poste avec Docker

Ce document est une **procédure**, pas une exécution. Aucune commande listée ci-dessous n'a été lancée
depuis cette session (Docker toujours indisponible ici — voir
`validation-finale-corrections-01-a-06.md`). Aucun fichier de code, de migration ou de test n'a été
modifié pour produire ce document. Objectif : permettre à un autre poste ou une autre session disposant
de Docker Desktop et de la Supabase CLI de reprendre exactement où la validation précédente s'est
arrêtée.

## 0. Vérification préalable — la commande agrégée appelle-t-elle les bons scripts ?

`package.json` définit :

```json
"test:security": "npm run test:security:preflight && npm run test:security:sql && npm run test:security:storage && npm run test:security:edge-functions && npm run test:security:concurrency && npm run test:security:playwright"
```

Chacun des 6 scripts appelés existe réellement sous ce nom exact dans `package.json`, et chacun pointe
vers un fichier réellement présent sous `scripts/` :

| Script npm réel | Commande | Fichier | Présent |
|---|---|---|---|
| `test:security:preflight` | `node scripts/test-security-preflight.mjs` | `scripts/test-security-preflight.mjs` | Oui |
| `test:security:sql` | `node scripts/run-security-sql-tests.mjs` | `scripts/run-security-sql-tests.mjs` | Oui |
| `test:security:storage` | `node scripts/test-security-storage.mjs` | `scripts/test-security-storage.mjs` | Oui |
| `test:security:edge-functions` | `node scripts/test-security-edge-functions.mjs` | `scripts/test-security-edge-functions.mjs` | Oui |
| `test:security:concurrency` | `node scripts/test-security-concurrency.mjs` | `scripts/test-security-concurrency.mjs` | Oui |
| `test:security:playwright` | `node scripts/run-security-playwright.mjs` | `scripts/run-security-playwright.mjs` | Oui |

**Conclusion : `npm run test:security` appelle bien les 6 scripts réels et correctement nommés.**
Aucun problème bloquant ici — rien à corriger.

Un script supplémentaire existe mais n'est **pas** inclus dans l'agrégation `test:security` (volontaire,
voir Correction 6) : `test:security:seed` → `node scripts/seed-security-fixtures.mjs`. Il doit être
lancé manuellement avant les suites qui en dépendent (voir section "Variables et fixtures locales").

### Écarts de nommage connus (non corrigés — pour information uniquement)

Ces deux écarts entre une instruction théorique antérieure et les scripts réellement livrés sont
**rappelés ici tels quels**, sans modification :

| Nom théorique utilisé dans une instruction antérieure | Nom réel dans `package.json` |
|---|---|
| `test:security:rls` | `test:security:playwright` |
| `test:security:functions` | `test:security:edge-functions` |

La procédure ci-dessous n'utilise **que** les noms réels.

## 1. Préconditions

- Docker Desktop démarré, daemon accessible (`docker ps` répond sans erreur).
- Supabase CLI installée et exécutable (`supabase --version`).
- Node.js et npm disponibles, dépendances installées (`npm ci` déjà exécuté ou à exécuter).
- **Aucune** URL distante dans `SUPABASE_TEST_URL` (ni dans aucune variable `SUPABASE_TEST_*`).
- **Aucune** variable de production utilisée à aucun moment (pas de `VITE_SUPABASE_URL` de production
  copiée dans une variable `SUPABASE_TEST_*`).

## 2. Vérifications initiales

```bash
git branch --show-current
git status --short
docker ps
supabase --version
node --version
npm --version
```

Comparer `git status --short` à l'état documenté dans `validation-finale-corrections-01-a-06.md`
(section 1) : la reprise doit démarrer sur un arbre de travail identique (aucun changement
supplémentaire inattendu). Si une différence non expliquée apparaît, **arrêter et documenter** avant
de continuer (règle 9 : ne pas corriger automatiquement).

## 3. Démarrage local

```bash
supabase stop --no-backup
supabase start
supabase status
```

`supabase status` affiche `API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` (entre autres) pour
l'instance locale éphémère qui vient de démarrer.

**Comment récupérer ces valeurs sans les écrire dans le rapport ni les committer :**

- Les lire directement dans le terminal (sortie de `supabase status`) et les exporter dans la session
  shell courante uniquement (variables d'environnement de processus, jamais dans un fichier suivi par
  Git) :
  ```bash
  export SUPABASE_TEST_URL="<valeur API_URL affichée par supabase status>"
  export SUPABASE_TEST_ANON_KEY="<valeur ANON_KEY affichée>"
  export SUPABASE_TEST_SERVICE_ROLE_KEY="<valeur SERVICE_ROLE_KEY affichée>"
  export SUPABASE_TEST_DB_URL="<valeur DB_URL affichée>"
  ```
- Ou, si l'on préfère un fichier local : créer/éditer **`.env.test`** (déjà gitignored — jamais
  `.env.test.example`, qui est un template public) et y coller ces valeurs ; `.env.test` n'est jamais
  lu par aucun script en dehors de la machine locale et n'est jamais committé.
- Ne **jamais** coller ces valeurs dans ce document, dans un commit, dans une issue, ou dans tout
  fichier suivi par Git.
- Toutes ces valeurs sont, par construction de `supabase start`, locales à l'instance Docker éphémère
  démarrée à l'instant — elles n'ont aucune validité en dehors de la machine et de la session
  courantes.

## 4. Variables locales attendues

Variables obligatoires, exigées par `scripts/test-security-preflight.mjs` (garde centrale, appelée par
tous les scripts de sécurité) :

- `SUPABASE_TEST_URL` — doit résoudre en hostname `localhost`/`127.0.0.1`/`::1` (vérifié par le
  preflight, qui refuse toute autre valeur).
- `SUPABASE_TEST_ANON_KEY`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `SUPABASE_TEST_DB_URL` — doit également résoudre en hostname local (même vérification).

Comptes fixtures locaux éventuels (nécessaires selon les suites exécutées — voir
`.env.test.example`, section "Correction 6 (TEST-01)") :

- `TEST_ADMIN_A_EMAIL` / `TEST_ADMIN_A_PASSWORD`
- `TEST_ADMIN_B_EMAIL` / `TEST_ADMIN_B_PASSWORD`
- `TEST_INTERVENANT_A_EMAIL` / `TEST_INTERVENANT_A_PASSWORD` (nécessaire pour `test:security:seed`
  et pour la collecte complète des specs Playwright dédiés sécurité)

Toutes ces variables doivent provenir **exclusivement** de `supabase status` (pour les 4 premières) ou
de valeurs fixes non sensibles sous le domaine réservé aux tests `example.test` (RFC 2606, pour les
comptes fixtures) — jamais d'un fichier `.env.production`/`.env.local` ni d'un projet Supabase distant.

Si les comptes fixtures n'existent pas encore sur l'instance locale fraîchement démarrée, les créer
via :

```bash
npm run test:security:seed
```

(crée organisations, comptes admin A/B, intervenant A, abonnements actifs — voir le script pour le
détail exact et ses limites documentées dans `correction-06-tests-multitenant.md`, section 9).

## 5. Réinitialisation de la base

```bash
supabase db reset
```

Doit appliquer toutes les migrations depuis zéro, y compris — sans s'y limiter — les 5 migrations des
Corrections 2 à 5 :

- `20260722000001_subscription_access_enforcement.sql`
- `20260723000001_fix_pir_select_admin_check.sql`
- `20260724000001_secure_get_partner_requests_preview.sql`
- `20260725000001_organisation_scoped_document_numbering.sql`
- `20260726000001_unify_commission_calculation.sql`

**Règle d'arrêt** : si `supabase db reset` échoue sur une migration, **ne pas éditer la migration**,
conserver la sortie exacte, classer l'échec (syntaxe / dépendance manquante / assertion / doublon
historique fixture / privilège / fonction ou policy absente / autre) et arrêter toute la suite SQL —
ne pas poursuivre les blocs suivants tant que ce point n'est pas résolu sous nouvelle autorisation.

## 6. Tests

Utiliser exclusivement les noms de scripts réels (section 0). Ordre recommandé — du plus rapide/moins
coûteux au plus long, avec arrêt immédiat au premier échec critique (voir section "Règles d'arrêt") :

```bash
npm run test:security:preflight
npm run test:unit
```

Puis, individuellement, dans l'ordre d'agrégation réel de `test:security` :

```bash
npm run test:security:sql
npm run test:security:storage
npm run test:security:edge-functions
npm run test:security:concurrency
npm run test:security:playwright
```

Puis, une fois chaque bloc validé individuellement :

```bash
npm run test:security
npm run typecheck
npm run build
```

Aucun script ne figurant pas réellement dans `package.json` (`test:security:rls`,
`test:security:functions`) ne doit être invoqué.

## 7. Règles d'arrêt (bloquantes — arrêter immédiatement)

Arrêter la suite en cours (et ne pas enchaîner les blocs suivants) si l'un de ces cas se produit :

- le preflight refuse l'environnement (`test:security:preflight` sort en erreur) ;
- Docker devient inaccessible en cours de route ;
- une migration échoue (`supabase db reset`) ;
- un test SQL échoue (`test:security:sql`) ;
- un test critique est rapporté comme ignoré/`skipped` (quel que soit le bloc) ;
- une suite exécute **zéro** scénario (0 test découvert) ;
- une URL distante apparaît dans une sortie de commande, un log, ou une variable d'environnement ;
- une Edge Function tente de contacter un fournisseur externe réel (Brevo ou autre) — vérifier les
  logs `supabase functions serve`/`supabase status` avant et après chaque appel de
  `test:security:edge-functions` ;
- le nettoyage (`supabase stop --no-backup`) échoue.

Dans tous ces cas : conserver la sortie exacte, classer la cause, ne rien corriger automatiquement, et
ne pas exécuter les blocs suivants sans nouvelle autorisation explicite.

## 8. Tableau de résultats à consigner (vierge)

| Bloc | Commande réelle | Exécuté | Réussi | Échoué | Ignoré | Durée | Observation |
|---|---|---:|---:|---:|---:|---:|---|
| Docker | `docker ps` | | | | | | |
| Supabase start | `supabase start` | | | | | | |
| db reset | `supabase db reset` | | | | | | |
| Migration Correction 2 | `20260722000001_subscription_access_enforcement.sql` (via `db reset`) | | | | | | |
| Migration Correction 3 | `20260723000001_fix_pir_select_admin_check.sql` (via `db reset`) | | | | | | |
| Migration Correction 3 bis | `20260724000001_secure_get_partner_requests_preview.sql` (via `db reset`) | | | | | | |
| Migration Correction 4 | `20260725000001_organisation_scoped_document_numbering.sql` (via `db reset`) | | | | | | |
| Migration Correction 5 | `20260726000001_unify_commission_calculation.sql` (via `db reset`) | | | | | | |
| Vitest | `npm run test:unit` | | | | | | |
| SQL | `npm run test:security:sql` | | | | | | |
| Playwright multi-tenant | `npm run test:security:playwright` | | | | | | |
| Storage | `npm run test:security:storage` | | | | | | |
| Edge Functions | `npm run test:security:edge-functions` | | | | | | |
| Concurrence | `npm run test:security:concurrency` | | | | | | |
| Sécurité globale | `npm run test:security` | | | | | | |
| Typecheck | `npm run typecheck` | | | | | | |
| Build | `npm run build` | | | | | | |
| Nettoyage | `supabase stop --no-backup` | | | | | | |

## 9. Nettoyage

```bash
supabase stop --no-backup
git status --short
```

Vérifier explicitement :

- aucune fixture distante créée (tout est resté sur l'instance locale éphémère, désormais arrêtée) ;
- aucun fichier temporaire contenant une clé n'a été laissé sur le disque (ni dans le dépôt, ni
  ailleurs qu'un éventuel `.env.test` local déjà gitignored) ;
- `git status --short` ne montre **aucune** modification imprévue par rapport à l'état documenté dans
  `validation-finale-corrections-01-a-06.md` — seule l'ajout éventuel de rapports de résultats est
  attendu, jamais un changement de code/migration ;
- aucune stack Supabase locale encore active (`docker ps` ne doit plus montrer de conteneur Supabase).

## 10. Décision — rappels

- **Aucun déploiement** si une suite critique n'a pas réellement tourné.
- **Aucun déploiement** si une migration échoue.
- **Aucun déploiement** si un test critique est ignoré (`skipped`).
- L'erreur TypeScript préexistante (`src/pages/DevisFormPage.tsx:191`, `TS2339` sur
  `adresse_intervention`) **doit rester documentée** tant qu'elle n'est pas corrigée séparément, sous
  autorisation dédiée — ne pas la corriger pendant une phase de validation.
- **Un build réussi seul ne suffit jamais** à valider la sécurité multi-tenant — il ne prouve que
  l'absence de régression de compilation Vite.

Procédure de reprise préparée. Aucune correction ni validation dynamique supplémentaire n'a été effectuée.
