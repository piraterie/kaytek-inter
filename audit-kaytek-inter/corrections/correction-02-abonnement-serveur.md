# Correction 2 — SEC2-01 : blocage des abonnements appliqué côté serveur

**Date** : 2026-07-22
**Branche** : `capacitor-android`
**Statut** : Correction appliquée (migration + 3 Edge Functions + 2 fichiers frontend), non commitée, non déployée, aucune opération distante exécutée.

---

## 1. Problème initial

Le blocage d'un abonnement expiré/annulé/impayé n'existait que côté frontend : `Guard`/`SubscriptionBlockedScreen` (`src/App.tsx`) affichait un écran de blocage si `subscriptionBlocked` (calculé par `fetchSubscriptionBlocked()`, `src/lib/subscription.ts`) était vrai. **Aucune policy RLS ne référençait `subscription_status`**, et **les 7 Edge Functions utilisent toutes un client `service_role`** pour leur opération réelle — un fait confirmé dans cette session par lecture du code de chacune (`envoyer-email`, `inviter-intervenant`, `send-push`, `send-telegram`, `supprimer-utilisateur`, `send-reminders`, `get-public-document`). Un JWT valide suffisait donc à contourner entièrement le blocage via un appel API direct ou un appel d'Edge Function, indépendamment du statut réel de l'abonnement.

## 2. Règles métier retenues

- **Option B validée** : lecture toujours autorisée (aucun SELECT modifié) ; création et modification de données métier bloquées pour une organisation dont l'abonnement n'est plus valide ; suppression non bloquée globalement (peut servir à réduire/fermer un compte) ; réactivation et documents publics déjà envoyés toujours accessibles.
- **Statuts autorisant l'écriture** : `active`, ou `trialing` avec `trial_ends_at IS NULL` ou `trial_ends_at > now()`. `past_due`, `unpaid`, `canceled` bloquent immédiatement — **`current_period_end` n'est volontairement pas pris en compte** dans cette correction (reproduit strictement la règle frontend actuelle, `isSubscriptionAccessAllowed()`).
- **Absence de ligne `subscriptions` liée à l'organisation** → accès autorisé (fail-open historique, nécessaire pour `kaytek-inter` et toute organisation pré-Stripe). Ce fail-open ne s'applique **jamais** à : un profil absent, un utilisateur non authentifié, un profil désactivé, une organisation désactivée/inexistante, ou une organisation dont l'abonnement existe mais est bloqué.
- **`organisations.actif = false`** intégré au helper — voir **SEC2-04** ci-dessous.

### SEC2-04 — `organisations.actif` jamais vérifié avant cette correction

- **Gravité** : Faible-Moyenne (découverte connexe, hors périmètre initial de SEC2-01)
- **Description** : la colonne `organisations.actif` existe depuis la création de la table (`20260610000001_create_organisations.sql`) mais **n'était vérifiée nulle part** — ni dans une policy RLS, ni côté frontend, ni dans une RPC. Une organisation désactivée conservait donc un accès complet en écriture.
- **Correction** : `current_organisation_has_app_access()` vérifie désormais `o.actif = true` en plus du statut d'abonnement, coût marginal nul puisque `organisations` est de toute façon jointe pour dériver l'organisation de l'appelant.
- **Statut** : corrigé par cette même migration, documenté séparément comme demandé plutôt que traité silencieusement.

## 3. Logique exacte du fail-open historique

`isSubscriptionAccessAllowed()` (frontend, inchangé) : `active` → autorisé ; `trialing` → autorisé si `trial_ends_at` NULL ou futur ; tout le reste → bloqué. La RPC frontend `get_my_organisation_subscription_status()` utilise un `JOIN` (pas `LEFT JOIN`) entre `subscriptions` et `profiles` : si aucune ligne `subscriptions` n'est liée à l'organisation, la RPC ne renvoie **aucune ligne**, et `fetchSubscriptionBlocked()` traite explicitement ce cas comme "jamais bloqué" (commentaire dans le code source). C'est ce comportement précis que `current_organisation_has_app_access()` reproduit ci-dessous — mais avec une logique `EXISTS`/`NOT EXISTS` déterministe plutôt qu'un `JOIN ... LIMIT 1`, qui serait non déterministe si plusieurs lignes `subscriptions` existaient pour la même organisation (voir **DB-06**).

## 4. Fonction SQL finale

