# Validation finale locale des Corrections 1 à 6

Phase de vérification uniquement — **aucune correction métier apportée**. Objectif : exécuter
réellement, sur une base Supabase locale jetable, les tests critiques des Corrections 1 à 6.

## 0. Résultat en une phrase

**Docker Desktop n'a pas de daemon accessible dans cet environnement** (client installé, serveur
injoignable). `supabase start` échoue donc immédiatement. Conformément aux règles de cette phase,
aucune URL distante n'a été utilisée comme repli, et toute la validation dynamique dépendant d'une
base Supabase locale (migrations, tests SQL, RLS multi-tenant, Storage, Edge Functions, concurrence,
`test:security` global, exécution dynamique du workflow CI) **n'a pas pu être exécutée**. Seules les
vérifications ne nécessitant aucune base (garde anti-production, tests unitaires, typecheck, build,
revue statique du workflow CI) ont été réellement exécutées.

## 1. État initial

```
$ git branch --show-current
capacitor-android

$ git status --short
```

Classement des fichiers modifiés/ajoutés par correction (fichiers `.playwright-cli/*` exclus : logs
d'un outil de navigation externe, sans rapport avec une correction) :

| Correction | Fichiers |
|---|---|
| Correction 1 (FONC-01) | `src/lib/devisCalc.ts` (nouveau), `src/lib/devisCalc.test.ts` (nouveau), `vitest.config.ts` (nouveau), `src/lib/hooks/index.ts`, `src/lib/pdf/generator.tsx`, `src/pages/DevisFormPage.tsx`, `src/pages/DevisApercuPage.tsx`, `package.json` (dépendance vitest) |
| Correction 2 (SEC2-01) | `supabase/migrations/20260722000001_subscription_access_enforcement.sql` (nouveau), `supabase/functions/envoyer-email/index.ts`, `supabase/functions/inviter-intervenant/index.ts`, `supabase/functions/send-reminders/index.ts`, `src/lib/supabase/auth.ts`, `src/pages/PlanningPage.tsx` |
| Correction 3 (RLS-01) | `supabase/migrations/20260723000001_fix_pir_select_admin_check.sql` (nouveau) |
| Correction 3 bis (RLS-07) | `supabase/migrations/20260724000001_secure_get_partner_requests_preview.sql` (nouveau), `src/lib/hooks/partners.ts` |
| Correction 4 (DB-02) | `supabase/migrations/20260725000001_organisation_scoped_document_numbering.sql` (nouveau) |
| Correction 5 (FONC-02) | `supabase/migrations/20260726000001_unify_commission_calculation.sql` (nouveau) |
| Correction 6 (TEST-01) | `.gitignore`, `package.json` (scripts additifs), `playwright.config.ts`, `tests/multi-tenant/01-isolation.spec.ts`, `tests/multi-tenant/02-isolation-create.spec.ts`, `playwright.security.config.ts` (nouveau), `tests/security-env.ts` (nouveau), `tests/security.setup.ts` (nouveau), `scripts/**` (nouveau), `.github/workflows/security-tests.yml` (nouveau), `audit-kaytek-inter/corrections/correction-06-tests-multitenant.md` (nouveau) |
| Hors périmètre (bruit) | `package-lock.json` (généré par l'installation de vitest, Correction 1), `.playwright-cli/*` (logs d'un outil de navigation externe, non lié à une correction) |

Confirmations :

- **Aucune ancienne migration modifiée** : `git status` ne montre aucun `M` sous
  `supabase/migrations/` — uniquement des `??` (nouveaux fichiers) pour les 5 migrations des
  Corrections 2 à 5. 107 fichiers de migration présents au total dans le dépôt.
- **Toutes les nouvelles migrations attendues sont présentes** : les 5 fichiers listés dans l'énoncé
  existent (`20260722000001`, `20260723000001`, `20260724000001`, `20260725000001`, `20260726000001`).
- **Tous les fichiers de tests attendus existent** (vérifié fichier par fichier) : les 5 `.sql` sous
  `audit-kaytek-inter/corrections/tests/`, les 8 scripts sous `scripts/`, `tests/security-env.ts`,
  `tests/security.setup.ts`, `playwright.security.config.ts`, `.github/workflows/security-tests.yml`.
- **Aucun fichier secret réel n'est suivi par Git** : `git ls-files | grep -i '\.env'` ne retourne
  **aucun résultat** — tous les fichiers `.env*` locaux (`.env.test`, `.env.local`, `.env.production`,
  `.env.beta-test`, `.env.guide`, y compris `.env.test.example`) apparaissent comme ignorés (`!!`) par
  le `.gitignore` existant (pattern large `.env*`, préexistant, non introduit par cette phase).
  **Observation** (non corrigée ici, hors mandat de cette phase) : ce pattern ignore aussi
  `.env.test.example`, un fichier de documentation sans secret réel qui pourrait légitimement être
  suivi — signalé pour information, aucune modification apportée.

Aucun changement n'a été supprimé ni restauré.

## 2. Garde anti-production — validé réellement

| Scénario | Commande | Code sortie | Résultat |
|---|---|---:|---|
| Configuration absente | `node scripts/test-security-preflight.mjs` (aucune variable) | 1 | Liste précise des 4 variables manquantes, aucune clé affichée |
| URL distante fictive | `SUPABASE_TEST_URL=https://fictitious-remote-project.supabase.co ...` | 1 | `REFUS : les tests de sécurité ne peuvent jamais être exécutés contre la production.` + raison (hôte non local) |
| `VITE_SUPABASE_URL` présent (repli refusé) | `VITE_SUPABASE_URL=http://127.0.0.1:54321 ...` (sans aucune variable `SUPABASE_TEST_*`) | 1 | Mêmes 4 variables `SUPABASE_TEST_*` toujours rapportées manquantes — `VITE_SUPABASE_URL` n'a aucun effet de repli |
| Configuration locale valide | `SUPABASE_TEST_URL=http://127.0.0.1:54321 ...` (toutes variables locales) | 0 | `[preflight] OK` — seuls des hostnames (`127.0.0.1`) affichés, jamais une clé ni une URL complète |

Aucune clé, mot de passe ni URL complète n'a été affichée dans aucune des 4 commandes ci-dessus.

## 3. Démarrage de Supabase local — INDISPONIBLE

```
$ docker ps
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ...
(exit 1)

$ docker info
Client: Version 29.5.3 (présent)
Server: failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... (exit 1)

$ supabase --version
2.105.0 (exit 0 — CLI présente et fonctionnelle)

$ supabase start
failed to inspect service: error during connect: ... open //./pipe/dockerDesktopLinuxEngine:
The system cannot find the file specified.
Docker Desktop is a prerequisite for local development. Follow the official docs to install:
https://docs.docker.com/desktop
(exit 1)
```

**Diagnostic** : le client Docker est installé, mais le daemon Docker Desktop n'est pas accessible
(pipe nommé local introuvable — aucune tentative de contact réseau, aucune URL distante utilisée).
Conformément aux règles de cette phase, la validation dynamique s'arrête ici. Aucune tentative de
contournement (URL distante, compte réel, etc.) n'a été effectuée.

## 4 à 11 — NON EXÉCUTÉES (dépendantes d'une base Supabase locale)

Les blocs suivants n'ont **pas pu être exécutés réellement** faute de Docker fonctionnel : aucune
migration n'a été appliquée dynamiquement, aucun test SQL/RLS/Storage/Edge Functions/concurrence n'a
tourné contre une base réelle. Aucun résultat n'est simulé ou fabriqué ci-dessous.

- Section 4 — Application des migrations (`supabase db reset`) : **non exécutée**.
- Section 6 — Tests SQL Corrections 2 à 5 (`npm run test:security:sql`) : **non exécutée**.
- Section 7 — Tests multi-tenant RLS Playwright : commande demandée `npm run test:security:rls`
  **n'existe pas** dans `package.json` ; le script réellement livré par la Correction 6 s'appelle
  `test:security:playwright`. Observation factuelle, non corrigée pendant cette phase (règle 9).
  Dans tous les cas : **non exécutable** sans Supabase local.
- Section 8 — Tests Storage (`npm run test:security:storage`) : **non exécutée**.
- Section 9 — Tests Edge Functions : commande demandée `npm run test:security:functions`
  **n'existe pas** ; le script réel s'appelle `test:security:edge-functions`. Même observation qu'en
  section 7, non corrigée. **Non exécutable** sans Supabase local (et sans `supabase functions serve`,
  lui-même dépendant de Docker).
- Section 10 — Tests de concurrence (`npm run test:security:concurrency`) : **non exécutée**.
- Section 11 — Commande globale `npm run test:security` : **non exécutée** (aurait de toute façon
  échoué dès `test:security:preflight` sans configuration locale réelle, puis à `test:security:sql`
  faute de `psql`/base locale — non tenté pour éviter un résultat trompeur).

## 5. Tests unitaires — exécuté, réussi

```
$ npx vitest run
✓ src/lib/devisCalc.test.ts (42 tests) 24ms

Test Files  1 passed (1)
     Tests  42 passed (42)
```

- Découverts : 42. Exécutés : 42. Réussis : 42. Échoués : 0. Ignorés : 0.
- Indépendant de Supabase (aucune connexion réseau/DB) — seul bloc de test métier réellement validé
  dans cette phase.

## 12. Typecheck et build — exécutés

```
$ npm run typecheck
src/pages/DevisFormPage.tsx(191,42): error TS2339: Property 'adresse_intervention' does not exist
on type '{ nom: string; prenom?: string; telephone?: string; email?: string; }'.
(exit 2)
```

- **Une seule erreur**, identique à celle déjà documentée avant cette phase (même fichier, même
  ligne, même message) — **aucune nouvelle erreur**, **aucun fichier de la Correction 6** n'est
  concerné.
- Non masquée, non corrigée pendant cette phase (règle 12/interdiction de correction).

```
$ npm run build
✓ built in 11.23s
(exit 0)
```

- Build réussi (le typecheck n'est pas bloquant pour Vite). **Un build réussi n'est pas considéré ici
  comme une validation de sécurité** (règle 15) — il confirme uniquement l'absence de régression de
  compilation.

## 13. Validation statique du workflow CI

Fichier : `.github/workflows/security-tests.yml`.

Aucun outil de validation YAML dédié n'est disponible dans cet environnement (`python3`/`pyyaml`
absents, `js-yaml` absent de `node_modules`) — pas d'installation tentée (hors mandat de cette phase,
et éviterait tout accès réseau superflu). Revue manuelle structurelle effectuée à la place :

