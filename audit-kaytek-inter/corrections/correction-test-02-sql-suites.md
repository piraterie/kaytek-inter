# TEST-02 — Correction des tests SQL critiques devenus incompatibles ou invalides après SEC2-02

Exécuté strictement en local (Supabase CLI, `supabase_db_kaytek-final`). Aucune commande n'a jamais touché un projet Supabase distant : `runPreflight()` (déjà en place depuis Correction 6) a validé `SUPABASE_TEST_URL`/`SUPABASE_TEST_DB_URL` comme pointant vers `127.0.0.1` avant chaque exécution. Aucun `supabase db push`, aucun `migration repair`, aucun commit, aucun push, aucun déploiement.

## 1. Fichiers analysés

| Fichier | Défaut initial constaté |
|---|---|
| `correction-02-helper-tests.sql` | Scénario anonyme obsolète (attendait un retour booléen `false`, obtient désormais `permission denied` depuis SEC2-02) |
| `correction-03-partner-rls-tests.sql` | Transition `accepted → pending` invalide sur `partner_connections` (jamais autorisée par le trigger) |
| `correction-03b-partner-preview-rpc-tests.sql` | UUID invalides (préfixes `g`, `h`, `i` — lettres hors `0-9a-f`) |
| `correction-04-numbering-tests.sql` | UUID invalides (préfixes `j`, `k`) |
| `correction-05-commission-tests.sql` | UUID invalides (préfixes `m`, `n`) |

## 2. Correction du scénario anonyme obsolète (Correction 2)

`pg_temp.assert_access()` ne traite plus jamais `p_uid IS NULL` (lève désormais une exception explicite si appelée ainsi, pour empêcher toute régression silencieuse). Un nouveau helper dédié `pg_temp.assert_anon_denied_app_access()` remplace l'ancien scénario et vérifie, sans modifier aucune donnée :
1. `has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE') = false` ;
2. l'appel réel sous `SET LOCAL role = anon` échoue avec `SQLSTATE 42501` (`insufficient_privilege`) — capturé et vérifié explicitement, jamais toléré comme un simple retour ;
3. si l'appel réussissait malgré tout (régression de SEC2-02), le test échoue explicitement (`RAISE EXCEPTION`), jamais un avertissement.

Le refus d'exécution est traité comme un **succès** du test. `SEC2-02` n'a été ni modifiée ni contournée. Exécuté : `SQLSTATE=42501` confirmé, `has_function_privilege=false` confirmé.

## 3. UUID corrigés

| Fichier | Ancien préfixe (invalide) | Nouveau préfixe (hex valide) |
|---|---|---|
| `correction-03b` | `g1`–`g4` | `21`–`24` |
| `correction-03b` | `h1`–`h8` | `31`–`38` |
| `correction-03b` | `i1`–`i5` | `41`–`45` |
| `correction-04` | `j1`, `j2` | `51`, `52` |
| `correction-04` | `k1`–`k3` | `61`–`63` |
| `correction-05` | `m1`, `m2` | `71`, `72` |
| `correction-05` | `n1`–`n4` | `81`–`84` |

Toutes les relations logiques (organisations distinctes, profils, connexions, demandes) sont préservées à l'identique — seul le caractère hexadécimal invalide a été remplacé, jamais la structure ou l'intention du scénario. Aucun UUID de production n'est utilisé (tous fixes, réservés aux tests locaux, format `00000000-0000-0000-0000-0000000000XX`).

## 4. Transitions de statut corrigées

**a) `partner_connections` (ligne `e1`, `correction-03-partner-rls-tests.sql`)**
- Ancien statut : `accepted`
- Transition tentée : `→ pending`
- Rejet : `partner_connections_before_update()` (migration `20260708000002`) n'autorise **aucune** transition vers `pending` autre que l'état initial à la création — `accepted → pending` n'a jamais été valide.
- Séquence retenue : `accepted → blocked` (transition inconditionnelle depuis `accepted`) puis `blocked → accepted` (autorisée, acteur = organisation ayant bloqué) — round-trip valide qui préserve l'intention du test (vérifier que `pir_select` ne relit jamais le statut de la connexion, seulement celui de la demande).