```sql
CREATE OR REPLACE FUNCTION public.current_organisation_has_app_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        NOT EXISTS (
          SELECT 1 FROM public.subscriptions s WHERE s.organisation_id = o.id
        )
        OR EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.organisation_id = o.id
            AND (
              s.subscription_status = 'active'
              OR (
                s.subscription_status = 'trialing'
                AND (s.trial_ends_at IS NULL OR s.trial_ends_at > now())
              )
            )
        )
      FROM public.profiles p
      JOIN public.organisations o ON o.id = p.organisation_id
      WHERE p.id = auth.uid()
        AND p.actif = true
        AND o.actif = true
    ),
    false
  )
$$;
```

**Déterminisme** : `profiles.id` est la clé primaire — au plus une ligne `(p, o)` possible, aucune ambiguïté d'ordre. La présence d'un abonnement valide est testée par `EXISTS`/`NOT EXISTS` (jamais `ORDER BY`/`LIMIT 1`), donc le résultat ne dépend jamais de l'ordre physique des lignes `subscriptions`, y compris lorsque plusieurs lignes existent pour la même organisation.

**Échec fermé** : `auth.uid()` NULL, profil absent, profil inactif ou organisation inactive → la sous-requête ne renvoie aucune ligne → `COALESCE(..., false)`.

**Privilèges** (vérifiés puis accordés explicitement — PostgreSQL accorde `EXECUTE` à `PUBLIC` par défaut sur toute nouvelle fonction) :
```sql
REVOKE ALL ON FUNCTION public.current_organisation_has_app_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organisation_has_app_access() TO service_role;
```
Aucun `GRANT` à `anon`.

### DB-06 — Aucune contrainte d'unicité sur `subscriptions.organisation_id`

- **Gravité** : Faible (dette de schéma, pas une faille de sécurité)
- **Description** : `subscriptions` a `user_id` comme clé primaire (portée individuelle), sans contrainte `UNIQUE`/`EXCLUDE` sur `organisation_id` — plusieurs utilisateurs distincts pourraient chacun avoir une ligne `subscriptions` liée à la même organisation, avec des statuts potentiellement différents. La fonction ci-dessus gère ce cas explicitement (autorise si **au moins une** ligne est valide) et de façon déterministe, mais le schéma lui-même n'empêche pas la situation.
- **Décision** : **aucune contrainte créée dans cette correction** (risque de casser des données déjà présentes en production, hors périmètre autorisé). Constat documenté séparément pour traitement futur (Phase B).

## 5. RPC finale

```sql
CREATE OR REPLACE FUNCTION public.get_my_app_access_status()
RETURNS TABLE(allowed boolean, has_subscription boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.current_organisation_has_app_access() AS allowed,
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      JOIN public.profiles p ON p.organisation_id = s.organisation_id
      WHERE p.id = auth.uid()
    ) AS has_subscription
$$;
```
Réutilise exclusivement le helper — aucune logique dupliquée. Ne renvoie aucune donnée Stripe (pas de `stripe_customer_id`, email, plan). Mêmes `REVOKE`/`GRANT` que le helper (`authenticated` + `service_role`, jamais `anon`).

## 6. Policies modifiées (P0 + P1)

Toutes reproduisent **exactement** leur définition finale actuelle (reconstruite par lecture exhaustive des migrations existantes — jamais réécrites depuis zéro) et n'ajoutent `AND current_organisation_has_app_access()` que par un `AND` supplémentaire. Aucun contrôle d'organisation, de rôle, de créateur, d'intervenant assigné ou de statut existant n'est retiré.

| Table | Policy | Opération | Référence de la définition reprise |
|---|---|---|---|
| `clients` | `clients_insert` | INSERT | `20260714000007_fix_clients_select_for_creator.sql` |
| `clients` | `clients_update` | UPDATE (USING + WITH CHECK) | `20260708000007_assistant_role_foundations.sql` |
| `interventions` | `interventions_insert` | INSERT | `20260714000001_intervenant_document_permissions.sql` |
| `interventions` | `interventions_update` | UPDATE | `20260708000007_assistant_role_foundations.sql` |
| `devis` | `devis_insert` / `devis_update` | INSERT/UPDATE | `20260708000008_security_phase1_critical_hardening.sql` (SEC-01) |
| `factures` | `factures_insert` / `factures_update` | INSERT/UPDATE | idem |
| `messages` | `messages_insert` | INSERT uniquement | `20260610000020_rls_phase4_photos_messages.sql` |
| `photos` | `photos_insert` | INSERT uniquement (pas de policy UPDATE existante) | idem |
| `document_public_links` | `org_insert` | INSERT uniquement | `20260708000008` (SEC-03) |
| `commissions` | `commissions_insert` / `commissions_update` | INSERT/UPDATE | insert : SEC-01 ; update : `20260610000025_rls_phase6_profiles_commissions.sql` (inchangée depuis) |
| `commission_receipts` | `cr_insert` / `cr_update` | INSERT/UPDATE | `20260708000008` (SEC-01) |

