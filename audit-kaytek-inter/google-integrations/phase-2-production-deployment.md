# Phase 2 — Déploiement production (rapport)

Branche : `feature/google-ads-gbp-phase1-foundations`. Commit Phase 1 : `1755e92cf75d3a1081a331318f7c0251c8bdc3dc`. Commit Phase 2 : `ccbd939c184decfe4bd9126412d36253b676a035`. Projet Supabase production : `dimrukkxehcwzemslwiz` (kaytek-inter). Frontend production : `app.kaytekinter.fr` (Vercel, projet `kaytek-final`).

## 1. Divergence initiale du ledger

`supabase migration list --linked` a révélé qu'**aucune des 4 migrations récentes n'était appliquée en production** (ni les 3 de Phase 1 `000003`-`000005`, ni la Phase 2 `000006`), alors que la demande initiale de déploiement ne portait que sur la migration Phase 2 seule. Signalé à l'utilisateur, qui a explicitement étendu l'autorisation aux 4 migrations dans l'ordre exact.

## 2. Autorisation étendue

Confirmée par l'utilisateur : application des 4 migrations dans l'ordre `000003 → 000004 → 000005 → 000006`, une par une avec validation complète après chacune, avant tout déploiement d'Edge Function.

## 3. Audit des 4 migrations (avant écriture)

Voir le tableau complet dans la conversation — synthèse : aucune migration ne suppose une colonne absente inattendue, ne recrée un objet existant, ne contient d'opération destructive. Introspection lecture seule confirmée : tous les objets cibles (tables, vues, fonctions) étaient absents avant application ; tous les prérequis (`current_org_id()`, `is_admin_in_org(uuid)`, `is_same_org(uuid)`, `can_manage_operations(uuid)`, `vault.secrets`, `vault.create_secret()`) étaient présents. Volumétrie production au moment de l'audit : 36 factures, 11 organisations, 51 clients — risque de verrouillage négligeable.

**Contournement technique documenté** : `supabase db push` refuse de s'exécuter (ou exigerait `--include-all`, qui aurait inclus `20260604000000_bootstrap_core_schema.sql`, explicitement hors périmètre) tant que ce fichier non tracké traîne dans `supabase/migrations/`. Il a été déplacé temporairement hors du dossier (empreinte SHA-256 enregistrée avant : `3f413976a1c38a9288aa5db0f489899e6523bf75510ee45252224a397e7036b0`), puis restauré à l'identique immédiatement après les 4 migrations (empreinte vérifiée strictement identique après restauration). Jamais modifié, jamais appliqué, toujours non tracké par Git.

## 4. Ordre d'application

1. `20260728000003_factures_envoyee_le.sql`
2. `20260728000004_google_integrations_foundations.sql`
3. `20260728000005_google_connection_status_views.sql`
4. `20260728000006_google_oauth_phase2_foundations.sql`

## 5. Résultat migration par migration

Chaque migration validée individuellement avant de passer à la suivante (ledger, objets créés, contraintes, policies, privilèges, non-altération des données existantes) — toutes réussies sans exception, sans avertissement inattendu. Les blocs `DO $$ ... RAISE EXCEPTION $$` intégrés aux migrations 000005/000006 ont chacun affiché leur `NOTICE` de succès en production.

## 6. État final du ledger

| Migration | Avant | Après |
|---|---|---|
| `20260728000003` | absente | appliquée |
| `20260728000004` | absente | appliquée |
| `20260728000005` | absente | appliquée |
| `20260728000006` | absente | appliquée |

## 7. Objets Phase 1 créés (vérifiés)

`factures.envoyee_le`, `google_ads_connections`, `gbp_connections`, `gbp_reviews`, `review_requests`, `google_ads_metrics_daily`, `google_oauth_events`, vues `google_ads_connection_status`/`gbp_connection_status`. RLS activée sur les 6 tables, 0 policy pour `anon`/`authenticated` sur les tables privées, 0 colonne token en clair, colonnes `*_secret_id` présentes, `review_requests.facture_id` NOT NULL, policy `review_requests_insert` (liaison stricte à une facture réellement envoyée) présente.

## 8. Objets Phase 2 créés (vérifiés)

`google_oauth_states` (deny-all, 0 policy), colonnes `google_account_email` (2 tables), 4 fonctions `google_oauth_vault_*` — toutes `SECURITY DEFINER`, `search_path` défini, `EXECUTE` refusé à `anon` et `authenticated`, accordé uniquement à `service_role`.

## 9. Privilèges et RLS — 24/24 contrôles automatisés OK

Voir requête complète dans la conversation. Intégrité des données pré-existantes confirmée (36 factures, 11 organisations, 51 clients inchangés après les 4 migrations).

## 10. Edge Functions déployées

| Fonction | JWT requis | Statut | Test auth |
|---|---|---|---|
| `google-oauth-start` | Oui (défaut) | ACTIVE, v1 | 401 sans JWT, 401 JWT invalide |
| `google-oauth-callback` | Non (`--no-verify-jwt`, requis — cible de redirection Google sans en-tête Authorization possible) | ACTIVE, v1 | Callback sans paramètres → 302 propre vers l'URL d'erreur, corps vide, aucune connexion créée |
| `google-oauth-disconnect` | Oui (défaut) | ACTIVE, v1 | 401 sans JWT, 401 JWT invalide |
| `google-oauth-status` | Oui (défaut) | ACTIVE, v1 | 401 sans JWT, 401 JWT invalide |

