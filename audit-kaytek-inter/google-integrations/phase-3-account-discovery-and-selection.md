# Phase 3 — Découverte et sélection des comptes Google (rapport)

Branche dédiée : `feature/google-phase3-account-discovery` (créée à partir de `feature/google-ads-gbp-phase1-foundations`, qui contient déjà les commits Phase 1 `1755e92c` et Phase 2 `ccbd939c`, plus le correctif Vault volatilité `20260728000007` déjà appliqué en production).

Implémentation **strictement locale** lors du premier passage (audit + code) : aucun `db push`, aucun déploiement d'Edge Function, aucun déploiement frontend, aucun commit, aucun push.

**Mise à jour — déploiement progressif contrôlé (même session, tour suivant) :** migration, 4 Edge Functions et frontend déployés en production pour la partie Google Business Profile. La partie Google Ads reste bloquée par l'absence de `GOOGLE_ADS_DEVELOPER_TOKEN`. Détail complet en fin de document, section « 19. Déploiement progressif — résultats ».

## 1. Architecture retenue

- Deux nouvelles Edge Functions **lecture seule** côté Google : `google-ads-list-accounts` (Google Ads REST v17) et `google-business-list-locations` (Google Business Profile — Account Management + Business Information API v1).
- Logique d'appel Google factorisée dans deux modules `_shared/` (`google-ads-api.ts`, `google-business-api.ts`), réutilisés par les fonctions de listing **et** par la fonction de sélection (revérification serveur — voir §7).
- Une seule Edge Function d'écriture, `google-select-connection`, qui enregistre le choix de l'administrateur après l'avoir revérifié contre une liste **fraîchement** obtenue auprès de Google (jamais de confiance dans un identifiant envoyé tel quel par le frontend).
- Aucune nouvelle table : les identifiants "sélectionnés" réutilisent les colonnes déjà créées en Phase 1 (`google_customer_id`, `google_login_customer_id`, `google_location_id`, `google_account_id`, `account_name`) ; seules les colonnes réellement absentes (nom descriptif, devise, fuseau horaire, adresse, statut d'ouverture, traçabilité `selected_at`/`selected_by`) sont ajoutées.
- `_shared/google-oauth-refresh.ts` (Phase 2, déjà mutualisé) est directement réutilisé par les deux modules API — aucune duplication de la logique de rafraîchissement de token (Phase 3F du cahier des charges était déjà satisfaite structurellement par l'architecture Phase 2).

## 2. Fichiers créés

- `supabase/functions/_shared/google-ads-api.ts` — `listAccessibleAdsAccounts()`.
- `supabase/functions/_shared/google-business-api.ts` — `listAccessibleGbpLocations()`.
- `supabase/functions/google-ads-list-accounts/index.ts`
- `supabase/functions/google-business-list-locations/index.ts`
- `supabase/functions/google-select-connection/index.ts`
- `supabase/functions/_shared/google-ads-api.test.ts`, `google-ads-api-no-devtoken.test.ts`, `google-business-api.test.ts` (Deno, réseau entièrement mocké)
- `supabase/migrations/20260728000008_google_account_selection.sql`
- `audit-kaytek-inter/corrections/tests/correction-08-google-account-selection-tests.sql`
- Ce document.

## 3. Fichiers modifiés

- `supabase/functions/_shared/google-oauth.ts` — ajout de `sanitizeErrorDetail()` (helper partagé, extrait de la correction `vault_storage_failed` précédente pour éviter la duplication), `GOOGLE_ADS_API_VERSION`/`GOOGLE_ADS_API_BASE`, `GBP_ACCOUNT_MANAGEMENT_BASE`, `GBP_BUSINESS_INFORMATION_BASE`.
- `supabase/functions/google-oauth-callback/index.ts` — refactor pour utiliser `sanitizeErrorDetail()` au lieu de la logique inline (aucun changement de comportement).
- `supabase/functions/google-oauth-status/index.ts` — le `SELECT` inclut désormais les nouvelles colonnes de sélection (toujours aucune colonne `*_secret_id`).
- `src/lib/hooks/googleIntegrations.ts` — nouveaux hooks `useLoadGoogleAdsAccounts`, `useLoadGoogleBusinessLocations`, `useSelectGoogleAdsAccount`, `useSelectGoogleBusinessLocation` ; `GoogleConnectionInfo` étendu.
- `src/pages/IntegrationsGooglePage.tsx` — ajout des composants `AdsSelector`/`GbpSelector` (chargement à la demande, sélection, changement, badges, gestion d'erreurs en français sans détail technique brut).
- `scripts/run-security-sql-tests.mjs` — enregistrement de `correction-08-google-account-selection-tests.sql`.
- `supabase/functions/_shared/google-oauth-refresh.test.ts`, `google-oauth-state.test.ts` — correction d'un commentaire d'en-tête obsolète (`--allow-none` n'est pas un flag Deno valide ; corrigé en `--allow-env`, seul flag réellement nécessaire — vérifié en les exécutant).

## 4. Migration proposée (`20260728000008`)

Additive uniquement : `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` sur `google_ads_connections` (`customer_descriptive_name`, `is_manager_account`, `currency_code`, `time_zone`, `selected_at`, `selected_by`) et `gbp_connections` (`location_title`, `location_address`, `location_open_status`, `selected_at`, `selected_by`) ; `CREATE OR REPLACE VIEW` des deux vues de statut avec les nouvelles colonnes ajoutées en dernière position (contrainte Postgres déjà rencontrée en Phase 2) ; re-déclaration des `GRANT`/`REVOKE` déjà en place ; bloc `DO` auto-vérificateur (même garde-fou qu'en Phase 1/2 : aucun droit d'écriture résiduel, aucune colonne de secret exposée).

**Non exécutée sur production dans ce passage.** Le stack Supabase local (Docker) n'était pas disponible dans cet environnement pour une application/vérification end-to-end automatisée — la migration a été validée par revue manuelle et par parité structurelle stricte avec les migrations `20260728000005`/`20260728000006` (déjà appliquées en production avec succès, même motif exact de `CREATE OR REPLACE VIEW` + bloc `DO` auto-vérificateur). Ceci doit être considéré comme une limite de vérification, pas comme une preuve d'exécution réussie — à confirmer par une application réelle (locale ou production) avant toute mise en service.

Les tables restent **deny-all** pour `anon`/`authenticated` (aucune nouvelle policy RLS créée) : seul `service_role`, via `google-select-connection`, peut écrire une sélection. La restriction « seuls les administrateurs peuvent modifier la sélection » (règle absolue #12) est donc appliquée au niveau applicatif (`requireActiveAdmin()` dans chaque Edge Function), pas par une policy RLS dédiée — cohérent avec le fait qu'`authenticated` n'a de toute façon aucun droit d'écriture sur ces tables, admin ou non.

## 5. Edge Functions créées

| Fonction | JWT requis | Lecture/écriture Google | Vérifications |
|---|---|---|---|
| `google-ads-list-accounts` | Oui (admin actif) | Lecture seule (`listAccessibleCustomers` + GAQL `SELECT`) | Aucune campagne/budget/mot-clé touché |
| `google-business-list-locations` | Oui (admin actif) | Lecture seule (`GET` uniquement) | Aucune fiche/avis/photo/horaire touché |
| `google-select-connection` | Oui (admin actif) | Aucun appel d'écriture Google — revérifie l'accessibilité de l'identifiant choisi via un appel de listing frais avant d'écrire en base | Rejette tout identifiant non retrouvé dans la liste fraîche (`403`, événement `*_selection_rejected` journalisé) |

Toutes trois : `requireActiveAdmin()` (JWT + `profiles.role='admin' AND actif=true`, organisation dérivée de `auth.uid()`, jamais du body) ; jamais de token lu/journalisé/retourné ; `console.error`/`google_oauth_events.detail` toujours passés par `sanitizeErrorDetail()`.

## 6. APIs Google appelées

- **Google Ads REST v17** (`googleads.googleapis.com/v17`) : `customers:listAccessibleCustomers` (GET), `customers/{id}/googleAds:search` (POST, GAQL `SELECT` sur `customer` puis `customer_client`). En-têtes `Authorization: Bearer`, `developer-token`, `login-customer-id`.
- **Google Business Profile** : Account Management API (`mybusinessaccountmanagement.googleapis.com/v1/accounts`, GET paginé) + Business Information API (`mybusinessbusinessinformation.googleapis.com/v1/{account}/locations`, GET paginé, `readMask` explicite).

Aucun appel `POST`/`PATCH`/`DELETE` vers une ressource Google dans les trois nouvelles fonctions — uniquement des méthodes de lecture (`GET`, ou `POST` avec une requête GAQL `SELECT` pour Google Ads, qui est la seule méthode HTTP exposée par cette API pour les requêtes en lecture).

## 7. Scopes utilisés

Aucun nouveau scope : `https://www.googleapis.com/auth/adwords` (Ads) et `https://www.googleapis.com/auth/business.manage` (GBP) étaient déjà demandés en Phase 2 et couvrent la lecture des comptes/établissements. Aucune modification de `google-oauth-start`.

## 8. Règles de sécurité respectées

- Revérification serveur systématique de l'identifiant sélectionné (`google-select-connection` rappelle `listAccessibleAdsAccounts`/`listAccessibleGbpLocations` avant d'écrire — jamais de confiance dans le frontend).
- Aucun token journalisé, retourné, ou stocké ailleurs que dans les colonnes `*_secret_id` déjà protégées par Vault (Phase 1/2, inchangé).
- `sanitizeErrorDetail()` appliqué à tout message d'erreur avant `console.error`/`google_oauth_events.detail` (retrait des motifs `ya29.*`/`1//*`, troncature à 1000 caractères).
- Aucune écriture directe possible par le frontend (tables deny-all inchangées).
- Isolation multi-tenant : `organisation_id` toujours dérivé de `auth.uid()` via `requireActiveAdmin()`, jamais lu depuis le body de la requête.

## 9. Gestion du rafraîchissement des tokens

Aucune nouvelle logique : les deux modules `_shared/google-*-api.ts` appellent `ensureFreshAccessToken()` (Phase 2, déjà testée — 5 tests Deno existants, tous toujours au vert) avant tout appel Google. Le token n'est lu qu'une fois via `vaultReadSecret()`, jamais journalisé.

## 10. Gestion des erreurs

Chaque module de listing retourne un type discriminé (`{ ok: true; accounts }` ou `{ ok: false; reason; detail? }`) plutôt que de lever une exception pour les cas prévisibles. Raisons couvertes : `not_connected`, `needs_reconnect`, `developer_token_missing` (Ads uniquement), `developer_token_unapproved` (Ads), `api_not_enabled`, `insufficient_permission`, `google_error` (repli générique, détail toujours nettoyé). Le frontend traduit chaque raison en un message français sans jargon technique (`ADS_ERROR_LABEL`/`GBP_ERROR_LABEL`), jamais le message brut de Google.

## 11. Interface

`/parametres/integrations` : chaque carte (Google Ads / Google Business Profile), une fois connectée, affiche soit un bouton « Charger mes comptes/établissements » (aucun appel automatique au chargement de la page — évite un appel Google Ads/GBP API à chaque visite), soit — si une sélection existe déjà — un résumé (nom, devise/fuseau ou adresse/statut) avec badge « associé » et bouton « Changer ». La liste distingue les comptes MCC (badge « MCC », sélection bloquée avec message explicatif) des comptes publicitaires réels. États gérés : chargement, liste vide, erreur API (message traduit), aucune donnée technique brute affichée.

## 12. Tests exécutés

**Backend (Deno, réseau entièrement mocké)** — tous exécutés et vérifiés au vert dans cette session :
- `google-ads-api.test.ts` (6 tests, nécessite `GOOGLE_ADS_DEVELOPER_TOKEN`/`GOOGLE_OAUTH_CLIENT_ID` définis dans l'environnement du process) : non connecté, liste vide, compte simple, hiérarchie MCC (1 niveau), erreur de permission classifiée, aucune fuite de token.
- `google-ads-api-no-devtoken.test.ts` (1 test, sans la variable) : `developer_token_missing` détecté avant tout appel réseau.
- `google-business-api.test.ts` (5 tests) : non connecté, liste vide, formatage adresse/statut, pagination (2 pages agrégées), erreur API non activée.
- Non-régression : `google-oauth-refresh.test.ts` (5 tests) et `google-oauth-state.test.ts` (8 tests), Phase 2, toujours au vert après le refactor `sanitizeErrorDetail`.
- **Total : 25 tests Deno passés, 0 échec.**
- `deno check` : tous les fichiers `.ts` neufs/modifiés passent sans erreur.

**Frontend** : `npm run typecheck` passe sur l'ensemble du projet, à l'exception d'une erreur préexistante et sans rapport dans `DevisFormPage.tsx:170` (confirmée par `git diff main` : fichier non touché par cette session, présente avant tout travail Phase 3). Aucun test automatisé Playwright/E2E exécuté pour l'UI de sélection (nécessiterait un stack local + un compte Google réel connecté — hors de portée en lecture seule/sans interaction navigateur dans cet environnement).

**Non exécuté dans ce passage (limite explicite, pas une omission silencieuse)** :
- La migration SQL elle-même (Docker/stack Supabase local indisponible dans cet environnement — voir §4).
- Le test RLS `correction-08-google-account-selection-tests.sql` (écrit, enregistré dans le runner, non exécuté pour la même raison).
- Tout appel réel aux APIs Google Ads/Business Profile (aucun credential de test invoqué, conforme à la règle « lecture seule / aucun test interactif à ce stade »).

## 13. Limites connues

- **Hiérarchie Google Ads MCC : un seul niveau.** Les comptes clients rattachés à un manager sont découverts via `customer_client` avec `level <= 1` — une hiérarchie à plusieurs niveaux (MCC de MCC) ne serait que partiellement listée. Documenté dans le code (`google-ads-api.ts`), pas un choix silencieux.
- **Statut de vérification Google Business Profile non déterminé.** `verificationStatus` est toujours `'unknown'` dans cette passe — l'obtenir réellement nécessite un appel dédié (`locations.getVoiceOfMerchantState`), non implémenté pour limiter la portée (risque de N+1 appels par établissement). Le statut d'ouverture (`openInfo.status`, OPEN/CLOSED_*) est en revanche fiable et affiché.
- **Version d'API Google Ads figée (`v17`).** Les versions Google Ads API sont dépréciées par cycles (~trimestriel) — à revérifier périodiquement contre les notes de version Google avant mise en production durable.
- **`GOOGLE_ADS_DEVELOPER_TOKEN` absent en production** (confirmé par `supabase secrets list` en Phase 3A) — `google-ads-list-accounts` répondra systématiquement `developer_token_missing` tant qu'il n'est pas configuré. Ce n'est pas un bug de cette implémentation, c'est un prérequis externe non encore rempli.
- Aucun test end-to-end réel (navigateur + compte Google connecté) n'a été exécuté — seule la logique a été validée par tests unitaires avec réseau mocké.

## 14. Prérequis Google Ads

- `developer-token` niveau Basic Access minimum (demande manuelle Google, **absent en production actuellement**).
- Un compte manager (MCC) Kaytek n'est pas strictement requis pour lister les comptes déjà accessibles au compte Google connecté, mais reste recommandé pour piloter plusieurs comptes clients à terme.
- Aucune approbation supplémentaire requise pour la simple lecture `listAccessibleCustomers`/GAQL `SELECT` au-delà du developer token.

## 15. Prérequis Google Business Profile

- Accès API déjà approuvé en Phase 0 (préalable au projet, non revérifié ici).
- Aucun prérequis supplémentaire pour les endpoints de lecture utilisés (`accounts`, `locations` avec `readMask`).

## 16. Plan de déploiement (proposé, non exécuté)

Commandes exactes, à exécuter uniquement après validation explicite séparée :

```
# 1. Appliquer la migration (même contournement bootstrap que Phase 1/2 si nécessaire)
npx supabase db push --linked --yes

# 2. Déployer les 3 nouvelles Edge Functions (JWT requis par défaut — aucune n'est un callback public)
npx supabase functions deploy google-ads-list-accounts --project-ref dimrukkxehcwzemslwiz
npx supabase functions deploy google-business-list-locations --project-ref dimrukkxehcwzemslwiz
npx supabase functions deploy google-select-connection --project-ref dimrukkxehcwzemslwiz

# 3. Redéployer google-oauth-status et google-oauth-callback (colonnes/refactor, --no-verify-jwt pour callback uniquement)
npx supabase functions deploy google-oauth-status --project-ref dimrukkxehcwzemslwiz
npx supabase functions deploy google-oauth-callback --no-verify-jwt --project-ref dimrukkxehcwzemslwiz

# 4. Build + déploiement frontend
npm run build
vercel deploy --prod --yes
```

**Ordre recommandé** : migration → Edge Functions → frontend (même ordre que Phase 2, jamais l'inverse — le frontend référence des fonctions qui doivent déjà exister). Avant l'étape 2, configurer `GOOGLE_ADS_DEVELOPER_TOKEN` en secret de production si ce n'est pas déjà fait (§13), sans quoi la carte Google Ads restera bloquée sur `developer_token_missing` en production.

## 17. Plan de retour arrière

- Edge Functions : `supabase functions delete <nom>` (ou redéploiement de la version précédente) pour les 3 nouvelles fonctions ; `google-oauth-status`/`google-oauth-callback` peuvent être redéployées depuis le commit Phase 2 (`ccbd939c`) si besoin.
- Migration : les nouvelles colonnes sont additives et nullable — un `ALTER TABLE ... DROP COLUMN IF EXISTS` inverse est possible sans perte pour le reste du schéma, mais **effacerait toute sélection déjà enregistrée par un client réel** si le retour arrière intervient après une mise en production effective. Ne jamais `DROP` les tables `google_ads_connections`/`gbp_connections` elles-mêmes.
- Frontend : rollback Vercel standard vers le déploiement précédent.

## 18. Confirmation (implémentation locale)

Aucune campagne Google Ads, aucune fiche Google Business Profile, aucun avis, aucune photo, aucun horaire n'a été créé/modifié/supprimé par ce travail — uniquement des appels `GET`/GAQL `SELECT` conçus et testés (mockés), jamais exécutés contre l'API Google réelle dans cette session. Aucune synchronisation massive déclenchée.

## 19. Déploiement progressif — résultats

### Verdict de la revue finale (Étape 1)
**Prêt au déploiement.** Les 15 points demandés ont été vérifiés par relecture complète du code : aucun token renvoyé au frontend ni journalisé, authentification systématique (`requireActiveAdmin`), organisation toujours dérivée de `auth.uid()`, sélection systématiquement revérifiée contre une liste fraîche avant écriture, identifiants stockés en `text`, écritures via `service_role` uniquement, migration additive (aucun `DROP`), aucune nouvelle policy RLS (donc aucun risque de casser les policies Phase 1/2), rafraîchissement de token toujours mutualisé (`ensureFreshAccessToken`), erreurs systématiquement nettoyées (`sanitizeErrorDetail`), aucun appel Google en écriture.

**Observation mineure non bloquante** : `google-oauth-disconnect` (non modifiée dans cette phase) ne réinitialise pas les nouvelles colonnes descriptives (`customer_descriptive_name`, `currency_code`, `time_zone`, `location_title`, `location_address`, `location_open_status`, `selected_at`, `selected_by`) lors d'une déconnexion — seules les colonnes de token/statut le sont. Impact réel nul : ces colonnes ne contiennent aucune donnée sensible, et l'UI ne les affiche que lorsque `status` est `connected`/`expired` (jamais `disconnected`), donc aucune donnée périmée n'est visible. Non corrigé conformément à la règle « ne redéploie pas google-oauth-disconnect sauf nécessité démontrée » — l'impact ne justifie pas cette nécessité.

### État du Developer Token (Étape 2)
`GOOGLE_ADS_DEVELOPER_TOKEN` **absent** de `supabase secrets list --project-ref dimrukkxehcwzemslwiz` (vérifié par nom uniquement, aucune valeur consultée). Déploiement de la partie Google Ads arrêté à cette étape, conformément aux règles absolues.

### Contrôles locaux (Étape 3)
- 25/25 tests Deno passés (Phase 2 : 13, Phase 3 : 12), réseau entièrement mocké.
- `npm run typecheck` : propre, à l'exception de l'erreur préexistante et sans rapport `DevisFormPage.tsx:170` (confirmée par `git diff main`, fichier non touché).
- `deno check` : tous les fichiers `.ts` Phase 2/3 passent.
- `npm run build` : succès (avertissements de taille de chunk préexistants, sans rapport).
- Recherche de fuites (`client_secret`, `refresh_token`, `access_token`, `service_role`, `developer_token`, `Authorization`, `console.log`) sur le code Phase 3 : uniquement des noms de variables/types/clés d'en-tête légitimes, aucune valeur en dur. Bundle `dist/` scanné pour des motifs `ya29.`/`GOCSPX-`/`service_role` : aucune occurrence.
- `git diff --check` : `exit 0` (seuls des avertissements de fin de ligne LF/CRLF, non bloquants).
- `git status --short` : conforme à l'ensemble de fichiers Phase 3 attendu, plus les artefacts déjà connus et non liés à cette session (fichier bootstrap non tracké, captures d'écran, logs Playwright).

### Migration (Étape 4)
`supabase migration list --linked` : `20260728000008` confirmée comme seule migration en attente avant application (aucune ancienne migration non appliquée accidentellement incluse). Appliquée via le même contournement documenté du fichier bootstrap non tracké (déplacé puis restauré à l'identique — empreinte SHA-256 `3f413976a1c3...036b0` vérifiée strictement identique avant/après). `db push` réussi, `NOTICE` auto-vérificateur affiché en production : *« OK — vues de statut Google (Phase 3) : colonnes de sélection ajoutées, aucune fuite. »*

Contrôles post-application (lecture seule) : nouvelles colonnes présentes avec les types/valeurs par défaut attendus (`text`/`boolean`/`timestamptz` nullable, aucun défaut) ; FK `selected_by → profiles(id) ON DELETE SET NULL` confirmée sur les deux tables ; RLS toujours activée (`relrowsecurity = true`) et **0 policy** sur les deux tables (deny-all intact) ; vues de statut : seul `SELECT` accordé à `anon`/`authenticated` (plus `REFERENCES`/`TRIGGER`, privilèges par défaut sans effet sur une vue, jamais `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`). Lignes de connexion existantes (organisation `2378ca5c-...`) toujours présentes et inchangées pour Ads et GBP (`status=connected`, `google_account_email=castryludovic@gmail.com` préservés).

### Edge Functions déployées (Étape 5)
| Fonction | Action | Version après |
|---|---|---|
| `google-ads-list-accounts` | **Non déployée** (bloquée, Developer Token absent) | — |
| `google-business-list-locations` | Déployée (nouvelle) | v1 |
| `google-select-connection` | Déployée (nouvelle) | v1 |
| `google-oauth-status` | Redéployée (nouvelles colonnes) | v11 |
| `google-oauth-callback` | Redéployée (refactor `sanitizeErrorDetail`, `--no-verify-jwt` conservé) | v12 |
| `google-oauth-start` | Non touchée | v10 (inchangée) |
| `google-oauth-disconnect` | Non touchée | v10 (inchangée) |

Confirmé via `supabase functions list` après chaque déploiement : uniquement la fonction ciblée à chaque appel, aucune autre fonction affectée.

### Contrôles backend (Étape 6)
Vérification d'authentification (non destructive, sans JWT) : `google-business-list-locations`, `google-select-connection`, `google-oauth-status` → `HTTP 401` chacune, confirmant l'application réelle de la vérification JWT. **Limite assumée** : je ne dispose d'aucune session administrateur réelle pour effectuer moi-même le test fonctionnel authentifié (listing réel des établissements, pagination, événements) — ce test est reporté à l'étape 8 (test utilisateur).

### Déploiement frontend (Étape 7)
`npm run build` (déjà validé à l'étape 3) puis `vercel deploy --prod --yes` : `readyState: READY`, aliasé sur `app.kaytekinter.fr`. `GET /parametres/integrations` → `HTTP 200`. Vérification limitée à la portée accessible sans navigateur interactif (reachability, build réussi) — absence d'écran blanc, absence d'erreur console, rendu mobile et absence de token dans l'onglet réseau du navigateur restent à confirmer par vous à l'étape 8.

### Tests utilisateur restant à effectuer (Étape 8)
1. « Charger mes établissements » sur la carte Google Business Profile → vérifier que l'établissement Kaytek apparaît.
2. Associer cet établissement.
3. Contrôle en lecture seule après association (sera fait par moi sur votre confirmation) : `google_location_id`, `location_title`, `selected_at`, `selected_by`, événement `gbp_location_selected`, aucune valeur Vault révélée, aucune modification distante.
4. Le bouton « Charger mes comptes Google Ads » restera bloqué (message « configuration non terminée ») tant que le Developer Token n'est pas ajouté — comportement attendu, pas une anomalie.

### Erreurs Google rencontrées
Aucune — aucun appel Google réel n'a encore été déclenché dans cette session (le listing GBP n'a pas encore été exécuté par un utilisateur réel).

### Commit / push
**Non effectué.** En attente de votre validation des tests manuels (Étape 8) avant l'étape 9, conformément à la règle « ne committe et ne pousse qu'après validation complète des contrôles locaux et de production ».

### Confirmation
Aucune ressource Google distante (campagne, annonce, groupe d'annonces, budget, mot-clé, fiche, avis, photo, horaire, établissement) n'a été créée, modifiée ou supprimée à aucune étape de ce déploiement.
