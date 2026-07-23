# Analyse MIG-02 — Nettoyage sécurisé des migrations de diagnostic et fixtures RLS partenaires

Document d'**analyse uniquement**. Aucun fichier n'a été modifié. Aucune donnée n'a été créée.
Aucune commande distante n'a été exécutée — uniquement Docker/Supabase **local**.

## 1. Erreur exacte reproduite

```bash
$ docker ps            # exit 0, fonctionnel
$ supabase stop --no-backup
Stopped supabase local development setup.

$ supabase start
...
Applying migration 20260715000002_recreate_pir_test_fixture.sql...
Stopping containers...
ERROR: insert or update on table "partner_intervention_requests" violates foreign key constraint
"partner_intervention_requests_connection_id_fkey" (SQLSTATE 23503)
Key (connection_id)=(6c6f3cb6-04e0-4947-9225-3ebcff8933a3) is not present in table "partner_connections".
At statement: 0
(exit 1)
```

- **Migration bloquante** : `20260715000002_recreate_pir_test_fixture.sql`.
- **Instruction en échec** : l'unique `INSERT INTO public.partner_intervention_requests (...)` du
  fichier (statement n°0, la première et seule instruction).
- **Contrainte concernée** : `partner_intervention_requests_connection_id_fkey`.
- **UUID de `connection_id` référencé** : `6c6f3cb6-04e0-4947-9225-3ebcff8933a3`.
- **Table référencée (FK cible)** : `public.partner_connections`.
- **Code PostgreSQL** : `SQLSTATE 23503` (`foreign_key_violation`).
- **Conteneurs** : arrêtés automatiquement par le CLI Supabase (confirmé après coup :
  `docker ps -a` vide, `supabase status` répond `No such container: supabase_db_kaytek-final`) —
  aucun nettoyage manuel nécessaire.

## 2. Analyse de la migration bloquante

Contenu intégral (22 lignes, une seule instruction SQL) :

```sql
-- Nouvelle ligne de test pour l'investigation pir_update (bypass RLS,
-- exécuté en tant que postgres). Sera nettoyée à la fin de l'investigation.
INSERT INTO public.partner_intervention_requests (
  id, connection_id, source_organisation_id, source_profile_id,
  target_organisation_id, status, type_intervention, urgence, ville,
  share_adresse, adresse_partagee, share_telephone, telephone_client_partage,
  share_nom_client, nom_client_partage, share_description, description_partagee,
  share_montant, montant_partage, share_photos
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '6c6f3cb6-...', '10b3a27e-...', '59e65e97-...',
  'ff6cf5ec-...', 'pending', 'serrurerie', false, 'Paris',
  true, '42 rue Confidentielle, 75001 Paris', true, '0699887766',
  true, 'CONFIDENTIEL Dupont', true, 'Porte claquée, client bloqué dehors',
  true, 90, false
) ON CONFLICT (id) DO NOTHING;
```

- **Lignes insérées** : 1 seule, dans `public.partner_intervention_requests`.
- **Tables touchées** : uniquement `partner_intervention_requests` (aucun schéma, aucune policy,
  aucune fonction, aucun trigger).
