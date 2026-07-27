# Phase 2 — Rapport OAuth Google réel (local uniquement, non committé)

Branche : `feature/google-ads-gbp-phase1-foundations`. Commit de départ
vérifié : `1755e92cf75d3a1081a331318f7c0251c8bdc3dc` (Phase 1). Aucun commit
créé pour la Phase 2 à ce stade — en attente d'autorisation séparée.

---

## 1. Architecture

Flux OAuth entièrement piloté serveur (Edge Functions), jamais de token
côté navigateur :

```
Frontend (admin)                Edge Functions                     Google
─────────────────                ──────────────                    ──────
IntegrationsGooglePage
  → useConnectGoogle() ───POST──→ google-oauth-start
                                    - vérifie JWT + admin actif
                                    - dérive organisation_id (auth.uid())
                                    - crée google_oauth_states (nonce)
                                    - signe state (HMAC)
                                  ←── { authUrl } ───
  window.location.href = authUrl ──────────────────────────────→ accounts.google.com
                                                                    (consentement)
                                  ←──── redirect (code, state) ────
                                 google-oauth-callback
                                    - vérifie state (signature/expiration/
                                      usage unique/org-provider-uid)
                                    - échange code→tokens (serveur)
                                    - userinfo (email, affichage)
                                    - stocke tokens via Vault
                                    - upsert google_ads_connections /
                                      gbp_connections (métadonnées seules)
  ←── redirect 302 (provider, google_status) ──
IntegrationsGooglePage
  (lit les query params, toast, refetch statut)
  → useGoogleOAuthStatus() ──GET──→ google-oauth-status
                                    - renouvelle l'access token si besoin
                                      (ensureFreshAccessToken, best-effort)
                                    - retourne métadonnées non sensibles
  → useDisconnectGoogle() ──POST──→ google-oauth-disconnect
                                    - révoque côté Google (best-effort)
                                    - supprime les secrets Vault
                                    - passe status='disconnected'
```

---

## 2. Fichiers Phase 2 (à distinguer strictement des fichiers préexistants non liés listés en §16)

**Nouveaux :**
- `supabase/migrations/20260728000006_google_oauth_phase2_foundations.sql`
- `supabase/functions/_shared/google-oauth.ts` (module partagé)
- `supabase/functions/_shared/google-oauth-refresh.ts` (helper renouvellement)
- `supabase/functions/_shared/google-oauth-state.test.ts` (tests Deno)
- `supabase/functions/_shared/google-oauth-refresh.test.ts` (tests Deno)
- `supabase/functions/google-oauth-start/index.ts`
- `supabase/functions/google-oauth-callback/index.ts`
- `supabase/functions/google-oauth-disconnect/index.ts`
- `supabase/functions/google-oauth-status/index.ts`
- `supabase/functions/.env.example` (noms de variables uniquement — gitignored comme `.env.test.example`, voir §14)
- `src/lib/hooks/googleIntegrations.ts`
- `src/pages/IntegrationsGooglePage.tsx`
- `audit-kaytek-inter/corrections/tests/correction-07-google-oauth-phase2-tests.sql`
- `audit-kaytek-inter/google-integrations/phase-2-google-oauth-setup.md`
- `audit-kaytek-inter/google-integrations/phase-2-oauth-report.md` (ce fichier)

**Modifiés :**
- `src/App.tsx` (route `parametres/integrations`, import lazy)
- `src/components/layout/AppLayout.tsx` (entrée NAV admin-only)
- `scripts/run-security-sql-tests.mjs` (enregistrement Correction 7)

**Structure des tables Phase 1 analysée avant toute écriture** (§3 de votre demande) : structure jugée compatible, complétée de façon strictement additive (voir §5) — aucune colonne/contrainte/policy Phase 1 retirée ou restreinte.

---

## 3. URI de callback

| URI | Valeur |
|---|---|
| Locale | `http://127.0.0.1:54321/functions/v1/google-oauth-callback` |
| Production | `https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/google-oauth-callback` |

Un seul callback partagé pour les deux providers (différenciés par `provider` dans le state signé) — réduit le nombre d'URI à enregistrer chez Google, donc le risque de `redirect_uri_mismatch`. Détail complet : `phase-2-google-oauth-setup.md`.

## 4. Scopes

