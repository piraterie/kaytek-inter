# Phase 1 — Cartographie du projet Kaytek Inter

Date de l'analyse : 2026-07-21
Branche courante : `capacitor-android` (base `main`)
Méthode : lecture seule (arborescence, `git status/log`, lecture de fichiers de config et d'un échantillon de code). Aucune commande de build/lint/test/déploiement exécutée.

---

## 1. Résumé de l'architecture

Kaytek Inter est une SPA React/TypeScript (Vite) consommant directement Supabase (Auth, Postgres/RLS, Storage, Realtime) depuis le frontend, complétée par 7 Edge Functions Supabase pour les opérations sensibles (email, invitation, suppression de compte, push, rappels, Telegram, accès document public). L'app est packagée en PWA (vite-plugin-pwa) et en application Android via Capacitor (dossier `android/`). La facturation Stripe **n'est pas implémentée dans ce dépôt** : les tables `subscriptions` / `stripe_webhook_events` sont documentées a posteriori dans une migration (`20260709000002_version_stripe_tables.sql`) comme provenant d'une intégration Stripe externe ("outside this repo"), cohérent avec la mémoire projet mentionnant une app séparée sur Netlify (kaytekinter.fr). Aucun `netlify.toml` ni code Stripe (webhook, checkout) n'existe dans ce dépôt.

Le dépôt applicatif réel se trouve à la racine (`src/`, `supabase/`, `android/`, `tests/`). Il contient cependant un volume important de fichiers hors périmètre applicatif : une ancienne copie de l'app dupliquée à la racine, un second projet quasi-identique dans `kaytek-final/`, un snapshot complet dans `backup/backup-2026-06-10/`, des archives ZIP volumineuses, des dizaines de scripts SQL ponctuels et de captures d'écran — tous versionnés dans git (cf. §13).

---

## 2. Arborescence simplifiée (périmètre applicatif)

```
kaytek-final/                    (= racine du dépôt, nom trompeur, voir §13)
├── src/
│   ├── App.tsx, main.tsx        # bootstrap + routing + guards
│   ├── pages/                   # 24 pages + sous-dossier guide/ (5 pages)
│   ├── components/              # composants partagés + layout/ + guide/
│   ├── lib/
│   │   ├── store.ts             # Zustand: useAuthStore, useUIStore, useParamsStore, useToastStore
│   │   ├── supabase/             # client.ts, auth.ts, storage.ts
│   │   ├── hooks/                # index.ts (React Query), guide.ts, partners.ts
│   │   ├── pdf/                  # generator.tsx (342 l.), cache.ts
│   │   ├── offline/               # queue.ts, sync.ts
│   │   ├── exportPremium.ts       # export Excel (1043 l.)
│   │   ├── biometric.ts, devices.ts, buildGuard.ts, buildInfo.ts, subscription.ts, themes.ts
│   ├── hooks/useOnlineStatus.ts
│   ├── types/index.ts
│   └── styles/globals.css
├── supabase/
│   ├── functions/                # 7 Edge Functions + _shared/
│   └── migrations/                # 102 fichiers SQL (2026-06-05 → 2026-07-15)
├── android/                       # projet Capacitor/Gradle complet
├── tests/                         # Playwright: e2e, multi-tenant, responsive, beta
├── guide/, guide-report/          # scripts Playwright de génération du "Centre d'aide" (vidéos/captures)
├── vite.config.ts, capacitor.config.ts, vercel.json, tsconfig*.json, playwright*.config.ts
├── kaytek-final/                  # ⚠ second projet dupliqué, imbriqué (voir §13)
├── backup/backup-2026-06-10/      # ⚠ snapshot complet versionné (voir §13)
└── (racine) App.tsx, index.ts, client.ts, auth.ts, LoginPage.tsx, AppLayout.tsx, *.sql, *.png, *.zip
                                    # ⚠ fichiers orphelins versionnés (voir §13)
```

---

## 3. Technologies détectées (confirmées via `package.json`)

React 18.3, TypeScript 5.5, Vite 5.4 + `vite-plugin-pwa`, `@supabase/supabase-js` 2.45, Zustand 4.5 (avec middleware `persist`), TanStack Query 5.56, React Router 6.26, React Hook Form 7.53 + Zod 3.23, `@react-pdf/renderer` 3.4, `exceljs` 4.4 + `xlsx` 0.18 (deux libs Excel en parallèle, cf. §13), `@fullcalendar/*` 6.1 (planning), `signature_pad` 4.2, `date-fns` 3.6, Capacitor 8.4 (`core`, `android`, `app`, `keyboard`, `splash-screen`, `status-bar`) + `@aparajita/capacitor-biometric-auth` 10, Playwright 1.60 (`@playwright/test` + `@playwright/cli`).

Aucune dépendance Stripe (`stripe`, `@stripe/*`) dans `package.json` — cohérent avec l'absence de code Stripe dans le dépôt.

---

## 4. Points d'entrée

- **Web** : [index.html](index.html) → [src/main.tsx](src/main.tsx) (StrictMode, `QueryClientProvider`, `BrowserRouter`, appel fire-and-forget `ensureFreshBuild()` pour purge SW/cache) → [src/App.tsx](src/App.tsx) (397 lignes : composants `Guard`/`LockGuard`, routing, écoute `onAuthStateChange`, gating abonnement).
- **Android** : `android/app/src/main` (projet Gradle générique Capacitor), config pont dans [capacitor.config.ts](capacitor.config.ts) (`appId: com.kaytekinter.app`, `webDir: dist`, plugins SplashScreen/StatusBar/Keyboard).
- **Edge Functions** : chaque fonction sous `supabase/functions/<nom>/index.ts` est un point d'entrée HTTP indépendant (Deno).
- **Fichiers à la racine portant les mêmes noms** (`App.tsx`, `index.ts`, `client.ts`, `auth.ts`, `LoginPage.tsx`, `AppLayout.tsx`) **ne sont pas des points d'entrée réels** : ce sont des copies non référencées par `vite.config.ts`/`index.html` (voir §13).

---

## 5. Routes principales (extraites de `src/App.tsx:352-392`)

Routes publiques : `/login`, `/reset-password`, `/activation`, `/d/:token` (accès document public), `/confidentialite`, `/delete-account`, `/lock`.

Routes protégées (sous `Guard` + `AppLayout`) : `/dashboard`, `/interventions`, `/interventions/:id`, `/planning`, `/devis` (+ `/nouveau`, `/:id/editer`, `/:id/apercu`), `/factures`, `/clients` (+ `/:id`), `/catalogue`, `/messagerie` (+ `/:userId`), `/commissions`, `/partenaires`, `/utilisateurs`, `/parametres`, `/journal`, `/guide/*` (4 sous-routes). Fallback `*` → `/dashboard`.

Le contrôle d'accès combine trois mécanismes dans le composant `Guard` :
- rôle strict (`adminOnly`) ;
- liste blanche de rôles (`allowedRoles={['admin','intervenant']}` etc.) ;
- capacité fine (`requireCanCreateDocs` → vérifie `user.can_create_documents`, utile pour le rôle assistant).

Exemples : `/clients` limité à `admin`+`assistant` ; `/devis`, `/factures`, `/commissions` à `admin`+`intervenant` ; `/catalogue`, `/utilisateurs`, `/parametres`, `/journal`, `/partenaires` à `admin` seul.

---

## 6. Gestion des rôles et de l'organisation active

- **Rôles** : portés par `Profile.role` (type dans [src/types/index.ts](src/types/index.ts)), valeurs `admin` / `assistant` / `intervenant` (cf. usage dans `Guard`). Aucun store frontend dédié aux rôles : le rôle vit dans `useAuthStore.user.role` ([src/lib/store.ts:6-43](src/lib/store.ts)).
- **Organisation active** : **pas de store frontend d'organisation active** (`useAuthStore` ne contient ni `organisation_id` ni sélecteur d'organisation). Le multi-tenant semble entièrement porté côté serveur : `organisation_id` figure sur `Profile` et la quasi-totalité des entités métier dans `src/types/index.ts` (14 fichiers y font référence côté frontend, essentiellement des types), et l'isolation réelle doit être imposée par les policies RLS (à vérifier en détail en phase 3). Le frontend ne fait donc a priori pas de filtrage applicatif par organisation — point à confirmer/qualifier de critique en phase 3.
- **Abonnement / gating d'accès** : [src/lib/subscription.ts](src/lib/subscription.ts) appelle la RPC `get_my_organisation_subscription_status` ; `App.tsx` utilise `subscriptionBlocked` (dans `useAuthStore`) pour bloquer l'app si l'abonnement de l'organisation est inactif/expiré (messages différenciés admin vs autres rôles, `App.tsx:129-131`).
- **Verrouillage app / biométrie** : `isAppUnlocked` persisté sélectivement (`partialize`) dans `useAuthStore`, page dédiée `src/pages/LockScreen.tsx`, logique dans `src/lib/biometric.ts` (160 l.) et `src/lib/devices.ts` (246 l., limitation d'appareils).

---

## 7. Modules fonctionnels identifiés (correspondance page/lib)

| Module | Fichiers principaux |
|---|---|
| Auth / activation / reset | `LoginPage`, `ActivationPage`, `ResetPasswordPage`, `LockScreen`, `src/lib/supabase/auth.ts` |
| Dashboard | `DashboardPage`, `useDashboard` (`src/lib/hooks/index.ts`) |
| Clients | `ClientsPage`, `ClientDetailPage` |
| Interventions / Planning | `InterventionsPage`, `InterventionDetailPage`, `PlanningPage` (FullCalendar) |
| Devis / Factures | `DevisPage`, `DevisFormPage`, `DevisApercuPage`, `FacturesPage`, `src/lib/pdf/generator.tsx`, `src/lib/pdf/cache.ts` |
| Signature | `SignatureModal.tsx` (signature_pad) |
| Photos | intégré aux pages Intervention (via Storage, cf. `src/lib/supabase/storage.ts`) |
| Messagerie | `MessagingPage`, `PartnerConversationPanel`, `PartnerMessagesModal` |
| Commissions | `CommissionsPage` |
| Partenaires | `PartenairesPage`, `SendToPartnerModal`, `CreateInterventionFromPartnerRequestModal`, `src/lib/hooks/partners.ts` |
| Catalogue | `CataloguePage` |
| Paramètres entreprise | `ParamsPage` |
| Journal | `JournalPage` |
| Utilisateurs | `UsersPage` |
| Centre d'aide / Guide | `pages/guide/*` (5 pages), `components/guide/*`, `lib/hooks/guide.ts`, `lib/data/guide-*.ts` |
| Export Excel | `src/lib/exportPremium.ts` (1043 l., exceljs + xlsx) |
| Document public partagé | `PublicDocumentPage`, edge function `get-public-document` |
| RGPD | `ConfidentialitePage`, `DeleteAccountPage` |
| Offline | `src/lib/offline/queue.ts`, `sync.ts`, `useOnlineStatus`, `OfflineBanner` |
| Notifications / Push | edge function `send-push`, table `push_subscriptions`, service worker `public/push-sw.js` |
| Rappels | edge function `send-reminders` |
| Telegram | edge function `send-telegram` |

---

## 8. Accès à Supabase

- Client unique : [src/lib/supabase/client.ts](src/lib/supabase/client.ts), réexporté avec `uploadPhoto`.
- Auth : [src/lib/supabase/auth.ts](src/lib/supabase/auth.ts).
- Storage : [src/lib/supabase/storage.ts](src/lib/supabase/storage.ts).
- Toutes les requêtes métier (dashboard, CRUD) passent par React Query dans [src/lib/hooks/index.ts](src/lib/hooks/index.ts) (utilise `getUid()` en lisant la session en direct plutôt que le store, avec commentaire explicite sur la fiabilité) et [src/lib/hooks/partners.ts](src/lib/hooks/partners.ts) / `guide.ts`.
- Aucun ORM : requêtes via le SDK `@supabase/supabase-js` (`.from(...).select/insert/update/rpc`) directement depuis le frontend — la sécurité repose donc intégralement sur les policies RLS côté Postgres (périmètre phase 3).

---

## 9. Edge Functions détectées (`supabase/functions/`, 7 fonctions + `_shared`)

| Fonction | Rôle apparent |
|---|---|
| `envoyer-email` | Envoi d'e-mails (référence Brevo détectée) |
| `inviter-intervenant` | Invitation d'un intervenant (référence Brevo détectée) |
| `get-public-document` | Sert les documents via lien public (`/d/:token`) |
| `send-push` | Notifications push web |
| `send-reminders` | Rappels planifiés |
| `send-telegram` | Notifications Telegram |
| `supprimer-utilisateur` | Suppression de compte (RGPD) |
| `_shared/validateEntreprise.ts` | Validation partagée (référence Brevo détectée) |

Détail des permissions, service-role key, secrets et validation d'entrée : hors périmètre phase 1, à couvrir en **phase 4**.

---

## 10. Migrations détectées (`supabase/migrations/`)

102 fichiers SQL, du 2026-06-05 au 2026-07-15. Grandes étapes visibles par le nommage : introduction du multi-tenant (`organisations`, puis ajout de `organisation_id` table par table le 2026-06-10), 8 phases de RLS (`rls_phase1` à `rls_phase8`), migration Stripe documentaire (`version_stripe_tables`), provisioning d'organisation (`provision_subscriber_organisation`), plusieurs phases de durcissement sécurité (`security_phase1_critical_hardening`, `secure_sensitive_settings_and_founder_seats`, `harden_notifications_and_reminders`), fonctionnalités réseau partenaires (phases 1-3), rôle assistant.

Point notable : **26 des 102 fichiers** portent des noms `diag_*`, `test_fixture_*` ou `cleanup_*` (concentrés entre le 2026-07-13 et 2026-07-15, autour de l'investigation `partner_intervention_requests`), signe d'un débogage en production réalisé directement par migrations successives. À examiner en phase 5 pour vérifier qu'aucune n'a laissé de policy ou fonction de diagnostic trop permissive active.

---

## 11. Tests détectés (`tests/`, Playwright)

- `tests/auth.setup.ts` (+ `tests/.auth/*.json`, gitignored) : setup de session.
- `tests/e2e/` : 11 specs (auth, clients, devis, workflow complet, signature, factures, interventions, messagerie, notifications, prestation carte cliquable, vérification guide).
- `tests/multi-tenant/` : `01-isolation.spec.ts`, `02-isolation-create.spec.ts` — tests d'isolation RLS multi-tenant, à croiser avec la phase 3.
- `tests/responsive/01-viewports.spec.ts` : tests multi-résolutions.
- `tests/beta/01-beta-accounts.spec.ts` : comptes bêta-testeurs.
- Scripts npm associés : `test`, `test:e2e`, `test:responsive`, `test:multi-tenant`, `test:chromium`, `test:ui`, `test:report`, `test:setup`, `test:beta`.
- Configs : `playwright.config.ts`, `playwright.guide.config.ts`, `tsconfig.playwright.json`.
- Dossier parallèle `guide/` : scripts Playwright *hors suite de tests* servant à générer les captures/vidéos du Centre d'aide (`guide/admin/*.ts`, `guide/intervenant/*.ts`, `guide/setup/*.ts`, `guide/scripts/upload-videos.ts`) — à ne pas confondre avec `tests/`.

---

## 12. Configurations de déploiement

- **Vercel** : [vercel.json](vercel.json) à la racine — rewrites SPA + en-têtes de sécurité complets (CSP, HSTS, X-Frame-Options, Permissions-Policy) restreignant `connect-src` à Supabase + `*.vercel.app`. Un second `vercel.json` quasi vide existe dans `kaytek-final/` (voir §13). Dossier `.vercel/` présent (lien de projet local).
- **Netlify** : aucun fichier `netlify.toml` ni configuration Netlify trouvé dans ce dépôt. Cohérent avec la mémoire projet indiquant une app commerciale séparée hébergée sur Netlify (kaytekinter.fr), **hors périmètre de ce dépôt**.
- **Android** : `android/` = projet Gradle Capacitor standard, `capacitor.config.ts` à la racine.
- **PWA** : configurée dans `vite.config.ts` via `vite-plugin-pwa` (`generateSW`, `registerType: autoUpdate`, manifest avec icônes standard + maskable, `importScripts` vers `public/push-sw.js` pour les push).
- **Stripe** : pas de code d'intégration dans ce dépôt (ni webhook, ni checkout, ni SDK) ; seules les tables Postgres sont documentées a posteriori par migration. Confirme la mémoire projet sur l'écart entre app commerciale externe et ce dépôt.
- **Brevo** : utilisé uniquement depuis les Edge Functions (`envoyer-email`, `inviter-intervenant`, `_shared/validateEntreprise.ts`), aucune trace côté frontend.

---

## 13. Fichiers non utilisés, dupliqués ou suspects (constats vérifiés)

Tous les éléments ci-dessous sont **suivis par git** (`git ls-files` confirmé), donc versionnés et poussés, pas de simples résidus locaux :

1. **Doublons de fichiers source à la racine du dépôt** : `App.tsx`, `App (2).tsx` (identique à `App.tsx`, `diff` vide), `AppLayout.tsx`, `LoginPage.tsx`, `auth.ts`, `client.ts`, `index.ts` — copies anciennes des fichiers réels situés dans `src/`. Non référencés par `vite.config.ts` ni `index.html`. Risque : confusion lors d'une recherche/édition, revue de code sur le mauvais fichier.
2. **Projet dupliqué imbriqué `kaytek-final/`** : arborescence quasi complète (`src/`, `package.json`, `vite.config.ts`, `vercel.json`, `tsconfig.json`, `index.html`) avec un `package.json` allégé (moins de dépendances que la racine, pas de scripts `test`/`android:*`) — ressemble à un état antérieur du projet conservé par erreur dans le dépôt actif. À confirmer si un ancien build/déploiement pointe encore dessus.
3. **Snapshot complet versionné `backup/backup-2026-06-10/`** : copie intégrale de l'app + `database-schema.sql` + rapports markdown à une date donnée. Une sauvegarde de ce type ne devrait généralement pas être commitée dans le même dépôt actif (gonfle l'historique, risque de divergence silencieuse).
4. **Archives ZIP volumineuses versionnées** : `KAYTEK_BACKUP_BEFORE_PDF_OPTIMIZATION.zip` (~51 Mo), `SUPABASE_BACKUP_BEFORE_PDF_OPTIMIZATION.zip`, `SUPABASE_MIGRATIONS_PHASE6.zip`, `SUPABASE_PHASE8_STABLE.zip` — alourdissent le clone/l'historique git de manière disproportionnée.
5. **~21 scripts SQL ponctuels `fix-*.sql` / `add-*.sql` / `diagnostic-*.sql` à la racine**, en plus des migrations officielles dans `supabase/migrations/`. Risque de confusion sur la source de vérité du schéma (le schéma réel est-il capturé uniquement par les migrations, ou certains de ces scripts ont-ils été appliqués manuellement sans migration correspondante ?) — à vérifier en phase 5.
6. **~45 captures d'écran PNG versionnées à la racine** (`dark-*.png`, `light-*.png`, `verify-*.png`, `state*.png`, `t1-*.png`…) ainsi que dans `audit/` et `guide-report/` — artefacts de sessions de test manuel/Playwright, sans rapport avec le code applicatif.
7. **Fichiers de session Playwright authentifiés commités : `guide/.auth/admin.json` et `guide/.auth/intervenant.json`.** Vérifié : ces fichiers contiennent un `access_token` et un `refresh_token` Supabase réels (session du compte `admin@kaytek.test`, `expires_at` du token d'accès au 2026-06-15, donc expiré à ce jour, mais le refresh token n'a pas été vérifié comme révoqué). C'est un compte de test dédié, ce qui réduit la gravité, mais committer des jetons de session reste une mauvaise pratique et mérite vérification en **phase 2 (sécurité frontend/auth)**. À noter : les équivalents `tests/.auth/*.json` sont correctement exclus par `.gitignore` — seul le dossier `guide/.auth/` a été committé par erreur.
8. **Deux bibliothèques d'export Excel en parallèle** (`exceljs` et `xlsx` toutes deux en dépendance et alias/optimisées dans `vite.config.ts`) — doublon fonctionnel probable à clarifier en phase 9 (performances/poids de bundle).
9. **Fichier généré résiduel** : `vite.config.ts.timestamp-*.mjs` — artefact de build Vite versionné par erreur.
10. **Fichiers de log/serveur ad hoc à la racine** : `_icon-server.cjs`, `_srv.cjs`, `_gen_icons_chrome.cjs`, `gen-icons*.cjs`, `gen2.cjs`, `generate-icons.cjs`, `dev-server.log`, `dev-server-err.log`, `check-devis-id.js` — scripts utilitaires ponctuels, a priori sans lien avec le runtime applicatif.
11. **Dossiers `.claude/worktrees/*`** : copies complètes du dépôt (`kaytek-address-autocomplete-fix`, `kaytek-dashboard-eye-toggle`, `kaytek-session-biometric-fix-2`) utilisées pour le workflow de développement par phases — attendues (non anormales), mais à exclure explicitement du périmètre d'audit pour ne pas dupliquer les constats.

Aucun de ces éléments n'a été modifié ou supprimé (conformément aux règles de la phase).

---

## 14. Zones critiques à auditer en priorité dans les phases suivantes

- **Phase 2 (sécurité frontend/auth)** : logique de `Guard`/`LockGuard` dans `App.tsx` (397 l., logique dense) ; gestion `isAppUnlocked`/biométrie (`biometric.ts`, `devices.ts`) ; jetons committés `guide/.auth/*.json` (finding #7 ci-dessus) ; `buildGuard.ts` (purge SW/cache).
- **Phase 3 (RLS/multi-tenant)** : absence de store frontend d'organisation active — confirmer que 100% du filtrage par `organisation_id` est bien imposé par les policies RLS et non supposé côté client ; les 8 phases de migrations RLS (`rls_phase1`→`phase8`) et leurs correctifs ultérieurs (`fix_*_rls.sql`) ; tests `tests/multi-tenant/`.
- **Phase 4 (Edge Functions)** : secrets/service-role dans les 7 fonctions, en particulier `supprimer-utilisateur` (RGPD) et `envoyer-email`/`inviter-intervenant` (Brevo).
- **Phase 5 (base de données)** : les 26 migrations `diag_*`/`test_fixture_*`/`cleanup_*` (2026-07-13 → 2026-07-15) et les ~21 scripts SQL racine hors migrations — vérifier qu'aucune policy/fonction de diagnostic n'est restée active.
- **Phase 7 (Stripe)** : confirmer précisément le contrat entre l'app externe (Netlify) et ce dépôt via les tables `subscriptions`/`stripe_webhook_events` et la RPC `get_my_organisation_subscription_status` (déjà partiellement couvert par la mémoire projet "Stripe self-service gap").
- **Phase 9 (performances)** : doublon `exceljs`/`xlsx`, poids du bundle PDF/Excel/FullCalendar, `exportPremium.ts` (1043 l.), `AppLayout.tsx` (801 l.).

---

## 15. Éléments non vérifiables à ce stade

- Contenu exact des secrets dans `.env.production`, `.env.local`, `.env.beta-test`, `.env.guide` — non ouverts en détail (présence confirmée, valeurs non analysées, conformément à l'interdiction de révéler des secrets).
- Statut réel (révoqué ou non) du `refresh_token` trouvé dans `guide/.auth/admin.json`/`intervenant.json` — nécessite un contrôle côté Supabase Auth, hors périmètre lecture-seule de cette phase.
- Contenu fonctionnel détaillé de chaque page/composant (399 fichiers dans `src/` non tous ouverts individuellement) — seule l'arborescence et un échantillon représentatif ont été inspectés.
- Le rôle exact et l'usage réel de `kaytek-final/` (copie figée abandonnée vs. déploiement encore actif ailleurs) — nécessiterait de vérifier les projets Vercel liés, hors périmètre phase 1.
- Contenu des 102 migrations et des Edge Functions ligne à ligne — traité en surface, détail réservé aux phases 4 et 5.
- Application commerciale externe (kaytekinter.fr sur Netlify) : hors périmètre de ce dépôt, mentionnée uniquement par recoupement avec la mémoire projet, non auditée ici.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
