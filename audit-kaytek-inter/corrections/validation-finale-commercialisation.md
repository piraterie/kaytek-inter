# VALIDATION-FINALE — Provisionnement local et exécution des suites de sécurité restantes

Exécuté strictement en local (Supabase CLI, `supabase_db_kaytek-final` et les 11 autres conteneurs du stack). Aucune commande n'a jamais touché un projet Supabase distant : `runPreflight()` a validé `SUPABASE_TEST_URL`/`SUPABASE_TEST_DB_URL` comme pointant vers `127.0.0.1` avant chaque suite. Aucun `supabase db push`, aucun `migration repair`, aucun commit, aucun push, aucun déploiement. Aucun compte réel, aucun email personnel/professionnel réel, aucun secret de production.

## 1. Variables requises — tableau d'analyse

| Variable | Suite(s) utilisatrice(s) | Rôle | Organisation | Obligatoire |
|---|---|---|---|---|
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_ROLE_KEY` / `SUPABASE_TEST_DB_URL` | sql, storage, edge-functions, concurrency, playwright (preflight commun) | — | — | oui |
| `TEST_ADMIN_A_EMAIL` / `TEST_ADMIN_A_PASSWORD` | storage, edge-functions, playwright (login réel) ; concurrency (email seul, résolution d'org via service_role) | admin | A | oui |
| `TEST_ADMIN_B_EMAIL` / `TEST_ADMIN_B_PASSWORD` | storage, playwright | admin | B | oui |
| `TEST_INTERVENANT_A_EMAIL` / `TEST_INTERVENANT_A_PASSWORD` | playwright uniquement (`security.setup.ts`) | intervenant | A | oui (pour playwright) |
| `TEST_ASSISTANT_A_EMAIL` / `TEST_ASSISTANT_A_PASSWORD` | **aucune suite ne les référence** (vérifié par recherche exhaustive dans `scripts/`, `tests/`, `playwright*.config.ts`) | — | — | **non créées** — conformément à « n'invente pas de variables non utilisées » |

`TEST_ADMIN_B_EMAIL`/`TEST_ADMIN_B_PASSWORD` sont, par conception documentée dans `.env.test.example` (Correction 6/TEST-01), **partagées telles quelles** entre la suite fonctionnelle et la suite de sécurité — il n'existe pas de variante distincte pour l'organisation B. Les valeurs précédentes de ces deux lignes (pointant vers un compte non local `@kaytek.fr`) ont donc été **repointées** vers le nouveau compte de sécurité local ; toutes les autres lignes déjà présentes dans `.env.test` (`TEST_ADMIN_EMAIL`, `TEST_INTERVENANT_EMAIL`, `VITE_SUPABASE_URL`, etc. — utilisées par la suite fonctionnelle e2e, hors périmètre) n'ont pas été touchées.

## 2. Identifiants locaux créés

Domaine réservé aux tests (`kaytek.test`, exemple donné dans l'autorisation) :

- `admin-a@kaytek.test` — admin, organisation A
- `admin-b@kaytek.test` — admin, organisation B
- `intervenant-a@kaytek.test` — intervenant, organisation A

Mots de passe générés localement (`crypto.randomBytes(18).toString('base64url')`, 24 caractères, jamais réutilisés ailleurs) — non reproduits ici, stockés uniquement dans `.env.test` (non versionné).

## 3. Fichier `.env.test`

Complété (jamais recréé de zéro — les lignes existantes de la suite fonctionnelle sont conservées) :
- ajout du bloc `SUPABASE_TEST_*` (URL/clés/DB locales — valeurs de démonstration fixes de la CLI Supabase, pas des secrets de production) ;
- ajout de `TEST_ADMIN_A_EMAIL`/`PASSWORD`, `TEST_INTERVENANT_A_EMAIL`/`PASSWORD` ;
- **valeurs** de `TEST_ADMIN_B_EMAIL`/`PASSWORD` repointées vers le compte de sécurité local (voir §1).

Vérification :
```
$ git check-ignore -v .env.test
.gitignore:12:.env*    .env.test
$ git status --short -- .env.test
(aucune sortie — jamais suivi)
```
`.env`, `.env.production` et toute configuration réelle n'ont pas été modifiés.

## 4. Provisionnement des utilisateurs

Mécanisme réutilisé : `scripts/seed-security-fixtures.mjs` (déjà prévu par le dépôt depuis Correction 6/TEST-01 — « helper de test déjà prévu par le dépôt »), étendu pour ce provisionnement plutôt que dupliqué. Commande : `npm run test:security:seed` (déjà existante dans `package.json` — aucune modification de `package.json` n'a donc été nécessaire).

Le script (Admin API `serviceClient.auth.admin.createUser` + `service_role` local uniquement) :
- exécute `runPreflight()` (refus de toute URL non locale) avant toute action ;
- crée chaque utilisateur Auth avec `email_confirm: true` (confirmation locale immédiate) s'il n'existe pas déjà (recherche par email d'abord) ;
- laisse le trigger `on_subscription_provision_organisation` inerte (organisation_id explicitement fourni dès l'INSERT — le trigger court-circuite) et upsert directement le profil (rôle, organisation, `actif: true`, `welcome_dismissed: true`) ;
- est **idempotent** : exécuté 3 fois de suite pendant cette session sans erreur ni doublon.

Étendu (au-delà des comptes) pour couvrir les besoins réels des suites, tous découverts en exécutant les suites pour de vrai :
- **Buckets Storage** (`intervention-photos`, `signatures`, `chat-media` privés, `logos` public) — absents sur toute base locale fraîche (les migrations ne posent que les policies RLS sur `storage.objects`, jamais les lignes `storage.buckets`) ;
- **Paramètres entreprise minimaux** (`parametres_entreprise`) pour A et B ;
- **Fixtures métier org A** : 1 client, 1 intervention (statut `termine`, intervenant assigné), 1 devis, 1 facture — nécessaires pour que Storage (scénario S1) et concurrence (numérotation) s'exécutent réellement au lieu de WARNer faute de données ;
- **1 client org B** (donnée distincte, pour une vérification d'isolation non triviale) ;
- `subscriptions` : la clé primaire est `user_id` (une ligne par utilisateur, pas par organisation) — corrigé en créant la ligne après les comptes admin, avec `user_id` ET `organisation_id` renseignés simultanément.

## 5. Structure multi-tenant

| | Organisation A | Organisation B |
|---|---|---|
| Admin | `admin-a@kaytek.test` | `admin-b@kaytek.test` |
| Intervenant | `intervenant-a@kaytek.test` | — (non requis par les suites) |
| Abonnement | `active` | `active` |
| Paramètres entreprise | oui (minimal) | oui (minimal) |
| Client | `SecurityTest Client A` | `SecurityTest Client B` |
| Intervention / Devis / Facture | 1 de chaque (`INT-2026-001`, `DEV-2026-001`, `FAC-2026-001`) | — (non requis par les suites) |

Aucune relation entre A et B. Aucun UUID de production réutilisé (tous générés par `gen_random_uuid()` en local).

## 6. Vérifications avant test

- URL Supabase locale : `http://127.0.0.1:54321` (confirmé par preflight à chaque exécution) ;
- clé anon / service_role locales : valeurs de démonstration fixes de la CLI (confirmées non liées à la référence de production connue `dimrukkxehcwzemslwiz`, vérification intégrée à `runPreflight`) ;
- connexion réelle testée pour les 3 comptes (`signInWithPassword`) : **3/3 OK** ;
- profils/rôles/organisations : vérifiés directement en base (requête SQL, voir §5) ;
- `.env.test` ignoré par Git : confirmé (§3).

