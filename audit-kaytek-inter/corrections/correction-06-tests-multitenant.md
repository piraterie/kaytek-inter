# Correction 6 — TEST-01 : fiabilisation obligatoire des tests d'isolation multi-tenant

## 1. Constat initial (rappel)

- `tests/multi-tenant/01-isolation.spec.ts` et `02-isolation-create.spec.ts` contenaient chacun un
  `test.skip(!process.env.TEST_ADMIN_B_EMAIL, ...)` : sans cette variable, Playwright rapporte la
  suite comme **"skipped"**, jamais comme un échec — un run entièrement ignoré se termine avec le
  code de sortie `0`, indiscernable d'un succès pour un `&&` shell ou une CI.
- `.env.test.example` documentait `TEST_ADMIN_B_EMAIL`/`TEST_ADMIN_B_PASSWORD` comme **"Optionnel"**.
- Constat critique confirmé pendant cette correction : `.env.test`, `.env.local` et `.env.production`
  pointent **tous les trois vers le même projet Supabase** (même référence de projet). Aucune base de
  test/staging distincte n'existe à ce jour — un run de la suite existante, même "réussi", aurait pu
  s'exécuter contre la production. Ce fait n'est jamais reproduit en clair ci-dessous (aucune URL/clé
  réelle citée) mais conditionne tout le reste de cette correction : la garde anti-production
  (section 3) est la pièce la plus critique de ce travail.

## 2. Principe retenu

Plus aucun test critique ne peut se terminer en `skipped` silencieux :

- Les deux fichiers `tests/multi-tenant/*.spec.ts` appellent désormais `requireSecurityTestEnv()`
  **au niveau module**, avant tout `test.describe`/`test.skip`. Une configuration incomplète lève
  une exception **pendant la collecte du fichier** — Playwright rapporte une erreur de chargement,
  jamais un skip.
- Le wrapper Playwright (`scripts/run-security-playwright.mjs`) ne se fie jamais au seul code de
  sortie de Playwright : il relit le reporter JSON natif (`stats.expected/unexpected/skipped/flaky`)
  et échoue explicitement si `skipped > 0`, si `unexpected > 0`, ou si **aucun test n'a été découvert**
  (0 test total).
- Une base de test locale distincte est désormais exigée via des variables dédiées
  (`SUPABASE_TEST_*`, `TEST_ADMIN_A_*`, `TEST_ADMIN_B_*`, `TEST_INTERVENANT_A_*`) qui ne retombent
  **jamais** sur `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` ni sur une valeur de production.

## 3. Garde anti-production centrale (`scripts/test-security-preflight.mjs`)

Point d'entrée unique, réutilisé par **tous** les scripts de sécurité et par
`playwright.security.config.ts` lui-même (import direct, pas seulement via le wrapper — un lancement
`npx playwright test --config=playwright.security.config.ts` en direct, sans passer par le wrapper,
déclenche quand même le refus).

Comportement :

- Refuse toute variable de contournement (`ALLOW_PRODUCTION_TESTS`, `FORCE_SECURITY_TESTS`,
  `SKIP_PRODUCTION_GUARD`) **par sa seule présence**, vraie ou fausse — aucun mécanisme de
  contournement n'existe dans ce projet.
- Exige `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`,
  `SUPABASE_TEST_DB_URL` (+ variables additionnelles selon le script appelant).
- Vérifie que `SUPABASE_TEST_URL`/`SUPABASE_TEST_DB_URL` pointent vers `localhost`/`127.0.0.1`/`::1`
  **uniquement** — aucune liste blanche distante.
- Rejette explicitement la référence de projet de production déjà publique dans ce dépôt (visible en
  clair dans une migration existante, donc non sensible en soi) comme filet de sécurité redondant.