Logs de déploiement/exécution scannés : aucune trace de `client_secret`, `refresh_token`, `access_token`, `state_secret`, `developer_token`, `service_role` ou mot de passe.

## 11. Frontend déployé

La route `/parametres/integrations` était **absente** du bundle de production avant cette session (vérifié par inspection directe du bundle JS live). `npm run build` exécuté et vérifié (aucune URL locale — hormis une chaîne générique interne à la librairie `@supabase/supabase-js` elle-même sans rapport avec la configuration du projet —, aucun compte de test, aucun secret, aucun artefact Playwright, URL Supabase de production correctement injectée). Déployé via `vercel deploy --prod` (méthode standard du projet, `.vercel/project.json` déjà lié à `kaytek-final`) → aliasé sur `app.kaytekinter.fr`, `readyState: READY`, `target: production`. Bundle live re-vérifié : contient bien les références à la page d'intégrations.

## 12-13. Test OAuth réel — exécuté par l'utilisateur, incident en cours de résolution

Le test interactif a été réalisé par l'utilisateur (authentification réelle requise, hors capacité de l'agent). Historique complet :

1. **1ʳᵉ série (paire OAuth d'origine)** : 3 tentatives `google_business`, toutes échouées à l'échange de token avec l'erreur Google `invalid_client`.
2. **Diagnostic** : Client ID reconnu par Google (écran de consentement atteint), mais `invalid_client` à l'échange → cause identifiée par empreinte SHA-256 : `GOOGLE_OAUTH_CLIENT_SECRET` était resté l'ancien secret déclaré compromis par l'utilisateur, désynchronisé du nouveau `GOOGLE_OAUTH_CLIENT_ID`.
3. **Correction** : import contrôlé de la paire OAuth du nouveau client Google `kaytekweb2` depuis le fichier JSON téléchargé (`C:\Users\Ludol\Downloads\client_secret_...json`), extraction et écriture dans Supabase sans jamais afficher les valeurs, fichier temporaire supprimé immédiatement après usage, fichier JSON original supprimé après confirmation utilisateur. Empreintes des deux secrets confirmées différentes de toutes les valeurs précédentes après import.
4. **2ᵉ tentative (nouvelle paire `kaytekweb2`)** : `invalid_client` disparu — Google reconnaît la nouvelle paire, l'échange de token **réussit**. Nouveau blocage : `vault_storage_failed` (échec du stockage du token dans Vault), sans connexion créée.
5. **Diagnostic Vault (lecture seule)** :
   - Signatures/privilèges des 4 fonctions `google_oauth_vault_*` conformes (owner `postgres`, `SECURITY DEFINER`, `search_path=[public, vault]`, `service_role`=autorisé, `anon`/`authenticated`=refusé).
   - Test SQL direct (transaction annulée, valeur factice `test-oauth-secret-non-sensitive`) : **create/read/update/delete réussissent tous les quatre**.
   - Test RPC via PostgREST avec la clé `anon` (publique) : réponse `401` avec `code 42501 — permission denied` (erreur Postgres de privilège), **pas** une erreur PostgREST « fonction introuvable » (`PGRST2xx`) — preuve directe que le cache de schéma PostgREST connaît et route correctement la fonction. L'hypothèse d'un cache obsolète est donc réfutée par les faits, pas seulement écartée par supposition.
   - Aucun secret factice résiduel après les tests (vérifié).
6. **Conclusion à ce stade** : toute l'infrastructure testable en lecture seule (SQL direct, routage RPC/PostgREST, privilèges) est saine. La cause exacte du `vault_storage_failed` observé lors de la tentative réelle (avec de vrais tokens Google, via le rôle `service_role` que l'agent n'a pas pu tester directement — clé non disponible/non utilisée par choix de sécurité) reste **non confirmée avec certitude** sans accès aux logs d'exécution réels de l'Edge Function (indisponibles via le CLI utilisé dans cet environnement). Hypothèse résiduelle la plus plausible : fenêtre de latence transitoire du cache PostgREST au moment précis de la tentative (18:25 UTC), le cache s'étant depuis avéré à jour. Recommandation : un nouvel essai est le test le plus informatif à ce stade (voir conversation pour le rapport détaillé).

## 14. Absence de tokens en clair
Confirmé structurellement (schéma) et par les 24 contrôles automatisés — non re-testable avec des tokens réels tant que l'étape 12-13 n'a pas été effectuée par vous.

## 15. Absence d'opération destructive
Confirmée — aucun `DROP`, `TRUNCATE`, `DELETE` massif exécuté à aucun moment ; toutes les migrations sont additives ; intégrité des données pré-existantes vérifiée après chaque étape.

## 16. Rollback préparé
Documenté en détail dans la conversation (par migration, ordre inverse, avec mise en garde explicite : ne pas `DROP` les tables de connexion si un test réel a déjà créé des connexions).

## 17. Push effectué
**Non — en attente** (voir section suivante de la conversation).

## 18. Lien de PR
Non applicable — push non encore effectué.

## 19. Confirmation
Aucune campagne Google Ads, aucune fiche Google Business Profile, aucun avis, aucune publication n'a été touché — aucun appel à ces APIs n'a été effectué, la Phase 3 n'a pas démarré.
