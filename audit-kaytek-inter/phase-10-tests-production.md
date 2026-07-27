# Phase 10 — Tests et préparation à la production

Date de l'analyse : 2026-07-21
Méthode : inventaire et lecture complète des fichiers de test (`tests/e2e`, `tests/multi-tenant`, `tests/responsive`, `tests/beta`, `android/app/src/test`, `android/app/src/androidTest`), lecture de `playwright.config.ts` et des fichiers d'environnement de test. Recensement des scripts de build (`package.json`) et relecture des résultats déjà établis en phase 9 (`typecheck`, `build`, `npm audit`) sans les ré-exécuter inutilement.

**Décision méthodologique importante — aucun test Playwright n'a été exécuté dans cette phase**, pour les raisons suivantes, vérifiées avant toute décision :
1. `.env.test` existe réellement (pas seulement l'exemple) et contient un `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` **réels**, pointant vers un projet Supabase existant (probablement le même projet que celui identifié dans les phases précédentes — aucune preuve d'un projet Supabase isolé dédié aux tests n'a été trouvée).
2. `playwright.config.ts` démarre un vrai serveur (`webServer.command: 'npm run dev'`) et exécute les tests contre ce serveur — un test de connexion "en apparence read-only" déclenche déjà des écritures réelles côté application (enregistrement d'appareil via `registerDevice()`, entrées `journal`, etc., cf. phases 2 et 5).
3. Un des fichiers de test (`tests/multi-tenant/02-isolation-create.spec.ts`) **avertit explicitement dans son propre commentaire** : *"⚠️ Ce test écrit de vraies données dans Supabase (comptes de test dédiés). Les données créées restent en base — archiver manuellement si besoin."* — donc destructif/persistant par nature, explicitement exclu par la consigne de cette phase.
4. Sans confirmation certaine qu'il s'agit d'un environnement isolé dédié aux tests (et non de la même base que celle documentée comme partagée dans les phases précédentes), le risque de créer, modifier ou polluer des données réelles est jugé trop élevé pour être pris unilatéralement.

Cette phase est donc entièrement fondée sur l'**analyse statique** des fichiers de test existants (ce qu'ils vérifient, comment, avec quelles conditions d'exécution), pas sur leur exécution.

---

## 1. Recensement des tests

### Tests unitaires

- **Aucun** — aucun framework de test unitaire (`vitest`, `jest`, ou équivalent) n'est configuré dans `package.json`, aucun fichier `*.test.ts`/`*.spec.ts` en dehors du dossier `tests/` (Playwright) n'a été trouvé dans `src/`. La logique métier (calculs de devis/factures/commissions, notamment le bug **FONC-01** identifié phase 6) n'est donc **jamais testée isolément** — elle ne peut être vérifiée qu'en bout en bout via un test Playwright complet instanciant toute l'application.

### Tests d'intégration

- **Aucun** au sens strict (test ciblant une fonction/API isolée avec une base de test contrôlée) — toute vérification passe par Playwright, qui teste l'application dans son ensemble via le navigateur.

### Playwright — inventaire complet (15 fichiers)

| Fichier | Nature | Écrit des données réelles ? |
|---|---|---|
| `tests/auth.setup.ts` | Setup — authentifie les comptes de test et sauvegarde `storageState` (`tests/.auth/*.json`) | Connexion réelle (device registration, cf. ci-dessus) |
| `tests/e2e/01-auth.spec.ts` | Connexion, déconnexion, routes protégées, message d'erreur credentials invalides | Connexions réelles |
| `tests/e2e/02-clients.spec.ts` | Création client, recherche, fiche client | **Oui** — crée un client réel |
| `tests/e2e/03-devis.spec.ts` / `03-workflow-complet.spec.ts` | Création devis, workflow complet (client→intervention→devis→facture) | **Oui** |
| `tests/e2e/04-signature.spec.ts` | Signature sur canvas | **Oui** (modifie un devis) |
| `tests/e2e/05-factures.spec.ts` | Liste factures, filtres, bouton PDF | Probablement lecture seule (non confirmé sans exécution) |
| `tests/e2e/06-interventions.spec.ts` | Création intervention | **Oui** |
| `tests/e2e/07-messaging.spec.ts` | Envoi de message texte, conversations | **Oui** — crée un message réel |
| `tests/e2e/08-notifications.spec.ts` | Badge non-lus, cloche de notification | Lecture probable |
| `tests/e2e/10-prestation-carte-cliquable.spec.ts` | Régressions UI catalogue (clic carte/bouton, anti-double-ajout, recalcul TVA) | Lecture/UI locale |
| `tests/e2e/guide-verification.spec.ts` | Centre d'aide (guide admin/intervenant, FAQ, progression, popup bienvenue) | Écrit `guide_progress`/`welcome_dismissed` |
| `tests/multi-tenant/01-isolation.spec.ts` | Isolation cross-org (clients/devis/factures/interventions/utilisateurs) + restriction de rôle intervenant | Lecture seule — **mais `test.skip` si `TEST_ADMIN_B_EMAIL` absent** (voir TEST-01) |
| `tests/multi-tenant/02-isolation-create.spec.ts` | Création réelle dans l'org A (client→intervention→devis→facture) puis vérification de non-visibilité côté org B | **Oui, explicitement non nettoyé** (avertissement dans le fichier lui-même) |
| `tests/responsive/01-viewports.spec.ts` | Rendu à 360/390/430/768/1280px, absence de scroll horizontal | Lecture/UI |
| `tests/beta/01-beta-accounts.spec.ts` | 5 comptes bêta réels (`.env.beta-test`), 4 phases (connexion, fonctionnalités, isolation, nettoyage) | **Oui**, avec une phase de nettoyage dédiée |

### Tests RLS

- **Aucun test n'appelle directement l'API Supabase avec des JWT différents pour vérifier une policy RLS précise** (ex. tenter un `SELECT`/`INSERT`/`UPDATE`/`DELETE` cross-org via `@supabase/supabase-js` ou une requête REST brute, en dehors du navigateur). L'isolation multi-tenant est vérifiée **exclusivement à travers le rendu de l'interface** (`tests/multi-tenant/*.spec.ts`) — un test qui passe confirme que l'UI ne montre pas les données d'une autre organisation, mais ne teste pas la policy RLS elle-même de façon isolée ni les scénarios d'appel direct (API/RPC) qui constituent le vecteur de risque le plus documenté dans les phases 2 à 4 de cet audit (accès via un JWT valide en dehors du code React officiel).
- Aucun test ne couvre la régression **RLS-01** (phase 3, `partner_intervention_requests`), ni le réseau partenaires en général (aucun fichier `tests/*partner*` trouvé).
- Aucun test ne couvre l'isolation Storage (photos, signatures) au niveau RLS.

### Tests Edge Functions

- **Aucun** — aucun test (Playwright ou autre) n'invoque directement une Edge Function (`envoyer-email`, `inviter-intervenant`, `send-push`, `send-reminders`, `send-telegram`, `supprimer-utilisateur`, `get-public-document`) pour vérifier son comportement (authentification, isolation organisation, gestion d'erreur) indépendamment de l'UI qui l'appelle.

### Tests Stripe

- **Aucun**, cohérent avec l'absence de code Stripe dans ce dépôt (phase 7) — rien à tester ici.

### Tests PWA

- **Aucun** test ciblant spécifiquement le service worker, le mode hors ligne, la mise à jour de version (`buildGuard.ts`) ou l'installabilité — la file d'attente hors ligne non câblée (**PWA-01**, phase 8) aurait précisément pu être détectée par un test dédié simulant une coupure réseau.

### Tests Android

- **Aucun test réel** — `android/app/src/test/.../ExampleUnitTest.java` (`assertEquals(4, 2+2)`) et `android/app/src/androidTest/.../ExampleInstrumentedTest.java` (vérifie le nom de package `com.getcapacitor.app`, qui ne correspond même plus à l'`applicationId` réel `com.kaytekinter.app` — cf. `build.gradle`, cet exemple boilerplate n'a jamais été mis à jour) sont le **modèle par défaut généré par Capacitor**, jamais adaptés au projet. Aucun test ne couvre la biométrie, le verrouillage, le cycle de vie arrière-plan/reprise de session, ni les permissions natives (dont l'absence de `RECORD_AUDIO`, **Android-01** phase 8).

### Tests de sécurité

- Partiellement couverts, de façon incidentale, par les tests fonctionnels existants :
  - `credentials invalides → message d'erreur` (`01-auth.spec.ts`) — vérifie un message générique, pas de fuite d'information sur l'existence d'un compte.
  - Redirections de routes protégées (`dashboard → redirige vers /login`, `/devis → redirige vers /login`, etc.) — vérifie le comportement du `Guard` frontend (cf. phase 2), pas la protection RLS sous-jacente.
  - Restrictions de rôle intervenant (`intervenant ne voit pas /clients`, etc., dans `01-isolation.spec.ts`) — même limite : vérifie la redirection UI, pas l'impossibilité d'accéder aux données via un appel direct.
  - "3. Sécurité — intervenant bloqué sur /guide/admin/videos" (`guide-verification.spec.ts`) — même famille.
- **Aucun test ne cible spécifiquement** : les scénarios de contournement identifiés dans les phases 2 à 4 (JWT d'une autre organisation appelé directement, compte désactivé gardant une session, abonnement expiré contournant l'écran de blocage, limite d'appareils, exposition de secrets dans les logs, injection/validation d'entrée sur les Edge Functions).

---

## 2. Dispositif de test — constats critiques

### TEST-01 — La suite de tests la plus critique de sécurité (isolation multi-tenant) est ignorée par défaut

- **Gravité** : Élevée
- **Confiance** : Confirmé
- **Fichiers** : `tests/multi-tenant/01-isolation.spec.ts:30`, `02-isolation-create.spec.ts:32`, `.env.test.example`
- **Description** : les deux fichiers de test d'isolation multi-tenant commencent par `test.skip(!process.env.TEST_ADMIN_B_EMAIL, '...')`. Or `.env.test.example` — le modèle que tout contributeur est censé copier pour créer son `.env.test` — présente `TEST_ADMIN_B_EMAIL` **commenté et explicitement qualifié d'"Optionnel"**. En suivant strictement la documentation fournie, un contributeur (ou une CI) qui configure l'environnement de test **n'active jamais** la suite d'isolation multi-tenant — les deux fichiers sont silencieusement ignorés (`skip`, pas `fail`), sans qu'aucune alerte ne remonte au-delà d'une ligne "skipped" dans le rapport Playwright, facilement invisible dans un résumé de CI qui ne regarde que le nombre d'échecs.
- **Impact** : le test le plus important de tout le projet du point de vue de la promesse commerciale (isolation entre entreprises clientes) peut être absent de toute exécution de CI sans que personne ne s'en aperçoive.
- **Recommandation** : provisionner un compte "Organisation B" dédié et permanent pour les tests, documenté comme **requis** (pas optionnel) dans `.env.test.example` et vérifié en CI par un contrôle explicite (échec bruyant, pas `skip` silencieux, si la variable est absente en environnement CI).
- **Statut** : Vérifié par lecture directe du code des deux fichiers et de la documentation d'exemple.

### TEST-02 — Les tests d'isolation multi-tenant vérifient l'UI, jamais l'API/RLS directement

- **Gravité** : Moyenne
- **Confiance** : Confirmé
- **Description** : détaillé ci-dessus (§ "Tests RLS"). Ces tests sont réels et utiles (ils exercent la RLS en conditions réelles à travers des requêtes Supabase authentiques déclenchées par l'UI), mais leur méthode (recherche de texte dans le DOM rendu) ne peut pas détecter un scénario où l'UI masquerait correctement une donnée tout en laissant un appel API direct la récupérer — exactement le type de risque documenté à plusieurs reprises dans les phases 2 à 4 (contrôle de rôle "frontend only", RLS-01 en phase 3).
- **Recommandation** : compléter par des tests d'API directs (ex. script utilisant `@supabase/supabase-js` avec les JWT de test pour tenter des `SELECT`/`INSERT`/`UPDATE` cross-organisation sur chaque table sensible), plus rapides à exécuter et plus précis qu'une navigation UI complète.

### TEST-03 — Test de création multi-tenant destructif et non nettoyé automatiquement

- **Gravité** : Faible-Moyenne (hygiène de l'environnement de test, pas un risque de sécurité applicative)
- **Confiance** : Confirmé (avertissement explicite dans le fichier)
- **Description** : `02-isolation-create.spec.ts` crée un client, une intervention, un devis et une facture réels à chaque exécution, sans étape de nettoyage automatique (contrairement à `tests/beta/01-beta-accounts.spec.ts` qui a une "Phase 4 : Nettoyage" dédiée). Des exécutions répétées de ce test accumulent des données `TEST-ISO` dans l'environnement cible.
- **Recommandation** : ajouter une étape de nettoyage (suppression ou archivage automatique des entités créées, identifiables par leur préfixe `TEST-ISO`) en fin de test, à l'image du pattern déjà utilisé dans la suite bêta.

---

## 3. Build

### Typecheck

- **Résultat (déjà établi phase 9, confirmé stable)** : `npm run typecheck` (`tsc --noEmit`) échoue avec une erreur réelle : `src/pages/DevisFormPage.tsx(170,42): error TS2339: Property 'adresse_intervention' does not exist...`. Ce script n'est appelé par aucun autre script npm (`build`, `dev`) — rien n'empêche donc un déploiement même si le typecheck échoue, en l'absence d'étape de CI qui l'exécuterait explicitement (non trouvée dans ce dépôt, cf. absence de dossier `.github/workflows` ou équivalent).

### Lint

- **Absent** — aucun script `lint` dans `package.json`, aucune configuration ESLint trouvée (confirmé phase 9, **QUAL-01**).

### Build frontend et PWA

- **Résultat (établi phase 9)** : `npm run build` réussit (`✓ built in 16.50s`), génère `dist/` avec 96 fichiers précachés par le service worker PWA (3 686,57 KiB). Avertissement Vite natif sur la taille de certains chunks (`pdf-*.js` 1,3 Mo, `exceljs-*.js` 938 Ko) — cf. **PERF-01**.
- **Erreurs d'import** : aucune rencontrée pendant le build — la compilation Vite (basée sur esbuild, qui ne fait pas de vérification de types complète) réussit malgré l'erreur TypeScript détectée par `tsc --noEmit` ci-dessus, ce qui confirme que cette erreur de type **peut atteindre la production sans blocage**.

### Variables requises

- `src/lib/supabase/client.ts` : si `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` sont absentes, le code se contente d'un `console.error('Variables Supabase manquantes dans .env.local')` puis **continue** avec `createClient('', '')` — pas d'arrêt net ni de message d'erreur utilisateur clair ; l'application démarrerait dans un état cassé avec des erreurs réseau confuses (URL invalide) plutôt qu'un message de configuration explicite.
- Variables identifiées comme utilisées par le frontend (cf. phase 2/7) : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_APP_URL` — toutes publiques par conception, aucune n'est un secret sensible.
- Variables requises côté Edge Functions (phase 4) : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `BREVO_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN` — gérées côté configuration du projet Supabase (secrets de fonctions), non présentes dans ce dépôt (normal).

### Configuration Vercel

- `vercel.json` (phase 1) : rewrites SPA + en-têtes de sécurité complets (CSP, HSTS, X-Frame-Options, Permissions-Policy) — cohérent et déjà positivement noté en phase 1. Rien de nouveau à signaler ici du point de vue "préparation production" ; aucun fichier de variables d'environnement Vercel (`*.env`) suivi par git (confirmé phase 1/9).

### Configuration Netlify

- **Absente de ce dépôt** — confirmé à nouveau (aucun `netlify.toml`), cohérent avec le fait que l'app commerciale externe (kaytekinter.fr) vit dans un dépôt séparé, non audité ici (cf. phases 1, 3, 7).

### Configuration Supabase

- **Aucun `supabase/config.toml`** trouvé dans ce dépôt (confirmé à nouveau, déjà noté phase 4) — le réglage `verify_jwt` par Edge Function, les limites de rate-limiting Auth, et la configuration Site URL/Redirect URLs (mémoire projet : historique de mauvaise configuration) ne sont donc pilotés que depuis le Dashboard Supabase, hors contrôle de version. C'est un point de préparation à la production à corriger : sans `config.toml` versionné, il n'existe aucune trace reproductible de la configuration du projet Supabase (au-delà des migrations SQL elles-mêmes).

### Configuration Android

- `capacitor.config.ts`, `build.gradle`, `AndroidManifest.xml` déjà vérifiés en détail phase 8 — secrets de signature correctement externalisés, `versionCode`/`versionName` incrémentés de façon disciplinée. Point de préparation à la production déjà signalé : absence de `google-services.json` (pas de FCM natif), permission `RECORD_AUDIO` manquante (**Android-01**).

---

## 4. Tests prioritaires manquants — classement P0/P1/P2

### P0 — À couvrir avant toute mise en production ou montée en charge commerciale

| # | Test manquant | Pourquoi P0 |
|---|---|---|
| 1 | **Isolation multi-tenant activée par défaut en CI** (rendre `TEST_ADMIN_B_EMAIL` obligatoire, échec bruyant si absent) | **TEST-01** — actuellement silencieusement désactivable, c'est la garantie commerciale n°1 du produit SaaS multi-tenant |
| 2 | **Tests RLS directs par API** (SELECT/INSERT/UPDATE/DELETE cross-organisation sur `clients`, `devis`, `factures`, `interventions`, `profiles`, `commissions`, en appelant directement Supabase avec les JWT de test, hors UI) | Seul moyen de détecter un contournement du type RLS-01 (phase 3) que les tests UI actuels ne peuvent pas voir |
| 3 | **Régression RLS-01** (`partner_intervention_requests` — vérifier qu'un intervenant/assistant non-admin ne peut pas lire les données clients partagées d'une demande partenaire) | Vulnérabilité confirmée en phase 3, actuellement sans aucun test de non-régression |
| 4 | **Numérotation devis/factures/interventions sous concurrence** (deux créations simultanées, vérifier l'absence de doublon **et** le scoping — actuellement absent — par organisation, DB-02 phase 5) | Risque de conformité comptable + risque de doublon déjà identifié |
| 5 | **Transformation devis → facture sous concurrence** (deux clics/requêtes simultanées sur le même devis) | **FACT-02** (phase 7) — condition de course confirmée, aucune contrainte `UNIQUE` en base pour la rattraper |
| 6 | **Comptes désactivés** (un utilisateur avec `actif=false` ne doit pas pouvoir se reconnecter ni conserver l'accès aux données) | **SEC2-03** (phase 2) — confirmé non vérifié côté frontend ; sans test, une régression future passerait inaperçue |
| 7 | **Sessions et abonnement** : un utilisateur d'une organisation à l'abonnement expiré/annulé ne doit pas pouvoir accéder aux données via un appel API direct (pas seulement voir l'écran de blocage) | **SEC2-01** (phase 2/7) — confirmé contournable aujourd'hui, aucun test ne le couvre ni ne le préviendrait si "corrigé puis re-cassé" |
| 8 | **Storage / fichiers** : un utilisateur d'une organisation ne doit pas pouvoir accéder à une photo/signature d'une autre organisation en devinant ou réutilisant un chemin de stockage | Aucun test Storage n'existe ; RLS Storage vérifiée uniquement par lecture de code en phase 3 |

### P1 — Important, à couvrir avant une croissance significative du nombre de clients

| # | Test manquant | Pourquoi P1 |
|---|---|---|
| 1 | **Calcul devis avec remise + TVA combinées** | Aurait détecté **FONC-01** (montant de TVA négatif) avant qu'il n'atteigne un client final |
| 2 | **Cohérence Dashboard vs page Commissions** | Aurait détecté **FONC-02** (deux montants différents affichés pour la même donnée) |
| 3 | **Limitation d'appareils** (le 3e appareil d'un intervenant doit être refusé ou remplacer le plus ancien selon la règle documentée) | Fonctionnalité présentée comme mesure de sécurité aux utilisateurs (phase 2, SEC2-02), jamais vérifiée automatiquement |
| 4 | **Rappels planifiés** (les rappels 24h/2h/30min se déclenchent bien pour les fenêtres de temps concernées) | **FN-03** (phase 4) — actuellement dépendant d'une ouverture manuelle de `/planning`, aucun test ne couvre le calcul des fenêtres lui-même |
| 5 | **Edge Functions — isolation organisation et rôle** (au moins un test par fonction : `envoyer-email`, `inviter-intervenant`, `supprimer-utilisateur`, `send-push`, `send-telegram` refusent bien un appel cross-organisation ou par un rôle non autorisé) | Actuellement vérifié uniquement en phase 4 par lecture de code, jamais par un test exécutable |
| 6 | **Suppression d'utilisateur avec données liées** (doit échouer proprement ou être empêchée, pas remonter une erreur Postgres brute) | **DB-01**/**FN-04** (phases 4-5) |
| 7 | **Webhooks Stripe** (rejeu, désordre, idempotence) — dès que le code de traitement du webhook sera rapatrié ou rendu accessible à l'audit | Actuellement hors périmètre (code externe), mais à anticiper si l'intégration est un jour internalisée |
| 8 | **Mode hors ligne réel** (une action effectuée hors connexion est bien mise en file et rejouée à la reconnexion) | **PWA-01** (phase 8) — actuellement la file n'est jamais alimentée, un test l'aurait révélé immédiatement |

### P2 — Utile, à couvrir dans une démarche d'amélioration continue

| # | Test manquant | Pourquoi P2 |
|---|---|---|
| 1 | **Android — biométrie/verrouillage** (au moins un test instrumenté remplaçant le boilerplate Capacitor par défaut) | Aucun test Android réel n'existe actuellement |
| 2 | **Détection de doublon client** (si la fonctionnalité est un jour ajoutée) | Actuellement absente par conception (phase 6), pas un bug à proprement parler |
| 3 | **Chevauchement de planning** (si une détection est ajoutée) | Idem — fonctionnalité absente, pas de régression à prévenir pour l'instant |
| 4 | **Performance/pagination** (temps de chargement de `/clients`, `/interventions` avec un grand volume simulé) | **PERF-02** (phase 9) — pertinent seulement à l'approche d'un volume réel important |
| 5 | **Accessibilité clavier/lecteur d'écran** | Non évalué dans cet audit, absent des tests existants |

---

## 5. Éléments non vérifiables dans cette phase

- **Résultat réel de l'exécution de la suite Playwright** — délibérément non exécutée dans cette phase (voir justification en tête de rapport). Tous les constats sur le comportement des tests viennent de la lecture de leur code, pas d'un run réel.
- **Existence d'une CI/CD** (GitHub Actions ou équivalent) exécutant ces tests automatiquement — aucun dossier `.github/workflows` ni configuration CI équivalente trouvé dans ce dépôt ; si une CI existe, elle est hébergée/configurée ailleurs (ex. intégration Vercel), non vérifiable depuis ce dépôt.
- **Compte "Organisation B" de test** : existence et provisioning réels non vérifiés (dépend de `.env.test`, dont le contenu n'a été vérifié que pour la présence de clés Supabase, pas pour la présence effective de `TEST_ADMIN_B_EMAIL`).
- **Comportement réel des tests marqués "écrit des données réelles"** dans le tableau du §1 — déduit de la lecture du code (appels `.click()` sur des boutons "Enregistrer"/"Créer"), pas observé en exécution.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