| Critère | Constat |
|---|---|
| Déclenchement PR + manuel | `on: workflow_dispatch: {}` et `pull_request: branches: [main]` — conforme |
| Aucun secret de production | Toutes les variables sont dérivées de `supabase status` (local) ou de valeurs fixes `example.test` non sensibles — aucun `secrets.*` référencé |
| Démarrage Supabase local | `supabase start` présent |
| Application des migrations | `supabase db reset` présent |
| Tests unitaires | `npm run test:unit` présent |
| Exécution de `test:security` | `npm run test:security` présent |
| Absence de `continue-on-error` | `grep -n "continue-on-error"` → aucune occurrence, confirmé |
| Artefacts en cas d'échec | `if: failure()` + `actions/upload-artifact@v4` sur `playwright-report-security/` |
| Arrêt Supabase sous `always()` | `if: always()` sur l'étape `Stop Supabase local` |
| Absence de tabulations | Confirmée (`grep -P "\t"` → aucune occurrence) |

Aucune tentative d'exécution dynamique du workflow (pas de `act`, pas de push, pas de déclenchement
GitHub) — hors mandat de cette phase et interdit par les règles (13/14).

## 14. Nettoyage

- Aucune stack Supabase locale n'a démarré — rien à arrêter (`supabase stop` non nécessaire, non
  exécuté).
