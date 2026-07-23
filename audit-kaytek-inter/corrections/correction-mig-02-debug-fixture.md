# Correction MIG-02 — Neutralisation conditionnelle de la fixture partenaire orpheline

## 0. Résultat en une phrase

**La correction MIG-02 elle-même a fonctionné exactement comme prévu et est confirmée empiriquement** :
`20260715000002_recreate_pir_test_fixture.sql` ne bloque plus le bootstrap, zéro fixture n'est créée
sur une base neuve, et l'assertion de fin de séquence (`20260715000013_final_state_check.sql`)
confirme directement « test fixture rows remaining (should be 0): **0** » et « diag functions
remaining (should be 0): **0** ». Le premier `supabase db reset` progresse ensuite jusqu'à
`20260722000001_subscription_access_enforcement.sql` (Correction 2), où il échoue sur une assertion
interne **sans rapport avec MIG-02** (droits `EXECUTE` de `anon` sur une fonction). Conformément au
périmètre strictement autorisé de cette correction (« ne modifie aucun autre fichier de migration »),
je ne l'ai pas corrigée. Le critère « deux resets complets réussissent » n'est donc **pas** atteint,
et la suite de tests npm (section 7 de l'autorisation) n'a pas été exécutée.

## 1. Migration modifiée

`supabase/migrations/20260715000002_recreate_pir_test_fixture.sql` — seul fichier touché, comme
autorisé.

## 2. SQL avant

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
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '6c6f3cb6-04e0-4947-9225-3ebcff8933a3',
  '10b3a27e-19a4-4ed5-a150-10bb3d0a8ab6',
  '59e65e97-326d-484d-911d-fb0c72212cb6',
  'ff6cf5ec-7156-43bb-bc83-979b0d64d82e',
  'pending', 'serrurerie', false, 'Paris',
  true, '42 rue Confidentielle, 75001 Paris',
  true, '0699887766',
  true, 'CONFIDENTIEL Dupont',
  true, 'Porte claquée, client bloqué dehors',
  true, 90, false
)
ON CONFLICT (id) DO NOTHING;
```

## 3. SQL après

```sql
INSERT INTO public.partner_intervention_requests (
  id, connection_id, source_organisation_id, source_profile_id,
  target_organisation_id, status, type_intervention, urgence, ville,
  share_adresse, adresse_partagee, share_telephone, telephone_client_partage,
  share_nom_client, nom_client_partage, share_description, description_partagee,
  share_montant, montant_partage, share_photos
)
SELECT
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '6c6f3cb6-04e0-4947-9225-3ebcff8933a3',
  '10b3a27e-19a4-4ed5-a150-10bb3d0a8ab6',
  '59e65e97-326d-484d-911d-fb0c72212cb6',
  'ff6cf5ec-7156-43bb-bc83-979b0d64d82e',
  'pending', 'serrurerie', false, 'Paris',
  true, '42 rue Confidentielle, 75001 Paris',
  true, '0699887766',
  true, 'CONFIDENTIEL Dupont',
  true, 'Porte claquée, client bloqué dehors',
  true, 90, false
