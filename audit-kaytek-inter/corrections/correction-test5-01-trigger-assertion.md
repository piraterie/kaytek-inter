# Correction TEST5-01 — Assertion de comptage du trigger de commission

## 0. Résultat en une phrase

**TEST5-01 est corrigée et validée dans son périmètre exact** : l'assertion a été corrigée, le
bootstrap **traverse désormais intégralement les 110 migrations pour la première fois dans toute
cette série d'analyses** (MIG-01 → MIG-02 → SEC2-02 → TEST5-01), et le test fonctionnel du trigger de
commission réussit, y compris exécuté sous le rôle `authenticated` sans aucun droit direct (confirmant
SEC2-02 simultanément). Le critère strict « deux `supabase db reset` retournent un code de sortie 0 »
n'est cependant **pas atteint à la lettre** : les migrations elles-mêmes réussissent à 100 % à chaque
tentative, mais l'étape de redémarrage des conteneurs qui suit systématiquement échoue sur un
**problème Docker sans rapport** (le service d'analytics/logs `vector`, incapable de joindre le socket
Docker dans cet environnement précis). De plus, la suite `test:security:sql` a révélé, une fois
réellement exécutée pour la première fois, des anomalies **pré-existantes et hors périmètre**
(dont une directement liée à SEC2-02, déjà autorisée séparément) — je me suis arrêté conformément à la
règle « n'corrige aucune autre anomalie sans autorisation ».

## 1. Assertion initiale

```sql
-- 11.2 — Nouveaux triggers présents et attachés aux bonnes tables.
SELECT count(*) INTO v_count FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table = 'factures'
  AND trigger_name = 'trg_calculate_commission_on_facture_payee';
IF v_count <> 1 THEN
  RAISE EXCEPTION 'Assertion échouée : trigger facture payée manquant (trouvé %)', v_count;
END IF;
```

## 2. Comportement de `information_schema.triggers`

Cette vue, standardisée SQL, n'a pas de concept natif de clause `OR` entre types d'événements : un
trigger physique unique défini `AFTER INSERT OR UPDATE` y apparaît comme **une ligne par type
d'événement couvert**, jamais une ligne unique.

## 3. Preuve des deux lignes par événement

Reproduit dans un conteneur Postgres jetable isolé (image exacte du projet,
`public.ecr.aws/supabase/postgres:17.6.1.121`, détruit après usage), avec un trigger recréé à
l'identique :

```sql
CREATE TRIGGER trg_calculate_commission_on_facture_payee
  AFTER INSERT OR UPDATE ON public.factures
  FOR EACH ROW EXECUTE FUNCTION trigger_calculate_commission_on_facture_payee();
```

```
 trigger_name                               | event_manipulation | action_timing
 trg_calculate_commission_on_facture_payee | INSERT              | AFTER
 trg_calculate_commission_on_facture_payee | UPDATE              | AFTER
(2 rows)
```

## 4. Preuve d'un seul trigger dans `pg_trigger`

Même conteneur jetable :

```
 oid   | tgname                                     | table_name | trigger_definition                                                                                                                | tgenabled | tgisinternal
 16671 | trg_calculate_commission_on_facture_payee | factures   | CREATE TRIGGER trg_calculate_commission_on_facture_payee AFTER INSERT OR UPDATE ON public.factures ... EXECUTE FUNCTION ...() | O         | f
(1 row)

count_info_schema | count_pg_trigger
2                 | 1
```

**Reconfirmé contre la vraie base du projet** après le premier reset réussi (`docker exec
supabase_db_kaytek-final psql ...`) : résultat identique, 1 seule ligne physique.

## 5. Assertion corrigée

```sql
-- 11.2 — Nouveaux triggers présents et attachés aux bonnes tables.
SELECT count(*) INTO v_count FROM pg_trigger
WHERE tgrelid = 'public.factures'::regclass
  AND tgname = 'trg_calculate_commission_on_facture_payee'
  AND NOT tgisinternal;
IF v_count <> 1 THEN
  RAISE EXCEPTION 'Assertion échouée : trigger facture payée manquant ou dupliqué (trouvé % trigger(s) physique(s) via pg_trigger)', v_count;
END IF;

SELECT pg_get_triggerdef(t.oid) INTO v_triggerdef
FROM pg_trigger t
WHERE t.tgrelid = 'public.factures'::regclass
  AND t.tgname = 'trg_calculate_commission_on_facture_payee'
  AND NOT t.tgisinternal;
IF v_triggerdef IS NULL
   OR v_triggerdef NOT LIKE '%AFTER%'
   OR v_triggerdef NOT LIKE '%INSERT%'
   OR v_triggerdef NOT LIKE '%UPDATE%'
   OR v_triggerdef NOT LIKE '%ON public.factures%'
   OR v_triggerdef NOT LIKE '%trigger_calculate_commission_on_facture_payee%'
THEN
  RAISE EXCEPTION 'Assertion échouée : définition du trigger facture payée inattendue (%)', v_triggerdef;
END IF;
```