- Aucun fichier temporaire contenant une clé n'a été créé par cette phase.
- Aucun compte, fixture ou objet Storage distant créé.
- `git status --short` après cette phase est **identique** à l'état initial (section 1) : cette phase
  n'a modifié aucun fichier suivi ni créé de nouveau fichier autre que ce rapport lui-même.

## 15. Tableau récapitulatif

| Bloc | Exécuté | Réussi | Échoué | Ignoré | Environnement | Bloquant |
|---|---:|---:|---:|---:|---|---:|
| Preflight sans configuration | Oui | Oui (refus attendu) | 0 | 0 | Local (aucun réseau) | Non |
| Preflight URL distante fictive | Oui | Oui (refus attendu) | 0 | 0 | Local (aucun réseau) | Non |
| Preflight `VITE_*` sans repli | Oui | Oui (refus attendu) | 0 | 0 | Local (aucun réseau) | Non |
| Preflight configuration locale valide | Oui | Oui | 0 | 0 | Local | Non |
| Migrations locales (`supabase db reset`) | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Vitest (tests unitaires) | Oui | 42 | 0 | 0 | Local, sans Supabase | Non |
| SQL Correction 2 | Non | — | — | — | Indisponible (Docker) | **Oui** |
| SQL Correction 3 | Non | — | — | — | Indisponible (Docker) | **Oui** |
| SQL Correction 3 bis | Non | — | — | — | Indisponible (Docker) | **Oui** |
| SQL Correction 4 | Non | — | — | — | Indisponible (Docker) | **Oui** |
| SQL Correction 5 | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Multi-tenant Playwright (RLS) | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Storage | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Edge Functions | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Concurrence — numérotation | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Concurrence — commissions | Non | — | — | — | Indisponible (Docker) | **Oui** |
| Typecheck | Oui | Non (1 erreur préexistante, hors périmètre) | 1 | 0 | Local | Non (build non bloqué) |
| Build | Oui | Oui | 0 | 0 | Local | Non |
| Validation CI (statique) | Oui (revue manuelle) | Oui | 0 | 0 | Local (aucun outil YAML dédié disponible) | Non |
| Validation CI (dynamique) | Non | — | — | — | Non tentée (hors mandat) | Non |