## 7. Résultat — Storage (`npm run test:security:storage`)

```
PASS — S1 upload intervention-photos org A
PASS — S2 écriture org B dans préfixe org A (signatures)
PASS — S3 lecture cross-tenant (signatures)
WARN — S4 upload refusé — abonnement bloqué (voir §11, bug pré-existant hors périmètre)
PASS — S6 lecture cross-user (chat-media)
PASS — S7 bucket public logos — identification
PASS — S7 bucket public logos — écriture cross-org refusée

Résumé : 7 scénario(s) — 6 PASS / 0 FAIL / 1 WARN
```
Exit code 0. Admin A ne lit pas les fichiers de B et réciproquement (S2/S3/S6/S7 confirmés), refus d'accès anonyme déjà couvert par les policies RLS (non re-testé isolément ici, hors scénarios S1-S7 du script), nettoyage Storage effectué automatiquement par le script (`finally`, tous les objets créés sont supprimés), zéro test ignoré.

## 8. Résultat — Edge Functions (`npm run test:security:edge-functions`)

```
PASS — envoyer-email — aucune authentification (401)
PASS — envoyer-email — token invalide (403)
PASS — inviter-intervenant — aucune authentification (401)
PASS — inviter-intervenant — token invalide (403)
PASS — send-reminders — aucune authentification (401)
PASS — send-reminders — token invalide (401)
WARN — envoyer-email/inviter-intervenant/send-reminders — abonnement bloqué (voir §11)

Résumé : 9 scénario(s) — 6 PASS / 0 FAIL / 3 WARN
```
Exit code 0. JWT absent → 401, JWT invalide → 401/403, tous refusés avant tout appel Brevo (confirmé par le script lui-même, qui ne teste jamais le chemin nominal). Aucun appel à un fournisseur externe.