**`messages_update`** (marquer un message comme lu) : **volontairement non modifiée**. Distinguer proprement "marquer lu" d'une autre mutation dans cette policy aurait nécessité une condition sur les colonnes réellement modifiées (`WITH CHECK` ne peut pas comparer facilement `OLD`/`NEW` colonne par colonne sans dupliquer significativement la policy) — jugé trop complexe pour cette correction. **Limite documentée** : un abonnement bloqué n'empêche donc pas de marquer un message existant comme lu, ce qui est acceptable au regard de l'objectif (empêcher la création de nouvelle valeur, pas dégrader l'usage résiduel).

### Storage (INSERT/UPDATE uniquement, SELECT jamais touché)

Reconstruction de l'état final confirmée : les policies légitimes datent de `20260610000030_storage_rls_phase8.sql` et n'ont plus été retouchées depuis (le `DROP` de `20260711000002_drop_orphaned_storage_admin_policies.sql` ne visait que 11 policies orphelines de noms différents — `logos_*_admin`, `pdfs_*_admin`, `photos_delete_admin`, `photos_insert_own`, `photos_select_own`, `signatures_delete_admin`, `signatures_select_admin`, `media_read`, `media_upload` — aucune ne recoupe les policies modifiées ici).

| Bucket | Policy modifiée | Opération |
|---|---|---|
| `intervention-photos` | `intervention_photos_insert` | INSERT |
| `signatures` | `signatures_insert`, `signatures_update` | INSERT, UPDATE (upsert) |
| `chat-media` | `chat_media_insert` | INSERT |

Aucune policy `SELECT` (téléchargement, URLs signées existantes) n'a été touchée sur aucun bucket. `logos`, `guide-videos`, `pdf-documents` : non modifiés.

## 7. Policies volontairement non modifiées

`profiles`, `organisations`, `subscriptions`, `stripe_webhook_events`, `founder_seats`, `prestations`, `parametres_entreprise`, `notifications`, `devices`, `push_subscriptions`, `guide_progress`, `journal` — aucune policy touchée. Toutes les policies `SELECT` (sur toutes les tables et buckets, y compris ceux modifiés en écriture) et toutes les policies `DELETE` (sur toutes les tables) sont **inchangées**, conformément aux règles 6/7 de cette correction.

## 8. Edge Functions

### Bloquées (RPC + 403 `subscription_inactive`)

`envoyer-email`, `inviter-intervenant`, `send-reminders`. Ordre appliqué dans les trois, strictement conforme à l'instruction : **1)** validation du JWT (`userClient.auth.getUser()`, client anon + header `Authorization` du JWT reçu — inchangé) → **2)** appel de `get_my_app_access_status()` **avec ce même client utilisateur**, jamais avec le client `service_role` → **3)** refus `403 { error: 'subscription_inactive', message: '...' }` si `allowed` est faux ou si la RPC échoue elle-même (échec fermé, volontairement différent du fail-open frontend : ces fonctions déclenchent une action réelle) → **4)** seulement ensuite, création du client `service_role` et exécution de l'action métier (recherche du document/profil, appel Brevo, etc.), strictement inchangée sinon.

Aucune donnée Stripe détaillée n'est renvoyée au client (`allowed`/`has_subscription` uniquement, jamais de statut Stripe brut ni d'identifiant).

### Volontairement non bloquées (décision métier explicite)

| Fonction | Justification |
|---|---|
| `send-push` | Relais secondaire, chemin interne (secret Vault/trigger DB) sans notion d'organisation appelante comparable |
| `send-telegram` | Idem, faible valeur d'abus |
| `supprimer-utilisateur` | Peut servir à réduire/clôturer un compte — bloquer irait à l'encontre de l'objectif |
| `get-public-document` | Public par conception, `service_role`, aucun JWT — **un lien déjà envoyé à un client final ne doit jamais devenir inaccessible parce que l'entreprise émettrice a un impayé** |

Ces 4 fonctions restent accessibles avec un abonnement inactif, par décision produit explicite et non par oubli.

## 9. Frontend