**b) `partner_intervention_requests` (ligne `f2`, même fichier) — second défaut révélé en cours d'exécution**
- Ancien statut : `in_progress`
- Transition tentée : `→ accepted` (tentative de « remise à l'état initial » après le test `accepted → in_progress`)
- Rejet : `partner_intervention_requests_before_update()` (migration `20260708000005`) — le cycle de vie d'une demande d'intervention est intentionnellement à sens unique (`pending → accepted → in_progress → completed`, plus les échappatoires `refused`/`cancelled`) ; aucun retour arrière n'existe, y compris vers `accepted`.
- Séquence retenue : suppression pure et simple de cette remise à l'état invalide — vérifié qu'aucune assertion suivante du fichier ne relit le statut de `f2`, donc le laisser en `in_progress` est sans incidence.

Aucun trigger n'a été désactivé, aucune contrainte affaiblie. Ces deux défauts sont des bugs préexistants du fixture de test (jamais exécuté avec succès jusqu'ici), pas des défauts de logique métier ni des régressions de SEC2-02/TEST5-01 — conforme à la règle d'arrêt (point 18) : aucune vraie faille ni incohérence métier réelle n'a été trouvée, seulement un fixture de test qui présumait à tort des transitions inexistantes.

## 5. Défauts additionnels révélés uniquement par l'exécution réelle (jamais atteints auparavant)

Trois fichiers n'avaient jamais été exécutés avec succès jusqu'à cette correction (bloqués plus tôt par UUID invalides ou absence de `psql`). Leur exécution réelle a révélé des bugs d'isolation/ordonnancement propres au fixture de test, corrigés dans le même esprit que les points 2–4 (jamais de modification de fonction métier, policy ou privilège) :