- Toujours demandés : `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (identité affichée uniquement, jamais utilisés pour une décision d'autorisation interne).
- Google Ads : `.../auth/adwords` (seul, jamais combiné à Business Profile dans la même autorisation).
- Google Business Profile : `.../auth/business.manage` (seul).

## 5. Modèle de données — additif uniquement

| Élément | Nature | Détail |
|---|---|---|
| `google_oauth_states` | Nouvelle table | nonce, organisation_id, provider, requested_by, expires_at, consumed_at — deny-all RLS |
| `google_ads_connections.google_account_email` / `gbp_connections.google_account_email` | Colonne ajoutée | `ADD COLUMN IF NOT EXISTS`, nullable — affichage uniquement |
| `google_ads_connections.access_token_secret_id` / `refresh_token_secret_id` | **Inchangées** (déjà `uuid REFERENCES vault.secrets(id)` depuis Phase 1) | Confirmé lors de l'analyse préalable : jamais de colonne texte en clair, ni en Phase 1 ni en Phase 2 |
| `google_ads_connection_status` / `gbp_connection_status` (vues) | Recréées (`CREATE OR REPLACE`) | Ajout de `google_account_email` en dernière position (contrainte Postgres sur l'ordre des colonnes d'une vue), REVOKE/vérification bloquante reconduits à l'identique |
| `public.google_oauth_vault_create/update/read/delete` | Nouvelles fonctions | Wrappers `SECURITY DEFINER` vers `vault.*` (non exposé par PostgREST), `service_role` uniquement |

Aucune policy RLS existante élargie (règle #17) — toutes les policies Phase 1 restent identiques ; les seules nouvelles policies concernent la nouvelle table `google_oauth_states` (deny-all, plus restrictif que tout le reste, pas un élargissement) et les nouvelles fonctions Vault (service_role uniquement).

## 6. State OAuth

Format : `base64url(JSON{nonce, org, provider, uid, exp}).base64url(HMAC-SHA256(payload))`, clé `GOOGLE_OAUTH_STATE_SECRET`.
- **Signé** : `crypto.subtle.sign`/`verify` (comparaison en temps constant, jamais une comparaison de chaînes manuelle).
- **Expirant** : `exp` embarqué (10 min) + revérifié contre `expires_at` en base.
- **Usage unique** : `UPDATE ... SET consumed_at = now() WHERE id = ... AND consumed_at IS NULL` — consommé **avant** l'échange du code, sert aussi de verrou anti-concurrence.
- **Anti-substitution d'organisation** : `organisation_id`/`provider`/`requested_by` du payload signé revérifiés contre la ligne `google_oauth_states` correspondante (double contrôle).

## 7. Stockage Vault

Inchangé par rapport à la conception Phase 1 (table privée + colonnes `*_secret_id`), complété par les wrappers `public.google_oauth_vault_*` nécessaires car `vault.*` n'est pas exposé par PostgREST (seul le schéma `public` l'est) — les Edge Functions (client `service_role` via supabase-js) ne peuvent donc appeler `vault.create_secret()`/`update_secret()` qu'au travers de ces wrappers, sur le modèle exact de `get_internal_push_secret()`.

## 8. Renouvellement des jetons

`_shared/google-oauth-refresh.ts` → `ensureFreshAccessToken(svc, provider, organisationId)` : renouvelle si expiration < 2 min, sinon no-op (`fresh`, zéro appel réseau — testé). Marque `expired` + `last_error` si `invalid_grant` (refresh_token révoqué). **Ne renvoie jamais de token** — uniquement un statut. Appelé à la demande depuis `google-oauth-status` (pas de `pg_cron`, aucune nécessité démontrée pour une tâche planifiée en Phase 2).

## 9. Séparation Google Ads / Google Business Profile

- Scopes jamais combinés dans une même autorisation (deux appels `google-oauth-start` distincts, un par provider).
- Deux tables séparées (héritées de Phase 1), deux connexions indépendantes par organisation — une org peut connecter l'un sans l'autre.
- **Comptes gestionnaires Google Ads (MCC) / `login_customer_id`** : `google_ads_connections.google_login_customer_id` existe depuis Phase 1 mais n'est pas encore renseigné par cette Phase 2 (aucun appel à l'API Google Ads elle-même, uniquement l'échange OAuth) — à peupler en Phase 3, quand l'utilisateur sélectionnera son compte Ads précis parmi ceux accessibles.
- **Plusieurs comptes Ads / plusieurs établissements GBP par organisation** : hors périmètre Phase 2 — le schéma actuel (`organisation_id UNIQUE`) suppose une connexion par provider et par organisation ; gérer plusieurs comptes nécessiterait de lever cette contrainte `UNIQUE` en Phase 3, décision à prendre avec vous le moment venu (pas fait ici, aucune nécessité démontrée maintenant).
- Aucune campagne, aucun avis, aucun établissement récupéré au-delà du strict nécessaire (l'e-mail du compte, via l'endpoint OpenID Connect déjà inclus dans le flux d'authentification lui-même — aucun appel Ads/Business Profile séparé).

## 10. Contrôles admin

`requireActiveAdmin()` (module partagé), appliqué aux 4 Edge Functions : JWT valide → `profiles.role = 'admin' AND profiles.actif = true` → `organisation_id` dérivé de cette même ligne. Aucune des 4 fonctions ne lit `organisation_id` (ou équivalent) depuis le corps de la requête — vérifié explicitement par grep sur les 4 fichiers (voir §12, tous les usages proviennent de `auth.organisationId` ou du state signé+vérifié en base).

## 11. Isolation multi-tenant

- Tables `google_oauth_states`, `google_ads_connections`, `gbp_connections` : RLS deny-all pour `anon`/`authenticated` — testé comportementalement (Corrections 6 et 7), y compris pour l'admin propriétaire de la ligne.
- Vues de statut : `WHERE organisation_id = current_org_id() AND is_admin_in_org(...)` — testé cross-org (admin B ne voit jamais l'email/statut de l'org A).
- Toutes les opérations d'écriture (`disconnect`, upsert du callback) sont scopées par `organisation_id = auth.organisationId`, dérivé serveur, jamais transmis par le client.

## 12. Frontend

`IntegrationsGooglePage.tsx` (route `/parametres/integrations`, `<Guard adminOnly>`, entrée NAV `adminOnly: true` → invisible pour assistant/intervenant, cohérent avec `/parametres`/`/partenaires`). N'appelle que `google-oauth-start`/`-status`/`-disconnect` via `supabase.functions.invoke` — jamais un `from('google_ads_connections')` direct, jamais un token manipulé côté client (`useConnectGoogle` ne reçoit qu'une `authUrl`, jamais un secret).

## 13. Tests ajoutés — ce qui a été RÉELLEMENT exécuté

| Couche | Fichier | Exécuté via | Résultat |
|---|---|---|---|
| State OAuth (signature/expiration/rejeu/format) | `_shared/google-oauth-state.test.ts` | `deno test --allow-env` (Deno installé pour cette session) | **8/8 OK**, zéro accès réseau (permission `--allow-env` seule accordée — le sandbox Deno lui-même rend un appel réseau impossible, pas seulement le code) |
| Renouvellement de token (valide/expiré/refusé) | `_shared/google-oauth-refresh.test.ts` | `deno test --allow-env`, `fetch` entièrement remplacé par un mock local | **5/5 OK**, chaque scénario vérifie explicitement l'absence d'appel réseau ou le contenu exact de la requête simulée |
| Type-checking des 4 Edge Functions | — | `deno check` sur chacune | **0 erreur** |
| RLS/Vault/isolation (DB) | `correction-07-google-oauth-phase2-tests.sql` | `npm run test:security:sql` (base locale) | **OK**, intégré à la suite permanente |

### Ce qui n'a PAS pu être exécuté en conditions réelles, et pourquoi

- **La logique complète des 4 Edge Functions via HTTP** (auth guard + happy path) n'a pas été testée par appel HTTP réel : aucun conteneur `edge-runtime` n'est démarré dans ce sandbox local (confirmé : `docker ps` ne liste que postgres/kong/auth/storage/etc., pas de runtime de fonctions — la suite `test:security:edge-functions` existante de ce dépôt le confirme aussi indirectement, ses scénarios « refus » passent y compris avec un statut 503, signe qu'aucune fonction n'y répond réellement dans cet environnement). Démarrer `supabase functions serve` était possible mais aurait nécessité soit des secrets réels (aucun disponible/souhaité à ce stade), soit un risque de contact réseau réel vers Google pour les chemins non purement auth-guard (`google-oauth-disconnect`/`-status` avec une connexion existante déclenchent un appel Google best-effort) — **exclu par la règle #20**.
- J'ai donc concentré les tests exécutés sur (a) la logique pure sans dépendance réseau/DB (state, refresh — la partie la plus critique et la plus nouvelle), (b) la frontière RLS/Vault (la garantie ultime, qui protège même en cas de bug applicatif dans les Edge Functions), et (c) le type-checking complet.
- **Recommandation avant déploiement réel** : ajouter une suite HTTP dédiée (sur le modèle de `test-security-edge-functions.mjs`) une fois `supabase functions serve` disponible dans l'environnement de CI/déploiement, couvrant au minimum les scénarios d'authentification (sans JWT/JWT invalide/assistant/intervenant/admin) pour les 4 fonctions — ces scénarios ne contactent jamais Google (échec avant tout `fetch` sortant), donc sans risque vis-à-vis de la règle #20.

## 14. Résultats des suites existantes (exécutées après les ajouts Phase 2)

```
npm run test:unit             → 42/42 OK (vitest, inchangé)
npm run test:security:sql     → 7/7 fichiers OK (Corrections 2 à 7)
npm run test:security:storage → 6 PASS / 0 FAIL / 1 WARN (fixture non liée, pré-existant)
npm run test:security:edge-functions → 6 PASS / 0 FAIL / 3 WARN (idem)
npm run test:security:concurrency    → 2 PASS / 0 FAIL / 1 WARN (idem)
npm run test:security:playwright     → 14/14 OK
npm run test:security         → EXIT CODE 0 (suite complète chaînée)
npm run build                 → succès (« ✓ built in 18.38s »), chunk IntegrationsGooglePage-*.js généré
```
Aucun nouvel échec transformé en WARN — tous les WARN listés ci-dessus préexistaient avant cette session (fixture `subscriptions` absente, non liée à Google).

**Un seul défaut détecté, non lié à ce travail** : `npm run typecheck` (`tsc --noEmit`) rapporte 1 erreur dans `src/pages/DevisFormPage.tsx:170` — fichier jamais modifié par cette session ni la précédente (`git diff HEAD -- src/pages/DevisFormPage.tsx` vide, dernier commit sur ce fichier daté du 2026-07-13). Confirmé pré-existant et sans rapport avec Google/OAuth ; non corrigé (hors périmètre, règle « ne pas toucher aux fichiers non liés »). `npm run build` n'est pas affecté (Vite ne fait pas de type-checking complet).

## 15. Limites restantes / actions Google Cloud à faire

- Client ID/Secret OAuth non créés (attendait cette analyse — voir `phase-2-google-oauth-setup.md`).
- `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_STATE_SECRET` et les autres secrets non générés/définis.
- Aucune Edge Function servie (`supabase functions serve`) ni déployée dans ce sandbox — code écrit et type-checké, jamais exécuté contre un vrai Google.
- `google_customer_id`/`google_login_customer_id`/établissement GBP précis non peuplés (nécessite un appel API Phase 3, hors périmètre).
- Gestion multi-comptes (plusieurs comptes Ads ou établissements GBP par organisation) non implémentée — actuellement 1 connexion par provider par organisation (contrainte `UNIQUE` héritée de Phase 1).
- Suite de tests HTTP live des Edge Functions non exécutée (voir §13) — recommandée avant tout déploiement en environnement où `supabase functions serve`/CI est disponible.

## 16. Fichiers préexistants non liés — confirmés non touchés

Présents dans `git status` mais **jamais modifiés, ajoutés au staging, ni supprimés** par cette session : captures d'écran `tests/screenshots/isolation-report/*`, logs `.playwright-cli/*`, `android/`, `audit-kaytek-inter/deploiement/`, `audit-kaytek-inter/phase-01-cartographie.md` à `phase-12-rapport-final.md`, `src/lib/devisCalc.ts`/`devisCalc.test.ts`, `supabase/.branches/`, `supabase/migrations/20260604000000_bootstrap_core_schema.sql`.

## 17. Confirmation d'absence de contact production

- Toutes les opérations DB : `docker exec supabase_db_kaytek-final` (conteneur local) ou `SUPABASE_TEST_URL=http://127.0.0.1:54321`.
- Aucun secret réel créé, donc aucun appel Google possible même accidentellement (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` vides → les Edge Functions refusent explicitement de démarrer un flux, voir vérifications `if (!GOOGLE_OAUTH_CLIENT_ID || ...)` dans `google-oauth-start`/`-callback`).
- Tests Deno exécutés avec uniquement `--allow-env` (aucune permission réseau accordée) pour les tests de state ; `fetch` explicitement remplacé par un mock pour les tests de renouvellement — un appel réseau réel aurait fait échouer le test lui-même (assertion explicite `fetchCalled === false` dans plusieurs scénarios).
- Aucun `supabase db push`, aucun `supabase functions deploy`, aucun `git push`.
- Référence de production (`dimrukkxehcwzemslwiz`) présente uniquement dans la documentation (URI à enregistrer côté Google) et dans `scripts/lib/production-guard.mjs` (Phase 1, inchangé) — jamais dans une commande exécutée.

---

## PHASE 2 OAUTH VALIDÉE LOCALEMENT. Les connexions Google Ads et Google Business Profile sont prêtes pour la création du Client OAuth Google Cloud et un déploiement contrôlé. J'attends votre autorisation avant tout commit, push ou déploiement.