`Guard`/`SubscriptionBlockedScreen` (`src/App.tsx`) : **inchangés**. Modifications strictement limitées à la gestion du code `subscription_inactive` désormais possible en retour des 3 Edge Functions bloquées :

- `src/lib/supabase/auth.ts` — `extractFunctionErrorMessage()` (déjà utilisée par `envoyerEmail()`/`inviterIntervenant()`) reconnaît désormais `body.error === 'subscription_inactive'` et affiche `body.message` (le texte humain) plutôt que le code machine ; exportée pour être réutilisable.
- `src/pages/PlanningPage.tsx` — `checkRappels()` ignorait entièrement `error` avant cette correction (seul `data` était déstructuré) ; ajout du destructuring de `error` et de l'appel à `extractFunctionErrorMessage()` **uniquement** pour afficher un message compréhensible en cas d'échec (pas de refonte de la gestion d'erreur existante par ailleurs).

Message affiché : *« L'abonnement de votre organisation ne permet plus cette action. »* (Edge Functions) — aucune erreur PostgreSQL brute n'est exposée à l'utilisateur dans ces chemins.

**Amélioration future non traitée ici** : l'état d'abonnement (`subscriptionBlocked`) n'est aujourd'hui rechargé qu'au chargement de l'app ou à la reconnexion (`fetchSubscriptionBlocked()` appelé dans `initAuth`) — aucun rafraîchissement automatique après un paiement réussi côté site externe. Documenté comme amélioration UX distincte, volontairement non développée dans cette correction serveur.

## 10. Storage — détail des policies modifiées

Voir §6. Rappel : seules les policies `INSERT`/`UPDATE` des 3 buckets validés sont modifiées ; toutes les policies `SELECT` (téléchargement, régénération de signed URL immédiatement après upload) restent identiques à `20260610000030`.

## 11. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `supabase/migrations/20260722000001_subscription_access_enforcement.sql` **(nouveau)** | Fonction, RPC, grants, 15 policies de mutation (tables) + 4 policies Storage, assertions statiques |
| `supabase/functions/envoyer-email/index.ts` | Vérification RPC + 403 `subscription_inactive` avant service_role |
| `supabase/functions/inviter-intervenant/index.ts` | Idem |
| `supabase/functions/send-reminders/index.ts` | Idem |
| `src/lib/supabase/auth.ts` | `extractFunctionErrorMessage()` : gestion du code `subscription_inactive`, exportée |
| `src/pages/PlanningPage.tsx` | `checkRappels()` : gestion d'erreur minimale sur `send-reminders` |

Fichiers de la **Correction 1** (`package.json`, `src/lib/hooks/index.ts`, `src/lib/pdf/generator.tsx`, `src/pages/DevisApercuPage.tsx`, `src/pages/DevisFormPage.tsx`, `src/lib/devisCalc.ts`/`.test.ts`, `vitest.config.ts`) : **aucun n'a été retouché** — confirmé par `git status` avant et après cette correction (diff identique sur ces fichiers).

## 12. Tests

### Tests SQL locaux (écrits, **non exécutés**)

Fichier : `audit-kaytek-inter/corrections/tests/correction-02-helper-tests.sql`. Couvre : utilisateur anonyme, profil absent, profil actif/inactif, organisation active/inactive, aucune ligne `subscriptions` (fail-open), `active`, `trialing` (essai NULL/valide/expiré), `past_due`, `unpaid`, `canceled`, plusieurs lignes `subscriptions` (une valide + une bloquée, toutes bloquées, une seule valide parmi plusieurs — DB-06), et `get_my_app_access_status()`. Enveloppé dans `BEGIN ... ROLLBACK` (aucune donnée de test ne persiste même en cas d'exécution accidentelle).

**Non exécuté** : cet environnement ne dispose pas d'un Docker démarré (`docker ps` → `failed to connect to the docker API`), donc `supabase start` (stack locale) n'a pas pu être lancé, et aucun projet Supabase de test distinct n'était disponible. **Aucune exécution contre la production n'a été tentée ni n'était envisagée.** Commandes à exécuter avant la prochaine revue :
```
supabase start
psql "$(supabase status -o json | jq -r '.DB_URL')" -f audit-kaytek-inter/corrections/tests/correction-02-helper-tests.sql
```

### Tests RLS par table / Storage

**Non exécutés**, pour la même raison (aucune base locale disponible dans cet environnement). Stratégie documentée dans l'analyse préalable (§7 de l'analyse) : SELECT toujours autorisé, INSERT/UPDATE refusés pour organisation bloquée, comportement inchangé pour organisation active, `organisation_id` falsifié toujours refusé, cross-tenant toujours refusé, upload Storage bloqué / téléchargement autorisé.

### Tests Edge Functions

**Non exécutés** — nécessiteraient soit une base locale (ci-dessus) soit un déploiement (exclu par les règles de cette correction). Vérification effectuée à la place : **relecture manuelle complète des 3 fichiers modifiés**, confirmant que l'ordre JWT → RPC (client utilisateur) → 403 → service_role est respecté, et qu'aucun email/invitation/rappel réel n'est déclenché par cette relecture (aucune fonction n'a été invoquée).