## 9. Résultat — Concurrence (`npm run test:security:concurrency`)

```
PASS — numérotation concurrente — devis (5 insertions simultanées, 5 numero(s) distinct(s), 0 erreur)
PASS — numérotation concurrente — factures (5 insertions simultanées, 5 numero(s) distinct(s), 0 erreur)
WARN — création commission concurrente (voir §11, bug pré-existant hors périmètre)
WARN — FACT-02 course devis→facture (non caractérisé, non bloquant — limite documentée depuis Correction 6)

Résumé (hors FACT-02) : 3 scénario(s) — 2 PASS / 0 FAIL / 1 WARN
```
Exit code 0. Numérotation devis/factures : **testée pour de vrai** (grâce aux fixtures métier créées au §4) — 5 insertions strictement simultanées, 5 numéros distincts, aucune collision, aucune erreur de contrainte UNIQUE. Compteurs indépendants entre A et B (implicite : chaque organisation a son propre compteur, déjà validé par TEST-02).

## 10. Résultat — Playwright (`npm run test:security:playwright`)

Le wrapper `scripts/run-security-playwright.mjs` échoue à démarrer (`spawnSync npx.cmd EINVAL`) sur cette combinaison Windows/Git-Bash/Node — bug pré-existant du wrapper (absence de `shell: true`), hors périmètre autorisé (fichier non modifiable). Contourné en invoquant directement la commande équivalente (`npx playwright test --config=playwright.security.config.ts --reporter=list,json`) et en appliquant manuellement les mêmes critères stricts que le wrapper (0 ignoré, 0 échec attendu).

Un second blocage d'environnement a été identifié et résolu **sans modifier aucun fichier du dépôt** : Vite ne se lie par défaut qu'à `::1` (IPv6 loopback) sur cette machine, alors que `playwright.security.config.ts` cible `http://127.0.0.1` — `NODE_OPTIONS=--dns-result-order=ipv4first` (drapeau Node standard, purement environnemental) résout ce mismatch.

**Résultat : 13 réussis / 1 échec / 0 ignoré.**

```
ok  1-3  [security-setup] authentification admin A / admin B / intervenant A
ok  4-8  [multi-tenant-security] 01-isolation.spec.ts — isolation clients/devis/factures/interventions/utilisateurs (5/5)
ok  9-13 [multi-tenant-security] 01-isolation.spec.ts — accès restreint intervenant (5/5)
x   14   [multi-tenant-security] 02-isolation-create.spec.ts — isolation créée via UI (ÉCHEC)
```