WHERE EXISTS (
  SELECT 1 FROM public.partner_connections
  WHERE id = '6c6f3cb6-04e0-4947-9225-3ebcff8933a3'
)
ON CONFLICT (id) DO NOTHING;
```

Différence stricte : `VALUES (...)` devient `SELECT ... WHERE EXISTS (...)`. **Aucune colonne,
aucune valeur, aucun UUID n'a été modifié ou ajouté** — la liste de colonnes et les 20 valeurs
littérales sont identiques caractère pour caractère à l'original.

## 4. Raison du `WHERE EXISTS`

Le `connection_id` (`6c6f3cb6-...`) référencé par cette fixture n'est créé par aucune migration de
ce dépôt (voir `analyse-mig-01-bootstrap-migrations.md` et `analyse-mig-02-debug-fixtures.md`) — il
existait réellement, hors dépôt, sur la base où l'investigation du 15 juillet a eu lieu. Sur un
bootstrap neuf, cette ligne de `partner_connections` n'existe jamais, et l'`INSERT` d'origine
échouait systématiquement sur la contrainte `partner_intervention_requests_connection_id_fkey`. Le
`WHERE EXISTS` fait dépendre l'insertion de la présence réelle de ce prérequis, sans jamais le
fabriquer.

## 5. Absence de fausse connexion créée

Confirmé : cette correction ne contient aucune instruction `INSERT`/`UPDATE` sur
`public.partner_connections`, `public.organisations` ou `public.profiles`. Elle ne fait que
**vérifier** l'existence d'une ligne par son identifiant — jamais la créer. Sur une base neuve, la
condition `WHERE EXISTS` est fausse et le `SELECT` ne produit aucune ligne à insérer.

## 6. Impact sur base neuve

Confirmé empiriquement lors du premier `supabase start` local (voir section 9) : la migration
s'applique désormais **sans erreur**, insère **0 ligne**, et la vérification finale de la séquence
(`20260715000013_final_state_check.sql`, déjà présente, non modifiée) rapporte explicitement
`test fixture rows remaining (should be 0): 0`.

## 7. Impact sur base existante

Comportement inchangé par construction : si `partner_connections` contient déjà la ligne
`6c6f3cb6-...` (comme c'était le cas sur la base où l'investigation a eu lieu), le `WHERE EXISTS` est
vrai et l'`INSERT` s'exécute exactement comme avant, avec les mêmes valeurs. Aucune régression
possible sur ce cas.

## 8. Relation avec la migration de cleanup

`20260715000010_cleanup_pir_investigation.sql` (non modifiée) supprime ensuite cette même ligne par
son `id` (`DELETE ... WHERE id = 'aaaaaaaa-...'`). Que la ligne ait été insérée (base existante) ou
non (base neuve), ce `DELETE` reste sans erreur dans les deux cas (une suppression par identifiant
absent affecte simplement 0 ligne en PostgreSQL). L'état final — aucune fixture ne subsiste — est
donc strictement identique dans les deux scénarios, confirmé par `20260715000013`.

## 9. Résultat du premier reset

Garde anti-production vérifiée avant tout test (section 8 de l'autorisation) :

| Scénario | Code sortie |
|---|---:|
| Configuration absente | 1 (refus, variables listées) |
| URL distante fictive | 1 (`REFUS : ... jamais ... contre la production.`) |
| `VITE_*` seul, sans repli | 1 (mêmes 4 variables `SUPABASE_TEST_*` toujours manquantes) |

```bash
$ docker ps                     # exit 0
$ supabase stop --no-backup     # exit 0
$ supabase start
...
Applying migration 20260715000002_recreate_pir_test_fixture.sql...   ← ne bloque plus
Applying migration 20260715000003_diag_pir_update_minimal.sql...
...
Applying migration 20260715000013_final_state_check.sql...
NOTICE: test fixture rows remaining (should be 0): 0
NOTICE: diag functions remaining (should be 0): 0
NOTICE: RPC respond_to_partner_intervention_request exists: t
NOTICE: RPC get_partner_requests_preview exists: t
Applying migration 20260722000001_subscription_access_enforcement.sql...
Stopping containers...
ERROR: Assertion échouée : anon a EXECUTE sur current_organisation_has_app_access() (SQLSTATE P0001)
At statement: 48
(exit 1)
```

**MIG-02 elle-même est donc validée avec succès** : le bootstrap traverse intégralement
`20260715000002` et toute la séquence de diagnostic du 13 au 15 juillet, jusqu'à
`20260715000013` inclus, sans aucune erreur et avec les propriétés attendues confirmées par les
`NOTICE` ci-dessus.

**Un nouveau blocage, sans rapport avec MIG-02, est apparu ensuite** dans
`20260722000001_subscription_access_enforcement.sql` (Correction 2 / SEC2-01), à son assertion
statique 13.3 :
```sql
IF has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
  RAISE EXCEPTION 'Assertion échouée : anon a EXECUTE sur current_organisation_has_app_access()';