### Ce qui a été réellement exécuté dans cette session

- `npm run typecheck` → **une seule erreur, identique et pré-existante** (`DevisFormPage.tsx:191`, déjà documentée et prouvée pré-existante dans la Correction 1) — aucune nouvelle erreur.
- `npm run build` → succès (`✓ built in 12.10s`), precache PWA 3690.70 KiB (vs 3690.51 KiB avant cette correction — différence négligeable, cohérente avec les 2 petits fichiers frontend modifiés).
- `npx vitest run` → **42/42 tests toujours passants** (suite de la Correction 1, non affectée).
- **Note** : `supabase/functions/*` (Deno) ne sont couvertes ni par `tsconfig.json` (`include: ["src"]` uniquement) ni par un `deno check` (Deno CLI absent de cet environnement — `deno: command not found`). Les 3 Edge Functions modifiées n'ont donc pu être vérifiées que par relecture manuelle, pas par un compilateur/typechecker — **limite explicitement signalée**, pas dissimulée.

## 13. Éléments non vérifiables

- Comportement réel en production (aucun test dynamique, aucune Edge Function invoquée, aucune migration appliquée à distance).
- Le mécanisme exact de synchronisation Stripe → `subscriptions` côté site externe (kaytekinter.fr, hors dépôt) — non affecté par cette correction mais toujours hors périmètre auditable.
- `founder_seats` (structure/policies complètes, table externe).
- Le comportement réel de `auth.uid()`/GUC `request.jwt.claim.sub` sur l'instance Supabase précise du projet pour la simulation utilisée dans les tests SQL locaux (pattern standard Supabase, non revérifié faute d'environnement local démarré).

## 14. Risques restants

- **Tests non exécutés** : cette correction n'a pas pu être validée par exécution réelle (Docker indisponible dans cet environnement) — risque principal résiduel. Les tests écrits doivent être exécutés avant tout déploiement.
- **DB-06** (plusieurs abonnements possibles par organisation) : dette de schéma documentée, non corrigée par choix (risque de casser des données existantes).
- **SEC2-04** (`organisations.actif`) : corrigé dans cette même migration, mais élargit légèrement le périmètre initial de SEC2-01 — à valider que ce comportement est bien souhaité en pratique (aucune organisation réelle actuellement désactivée n'est connue depuis ce dépôt).
- `messages_update` reste non protégée par le nouveau helper (limite documentée §6) — un abonnement bloqué n'empêche pas de marquer un message comme lu.
- Edge Functions non vérifiées par un typechecker Deno (limite d'outillage de cet environnement, pas du code).

## 15. Stratégie de rollback

Purement additif, aucune donnée touchée :
```sql
-- Revenir sur les policies : ré-appliquer les migrations qui les définissaient
-- avant cette correction (ou reproduire leur texte sans "AND current_organisation_has_app_access()"),
-- puis :
DROP FUNCTION IF EXISTS public.get_my_app_access_status();
DROP FUNCTION IF EXISTS public.current_organisation_has_app_access();
```
Côté code :
```
git checkout -- supabase/functions/envoyer-email/index.ts supabase/functions/inviter-intervenant/index.ts supabase/functions/send-reminders/index.ts src/lib/supabase/auth.ts src/pages/PlanningPage.tsx
rm supabase/migrations/20260722000001_subscription_access_enforcement.sql
rm -r audit-kaytek-inter/corrections/tests/correction-02-helper-tests.sql
```

## 16. Commandes de déploiement futures (documentées, non exécutées)

```
supabase db push          # applique la migration — à exécuter uniquement après tests locaux validés
supabase functions deploy envoyer-email
supabase functions deploy inviter-intervenant
supabase functions deploy send-reminders
```
Aucune de ces commandes n'a été exécutée dans cette session.

---

**Correction 2 terminée. Je n'ai pas commencé la correction suivante. J'attends votre autorisation.**