- Lit (sans jamais l'afficher) le hostname de `VITE_SUPABASE_URL` dans `.env.production`/`.env.local`/
  `.env.beta-test`/`.env.test` s'ils existent localement, et rejette toute correspondance.
- Ne journalise jamais de secret : uniquement des noms de variables et des hostnames.

## 4. Variables d'environnement dédiées

`.env.test.example` documente désormais (section "Correction 6 (TEST-01)") :

| Variable | Statut | Usage |
|---|---|---|
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_ROLE_KEY` / `SUPABASE_TEST_DB_URL` | Nouvelles, obligatoires | Instance Supabase locale uniquement (`supabase status`) |
| `TEST_ADMIN_A_EMAIL` / `TEST_ADMIN_A_PASSWORD` | Nouvelles, obligatoires | Admin org A dédié sécurité (`@security.example.test`) |
| `TEST_ADMIN_B_EMAIL` / `TEST_ADMIN_B_PASSWORD` | Existantes, désormais obligatoires (non renommées) | Admin org B — déjà exclusivement utilisées par la suite multi-tenant avant cette correction |
| `TEST_INTERVENANT_A_EMAIL` / `TEST_INTERVENANT_A_PASSWORD` | Nouvelles | Compte intervenant dédié sécurité |

Aucune valeur réelle n'est committée : uniquement des exemples locaux (`127.0.0.1`) et des adresses du
TLD réservé aux tests `example.test` (RFC 2606, ne résout jamais réellement).

## 5. Fichiers créés

| Fichier | Rôle |
|---|---|
| `scripts/lib/load-env.mjs` | Chargeur `.env` minimal partagé (ne journalise jamais une valeur) |
| `scripts/test-security-preflight.mjs` | Garde anti-production centrale (section 3) |
| `scripts/seed-security-fixtures.mjs` | Amorce idempotente des organisations/comptes/abonnements de test (CI) |
| `scripts/run-security-sql-tests.mjs` | Exécute un par un (jamais concaténés) les 5 fichiers `.sql` des Corrections 2 à 5, vérifie au préalable que les migrations sont réellement appliquées (objets DB réels, pas seulement présence des fichiers), s'arrête à la première erreur |
| `scripts/run-security-playwright.mjs` | Lance `playwright.security.config.ts`, relit le reporter JSON, échoue sur tout skip/échec/0-test-découvert |
| `scripts/test-security-storage.mjs` | 7 scénarios RLS Storage (upload org A, écriture/lecture cross-org refusées sur `signatures`/`chat-media`, upload refusé si abonnement bloqué, lecture ancien fichier après restauration, bucket public `logos` identifié) |
| `scripts/test-security-edge-functions.mjs` | Refus d'accès uniquement (`envoyer-email`, `inviter-intervenant`, `send-reminders`) : aucune auth, token invalide, abonnement bloqué — **jamais** un appel pouvant atteindre Brevo |
| `scripts/test-security-concurrency.mjs` | Insertions concurrentes réelles (numérotation devis/factures), transitions concurrentes vers `payee` (commission), FACT-02 caractérisé mais **non bloquant** |
| `tests/security-env.ts` | `requireSecurityTestEnv()` — lève une exception à la collecte, jamais un skip |
| `tests/security.setup.ts` | Authentification dédiée sécurité (admin A/B, intervenant A) — lève toujours une erreur si un identifiant manque, jamais de `storageState` vide + avertissement |
| `playwright.security.config.ts` | Config dédiée : `reuseExistingServer: false` toujours, port 5183 dédié, substitution en mémoire de `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, exécute la garde anti-production à l'import |
| `.github/workflows/security-tests.yml` | CI optionnelle : Supabase local (Docker), seed, `test:unit` puis `test:security` |

## 6. Fichiers modifiés

- `.env.test.example` — nouvelle section documentée (section 4).
- `tests/multi-tenant/01-isolation.spec.ts` / `02-isolation-create.spec.ts` — suppression des
  `test.skip(!process.env.TEST_ADMIN_B_EMAIL, ...)`, ajout de `requireSecurityTestEnv()` en tête de
  fichier, `storageState` pointant vers `tests/.auth/security-admin-a.json`/`security-admin-b.json`
  (écrits par `tests/security.setup.ts`, jamais par l'ancien `tests/auth.setup.ts` non bloquant). Le
  second `test.describe` de `01-isolation.spec.ts` (accès restreint intervenant, gated par
  `TEST_INTERVENANT_EMAIL`) est **volontairement laissé inchangé** — hors périmètre de TEST-01 (rôle
  UI, pas isolation cross-tenant).
- `playwright.config.ts` — le projet `multi-tenant` (qui dépendait du `setup` non bloquant) est retiré ;
  un commentaire renvoie explicitement vers `playwright.security.config.ts`. Aucun autre projet
  modifié.
- `package.json` — scripts additifs uniquement (`test:security:preflight`, `test:security:seed`,
  `test:security:sql`, `test:security:storage`, `test:security:edge-functions`,
  `test:security:concurrency`, `test:security:playwright`, `test:security`, `test:all`) ; aucun script
  existant renommé ni supprimé. Aucune nouvelle dépendance ajoutée (`@supabase/supabase-js` était déjà
  présent).
- `.gitignore` — ajout de `playwright-report-security/` (répertoire de rapport généré par la nouvelle
  config dédiée).

## 7. Ce qui a été vérifié dans cet environnement (sans Docker)

Docker n'est pas disponible dans cet environnement — aucune instance Supabase locale n'a donc pu être
démarrée. Conformément aux instructions, aucun résultat n'a été simulé ; seules les vérifications
réellement exécutables sans base locale l'ont été :

1. **`npm run typecheck`** — une seule erreur, préexistante et sans rapport avec cette correction
   (`src/pages/DevisFormPage.tsx:191`, déjà documentée avant cette correction). Aucun fichier créé/
   modifié par la Correction 6 n'introduit d'erreur TypeScript. **Non masquée** — `test:all` inclut
   toujours `typecheck` et échouera donc tant que cette erreur préexistante n'est pas corrigée
   séparément.
2. **`npm run build`** — succès (le typecheck n'est pas bloquant pour Vite).
3. **`npx vitest run`** — 42/42 tests passés, inchangé.
4. **Garde anti-production, démontrée en conditions réelles** :
   - Sans aucune variable définie → échec propre, liste précise des variables manquantes.
   - Avec `SUPABASE_TEST_URL` = référence de projet de production connue de ce dépôt → refus explicite
     ("projet Supabase de production connu... interdit sans exception").
   - Avec une URL distante fictive quelconque (`https://some-other-remote-project.supabase.co`) →
     refus explicite ("ne pointe pas vers un hôte local").
   - Avec `ALLOW_PRODUCTION_TESTS=false` (donc une valeur "fausse") en plus d'une config locale valide
     → refus explicite (la seule présence de la variable suffit).
   - Avec une configuration locale complète et valide (`127.0.0.1`) → succès, seuls des hostnames sont
     affichés (jamais une URL complète ni une clé).
5. **`playwright.security.config.ts` en conditions réelles** :
   - `npx playwright test --list --config=playwright.security.config.ts` sans variables → refus par la
     garde anti-production, à l'import du fichier de config lui-même (pas seulement via le wrapper).
   - Avec des variables locales fictives mais bien formées → **14 tests découverts sur 3 fichiers**
     (`security.setup.ts` + les 2 specs multi-tenant), aucune erreur de chargement, aucun skip.
   - `npx playwright test --list --config=playwright.config.ts` (config fonctionnelle existante) —
     212 tests sur 14 fichiers, confirme que les specs multi-tenant ne sont plus rattachées à cette
     config et ne provoquent donc aucune erreur de collecte pour la suite fonctionnelle.
6. **Scripts `.mjs` — vérification de syntaxe et de comportement d'échec propre** : chaque script
   (`run-security-sql-tests.mjs`, `test-security-storage.mjs`) a été exécuté avec une configuration
   locale syntaxiquement valide mais sans service réellement démarré : chacun échoue proprement avec un
   message explicite (`psql introuvable`, `ECONNREFUSED` intercepté par le gestionnaire d'erreur
   global) et un code de sortie non nul — aucun crash silencieux, aucun résultat fabriqué.

## 8. Ce qui reste non exécuté (nécessite Docker / Supabase local)

Faute de Docker dans cet environnement, **aucune assertion fonctionnelle réelle** n'a pu être obtenue
pour :

- `npm run test:security:sql` (les 5 fichiers de tests SQL des Corrections 2 à 5 eux-mêmes).
- `npm run test:security:playwright` (exécution réelle des 14 tests contre une app connectée à
  Supabase local).
- `npm run test:security:storage`, `test:security:edge-functions`, `test:security:concurrency`.
- Le workflow CI (`.github/workflows/security-tests.yml`) n'a pas été déclenché.

Ces commandes doivent être exécutées une première fois dans un environnement avec Docker
(`supabase start` fonctionnel) avant de considérer cette correction opérationnellement validée — pas
seulement statiquement correcte.

## 9. Limite connue — fixtures Storage/concurrence en CI

`scripts/seed-security-fixtures.mjs` crée uniquement organisations, profils, comptes auth et une ligne
`subscriptions` active par organisation (schéma bien connu, vérifié dans les tests SQL de la
Correction 2). Il ne crée **pas** de client/intervention/devis/facture de test — le schéma exact de
ces tables (colonnes `NOT NULL`) n'a pas été entièrement vérifié dans cette correction. Conséquence :
sur une base CI fraîche, les scénarios de `test-security-storage.mjs` et
`test-security-concurrency.mjs` qui dépendent d'une ligne existante (upload photo intervention,
numérotation devis/factures, création de commission) se rapportent en `WARN` (non bloquant, pas un
`FAIL`) plutôt qu'en échec — documenté explicitement dans chaque script plutôt que fabriqué. Un futur
correctif pourra étendre le seed une fois le schéma de ces tables entièrement audité.

## 10. FACT-02 (course devis→facture)

Explicitement exclu du pass/fail bloquant, conformément à l'autorisation. `test-security-concurrency.mjs`
documente ce scénario comme non caractérisé (le mécanisme exact de transformation devis→facture est un
enchaînement multi-étapes côté frontend, pas une fonction SECURITY DEFINER unique équivalente à
`next_document_number()`/`calculate_commission_for_facture()`) — reste un sujet distinct, hors
périmètre de cette correction.

## 11. Rollback

Toutes les modifications de cette correction sont additives ou réversibles sans perte de données :

1. **Revert des fichiers modifiés** (aucune migration, aucune donnée) :
   ```
   git checkout -- .env.test.example tests/multi-tenant/01-isolation.spec.ts \
     tests/multi-tenant/02-isolation-create.spec.ts playwright.config.ts \
     package.json .gitignore
   ```
2. **Suppression des fichiers créés** :
   ```
   git rm -r scripts/lib scripts/test-security-preflight.mjs scripts/seed-security-fixtures.mjs \
     scripts/run-security-sql-tests.mjs scripts/run-security-playwright.mjs \
     scripts/test-security-storage.mjs scripts/test-security-edge-functions.mjs \
     scripts/test-security-concurrency.mjs tests/security-env.ts tests/security.setup.ts \
     playwright.security.config.ts .github/workflows/security-tests.yml
   ```
3. Aucun rollback SQL n'est nécessaire — cette correction n'a créé ni modifié aucune migration, table,
   fonction, trigger ni policy RLS.
4. Effet du rollback : les deux fichiers `tests/multi-tenant/*.spec.ts` retrouvent leur
   `test.skip(!process.env.TEST_ADMIN_B_EMAIL, ...)` d'origine — **la régression TEST-01 réapparaît**
   (suite à nouveau silencieusement ignorable). Le rollback n'est donc recommandé qu'en cas de blocage
   opérationnel avéré, pas par précaution.

## 12. Périmètre explicitement non touché

Aucune migration métier, policy RLS, ni logique métier des Edge Functions n'a été créée ou modifiée par
cette correction. Les fichiers modifiés listés dans le `git status` sous `src/`, `supabase/functions/`
et `supabase/migrations/` en dehors de cette liste appartiennent aux Corrections 1 à 5 (déjà
committées/en cours avant cette correction) et n'ont pas été retouchés ici.

Correction 6 terminée. Les tests critiques ne peuvent plus être ignorés silencieusement. J'attends votre autorisation.