Le comptage repose désormais sur `pg_trigger` (catalogue physique, insensible à l'artefact
d'`information_schema.triggers`) et une seconde assertion vérifie explicitement, via
`pg_get_triggerdef()`, que le trigger unique retrouvé couvre bien `AFTER`, `INSERT`, `UPDATE`, la
table `public.factures` et la fonction `trigger_calculate_commission_on_facture_payee` — aucune
régression silencieuse possible vers un trigger à un seul événement ou mal rattaché.

**Ce qui n'a pas changé** : la fonction de commission, le trigger lui-même (toujours `AFTER INSERT OR
UPDATE`), ses deux événements, la logique métier, les privilèges (SEC2-02 non retouchée), toute autre
migration.

## 6. Fichiers modifiés

- `supabase/migrations/20260726000001_unify_commission_calculation.sql` (seul fichier autorisé,
  seule l'assertion 11.2 modifiée — ajout d'une variable `v_triggerdef text` dans la section
  `DECLARE` existante, remplacement du comptage `information_schema.triggers` par `pg_trigger`,
  ajout d'une vérification de définition).
- Migration additive SEC2-02 (`20260727000002`) : **non modifiée** — confirmé par recherche
  (`grep information_schema.triggers|pg_trigger`) qu'elle ne contient aucune logique de comptage de
  trigger.
- Aucun test externe (`scripts/`, `tests/`, `audit-kaytek-inter/corrections/tests/`) ne contenait la
  même logique de comptage — aucun autre fichier modifié.
- `audit-kaytek-inter/corrections/correction-test5-01-trigger-assertion.md` (ce rapport, nouveau).

## 7. Résultat du premier reset

```bash
$ docker ps                     # exit 0
$ supabase stop --no-backup     # exit 0
$ supabase start
... (110 migrations appliquées, toutes réussies) ...
NOTICE: Correction 5 (FONC-02) : toutes les assertions statiques ont réussi.
...
NOTICE: SEC2-02 : toutes les assertions de privilèges EXECUTE ont réussi.
(exit 0 — SUCCÈS COMPLET, une première dans cette série d'analyses)
```

**Confirmé** : la migration `20260726000001` applique désormais son assertion 11.2 avec succès —
« Correction 5 (FONC-02) : toutes les assertions statiques ont réussi » s'affiche, ce qui n'était
jamais arrivé lors des tentatives précédentes (MIG-01, MIG-02, SEC2-02).

```bash
$ supabase db reset
... (mêmes 110 migrations, mêmes succès) ...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
Error status 502: An invalid response was received from the upstream server
(exit 1)
```

**Analyse de cet échec (aucune correction effectuée, hors périmètre de TEST5-01)** : l'échec ne
survient **jamais** pendant l'application des migrations (toutes réussissent, à chaque tentative,
confirmé 3 fois) — il survient **après**, à l'étape « Restarting containers » du CLI. Diagnostic :

```
$ docker ps -a --filter name=supabase
... supabase_vector_kaytek-final   Restarting (0) ...
$ docker logs supabase_vector_kaytek-final
ERROR ... vector::sources::docker_logs: Listing currently running containers failed.
error=... ConnectError("tcp connect error", ... "Connection refused" ...)
```

Le sidecar `vector` (collecte de logs pour Logflare/Analytics local) ne parvient pas à joindre le
socket Docker depuis l'intérieur de son propre conteneur dans cet environnement précis
(Docker Desktop pour Windows) et boucle en redémarrage — provoquant un 502 transitoire pendant que le
CLI attend la stabilisation des services au redémarrage. **Sans aucun rapport avec le contenu SQL,
les migrations, TEST5-01 ou SEC2-02** : confirmé par le fait que `supabase status` continue de
rapporter la stack fonctionnelle (base de données, Auth, REST, Storage tous « healthy ») immédiatement
après cet échec, et que la base de données elle-même reste pleinement interrogeable et correcte
(sections 8 et 9 ci-dessous). Deux tentatives supplémentaires de `supabase db reset` ont reproduit
exactement le même schéma (migrations 100 % réussies, puis 502 transitoire au redémarrage des
conteneurs) — écartant une simple instabilité ponctuelle.

## 8. Résultat du second reset

Trois tentatives de `supabase db reset` au total dans cette session (au-delà du premier `start`) :
toutes les trois ont **intégralement réussi la phase de migration** (110/110, toutes assertions,
y compris celle corrigée par TEST5-01 et celles de SEC2-02), et toutes les trois ont rencontré le
même 502 transitoire, sans rapport, décrit en section 7. La base de données reste saine et
interrogeable après chaque tentative (confirmé directement, section 9).

## 9. Définition finale du trigger (vérifiée contre la vraie base du projet)

```sql
$ docker exec supabase_db_kaytek-final psql -U postgres -d postgres -c "
SELECT t.oid, t.tgname, t.tgrelid::regclass, pg_get_triggerdef(t.oid), t.tgenabled, t.tgisinternal
FROM pg_trigger t WHERE t.tgrelid='public.factures'::regclass
  AND t.tgname='trg_calculate_commission_on_facture_payee' AND NOT t.tgisinternal;"

 oid   | tgname                                     | table_name | trigger_definition
 19724 | trg_calculate_commission_on_facture_payee | factures   | CREATE TRIGGER trg_calculate_commission_on_facture_payee AFTER INSERT OR UPDATE ON public.factures FOR EACH ROW EXECUTE FUNCTION trigger_calculate_commission_on_facture_payee()
 tgenabled=O (enabled), tgisinternal=f
(1 row)
```

## 10. Résultat du test fonctionnel de commission

Deux tests, fixtures locales jetables uniquement, chacun dans une transaction `BEGIN...ROLLBACK`
(aucune donnée persistante) :

**Test 1 — en tant que `postgres`** : facture créée (montant 100, intervenant commission_pct=30) →
transition `impayee → payee` → **1 commission créée** (`part_intervenant=30.00`,
`commission_admin=70.00`, `formule_version=2`, valeurs conformes à la formule). Mise à jour ultérieure
(changement de notes, toujours `payee`) → **toujours 1 seule commission** (aucun doublon). Nouvelle
transition `impayee → payee` (simulant un second déclenchement) → **toujours 1 seule commission**
(idempotence `ON CONFLICT` confirmée). Transaction annulée (`ROLLBACK`) — 0 fixture restante.

**Test 2 — en tant que rôle `authenticated`, JWT simulé de l'admin (`set_config('request.jwt.claim.sub', ...)`
+ `SET LOCAL role = 'authenticated'`), reproduisant exactement le chemin réel PostgREST/RLS** :
transition `impayee → payee` effectuée par `authenticated` → **réussit** → **1 commission créée**.
Confirmé simultanément : `has_function_privilege('authenticated', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE')`
= **`false`** — le trigger fonctionne intégralement **sans aucun droit direct pour authenticated**,
validant à la fois TEST5-01 (trigger) et SEC2-02 (privilèges) simultanément, en conditions réelles.
Transaction annulée — 0 fixture restante.

## 11. Résultat des suites critiques

```bash
$ npm run test:unit
✓ src/lib/devisCalc.test.ts (42 tests)
Test Files  1 passed (1) — Tests  42 passed (42)
```

```bash
$ npm run test:security:sql
[preflight] OK
[test:security:sql] ÉCHEC — la commande `psql` est introuvable dans le PATH.
```

**Limite d'environnement déjà documentée** (Correction 6, MIG-01) : aucun client `psql` natif
disponible dans ce shell Bash sur cet hôte Windows. **Substitut réalisé** pour obtenir malgré tout une
vérification réelle : chacun des 5 fichiers de test SQL exécuté directement via
`docker exec supabase_db_kaytek-final psql -f ...` (psql disponible à l'intérieur du conteneur de
base de données) :

| Fichier | Résultat | Analyse |
|---|---|---|
| `correction-02-helper-tests.sql` | **Échec** — `permission denied for function current_organisation_has_app_access`, scénario « utilisateur anonyme » | **Conséquence directe et attendue de SEC2-02** (déjà autorisée séparément) : ce test suppose qu'`anon` peut appeler la fonction et obtenir `false` — SEC2-02 révoque désormais complètement ce droit, donc l'appel échoue avant même de retourner une valeur. Le test lui-même nécessiterait une mise à jour pour refléter le nouveau modèle (attendre une exception plutôt qu'un `false`), hors périmètre strict de TEST5-01 (fichier de migration unique autorisé) |
| `correction-03-partner-rls-tests.sql` | Échec — `Transition de statut invalide : accepted → pending` (assertion métier du test lui-même) | Sans rapport apparent avec TEST5-01/SEC2-02 — anomalie préexistante du script de test, jamais exécuté avec succès auparavant dans cet environnement (psql indisponible jusqu'à cette session) |
| `correction-03b-partner-preview-rpc-tests.sql` | Échec — `invalid input syntax for type uuid: "...0000000000g1"` | UUID invalide (caractère `g`, hors alphabet hexadécimal) dans une fixture du test lui-même — bug préexistant du script, sans rapport avec TEST5-01/SEC2-02 |
| `correction-04-numbering-tests.sql` | Échec — même type d'erreur (`...0000000000j1`) | Idem |
| `correction-05-commission-tests.sql` | Échec — même type d'erreur (`...0000000000m1`) | Idem |

**Conformément à la règle « arrête-toi au premier échec critique, ne corrige aucune anomalie sans
autorisation »**, je me suis arrêté ici — **aucune suite suivante n'a été exécutée**
(`test:security:storage`, `test:security:edge-functions`, `test:security:concurrency`,
`test:security:playwright`, `test:security` global).

**Constat notable** : c'est la toute première fois, dans l'ensemble de cette série de sessions
(MIG-01 à TEST5-01), qu'un reset complet réussit et que ces 5 fichiers de tests SQL ont pu être
réellement exécutés contre une base migrée avec succès — révélant des anomalies qui n'avaient jamais
pu être détectées auparavant faute d'y être jamais arrivé.

## 12. Tests ignorés

Aucun test critique n'a été **silencieusement ignoré** — chaque suite non exécutée l'a été
explicitement, par arrêt volontaire après le premier échec de la suite précédente, jamais par un
`skip` masqué.

## 13. Aucune opération distante

Aucune commande n'a contacté un projet Supabase distant. Aucun `supabase db push`, aucun `migration
repair`, aucune requête contre la production. Les conteneurs Postgres jetables utilisés pour la
confirmation de l'artefact (section 3) ont été détruits (`docker rm -f`) immédiatement après usage.
Aucun commit, aucun push, aucun déploiement.

## 14. Limites restantes

1. **502 transitoire au redémarrage des conteneurs** (`vector`/Logflare, section 7) empêche
   `supabase db reset` de retourner un code de sortie 0 à la lettre, bien que la totalité du contenu
   SQL/migrations réussisse à chaque tentative. Limite d'environnement Docker Desktop, sans rapport
   avec TEST5-01.
2. **`psql` indisponible nativement** dans ce shell — contourné via `docker exec`, déjà documenté
   depuis Correction 6.
3. **5 anomalies découvertes dans les scripts de test SQL des Corrections 2 à 5** (section 11),
   dont une directement liée à SEC2-02 (déjà autorisée séparément, méritant une mise à jour du script
   de test) et quatre apparemment préexistantes et sans rapport, jamais détectées faute d'exécution
   réelle antérieure. **Aucune corrigée** — hors périmètre strict de TEST5-01.
4. `test:security:storage/edge-functions/concurrency/playwright` et `test:security` global : non
   exécutés, arrêt volontaire après le premier échec de `test:security:sql`.

## 15. Décision

Le trigger de commission, objet exact de TEST5-01, est confirmé **fonctionnellement correct, unique,
et bien défini** — par lecture statique, par reproduction isolée de l'artefact, et par un test
fonctionnel réel réussi (y compris sous le rôle `authenticated` sans droit direct, en conditions
quasi-réelles). Le bootstrap complet est également confirmé migrer avec succès à 100 % pour la
première fois. Cependant, le critère strict « deux resets retournent le code 0 » n'est pas atteint à
la lettre (cause étrangère à TEST5-01), et la suite de validation s'est arrêtée sur des anomalies
hors périmètre découvertes dans les scripts de test SQL. Conformément aux critères de réussite stricts
énoncés dans l'autorisation, je ne déclare donc pas la validation complète.

TEST5-01 non validée. Le bootstrap, le trigger de commission ou une suite critique reste en échec. J'attends votre autorisation avant toute nouvelle correction.