- **UUID codés en dur** : 4 — `id` (`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, clairement factice),
  `connection_id` (`6c6f3cb6-...`), `source_organisation_id` (`10b3a27e-...`),
  `source_profile_id` (`59e65e97-...`), `target_organisation_id` (`ff6cf5ec-...`) — ces 3 derniers
  ont l'apparence d'UUID v4 réels (pas de motif répétitif comme l'`id`), cohérent avec des
  organisations/profils réels ayant servi à l'investigation en conditions réelles.
- **Dépendance FK** : `connection_id → partner_connections(id)` — la seule qui échoue. Les autres FK
  (`source_organisation_id`/`target_organisation_id → organisations(id)`,
  `source_profile_id → profiles(id)`) ne sont pas testées ici (Postgres s'arrête à la première
  violation), donc leur statut réel sur une base vide est inconnu mais probablement également
  absent, pour la même raison.
- **Objectif apparent** : recréer une ligne de test après qu'une précédente ligne de test (créée
  pendant une investigation antérieure, le 14 juillet, id `1fcbba0c-...`) a été nettoyée par
  `20260714000013`, afin de poursuivre l'investigation du bug `pir_update` le 15 juillet avec les
  mêmes identifiants d'organisation/connexion partenaire réels que la veille.
- **Commentaire d'en-tête** : *« Nouvelle ligne de test pour l'investigation pir_update (bypass RLS,
  exécuté en tant que postgres). Sera nettoyée à la fin de l'investigation. »* — explicite, sans
  ambiguïté sur la nature temporaire de cette ligne.
- **Contexte déductible** : cette ligne est confirmée nettoyée par
  `20260715000010_cleanup_pir_investigation.sql` (`DELETE ... WHERE id = 'aaaaaaaa-...'`), une fois
  le vrai bug résolu par `20260715000009_fix_pir_update_rpc.sql`. La séquence complète (voir section
  3) montre que cette investigation a été menée **en conditions réelles, contre une base déjà
  peuplée** (organisations/profils/connexion partenaire réels, jamais capturés par une migration
  `INSERT` — même schéma que les tables fondamentales manquantes de MIG-01, mais ici appliqué à une
  **ligne de données**, pas à un objet de schéma).
- **Présence de cleanup** : oui, confirmée (`20260715000010`).
- **Impact attendu sur une base réelle (production)** : si cette migration a déjà été appliquée en
  production, le `connection_id` y existait réellement à ce moment (c'est justement pour ça que
  l'INSERT y a réussi) — donc **aucun impact négatif** là-bas ; le problème n'existe que pour un
  bootstrap **neuf**, où cette ligne de `partner_connections` n'a jamais été créée par aucune
  migration.
- **Nécessité pour le schéma final** : **aucune**. Cette ligne ne configure ni policy, ni fonction,
  ni trigger — elle est intégralement supprimée 8 migrations plus tard
  (`20260715000010`), avant même la fin de la séquence de debug.

**Détermination** : cette migration **crée uniquement une donnée de test**, temporaire, déjà
nettoyée plus loin dans l'historique. Elle ne modifie ni policy, ni fonction, ni trigger ; elle ne
prépare pas non plus un diagnostic ultérieur elle-même (c'est le fichier suivant, `20260715000003`,
qui reprend l'investigation) ; elle n'est pas nécessaire à un correctif final.

## 3. Cartographie complète de la séquence de debug (13-15 juillet)

| Migration | Catégorie | Modifie le schéma | Modifie policy/fonction | Insère des données | Nettoie ses données | Nécessaire à HEAD |
|---|---|---:|---:|---:|---:|---:|
| `20260713000002_diag_notif_policy.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260713000003_diag_profiles_policy.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260713000004_diag_notif_check_fn.sql` | Diagnostic (fonction temporaire) | Non | Oui (fonction diag) | Non | Oui (000006) | Non |
| `20260713000005_diag_notif_triggers.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260713000006_cleanup_diag_notif_check_fn.sql` | Cleanup | Non | Oui (DROP fonction) | Non | — (est le cleanup) | Non (a fait son travail) |
| `20260714000001_intervenant_document_permissions.sql` | **Correctif fonctionnel** | Non | Oui | Non | N/A | **Oui** |
| `20260714000002_partner_request_status_gating.sql` | **Correctif fonctionnel** | Non | Oui (`pir_select`, `get_partner_requests_preview`) | Non | N/A | Non (remplacée par Corrections 3/3bis) mais légitime en son temps |
| `20260714000003_diag_clients_insert.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260714000004_diag_clients_insert_check.sql` | Diagnostic (fonction temporaire) | Non | Oui (fonction diag) | Non | Oui (000007) | Non |
| `20260714000005_diag_clients_deep.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260714000006_diag_clients_insert_narrow.sql` | Diagnostic (policy volontairement affaiblie, INSERT seul) | Non | Oui (temporaire) | Non | Remplacée par 000007 | Non |
| `20260714000007_fix_clients_select_for_creator.sql` | **Correctif fonctionnel final** | Non | Oui (`clients_insert`, `clients_select`) + cleanup fonction diag | Non | N/A | **Oui** |
| `20260714000008_diag_pir_update.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260714000009_diag_pir_update_check.sql` | Diagnostic (fonction temporaire) | Non | Oui (fonction diag) | Non | Oui (000010) | Non |
| `20260714000010_cleanup_pir_diag.sql` | Cleanup | Non | Oui (DROP fonction) | Non | — (est le cleanup) | Non (a fait son travail) |
| `20260714000011_test_fixture_refuse_pir.sql` | Fixture (UPDATE données existantes) | Non | Non | Oui (UPDATE, pas INSERT) | Oui (000013) | Non |
| `20260714000012_test_fixture_accept_pir.sql` | Fixture (UPDATE + trigger désactivé/réactivé ponctuellement) | Non | Non (trigger désactivé puis réactivé dans le même fichier) | Oui (UPDATE) | Oui (000013) | Non |
| `20260714000013_cleanup_pir_test_fixture.sql` | Cleanup | Non | Non | Non | Oui (DELETE ligne `1fcbba0c-...`) | Non (a fait son travail) |
| `20260715000001_diag_pir_structure.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| **`20260715000002_recreate_pir_test_fixture.sql`** | **Fixture (INSERT)** | Non | Non | **Oui — BLOQUANT sur base vide** | Oui (000010) | **Non** |
| `20260715000003_diag_pir_update_minimal.sql` | Diagnostic (policy volontairement affaiblie) | Non | Oui (temporaire, `pir_update`) | Non | Remplacée par 000009 | Non |
| `20260715000004_diag_pir_update_hardcoded.sql` | Diagnostic (**policy grande ouverte `USING(true)`**) | Non | Oui (temporaire, `pir_update`) | Non | Remplacée par 000009 | Non |
| `20260715000005_diag_reload_schema.sql` | Diagnostic (NOTIFY PostgREST) | Non | Non | Non | N/A | Non |
| `20260715000006_diag_pir_rules_and_dupes.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260715000007_diag_pir_final_check.sql` | Diagnostic (lecture seule) | Non | Non | Non | N/A | Non |
| `20260715000008_diag_pir_select_true.sql` | Diagnostic (**policy grande ouverte `USING(true)`**) | Non | Oui (temporaire, `pir_select`) | Non | Remplacée par 000009 | Non |
| `20260715000009_fix_pir_update_rpc.sql` | **Correctif fonctionnel final** | Non | Oui (`pir_select`, `pir_update`) + nouvelle RPC `respond_to_partner_intervention_request()` | Non | N/A | **Oui** |
| `20260715000010_cleanup_pir_investigation.sql` | Cleanup | Non | Non | Non | Oui (DELETE ligne `aaaaaaaa-...`) | Non (a fait son travail) |
| `20260715000011_pir_preview_add_updated_at.sql` | **Correctif fonctionnel** | Non | Oui (`get_partner_requests_preview`, ajout colonne `updated_at` au résultat) | Non | N/A | Non (remplacée par Correction 3 bis) mais légitime en son temps |
| `20260715000012_cleanup_frontend_test_fixtures.sql` | Cleanup (données créées via le frontend réel, jamais via migration) | Non | Non | Non | Oui (DELETE 3 lignes) | Non (a fait son travail) |
| `20260715000013_final_state_check.sql` | Diagnostic (lecture seule, assertions informatives sans `RAISE EXCEPTION`) | Non | Non | Non | N/A | Non |

**Constats** :

- **Une seule fixture jamais nettoyée sur une base vide** : `20260715000002` — toutes les autres
  (`20260714000011/012/013`, `20260715000010`, `20260715000012`) portent sur des ID **déjà
  existants** (créés hors migration, via l'UI réelle ou l'investigation du 14 juillet) : leurs
  `UPDATE`/`DELETE` ne trouvent simplement aucune ligne sur une base vide et ne provoquent **aucune
  erreur** (`UPDATE`/`DELETE ... WHERE id = X` sans correspondance affecte 0 ligne, sans exception).
- **Diagnostics ouvrant temporairement une policy** : `20260714000006` (INSERT seul, restreint),
  `20260715000003` (`pir_update` réduite), `20260715000004` (`pir_update` → `USING(true)`, grande
  ouverte), `20260715000008` (`pir_select` → `USING(true)`, grande ouverte). **Les 4 sont
  intégralement remplacées** par leur correctif final respectif avant la fin de la séquence
  (`20260714000007` pour la première, `20260715000009` pour les 3 suivantes) — aucune n'est active
  à HEAD.
- **Correctifs finaux qui remplacent ces diagnostics** : `20260714000007` (clients),
  `20260715000009` (pir_select/pir_update/RPC).
- **Cleanups réellement nécessaires** (pour l'état final, indépendamment du bootstrap) :
  `20260713000006`, `20260714000010`, `20260714000013`, `20260715000010`, `20260715000012` —
  toutes déjà présentes et déjà suffisantes ; aucune n'est elle-même bloquante.
- **Migrations purement historiques sans effet final utile** : toutes les `diag_*` en lecture seule
  (`20260713000002/003/005`, `20260714000003/005/008`, `20260715000001/005/006/007/013`) — elles ne
  modifient jamais rien, uniquement `RAISE NOTICE`.

## 4. État final réellement nécessaire

- **`pir_select`** (définition finale utile) : celle de **Correction 3**
  (`20260723000001_fix_pir_select_admin_check.sql`) — confirmé : ce fichier fait
  `DROP POLICY IF EXISTS "pir_select"` puis `CREATE POLICY "pir_select"`, s'appliquant après (et donc
  remplaçant) la version de `20260715000009`.
- **`pir_update`** : **aucune migration postérieure à `20260715000009_fix_pir_update_rpc.sql` ne la
  touche** (confirmé par recherche exhaustive) — sa définition finale est donc bien celle de
  `20260715000009` : `(current_org_id() = source_organisation_id OR current_org_id() =
  target_organisation_id) AND is_admin_in_org(current_org_id())`.
- **`respond_to_partner_intervention_request()`** : **également jamais retouchée après
  `20260715000009`** — sa définition finale est donc celle de cette même migration. Confirmé
  explicitement par le commentaire de Correction 3 bis lui-même : *« pir_select (Correction 3),
  pir_insert, pir_update, respond_to_partner_intervention_request(), les triggers, les autres tables
  partner_*, les helpers existants et toute donnée existante restent intégralement inchangés. »*
- **`get_partner_requests_preview()`** : définition finale de **Correction 3 bis**
  (`20260724000001_secure_get_partner_requests_preview.sql`, `CREATE OR REPLACE FUNCTION`),
  remplaçant la version de `20260715000011` (elle-même remplaçant celle de `20260714000002`).
- **Triggers** : `partner_intervention_requests_before_update()` (trigger
  `trg_pir_before_update`) — dernière modification confirmée en
  `20260708000006_partner_intervention_import.sql` (assouplissement encadré de
  `resulting_intervention_id`) ; non retouché par la séquence de debug de juillet 13-15 ni par les
  Corrections 3/3 bis. `log_partner_intervention_event()`/`notify_on_partner_intervention_change()`
  (créés en `20260708000005`) : non retouchés non plus.
- **Policies partenaires finales** : `pir_insert` (créée en `20260708000005`, jamais retouchée) ;
  `pir_select` (Correction 3) ; `pir_update` (`20260715000009`) ; `pie_select`
  (`partner_intervention_events`, créée en `20260708000005`, restriction de visibilité héritée
  automatiquement du resserrement de `pir_select` — confirmé par le commentaire de
  `20260714000002` lui-même).
- **Absence totale de fixtures de test** : confirmée par construction — chaque fixture identifiée
  (section 3) est nettoyée par une migration ultérieure déjà présente dans l'historique, à
  l'exception de `20260715000002` qui **échoue avant même d'insérer sa donnée sur une base neuve** —
  ce qui, une fois rendu conditionnel (section 5), aboutit exactement au même résultat final (0
  ligne) que sur une base où elle a réussi puis a été nettoyée par `20260715000010`.

**Confirmation demandée** : oui, les Corrections 3 et 3 bis remplacent déjà intégralement les états
intermédiaires de `pir_select` et `get_partner_requests_preview()` issus de cette séquence de debug —
aucune action n'est nécessaire sur ces deux objets pour MIG-02.

## 5. Recherche exhaustive d'autres migrations de données temporaires

Recherches effectuées sur l'ensemble des 111 fichiers de migration (107 existants + les 2 de MIG-01
+ le script de contrôle des secrets, hors périmètre schéma) :