### Détail des blocs non exécutés

| Bloc | Commande | Fichier concerné | Cause probable | Correction concernée | Bloquant |
|---|---|---|---|---|---|
| Migrations locales | `supabase db reset` | — | Daemon Docker Desktop injoignable (`npipe:////./pipe/dockerDesktopLinuxEngine`) | Toutes (2–6) | Oui |
| SQL Corrections 2–5 | `npm run test:security:sql` | `scripts/run-security-sql-tests.mjs` | Dépend d'une base locale démarrée (bloqué en amont) | 2, 3, 3 bis, 4, 5 | Oui |
| Multi-tenant RLS | Nom demandé `test:security:rls` **inexistant** (script réel : `test:security:playwright`) | `playwright.security.config.ts` | Dépend d'une base locale démarrée (bloqué en amont) ; écart de nommage observé mais non corrigé | 6 (et isolation 2–5 indirectement) | Oui |
| Storage | `npm run test:security:storage` | `scripts/test-security-storage.mjs` | Dépend d'une base locale démarrée (bloqué en amont) | 6 | Oui |
| Edge Functions | Nom demandé `test:security:functions` **inexistant** (script réel : `test:security:edge-functions`) | `scripts/test-security-edge-functions.mjs` | Dépend de `supabase functions serve` + base locale (bloqué en amont) ; écart de nommage observé mais non corrigé | 2, 6 | Oui |
| Concurrence | `npm run test:security:concurrency` | `scripts/test-security-concurrency.mjs` | Dépend d'une base locale démarrée (bloqué en amont) | 4, 5 | Oui |
| `test:security` global | `npm run test:security` | `package.json` | Dépend de tous les blocs ci-dessus | Toutes | Oui |
| CI dynamique | — | `.github/workflows/security-tests.yml` | Non tentée — hors mandat de cette phase, aurait nécessité Docker également | 6 | Non (info seule) |