- **`correction-03-partner-rls-tests.sql` et `correction-03b-partner-preview-rpc-tests.sql`** : le nettoyage explicite tentait de supprimer `public.profiles` avant `public.notifications`, alors que `trg_pir_after_insert_notify` (migration `20260708000005`) crée une ligne de notification à chaque INSERT/transition de `partner_intervention_requests` exécutée par ces fixtures — violation de `notifications_user_id_fkey`. Corrigé en ajoutant `DELETE FROM public.notifications` avant la suppression des profils.
- **`correction-04-numbering-tests.sql`** :
  - `ALTER TABLE public.devis DISABLE/ENABLE TRIGGER` s'exécutait alors que `SET LOCAL role = 'authenticated'` était déjà actif — `authenticated` n'est jamais propriétaire de la table, d'où `must be owner of table devis`. Corrigé en réordonnant : bascule du trigger en tant que `postgres` (avant/après le rôle `authenticated`), seule l'opération applicative (l'INSERT réel) s'exécute sous `authenticated`.
  - Un test de non-réutilisation de numéro lisait `document_counters` directement sous `authenticated`, alors que ce même fichier vérifie par ailleurs (et confirme) que `authenticated` n'a **jamais** de droit `SELECT` sur cette table interne — la lecture du compteur ne peut donc être qu'un artefact du fixture, pas une exigence RLS réelle. Corrigé en lisant le compteur avant/après le bloc `authenticated`, en conservant sous `authenticated` uniquement les opérations réelles sur `public.devis`.

Ces corrections n'ont modifié aucune fonction métier, policy ou privilège — uniquement l'ordonnancement et le nettoyage des fixtures de test elles-mêmes.

## 6. Runner Docker (`scripts/run-security-sql-tests.mjs`)

`psql` natif est absent de cet environnement (Windows/Git-Bash). Le runner détecte maintenant automatiquement ce cas et bascule sur `docker exec -i <conteneur> psql` :
- Le conteneur Postgres est détecté par l'**image** qu'il exécute (ancre stricte `/supabase/postgres:`, distincte de `supabase/postgres-meta` et `supabase/postgrest`) — jamais par un nom de conteneur en dur (`supabase_db_<projet>` dépend du nom du projet). Échec explicite si zéro ou plusieurs conteneurs correspondent.
- Le SQL transite par STDIN (jamais par un chemin de fichier passé au conteneur), pour éviter la conversion de chemin MSYS/Git-Bash sur Windows et rester identique sur toutes les plateformes.
- `ON_ERROR_STOP=1` conservé sur chaque fichier ; nom du fichier affiché avant exécution ; code de sortie non nul propagé au premier échec ; aucun fichier n'est jamais sauté ; `runPreflight()` (hôte local) exécuté avant toute tentative Docker.
- `psql` natif reste le chemin par défaut si disponible (aucune régression sur les environnements où il est installé).

## 7. Résultat par fichier (exécution directe `docker exec`, puis via le runner)

| Fichier | Exécuté | Réussi | Durée (runner) | Rollback | Données restantes |
|---|---|---|---|---|---|
| `correction-02-helper-tests.sql` | oui | oui | 149 ms | oui (`ROLLBACK`) | aucune |
| `correction-03-partner-rls-tests.sql` | oui | oui | 166 ms | oui (`ROLLBACK`) | aucune |
| `correction-03b-partner-preview-rpc-tests.sql` | oui | oui | 176 ms | oui (`ROLLBACK`) | aucune |
| `correction-04-numbering-tests.sql` | oui | oui | 163 ms | oui (`ROLLBACK`) | aucune |
| `correction-05-commission-tests.sql` | oui | oui | 163 ms | oui (`ROLLBACK`) | aucune |

Nombre total d'assertions `RAISE NOTICE 'OK [...]'` observées : 18 (Correction 2) + 21 (Correction 3) + 18 (Correction 3 bis) + 13 (Correction 4) + 34 (Correction 5) = **104 assertions**, toutes réussies, zéro échec, zéro ignoré.

## 8. Résultat global `npm run test:security:sql`

```
[preflight] OK — hôte local confirmé, variables obligatoires présentes.
[test:security:sql] psql natif introuvable dans le PATH — repli sur `docker exec` vers le conteneur Postgres local.
[test:security:sql] psql (via docker exec, conteneur 143cfcf0c885) détecté : psql (PostgreSQL) 17.6
...
[test:security:sql] Résumé :
  - OK   : correction-02-helper-tests.sql
  - OK   : correction-03-partner-rls-tests.sql
  - OK   : correction-03b-partner-preview-rpc-tests.sql
  - OK   : correction-04-numbering-tests.sql
  - OK   : correction-05-commission-tests.sql

[test:security:sql] OK — tous les fichiers de test SQL (Corrections 2 à 5) ont été exécutés avec succès.
```
Code de sortie : `0`. 5 fichiers exécutés, 5 réussis, zéro ignoré, zéro connexion distante (préflight confirmé sur `127.0.0.1` avant chaque exécution).

## 9. Suites critiques restantes (après succès des 5 suites SQL)

| Suite | Statut | Détail |
|---|---|---|
| `npm run test:unit` | ✅ Réussi | 42/42 tests (`src/lib/devisCalc.test.ts`), exit 0 |
| `npm run test:security:storage` | ⛔ Bloqué (hors périmètre TEST-02) | Préflight échoue : `TEST_ADMIN_A_EMAIL`/`TEST_ADMIN_A_PASSWORD` absents de `.env.test`. Ces comptes de test dédiés à la suite de sécurité (documentés dans `.env.test.example`) ne sont pas provisionnés dans cet environnement local. Les créer et/ou lancer `npm run test:security:seed` sortirait du périmètre strictement autorisé par TEST-02 (les 5 fichiers SQL + le runner uniquement) — nécessite une autorisation séparée. |
| `test:security:edge-functions` / `concurrency` / `playwright` / `test:security` | Non exécutées | Bloquées par la même dépendance (comptes de test dédiés absents) — non tentées pour ne pas dépasser le périmètre autorisé. |

Conformément à l'instruction « ne repars pas dans un audit infini » et « ne recherche pas de nouveaux problèmes hors des suites déjà prévues », je me suis arrêté à ce blocage de précondition d'environnement plutôt que de modifier `.env.test` ou de lancer un script de seed non explicitement autorisé par TEST-02.

## 10. Classification commercialisation

| Constat | Classification |
|---|---|
| Scénario anonyme obsolète (Correction 2) — comportement SEC2-02 correct, test corrigé | **NON BLOQUANT** — test historique obsolète, corrigé |
| Transitions de statut invalides dans les fixtures (`partner_connections`, `partner_intervention_requests`) | **NON BLOQUANT** — bug de fixture de test préexistant, jamais une faille métier réelle |
| UUID invalides dans 3 fichiers de test | **NON BLOQUANT** — erreur cosmétique de fixture, corrigée |
| Nettoyage incomplet (`notifications` avant `profiles`) et ordonnancement de rôle (`devis`/`document_counters`) | **NON BLOQUANT** — dette technique de fixture de test, corrigée, aucune fonction métier ni policy modifiée |
| Absence native de `psql` (environnement Windows) | **NON BLOQUANT** — limitation d'environnement, contournée par le runner Docker |
| Comptes de test dédiés (`TEST_ADMIN_A_*`) non provisionnés pour Storage/Edge Functions/Concurrency/Playwright | **NON BLOQUANT** pour le résultat de TEST-02 lui-même, mais **bloque la poursuite de la validation finale de commercialisation** tant qu'ils ne sont pas provisionnés (nécessite une autorisation séparée) |
| Les 104 assertions des 5 suites SQL critiques | Toutes réussies — **aucun constat BLOQUANT COMMERCIALISATION** détecté dans le périmètre SQL de TEST-02 |

Aucune faille multi-tenant, aucun accès anonyme sensible, aucune perte/corruption de données, aucune facturation/paiement incorrect, aucune commission dupliquée n'a été détecté dans le périmètre de cette correction.

## 11. Fichiers modifiés

- `audit-kaytek-inter/corrections/tests/correction-02-helper-tests.sql`
- `audit-kaytek-inter/corrections/tests/correction-03-partner-rls-tests.sql`
- `audit-kaytek-inter/corrections/tests/correction-03b-partner-preview-rpc-tests.sql`
- `audit-kaytek-inter/corrections/tests/correction-04-numbering-tests.sql`
- `audit-kaytek-inter/corrections/tests/correction-05-commission-tests.sql`
- `scripts/run-security-sql-tests.mjs`
- `audit-kaytek-inter/corrections/correction-test-02-sql-suites.md` (ce rapport)

Aucune migration, aucun code frontend, aucune Edge Function, aucune fonction métier, aucune policy, aucun privilège, aucun secret, aucune configuration distante n'a été modifié. Aucun commit, aucun push, aucun déploiement.

## 12. Conclusion

Les cinq suites SQL critiques (Corrections 2 à 5) sont corrigées, s'exécutent sans test ignoré et réussissent intégralement, à la fois individuellement et via `npm run test:security:sql` (adapté pour fonctionner via Docker en l'absence de `psql` natif). `npm run test:unit` réussit également (42/42). La poursuite vers Storage/Edge Functions/Concurrency/Playwright est bloquée par une précondition d'environnement (comptes de test dédiés non provisionnés) hors du périmètre strictement autorisé par TEST-02.

---

**TEST-02 corrigé. Les cinq suites SQL critiques sont exécutées et réussissent sans test ignoré. J'attends votre autorisation pour la validation finale de commercialisation.**