| Recherche | Résultat |
|---|---|
| `INSERT INTO public.<table métier>` dans tout fichier postérieur à `20260715000002` | Seul `20260726000001_unify_commission_calculation.sql:279` correspond — un `INSERT` **paramétré** à l'intérieur du corps de `calculate_commission_for_facture()` (Correction 5), aucun UUID codé en dur, aucune donnée de test — non concerné |
| Emails de test (`@test.`, `@example.`, `test@`, `@security.example.test`) dans `supabase/migrations/*.sql` | **Aucune occurrence** dans tout le dossier des migrations |
| Policies `USING (true)` actives à HEAD | **Aucune** — les 4 occurrences trouvées sont soit du texte de commentaire décrivant un état passé (`20260610000019`, `20260715000009`), soit des définitions temporaires déjà remplacées (`20260715000004`, `20260715000008`) |
| Triggers temporairement désactivés | Un seul cas : `20260714000012_test_fixture_accept_pir.sql` — `ALTER TABLE ... DISABLE TRIGGER trg_pir_before_update` puis `ENABLE TRIGGER` **dans le même fichier**, autour d'une seule ligne de test déjà nettoyée par `20260714000013` — pas de trigger resté désactivé à HEAD |
| Fonctions de diagnostic retournant des données internes | `diag_notif_check` (000713004, nettoyée par 000713006), `diag_clients_insert_check` (000714004, nettoyée par 000714007), `diag_pir_update_check` (000714009, nettoyée par 000714010) — **toutes nettoyées**, aucune ne subsiste à HEAD |
| Fichiers restants entre `20260715000013` et `20260722000001` (première migration des Corrections 1-6) | **Aucun** — frontière nette, aucune autre migration de debug à traiter |