## 16. Décision de fin (première tentative)

### NON VALIDÉ — ENVIRONNEMENT INDISPONIBLE

Docker Desktop n'a pas de daemon accessible dans cet environnement ; `supabase start` échoue
immédiatement et sans contact réseau. Aucune migration, aucun test SQL, aucun test d'isolation
multi-tenant, aucun test Storage, aucun test Edge Functions et aucun test de concurrence n'a pu être
réellement exécuté contre une base Supabase locale. Seuls la garde anti-production (tests négatifs et
positif), les 42 tests unitaires, le typecheck/build et une revue statique manuelle du workflow CI ont
été réellement vérifiés.

L'application **n'est pas déclarée prête à être commercialisée ou déployée** sur la base de cette
phase. Aucune correction métier n'a été apportée. Aucun commit, aucun push, aucun déploiement.

## 17. Nouvelle tentative de validation (2026-07-22)

Reprise demandée explicitement avec une règle renforcée : *« Si `docker ps` échoue, arrête
immédiatement »*, placée dès la section « Vérifications initiales ». Exécution :

```
$ git branch --show-current
capacitor-android

$ git status --short
(identique à la section 1 — aucun changement supplémentaire depuis la tentative précédente)

$ docker ps
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the
path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system
cannot find the file specified.
(exit 1)

$ supabase --version
2.105.0 (exit 0)

$ node --version
v22.16.0

$ npm --version
9.6.2
```