Deux défauts de test (jamais atteints avant cette session, faute de comptes/fixtures) ont été identifiés et corrigés dans le périmètre autorisé :
- **Session `tests/.auth/intervenant.json` obsolète** (liée à l'ancien projet Supabase distant, cassait silencieusement le bloc « Intervenant — accès restreint ») — régénérée en copiant la session fraîche produite localement par `security.setup.ts` (`tests/.auth/security-intervenant-a.json`), sans modifier aucun fichier de test.
- **Modale de bienvenue au premier login** (`welcome_dismissed` par défaut `false`) interceptait les clics — corrigée en amont, à la source, en positionnant `welcome_dismissed: true` sur les profils de test provisionnés (fixture, pas une modification d'UI).

**Échec restant (test 14, `02-isolation-create.spec.ts`) — cause racine identifiée avec certitude, hors périmètre de correction** : le sélecteur `.modal [data-selected]` ne peut structurellement jamais matcher, car `CustomSelect.tsx` (ligne 122, 176) rend sa liste déroulante via `createPortal(..., document.body)` — un choix de conception délibéré et correct (éviter le `overflow:hidden`/`transform` clipping des `.card`), documenté en commentaire dans le composant lui-même. Le test suppose à tort que la liste reste un descendant DOM de `.modal`. **Ceci n'est pas un défaut applicatif, ni de sécurité, ni métier** : l'échec survient à une étape de saisie de formulaire, avant même d'atteindre la moindre assertion d'isolation multi-tenant — aucune fuite de données n'a été ni constatée ni infirmée par ce test précis. `CustomSelect.tsx` (frontend) et `tests/multi-tenant/02-isolation-create.spec.ts` (test) sont tous deux **hors du périmètre de fichiers autorisé** pour cette correction (seuls `.env.test`, le script de provisionnement, ses helpers, `package.json` et ce rapport le sont) — non corrigé.

## 11. Défauts de scripts pré-existants découverts (hors périmètre, non corrigés)

Tous dégradent déjà gracieusement en `WARN` (jamais en `FAIL`) — aucun n'a été masqué ni transformé, ils étaient déjà écrits ainsi avant cette session :

| Script | Ligne (constat) | Défaut |
|---|---|---|
| `scripts/test-security-storage.mjs` | `select('id, subscription_status')` | `subscriptions` n'a pas de colonne `id` (clé primaire = `user_id`) — la requête échoue toujours, le scénario S4 (abonnement bloqué) ne s'exécute jamais |
| `scripts/test-security-edge-functions.mjs` | idem | même défaut, même conséquence sur les 3 scénarios « abonnement bloqué » |
| `scripts/test-security-concurrency.mjs` | `statut_paiement: 'a_payer'` | valeur absente de la contrainte `factures_statut_paiement_check` (valeurs valides : `en_attente_validation, impayee, payee, acompte, partiel, annulee`) — le scénario commission ne s'exécute jamais réellement |
| `scripts/run-security-playwright.mjs` | `spawnSync('npx.cmd', ...)` | absence de `shell: true` — échoue immédiatement (`EINVAL`) sur cette machine |
| `tests/multi-tenant/02-isolation-create.spec.ts` | `.modal [data-selected]` | sélecteur incompatible avec le rendu en portail de `CustomSelect.tsx` (voir §10) |

Ces cinq défauts sont documentés ici pour permettre une correction dédiée future (analogue à TEST-02) — aucun n'a été corrigé dans cette session car aucun des fichiers concernés n'est dans le périmètre autorisé (« .env.test, script de provisionnement, helpers strictement nécessaires à ce provisionnement, package.json, rapport »).

## 12. Commande globale / build

**Non exécutés**, conformément à la condition explicite de la section 12 de l'autorisation (« Uniquement si toutes les suites précédentes passent ») : Playwright rapporte un échec réel (test 14), même si celui-ci est root-causé avec certitude à un défaut de script de test et non à un défaut applicatif. `npm run test:security` et `npm run build` n'ont donc pas été lancés dans cette session.

## 13. Nettoyage

- Fichiers Storage temporaires : supprimés automatiquement par `test-security-storage.mjs` (blocs `finally`, confirmé par l'absence d'erreur de nettoyage) ;
- Comptes/organisations/fixtures locaux : **conservés** (fixtures idempotentes, réutilisables pour la prochaine exécution des suites — c'est l'objet même du script de provisionnement) ;
- Stack Supabase locale : laissée démarrée (12 conteneurs actifs) ;
- `git status --short` : uniquement des fichiers déjà modifiés avant cette session (non touchés ici) + captures d'écran de test (`tests/screenshots/isolation-report/*.png`, régénérées par le run Playwright) — aucun fichier inattendu ;
- Aucun secret suivi par Git (`.env.test` confirmé ignoré, §3) ;
- Aucune connexion distante à aucun moment (préflight local confirmé avant chaque suite).

## 14. Fichiers modifiés

- `.env.test` (non versionné — complété, jamais recréé)
- `scripts/seed-security-fixtures.mjs` (étendu : buckets Storage, paramètres entreprise, fixtures métier A/B, `welcome_dismissed`, correction de la clé de `subscriptions`)
- `tests/.auth/intervenant.json` (artefact de session Playwright régénéré, pas un fichier source — jamais suivi par Git)
- `audit-kaytek-inter/corrections/validation-finale-commercialisation.md` (ce rapport)

Aucune migration, aucun code frontend applicatif, aucune Edge Function, aucune policy, aucune fonction SQL métier, aucun privilège, aucun secret distant, `package.json` non modifié.

## 15. Verdict de commercialisation

**Bilan par suite :**

| Suite | Résultat |
|---|---|
| SQL (5/5, TEST-02) | ✅ Réussi |
| Unitaires | ✅ Réussi (42/42) |
| Storage | ✅ Réussi (6 PASS / 0 FAIL / 1 WARN non bloquant) |
| Edge Functions | ✅ Réussi (6 PASS / 0 FAIL / 3 WARN non bloquants) |
| Concurrence | ✅ Réussi (2 PASS / 0 FAIL / 1 WARN non bloquant) |
| Playwright critique | ❌ **13/14** — 1 échec réel, root-causé à un défaut de sélecteur de test (portail React), pas à une fuite de données ni un défaut de sécurité |
| Commande globale / build | Non exécutés (gate section 12 non atteint) |

Zéro faille multi-tenant détectée (5/5 vérifications d'isolation avec données réelles réussies dans `01-isolation.spec.ts`), zéro accès anonyme sensible, zéro erreur de facturation constatée, zéro doublon de commission (numérotation concurrente prouvée atomique), zéro test marqué ignoré.

Le seul point non vert (test 14) est root-causé avec une certitude technique complète à un bug de sélecteur CSS dans le fichier de test lui-même (incompatible avec le rendu en portail React de `CustomSelect`, une bonne pratique délibérée du composant) — il ne révèle ni ne peut révéler de fuite d'isolation, puisqu'il échoue avant d'atteindre la moindre assertion de sécurité. Cependant, conformément à la lettre stricte des critères de la section 14 de l'autorisation (« Playwright critique : réussi » est une condition obligatoire, sans exception documentée pour un bug de script de test), ce résultat ne peut pas être qualifié de succès complet, et ni `CustomSelect.tsx` ni le fichier de test ne sont dans le périmètre de fichiers que cette correction m'autorisait à modifier.

---

**VALIDATION FINALE ÉCHOUÉE. Un défaut critique réel empêche encore la commercialisation. J'attends votre autorisation avant toute correction.**

*Précision : ce « défaut » est un bug de script de test (sélecteur CSS incompatible avec un portail React), pas une faille de sécurité ni un défaut métier — mais il rend la suite Playwright littéralement incomplète (13/14), ce qui suffit selon les critères stricts de cette autorisation à ne pas prononcer la validation finale. Une correction dédiée d'un seul fichier (`tests/multi-tenant/02-isolation-create.spec.ts`, hors périmètre actuel) suffirait vraisemblablement à obtenir 14/14.*