**Aucune seconde fixture orpheline n'a été trouvée** au-delà de `20260715000002` — c'est la seule
migration de toute la séquence de debug (13-15 juillet) qui échoue réellement sur une base neuve.

## 6. Comparaison des options

### Option A — Rendre la migration fixture conditionnelle

```sql
INSERT INTO public.partner_intervention_requests (...)
SELECT 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '6c6f3cb6-...', ...
WHERE EXISTS (SELECT 1 FROM public.partner_connections WHERE id = '6c6f3cb6-...')
ON CONFLICT (id) DO NOTHING;
```

- **Bootstrap neuf** : `connection_id` n'existe pas → 0 ligne insérée → migration réussit
  trivialement.
- **Bases existantes (là où le `connection_id` existait réellement au moment de l'investigation)** :
  comportement inchangé *si rejouée* — mais elle ne serait de toute façon jamais rejouée si déjà
  marquée « applied » dans le ledger (voir section 7).
- **Effet final** : strictement identique avec ou sans la garde, dans les deux cas de figure (base
  neuve : 0 ligne avant et après ; base où l'INSERT réussirait : ligne insérée puis supprimée par
  `20260715000010` de toute façon) — confirmé par la section 4.
- **Conservation de l'historique** : totale — le fichier garde son nom, son timestamp, son
  commentaire d'origine ; seule une clause `WHERE EXISTS` est ajoutée.
- **Risque de masquer un besoin réel** : aucun — cette fixture n'a jamais servi qu'à un debug
  ponctuel déjà résolu par `20260715000009`, confirmé section 4.
- **Acceptable au sens de la condition posée par l'énoncé** (« uniquement si la fixture n'est pas
  nécessaire à l'état final ») : **oui, condition remplie**.

### Option B — Transformer en no-op explicite

Remplacer le contenu par un commentaire ou un bloc `DO` neutre expliquant la désactivation.

- Modifie également le contenu du fichier (même risque de checksum que l'Option A vis-à-vis d'un
  ledger de production où elle serait déjà appliquée).
- Plus radical que l'Option A : supprime toute trace exécutable de l'intention d'origine plutôt que
  de la garder sous condition. Dans ce cas précis, comme la fixture ne sert plus jamais à rien
  (confirmé section 4), les deux options aboutissent au même résultat fonctionnel — la différence
  est purement stylistique/de préservation de l'intention historique.
- Sur une base existante où la migration est déjà marquée appliquée : aucune conséquence (le fichier
  local n'est de toute façon pas rejoué automatiquement là-bas).

### Option C — Migration bootstrap antérieure créant les prérequis

**Rejetée**, exactement pour la raison anticipée par l'énoncé : satisfaire la FK exigerait de
fabriquer une ligne `partner_connections` complète (organisation source, organisation cible, profil,
statut de connexion) sans aucune preuve — une donnée métier partenaire entièrement inventée,
explicitement interdite par les règles 4 et 14 de cette phase. Aucune source ne permet de reconstruire
fidèlement cette ligne (contrairement aux tables de MIG-01, où une source autoritaire —
`backup/backup-2026-06-10/database-schema.sql` — existait).

### Option D — Baseline/squash des migrations de diagnostic

Écartée pour ce problème précis : la section 5 a confirmé qu'**une seule** migration sur ~30 de la
séquence de debug est réellement bloquante sur une base neuve — toutes les autres se comportent déjà
correctement (no-op silencieux ou cleanup déjà présent). Squasher toute la séquence pour corriger un
seul fichier ferait perdre le contexte de diagnostic détaillé (utile pour comprendre POURQUOI
`pir_update`/`pir_select` ont leur forme actuelle) sans bénéfice proportionné. À garder en réserve
uniquement si une future analyse révélait un nombre beaucoup plus important de migrations
bloquantes.

### Option E — Nouvelle migration corrective postérieure

**Ne peut pas fonctionner**, pour la raison structurelle donnée par l'énoncé : `supabase db
reset`/`start` applique les migrations dans l'ordre chronologique de leur nom de fichier ; l'échec se
produit **pendant** l'application de `20260715000002` elle-même, avant même que le CLI ne considère
les fichiers suivants. Aucune migration datée après ne peut empêcher rétroactivement celle-ci
d'échouer. Cette option est structurellement inapplicable ici, pas seulement sous-optimale.

## 7. Stratégie recommandée (analyse — aucune action à ce stade)

**Option A** (rendre `20260715000002_recreate_pir_test_fixture.sql` conditionnelle via `WHERE
EXISTS`) est la stratégie recommandée :

- Ne crée aucune donnée métier fictive (l'INSERT ne s'exécute que si le prérequis existe déjà
  réellement — jamais fabriqué).
- Permet à une base neuve de traverser la migration (0 ligne, succès trivial).
- Conserve l'état final des policies/fonctions : aucune n'est touchée par ce fichier, donc aucun
  risque de divergence.
- Ne rejoue aucune action dangereuse sur une base existante : comportement inchangé si le
  `connection_id` y existe (et de toute façon sans conséquence puisque nettoyée 8 migrations plus
  loin par `20260715000010`, déjà présente et non modifiée).
- Ne nécessite aucune opération distante maintenant.
- Compréhensible et documentable en une ligne de commentaire expliquant le garde-fou.

Option B reste une alternative valable (résultat final identique) si une préférence est exprimée pour
une désactivation plus explicite plutôt qu'une garde conditionnelle — à trancher lors de
l'autorisation de correction, pas ici.

## 8. Impact sur la production

Sans aucune requête distante :

- `20260715000002` est très probablement déjà enregistrée comme appliquée dans
  `supabase_migrations.schema_migrations` en production — c'est justement parce que le
  `connection_id` y existait réellement (créé via l'application, pendant l'investigation du 14-15
  juillet) que l'INSERT y a réussi à l'origine.
- Modifier son contenu localement (Option A ou B) **ne la rejouera pas automatiquement en
  production** — Supabase ne réexécute jamais une migration déjà marquée « applied » par simple
  modification du fichier local ; seul un `migration repair`/une réconciliation explicite du ledger
  changerait cela, et aucune n'est demandée ni effectuée ici.
- Le dépôt et le ledger distant peuvent donc diverger légèrement en contenu (texte du fichier) sans
  jamais diverger en effet réel côté production (la ligne y existe déjà, que le fichier local soit
  gardé conditionnel ou non).
- Une stratégie de réconciliation de ledger (semblable à celle déjà nécessaire pour MIG-01) pourra
  être nécessaire plus tard, à documenter séparément, jamais exécutée sans audit préalable en lecture
  seule de `supabase_migrations.schema_migrations`.
- Aucune commande de `repair` destructrice n'est préparée ni recommandée par cette analyse.

## 9. Fichiers qui seraient modifiés (si autorisé plus tard)

- `supabase/migrations/20260715000002_recreate_pir_test_fixture.sql` — ajout d'une clause
  `WHERE EXISTS` (Option A) ou remplacement de son contenu par un no-op documenté (Option B).
  **Aucune autre migration existante ne nécessite de modification** (confirmé section 5 :
  aucune autre fixture bloquante trouvée).
- Éventuellement un test dédié (sous `scripts/` ou `tests/`, à définir lors de l'autorisation)
  vérifiant l'absence de toute fixture partenaire de test après un double `supabase db reset` —
  hors périmètre de cette phase d'analyse.
- `audit-kaytek-inter/corrections/correction-mig-02-debug-fixtures.md` (futur rapport de correction,
  pas créé dans cette phase).

## 10. Tests nécessaires après autorisation

```bash
supabase stop --no-backup
supabase start
supabase db reset
supabase db reset   # second reset, répétabilité
```

Puis vérifier :
- zéro fixture partenaire de test (`partner_intervention_requests` vide de toute ligne de test,
  notamment aucune ligne avec `id` ou `connection_id` correspondant aux UUID de debug identifiés en
  section 2) ;
- état final des policies `pir_select`/`pir_update`/`pie_select` identique à celui documenté en
  section 4 ;
- aucun UUID de debug présent, aucun email de test ;
- aucun trigger ni policy diagnostic actif (`pg_policies`/`pg_trigger` ne référencent plus
  `USING(true)` ni de fonction `diag_*`) ;
- Corrections 1 à 6 toujours intactes et présentes ;
- progression du reset au-delà de la migration ~103 — reste à confirmer qu'aucun **autre** blocage
  n'existe plus loin dans l'historique (Corrections 1-6 elles-mêmes, migrations 20260722-20260727,
  déjà connues et déjà validées individuellement mais jamais rejouées à la suite d'un bootstrap
  complet réussi) ;
- `npm run test:security` exécutable dans son intégralité (dépend du reset complet).

## 11. Rollback (si une correction est appliquée plus tard)

```bash
git checkout -- supabase/migrations/20260715000002_recreate_pir_test_fixture.sql
supabase stop --no-backup
```

Aucune autre migration ne serait concernée.

## 12. Niveau de confiance

| Élément | Confiance |
|---|---:|
| Erreur exacte, migration bloquante, UUID/contrainte concernés | **Élevée** — reproduite deux fois, message identique |
| Nature de la fixture (test, sans effet final) | **Élevée** — commentaire explicite + cleanup confirmé par migration ultérieure déjà existante |
| État final de `pir_select`/`get_partner_requests_preview` (remplacés par Corrections 3/3 bis) | **Élevée** — confirmé par lecture directe des deux migrations et leur propre commentaire de portée |
| État final de `pir_update`/`respond_to_partner_intervention_request()` (figé à `20260715000009`) | **Élevée** — recherche exhaustive confirmant l'absence de toute modification ultérieure |
| Absence d'une seconde fixture bloquante après la migration 103 | **Élevée** — recherche exhaustive par motif sur l'ensemble du dossier de migrations, frontière nette confirmée avant les Corrections 1 à 6 |
| Origine exacte du `connection_id`/des organisations réelles utilisées (jamais capturées par une migration) | **Moyenne** — cohérente avec le schéma déjà observé pour MIG-01 (données/objets créés hors dépôt), mais non vérifiable sans accès en lecture à la production |

Analyse MIG-02 terminée. J'attends votre autorisation avant toute modification des migrations de diagnostic.