```
Cette migration crée la fonction, fait `ALTER FUNCTION ... OWNER TO postgres`, puis
`REVOKE ALL ON FUNCTION ... FROM PUBLIC` et `GRANT EXECUTE ... TO authenticated, service_role` —
mais jamais un `REVOKE EXECUTE ... FROM anon` explicite. Hypothèse (non vérifiée plus avant, hors
mandat strict de cette correction) : les images Postgres locales fournies par la Supabase CLI
appliquent probablement un privilège par défaut (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
FUNCTIONS TO anon`) pour le rôle créateur des objets — un `REVOKE ALL ... FROM PUBLIC` ne retire pas
un privilège accordé directement à `anon` (par opposition à un privilège hérité de `PUBLIC`). Ce
comportement, s'il se confirme, affecterait potentiellement **toute** fonction créée par ce dépôt qui
suit ce même style `REVOKE ... FROM PUBLIC` sans `REVOKE ... FROM anon` explicite — mais **aucune
vérification supplémentaire n'a été faite**, conformément au périmètre strict de cette correction
(« ne modifie aucun autre fichier de migration »). **Aucune tentative de correction n'a été faite sur
`20260722000001`.**

Conteneurs : arrêtés automatiquement par le CLI après l'échec (confirmé : `docker ps -a` vide,
`supabase status` répond `No such container`) — aucun nettoyage manuel nécessaire.

## 10. Résultat du second reset

**Non exécuté** — conformément à l'autorisation (« si le premier reset réussit entièrement, exécute
un second »), le premier reset ne s'étant pas terminé avec succès (échec dans Correction 2, après le
périmètre de MIG-02), un second reset n'apporterait aucune information supplémentaire.

## 11. État final des policies/fonctions partenaires

Confirmé directement par les `NOTICE` de `20260715000013_final_state_check.sql` (section 9) — au
point où le bootstrap s'est arrêté (juste après cette séquence, avant les Corrections 1 à 6) :

- `pir_select` : masquage par statut (source : accès total ; cible : accès complet uniquement si
  `accepted`/`in_progress`/`completed`) — sera ensuite remplacée par Correction 3, non encore
  atteinte dans ce run.
- `pir_update` : org membre + admin — définition finale confirmée (aucune migration ultérieure ne la
  retouche, voir `analyse-mig-02-debug-fixtures.md` section 4).
- `respond_to_partner_intervention_request()` : présente (`exists: t`) — définition finale confirmée.
- `get_partner_requests_preview()` : présente (`exists: t`) — sera ensuite remplacée par Correction 3
  bis (`20260724000001`), non encore atteinte dans ce run.
- **Aucune policy `USING(true)` temporaire active**, **aucune fonction de diagnostic active** (`diag
  functions remaining: 0`) — confirmé directement.
- **Aucun UUID de fixture présent dans les données** (`test fixture rows remaining: 0`) — confirmé
  directement.

Les Corrections 3 et 3 bis elles-mêmes n'ont pas encore été rejouées dans ce run précis (le reset
s'est arrêté avant, à Correction 2) — leur propre effet (déjà validé individuellement lors des
Corrections 3/3 bis d'origine) reste donc à confirmer lors d'un futur run complet, une fois le nouveau
blocage de Correction 2 traité séparément.

## 12. Tests de sécurité exécutés

**Aucun** — conditionnés explicitement par l'autorisation à la réussite complète des deux resets, non
atteinte. `npm run test:unit`, `test:security:sql`, `test:security:storage`,
`test:security:edge-functions`, `test:security:concurrency`, `test:security:playwright`,
`test:security` : non lancés.

## 13. Tests réussis / échoués / ignorés