**`docker ps` a échoué (exit 1) — arrêt immédiat conformément à la règle explicite de cette
tentative.** Contrairement à la tentative précédente (section 3), aucune vérification supplémentaire
n'a été relancée après cet échec — ni les scénarios négatifs du preflight, ni `npm run test:unit`, ni
`npm run typecheck`/`npm run build` — bien que ces derniers soient indépendants de Docker et aient déjà
été validés lors de la tentative précédente (sections 2, 5, 12 ci-dessus, résultats inchangés car
aucun fichier de code, de test ou de configuration n'a été modifié entre les deux tentatives). Ce choix
suit strictement la formulation littérale de la nouvelle règle d'arrêt plutôt que la logique
d'indépendance vis-à-vis de Docker.

Aucune URL distante n'a été utilisée à aucun moment. Aucun fichier n'a été modifié par cette tentative,
hormis ce rapport.

### Tableau — cette tentative uniquement

| Bloc | Commande | Exécuté | Réussi | Échoué | Ignoré | Durée | Environnement | Message d'erreur | Bloquant |
|---|---|---:|---:|---:|---:|---:|---|---|---:|
| Branche/statut git | `git branch --show-current` / `git status --short` | Oui | Oui | 0 | — | <1s | Local | — | Non |
| Docker | `docker ps` | Oui | **Non** | 1 | — | <1s | Local | `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... The system cannot find the file specified.` | **Oui** |
| Supabase CLI | `supabase --version` | Oui | Oui (2.105.0) | 0 | — | <1s | Local | — | Non |
| Node | `node --version` | Oui | Oui (v22.16.0) | 0 | — | <1s | Local | — | Non |
| npm | `npm --version` | Oui | Oui (9.6.2) | 0 | — | <1s | Local | — | Non |
| Preflight (négatifs/positif) | `npm run test:security:preflight` et variantes | **Non relancé** | — | — | — | — | — | Arrêt immédiat après échec Docker (règle explicite de cette tentative) — déjà validé section 2 | Non (déjà couvert) |
| Supabase start | `supabase start` | Non | — | — | — | — | Indisponible (Docker) | Bloqué par l'échec de `docker ps` | Oui |
| db reset | `supabase db reset` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Migrations Correction 2 à 5 | (via `db reset`) | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Vitest | `npm run test:unit` | **Non relancé** | — | — | — | — | — | Arrêt immédiat — déjà validé section 5 (42/42) | Non (déjà couvert) |
| SQL | `npm run test:security:sql` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Playwright multi-tenant | `npm run test:security:playwright` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Storage | `npm run test:security:storage` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Edge Functions | `npm run test:security:edge-functions` | Non | — | — | — | — | Indisponible (Docker + `supabase functions serve`) | Bloqué en amont | Oui |
| Concurrence | `npm run test:security:concurrency` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Sécurité globale | `npm run test:security` | Non | — | — | — | — | Indisponible (Docker) | Bloqué en amont | Oui |
| Typecheck | `npm run typecheck` | **Non relancé** | — | — | — | — | — | Arrêt immédiat — déjà validé section 12 (1 erreur préexistante, `DevisFormPage.tsx:191`, inchangée) | Non (déjà couvert) |
| Build | `npm run build` | **Non relancé** | — | — | — | — | — | Arrêt immédiat — déjà validé section 12 (succès) | Non (déjà couvert) |
| Nettoyage | `supabase stop --no-backup` / `git status --short` | Oui (partiel) | Oui | 0 | — | <1s | Local | Rien à arrêter — aucune stack n'a démarré ; `git status --short` inchangé | Non |

## 18. Décision de fin (tentative du 2026-07-22)

### NON VALIDÉ — ENVIRONNEMENT INDISPONIBLE

`docker ps` échoue toujours dans cet environnement (même cause exacte que la tentative précédente :
daemon Docker Desktop injoignable via le pipe nommé local, aucun contact réseau). Conformément à la
règle explicite de cette tentative, la validation s'est arrêtée immédiatement après cet échec — aucune
migration, aucun test SQL, aucun test d'isolation multi-tenant, aucun test Storage, aucun test Edge
Functions, aucun test de concurrence, et cette fois-ci **aucun** test unitaire/typecheck/build n'a été
(re-)exécuté, bien que leurs résultats antérieurs (tentative précédente, sections 5 et 12) restent
valides puisqu'aucun fichier de code n'a changé entre-temps.

L'application **n'est pas déclarée prête à être commercialisée ou déployée** sur la base de cette
tentative. Aucune correction métier n'a été apportée. Aucun commit, aucun push, aucun déploiement.
`git status --short` est inchangé par rapport à l'état initial, hormis la mise à jour de ce rapport.

## 19. Troisième tentative — Docker fonctionnel (2026-07-22)

`docker ps` confirmé fonctionnel avant cette tentative :

```
$ git branch --show-current
capacitor-android

$ git status --short
(identique aux tentatives précédentes)

$ docker ps
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
(liste vide, exit 0)

$ supabase --version
2.105.0

$ node --version
v22.16.0

$ npm --version
9.6.2
```

### Garde anti-production (re-vérifiée, Docker désormais fonctionnel)

| Scénario | Code sortie | Résultat |
|---|---:|---|
| Configuration absente | 1 | 4 variables manquantes listées, aucune clé affichée |
| URL distante fictive (`https://fictitious-remote-project.supabase.co`) | 1 | `REFUS : les tests de sécurité ne peuvent jamais être exécutés contre la production.` |
| Uniquement `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (sans aucune variable `SUPABASE_TEST_*`) | 1 | Mêmes 4 variables `SUPABASE_TEST_*` toujours rapportées manquantes — aucun repli sur `VITE_*` |

Les trois scénarios négatifs se comportent à l'identique des tentatives précédentes.

### Démarrage Supabase local — ÉCHEC CRITIQUE (premier échec réel de cette phase)

```
$ supabase stop --no-backup
Stopping containers...
Stopped supabase local development setup.
(exit 0)

$ supabase start
...
Starting database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 20260605000000_push_subscriptions.sql...
Stopping containers...
ERROR: relation "profiles" does not exist (SQLSTATE 42P01)
At statement: 0
-- Migration: push_subscriptions table + trigger pour Web Push
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ...
)
Try rerunning the command with --debug to troubleshoot the error.
(exit 1)
```

**Diagnostic précis** : `20260605000000_push_subscriptions.sql` est le **premier fichier de migration
du dépôt par ordre chronologique** (`ls supabase/migrations | sort | head -1`). Il référence
`profiles(id)` en clé étrangère, alors que la table `public.profiles` n'est créée que par une migration
bien plus tardive (`supabase/migrations/20260610000001_create_organisations.sql` et suivantes créent le
schéma organisations/profiles). Sur une base strictement vide (`supabase start` sur un volume Docker
neuf, aucun conteneur préexistant — confirmé par `docker ps -a` vide et `supabase status` répondant
`No such container: supabase_db_kaytek-final` juste avant cette tentative), la relecture linéaire de
toutes les migrations échoue dès la toute première d'entre elles.

**Classification** : dépendance manquante (ordre des migrations) — le schéma de base
(`organisations`, `profiles`, etc.) a manifestement été créé à l'origine directement sur le projet
Supabase distant (dashboard/SQL éditeur), hors du système de migrations versionnées, avant que le
suivi par fichiers de migration ne commence. Ce n'est pas une régression introduite par les
Corrections 1 à 6 : aucun des fichiers créés ou modifiés par ces corrections n'est en cause — le
premier fichier de migration du dépôt entier (daté du 5 juin 2026, plusieurs semaines avant la
Correction 1) est seul en cause.

**Conséquence** : `supabase start`/`supabase db reset` ne peuvent pas initialiser une base locale
strictement vide dans l'état actuel du dépôt. Ceci bloque **la totalité** de la validation dynamique
prévue (application des migrations, tests SQL des Corrections 2 à 5, isolation multi-tenant RLS,
Storage, Edge Functions, concurrence, `test:security` global) — aucune de ces suites ne peut être
réellement exécutée tant que ce gap n'est pas résolu.

**Aucune correction n'a été tentée** (pas de nouvelle migration créée pour recréer le schéma manquant,
pas de réordonnancement, pas de modification de `20260605000000_push_subscriptions.sql`) — strictement
hors mandat de cette phase, en attente d'autorisation explicite.

**État après l'échec** — vérifié, aucun nettoyage manuel nécessaire :

```
$ docker ps -a
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
(vide — le CLI Supabase a lui-même arrêté les conteneurs après l'échec de migration)

$ supabase status
failed to inspect container health: Error response from daemon: No such container: supabase_db_kaytek-final
(exit 1 — confirme qu'aucune stack ne tourne)
```

Conformément à la règle « Arrête-toi au premier échec critique », **aucune étape suivante n'a été
exécutée** dans cette tentative : ni `supabase db reset` isolément, ni `npm run test:unit`, ni
`npm run test:security:sql`, ni les tests Storage/Edge Functions/concurrence/Playwright/sécurité
globale, ni `npm run typecheck`/`npm run build` (bien que ces deux derniers soient indépendants de
Supabase, ils n'ont pas été relancés dans cette tentative précise, par cohérence avec l'arrêt immédiat
demandé — leurs résultats de la première tentative, sections 5 et 12, restent inchangés et valides
puisqu'aucun fichier de code n'a été modifié entre-temps).

### Tableau — cette tentative uniquement

| Bloc | Commande | Exécuté | Réussi | Échoué | Ignoré | Durée | Environnement | Message d'erreur | Bloquant |
|---|---|---:|---:|---:|---:|---:|---|---|---:|
| Branche/statut git | `git branch --show-current` / `git status --short` | Oui | Oui | 0 | — | <1s | Local | — | Non |
| Docker | `docker ps` | Oui | Oui (liste vide) | 0 | — | <1s | Local | — | Non |
| Supabase CLI/Node/npm | `supabase --version` / `node --version` / `npm --version` | Oui | Oui | 0 | — | <1s | Local | — | Non |
| Preflight — config absente | `node scripts/test-security-preflight.mjs` | Oui | Oui (refus attendu) | 0 | — | <1s | Local (aucun réseau) | 4 variables manquantes | Non |
| Preflight — URL distante fictive | idem avec `SUPABASE_TEST_URL` fictive | Oui | Oui (refus attendu) | 0 | — | <1s | Local (aucun réseau) | `REFUS : ... jamais ... contre la production.` | Non |
| Preflight — uniquement `VITE_*` | idem avec seulement `VITE_SUPABASE_URL` | Oui | Oui (refus attendu) | 0 | — | <1s | Local (aucun réseau) | 4 variables `SUPABASE_TEST_*` toujours manquantes | Non |
| Supabase stop (initial) | `supabase stop --no-backup` | Oui | Oui | 0 | — | ~5s | Local | — | Non |
| Supabase start | `supabase start` | Oui | **Non** | 1 | — | ~3 min (pull images + migrations) | Local (aucun réseau distant contacté — uniquement Docker Hub pour les images officielles Supabase, pas de projet Supabase distant) | `ERROR: relation "profiles" does not exist (SQLSTATE 42P01)` sur `20260605000000_push_subscriptions.sql` | **Oui** |
| Preflight positif (config locale réelle) | `npm run test:security:preflight` | Non | — | — | — | — | Bloqué en amont (pas de base locale démarrée) | — | Oui |
| db reset | `supabase db reset` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Migration Correction 2 | `20260722000001_subscription_access_enforcement.sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Migration Correction 3 | `20260723000001_fix_pir_select_admin_check.sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Migration Correction 3 bis | `20260724000001_secure_get_partner_requests_preview.sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Migration Correction 4 | `20260725000001_organisation_scoped_document_numbering.sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Migration Correction 5 | `20260726000001_unify_commission_calculation.sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Vitest | `npm run test:unit` | Non relancé | — | — | — | — | Résultat antérieur inchangé (42/42, section 5) | — | Non (déjà couvert) |
| SQL Corrections 2–5 | `npm run test:security:sql` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Playwright multi-tenant | `npm run test:security:playwright` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Storage | `npm run test:security:storage` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Edge Functions | `npm run test:security:edge-functions` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Concurrence | `npm run test:security:concurrency` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Sécurité globale | `npm run test:security` | Non | — | — | — | — | Bloqué en amont | — | Oui |
| Typecheck | `npm run typecheck` | Non relancé | — | — | — | — | Résultat antérieur inchangé (1 erreur préexistante, `DevisFormPage.tsx:191`, section 12) | — | Non (déjà couvert) |
| Build | `npm run build` | Non relancé | — | — | — | — | Résultat antérieur inchangé (succès, section 12) | — | Non (déjà couvert) |
| Nettoyage | `docker ps -a` / `supabase status` | Oui | Oui (rien à nettoyer) | 0 | — | <1s | Local | Conteneurs déjà arrêtés automatiquement par le CLI après l'échec | Non |

## 20. Décision de fin (tentative du 2026-07-22, Docker fonctionnel)

### NON VALIDÉ — SUITE INCOMPLÈTE

Docker et la Supabase CLI sont désormais pleinement opérationnels, et la garde anti-production a été
re-confirmée (3 scénarios négatifs + comportement cohérent). Mais **`supabase start` échoue lui-même**,
dès l'application de la toute première migration du dépôt (`20260605000000_push_subscriptions.sql`,
antérieure de plusieurs semaines aux Corrections 1 à 6), en raison d'une référence à `public.profiles`
avant sa création — un gap structurel préexistant dans l'historique des migrations, indépendant des
Corrections 1 à 6. Aucune base locale n'a donc pu être initialisée, et **aucune** suite dynamique
(SQL, RLS multi-tenant, Storage, Edge Functions, concurrence, `test:security` global) n'a pu être
réellement exécutée. Aucun résultat n'a été simulé ou fabriqué.

Aucune correction n'a été apportée à ce fichier de migration ni à aucun autre — strictement hors mandat
de cette phase. `git status --short` reste inchangé par rapport à l'état initial, hormis la mise à jour
de ce rapport. Aucun commit, aucun push, aucun déploiement.

Validation locale non obtenue. Au moins une suite critique est en échec, incomplète ou non exécutable. J'attends votre autorisation avant toute correction ou déploiement.