| Bloc | Statut |
|---|---|
| Garde anti-production (3 scénarios négatifs) | Réussis (3/3) |
| `20260715000002` (fixture MIG-02) | **Réussi** — ne bloque plus, 0 ligne créée |
| Séquence complète 13-15 juillet (diagnostics + cleanups) | **Réussie** — 0 fixture, 0 fonction diag restante |
| `20260722000001` (Correction 2) | **Échoué** — assertion `anon` EXECUTE, hors périmètre MIG-02 |
| Second reset | Non exécuté (condition non remplie) |
| Suite `npm run test:security*` | Non exécutée (condition non remplie) |

## 14. Limites

- MIG-02 est une correction **complète et validée dans son périmètre exact** — la fixture ne bloque
  plus, aucune donnée partenaire fictive n'a été créée, l'état final (0 fixture, 0 fonction diag) est
  confirmé directement par les propres assertions déjà présentes dans l'historique.
- Le critère global « deux resets complets réussissent » **n'est pas atteint**, à cause d'un problème
  **entièrement distinct**, situé dans `20260722000001_subscription_access_enforcement.sql`
  (Correction 2), portant sur un privilège `EXECUTE` `anon` inattendu sur
  `current_organisation_has_app_access()`. Ce problème n'a pas été corrigé, conformément au périmètre
  strict de cette autorisation.
- L'hypothèse de cause (privilège par défaut de la plateforme Supabase locale non explicitement
  révoqué pour `anon`) n'a pas été vérifiée en profondeur — à traiter comme une analyse séparée future
  si autorisée.
- Il reste possible que d'autres fonctions du dépôt suivant le même style (`REVOKE ... FROM PUBLIC`
  sans `REVOKE ... FROM anon` explicite) présentent le même symptôme plus loin dans le bootstrap —
  non vérifié, hors mandat de cette correction.

## 15. Divergence potentielle avec le ledger production

Cette correction modifie **une migration très probablement déjà appliquée en production**
(`20260715000002`), puisque le `connection_id` qu'elle référence y existait réellement au moment de
l'investigation d'origine — c'est justement pour cette raison que l'`INSERT` d'origine y a réussi.

- Cette modification **ne sera pas rejouée automatiquement en production** : Supabase ne réexécute
  jamais une migration déjà marquée « applied » dans `supabase_migrations.schema_migrations` du seul
  fait qu'un fichier local a changé.
- Le ledger distant peut donc conserver indéfiniment la version historique (`VALUES` inconditionnel)
  tant qu'aucune réconciliation explicite n'est effectuée — ce qui est **sans impact réel** puisque la
  ligne y existe déjà de toute façon.
- L'objectif de cette correction est **exclusivement** de rendre les installations neuves (bootstrap
  local, CI) reproductibles depuis zéro — ce n'est **pas** une migration de production classique et
  elle ne doit pas être présentée comme telle.
- **Aucun `migration repair` distant n'a été exécuté.** Aucune donnée de production n'a été touchée,
  lue ou modifiée par cette correction.

## 16. Rollback local exact

```bash
git checkout -- supabase/migrations/20260715000002_recreate_pir_test_fixture.sql
supabase stop --no-backup
```

Aucune autre migration n'est concernée par ce rollback.

## 17. Absence d'opération distante

Aucune commande n'a contacté un projet Supabase distant. Aucun `supabase db push`, aucun `migration
repair`, aucune requête contre la production. `docker ps`/`supabase status` confirment qu'aucune
stack locale n'est restée active après cette session. Aucun commit, aucun push.

## Fichiers modifiés

- `supabase/migrations/20260715000002_recreate_pir_test_fixture.sql` (seule migration modifiée, comme
  autorisé).
- `audit-kaytek-inter/corrections/correction-mig-02-debug-fixture.md` (ce rapport, nouveau).

Aucun autre fichier de migration, aucun fichier frontend, Edge Function, script ou test n'a été
modifié.

MIG-02 non validée. Le bootstrap ou une suite critique reste en échec. J'attends votre autorisation avant toute nouvelle correction.
