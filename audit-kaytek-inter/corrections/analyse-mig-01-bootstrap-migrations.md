# Analyse MIG-01 — Rendre l'historique des migrations reproductible depuis zéro

Document d'**analyse uniquement**. Aucun fichier de migration n'a été modifié, renommé ou créé.
Aucune commande distante n'a été exécutée. Toutes les commandes ci-dessous ont tourné exclusivement
contre Docker/Supabase **local**.

## 1. Erreur exacte reproduite

```bash
$ supabase stop --no-backup
Stopping containers...
Stopped supabase local development setup.

$ supabase start
...
Starting database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 20260605000000_push_subscriptions.sql...
Stopping containers...
ERROR: relation "profiles" does not exist (SQLSTATE 42P01)
At statement: 0
-- Migration: push_subscriptions table + trigger pour Web Push

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
)
Try rerunning the command with --debug to troubleshoot the error.
(exit 1)
```

- **Migration fautive (au sens "premier point d'échec")** : `20260605000000_push_subscriptions.sql`.
- **Ligne SQL exacte** : `user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,`
  (statement n°0 du fichier — la toute première instruction exécutée).
- **Message PostgreSQL complet** : `ERROR: relation "profiles" does not exist`.
- **Code d'erreur** : `SQLSTATE 42P01` (`undefined_table`).
- **Conteneurs** : arrêtés **automatiquement** par le CLI Supabase après l'échec (`Stopping
  containers...` apparaît dans le log immédiatement après l'erreur). Confirmé après coup :
  `docker ps -a` retourne une liste vide et `supabase status` répond
  `failed to inspect container health: ... No such container: supabase_db_kaytek-final` — aucun
  nettoyage manuel n'a été nécessaire.
- Reproduit deux fois (session de validation précédente + cette session), résultat strictement
  identique à chaque fois.

## 2. Analyse de la migration en échec (`20260605000000_push_subscriptions.sql`)

Contenu intégral (47 lignes) :

- **Table créée** : `push_subscriptions` (`id`, `user_id`, `endpoint`, `p256dh`, `auth`,
  `created_at`).
- **FK** : `user_id → profiles(id) ON DELETE CASCADE`.
- **RLS** : `ENABLE ROW LEVEL SECURITY` + 3 policies (`push_sub_insert`, `push_sub_select`,
  `push_sub_delete`), toutes basées sur `auth.uid() = user_id`.
- **Fonction créée** : `notify_push_on_new_message()` — `SECURITY DEFINER`, appelle
  `net.http_post(...)`.
- **Trigger créé** : `on_new_message_push` `AFTER INSERT ON messages` → exécute la fonction
  ci-dessus.
- **Grants explicites** : aucun (RLS + policies uniquement).

**Dépendances de cette migration** :

| Objet référencé | Type | Migration de création | Existe au 20260605000000 ? | Bloquant |
|---|---|---|---:|---:|
| `profiles` | table | **Aucune** (jamais créée dans le dépôt) | Non | **Oui — cause de l'échec reproduit** |
| `messages` | table (cible du `CREATE TRIGGER ... ON messages`) | **Aucune** (jamais créée dans le dépôt) | Non | Oui (masqué par l'échec précédent, se manifesterait juste après si `profiles` était contourné isolément) |
| `auth.uid()` | fonction (schéma `auth`, GoTrue) | Fournie par la plateforme Supabase (schéma système, jamais dans `supabase/migrations`) | Oui (toujours disponible dès le démarrage du conteneur `db`) | Non |
| `net.http_post()` | fonction (extension `pg_net`) | Fournie par l'image Postgres locale de Supabase (extension pré-activée par la plateforme, pas par une migration du dépôt) | Oui | Non |
| `gen_random_uuid()` | fonction (extension `pgcrypto`) | Fournie par la plateforme Supabase (pré-activée) | Oui | Non |
| `notify_push_on_new_message()` | fonction | Créée par cette même migration, juste avant le `CREATE TRIGGER` | Oui (auto-référence intra-fichier) | Non |

**Constat additionnel important** (voir aussi section 6 — risque de production) : la fonction
`notify_push_on_new_message()` contient une **URL de production codée en dur**
(`https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push`) et un **jeton JWT anon codé en
dur** directement dans le corps SQL versionné. Ce point est traité séparément en section 4 (trouvé
en cherchant d'autres trous de bootstrap) car il dépasse la seule question d'ordonnancement.

## 3. Reconstruction de l'historique complet

Recherche exhaustive de tout `CREATE TABLE` (avec ou sans `IF NOT EXISTS`) dans les 107 fichiers de
`supabase/migrations/` :

| Table | Créée par une migration ? | Fichier de création |
|---|---|---|
| `organisations` | **Oui** | `20260610000001_create_organisations.sql` |
| `devices` | **Oui** | `20260605000006_devices_security.sql` |
| `subscriptions` (abonnements) | **Oui** | `20260709000002_version_stripe_tables.sql` |
| `stripe_webhook_events` | **Oui** | `20260709000002_version_stripe_tables.sql` |
| `document_counters` | **Oui** | `20260725000001_organisation_scoped_document_numbering.sql` |
| `document_public_links` | **Oui** | `20260618000001_document_public_links.sql` |
| `guide_progress` / `guide_news` / `guide_videos` | **Oui** | `20260615000001/2/3_*.sql` |
| `partner_profiles` / `partner_connections` / `partner_connection_events` / `partner_intervention_requests` / `partner_intervention_events` / `partner_messages` | **Oui** | `20260708000002/4/5_*.sql` |
| `push_subscriptions` | **Oui** | `20260605000000_push_subscriptions.sql` (la migration en échec elle-même) |
| **`profiles`** | **Non — jamais** | — |
| **`clients`** | **Non — jamais** | — |
| **`devis`** | **Non — jamais** | — |
| **`factures`** | **Non — jamais** | — |
| **`interventions`** | **Non — jamais** | — |
| **`messages`** | **Non — jamais** | — |
| **`notifications`** | **Non — jamais** | — |
| **`journal`** | **Non — jamais** | — |
| **`photos`** | **Non — jamais** | — |
| **`prestations`** | **Non — jamais** | — |
| **`parametres_entreprise`** | **Non — jamais** | — |
| **`commissions`** | **Non — jamais** | — |
| **`commission_receipts`** | **Non — jamais** | — |

**Conclusion centrale, plus large que le périmètre initialement décrit** : ce n'est pas seulement
`profiles` qui manque « en avance de phase ». **13 tables fondamentales de l'application ne sont
créées par AUCUNE migration du dépôt**, sur les 107 fichiers existants (couvrant le 5 juin au 26
juillet 2026). Elles sont pourtant abondamment référencées : `profiles` dans 37 fichiers,
`interventions` dans 31, `devis` dans 26, `factures` dans 23, `notifications` dans 15, `journal` et
`prestations` dans 12 chacune, `commissions` dans 10, `commission_receipts` et
`parametres_entreprise` dans 8-9 chacune. Cela ne peut s'expliquer que par une chose : **le schéma
applicatif fondamental (tables métier + colonnes + au moins un trigger, voir section 4) a été créé
directement sur le projet Supabase distant — via le Dashboard/éditeur SQL ou un import initial — avant
que le suivi par fichiers de migration versionnés ne commence, le 5 juin 2026.** Le dossier
`supabase/migrations/` ne capture que les évolutions incrémentales appliquées PAR-DESSUS ce socle non
versionné.

**Chronologie des premiers points d'impact** (si l'on contournait uniquement l'échec sur `profiles`
sans corriger le problème de fond, voici les échecs qui se produiraient ensuite, dans l'ordre) :

| Ordre | Migration | Première table manquante rencontrée |
|---|---|---|
| 1 | `20260605000000_push_subscriptions.sql` | `profiles` (échec déjà reproduit) |
| 2 | `20260605000004_rls_role_policies.sql` | `clients`, `commissions`, `devis`, `factures`, `interventions`, `journal`, `parametres_entreprise`, `photos`, `prestations` (9 tables à la fois) |
| 3 | `20260610000011_commission_receipts_organisation_id.sql` | `commission_receipts` |
| 4 | `20260610000013_notifications_organisation_id.sql` | `notifications` |

Aucune de ces 13 tables ni la migration qui les référence pour la première fois ne fait partie des
Corrections 1 à 6 — toutes sont antérieures de plusieurs semaines.

**Vérifications complémentaires effectuées (aucun autre problème d'ordonnancement trouvé parmi les
tables qui, elles, SONT créées par des migrations)** :

- `organisations` : aucune migration antérieure à `20260610000001` n'y fait référence — clean.
- `subscriptions` (la vraie table d'abonnements) : la seule occurrence antérieure à
  `20260709000002` est un **faux positif** — le mot « subscriptions » dans
  `20260610000020_rls_phase4_photos_messages.sql` désigne les *subscriptions Realtime* de
  PostgreSQL/Supabase (WebSocket), sans rapport avec la table `public.subscriptions`.
- `document_counters` : aucune référence avant `20260725000001` — clean.
- `partner_profiles` : aucune référence avant `20260708000002` — clean.
- `is_admin_in_org()` / `current_org_id()` (helpers RLS, créés dans
  `20260610000016_rls_helpers_multitenant.sql`) : aucune migration antérieure ne les utilise — clean.

## 4. Autres trous de bootstrap recherchés

| Catégorie recherchée | Résultat |
|---|---|
| FK vers une table créée plus tard **au sein du dépôt** | Aucune trouvée (le cas `profiles`/`messages`/etc. n'est pas "créée plus tard", c'est "jamais créée" — catégorie distincte, section 3) |
| Trigger sur une table inexistante dans le dépôt | **Oui** — `trg_push_on_notification` sur `public.notifications` : ce trigger est activement maintenu (sa fonction est redéfinie dans `20260610000032`, `20260708000001`, `20260708000008`, avec des requêtes de vérification qui *attendent* qu'il existe) mais **son `CREATE TRIGGER` d'origine n'apparaît dans AUCUNE migration du dépôt** — comme `notifications` elle-même, il a été créé hors dépôt |
| Policy sur une table inexistante dans le dépôt | Toutes les policies sur les 13 tables listées en section 3 sont dans ce cas — même cause unique, pas 13 causes indépendantes |
| Fonction utilisant une table inexistante dans le dépôt | Idem (`is_admin_in_org`, `current_org_id`, etc. une fois créés, référencent `profiles` en interne — cohérent avec la même cause) |
| `ALTER TABLE` avant `CREATE TABLE` **du même objet, dans le dépôt** | Aucun cas trouvé parmi les tables créées par migration ; systématique en revanche pour les 13 tables jamais créées (chaque `ALTER TABLE clients/devis/...` suppose la table déjà là) — même cause unique |
| `CREATE INDEX` avant la création de la colonne visée | Non vérifié exhaustivement colonne par colonne sur les 107 fichiers (volume trop important pour cette analyse) — risque jugé faible car le style constaté dans tout le dépôt place systématiquement `ALTER TABLE ... ADD COLUMN` et l'index associé dans le même fichier |
| `GRANT` sur une fonction créée plus tard | Non trouvé — le style du dépôt place systématiquement `REVOKE`/`GRANT` juste après le `CREATE FUNCTION` correspondant, dans le même fichier, à chaque occurrence inspectée |
| `DROP POLICY`/`DROP TRIGGER`/`DROP FUNCTION` sans `IF EXISTS` | Aucune occurrence réelle trouvée (les seules correspondances brutes sont des mentions dans des commentaires, pas de véritables instructions SQL) |
| Dépendance à une extension non encore créée | `pgcrypto` (une seule `CREATE EXTENSION IF NOT EXISTS` explicite, dans `20260618000001`) et `pg_net` (jamais explicitement créée dans le dépôt) — **non bloquant** : les images Postgres locales fournies par la Supabase CLI activent nativement `pgcrypto`/`pg_net`/`uuid-ossp` au niveau plateforme, indépendamment des migrations du dépôt (confirmé : l'échec reproduit ne porte jamais sur `net.http_post` ou `gen_random_uuid`, uniquement sur `profiles`) |
| Dépendance à un objet créé manuellement hors dépôt | **Oui, catégorie dominante** — les 13 tables de la section 3 + le trigger `trg_push_on_notification` |
| **URL de production codée en dur dans une migration versionnée** | **Oui — trouvaille distincte et sérieuse**, détaillée ci-dessous |

### Trouvaille distincte : URL de production et jeton codés en dur dans des migrations versionnées

`grep -l "net\.http_post" *.sql` fait apparaître **5 fichiers** :
`20260605000000_push_subscriptions.sql`, `20260610000032_fix_notify_push_search_path.sql`,
`20260630000003_interventions_rappels.sql` (commentaire seul, inactif),
`20260708000001_fix_pg_net_notification_body_type.sql`,
`20260708000008_security_phase1_critical_hardening.sql`.

- Dans **`20260605000000`** : la fonction `notify_push_on_new_message()` et son trigger
  `on_new_message_push` (sur `messages`) sont supprimés dès la migration **suivante**
  (`20260605000001_remove_push_trigger.sql`, `DROP TRIGGER` + `DROP FUNCTION`) et **jamais
  recréés** — à l'état final (HEAD), ce chemin précis est du code mort, sans risque d'exécution
  automatique. L'URL de production et le JWT anon codés en dur y restent présents dans l'historique
  Git (fichier toujours suivi), mais inertes.
- En revanche, **`trigger_push_on_notification()`** (fonction distincte, sur `public.notifications`,
  via le trigger `trg_push_on_notification`) est **activement maintenue et toujours active à HEAD** :
  redéfinie par `20260610000032`, `20260708000001`, puis `20260708000008` (durcissement sécurité
  SEC-06). Sa dernière version (`20260708000008`) contient **toujours** :
  - la même URL de production codée en dur : `https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/send-push` ;
  - le même jeton anon JWT codé en dur (commenté comme volontairement non secret, cohérent avec un
    anon key) ;
  - **seule amélioration réelle** : le secret interne (`X-Internal-Secret`) n'est plus codé en dur —
    il est désormais lu via `public.get_internal_push_secret()` → `vault.decrypted_secrets` (rotation
    SEC-06, commentaire explicite : *"ancien secret hardcodé dans les migrations invalidé"*).
- **Implication directe pour toute validation locale future** : ce trigger `trg_push_on_notification`
  est censé exister sur `public.notifications` en production (comme `notifications` elle-même, il
  n'est créé par aucune migration du dépôt). Si un futur bootstrap local (quelle que soit l'option
  choisie en section 5) recrée fidèlement le schéma de production — y compris ce trigger — alors
  **tout `INSERT INTO notifications` exécuté localement (par exemple par l'Edge Function
  `send-reminders`, ou par les futurs tests de concurrence/Storage de la Correction 6) déclencherait
  un vrai appel HTTP sortant vers l'URL de production**, en violation directe de la règle « aucune
  URL distante » qui structure tout le travail de validation des Corrections 1 à 6. Ce point devra
  être neutralisé explicitement (variable d'environnement, table de config, ou suppression du
  trigger côté bootstrap local) **dans la future correction**, pas ignoré.

## 5. Comparaison des stratégies

### Option A — Corriger le contenu de l'ancienne migration (retarder la FK, etc.)

- **Ne résout pas le problème de fond** : `profiles` n'est pas "créée plus tard" dans le dépôt, elle
  n'est créée **nulle part**. Retarder la FK à l'intérieur de `20260605000000` ferait au mieux
  passer CETTE migration, pour échouer immédiatement sur `20260605000004_rls_role_policies.sql` (9
  tables manquantes d'un coup), puis sur les suivantes — exactement le piège que la règle 11
  demande d'éviter.
- **Risque de production** : cette migration est très probablement déjà marquée "appliquée" dans
  `supabase_migrations.schema_migrations` sur la production (où `profiles` existait déjà
  manuellement). Modifier son contenu changerait son checksum, ce que Supabase CLI peut signaler
  comme une divergence entre le fichier local et l'historique distant enregistré.
- **Conclusion** : **non viable**, à la fois insuffisante et risquée. Écartée. (Interdite de toute
  façon par la règle 4 de cette phase.)

### Option B — Renommer/reclasser la migration après la création de `profiles`

- Il n'existe **aucun point chronologique** dans le dépôt où déplacer ce fichier réglerait quoi que
  ce soit, puisque `profiles` n'est créée par aucune migration existante.
- Renommer un fichier déjà appliqué en production change son identifiant de version
  (`supabase_migrations.schema_migrations` indexe par le préfixe timestamp) — la production
  considérerait alors ce "nouveau" nom comme une migration jamais appliquée, avec un risque réel de
  tentative de ré-application d'objets déjà existants (succès accidentel si tout est idempotent,
  échec sinon) ou de nécessiter un `migration repair` distant pour réconcilier — explicitement
  interdit dans cette phase (règle 8) et risqué même plus tard.
- **Conclusion** : **non viable seule**, et porteuse d'un risque réel sur l'historique distant.
  Écartée comme solution principale.

### Option C — Nouvelle migration de bootstrap avec timestamp antérieur

- Vérifié spécifiquement pour ce dépôt : **aucune migration existante ne recrée** `profiles` ni
  aucune des 12 autres tables manquantes de façon non idempotente — donc une nouvelle migration de
  bootstrap (avec `CREATE TABLE IF NOT EXISTS` pour chacune) ne rentrerait en collision avec aucun
  fichier déjà présent dans le dépôt.
- Reste à résoudre : (1) obtenir le schéma **exact** de ces 13 tables + du trigger
  `trg_push_on_notification` — cela nécessite une lecture (seule) du schéma réel de production,
  différée à une étape ultérieure autorisée (section 6) plutôt que déduite par approximation des
  `ALTER TABLE` dispersés ; (2) réconcilier ensuite l'historique distant, très probablement via
  `supabase migration repair --status applied <nouvelle-version>` exécuté **explicitement plus
  tard, avec autorisation**, pour que production ne tente jamais de RE-exécuter ce fichier (les
  objets y existent déjà).
- **Conclusion** : **viable en principe**, sous réserve d'un schéma exact et d'une réconciliation
  distante soigneuse, différée. C'est la mécanique recommandée (voir stratégie retenue ci-dessous).

### Option D — Baseline propre séparée pour les nouvelles installations

- Approche documentée par Supabase elle-même pour les historiques qui ne rejouent plus proprement
  depuis zéro (schéma déclaratif / migration de baseline + archivage de l'historique legacy).
- Avantages : garantit un bootstrap neuf rapide et correct sans avoir à raisonner migration par
  migration sur la compatibilité de chacune des ~90 fichiers qui dépendent des 13 tables ; contourne
  entièrement le problème de rejeu chronologique pour les nouveaux environnements.
- Inconvénients : risque de perdre la traçabilité fine (mitigé si les 107 migrations existantes sont
  **archivées**, jamais supprimées) ; nécessite une construction initiale très soigneuse pour que le
  schéma neuf soit rigoureusement identique à celui obtenu par (socle historique + 107 migrations) ;
  pose la même question de réconciliation avec le ledger de production qu'Option C.
- Vu le volume de contexte métier et sécurité déjà documenté dans les 107 migrations existantes
  (rollbacks, assertions, historique des corrections SEC-01 à SEC-08, etc.), une bascule complète
  vers un unique snapshot dès maintenant serait disproportionnée par rapport au problème réellement
  constaté (13 tables manquantes, pas tout l'historique).
- **Conclusion** : **viable, mais plus lourde qu'Option C pour le problème réellement observé ici** —
  à garder en réserve si la liste des trous de bootstrap s'avérait en réalité beaucoup plus étendue
  après une lecture du schéma de production, ou pour une refonte future plus large.

### Option E — Migration conditionnelle/idempotente

- N'est pas une alternative séparée à C/D mais une **technique d'implémentation** : `CREATE TABLE IF
  NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` sont déjà le
  style dominant de tout le dépôt (confirmé section 4 : quasi aucun `DROP` sans `IF EXISTS`).
  Appliquer ce même style à une nouvelle migration de bootstrap (Option C) n'est pas un artifice qui
  « masquerait » un historique incohérent — c'est la manière standard, recommandée par Supabase, de
  rendre une migration sûre à la fois pour une base neuve (où elle crée réellement les objets) et
  pour la production (où elle ne fait rien, les objets existant déjà).
- Appliquer cette technique en modifiant rétroactivement les migrations EXISTANTES (plutôt que via un
  seul nouveau fichier) est en revanche écarté : cela violerait la règle 4 (« ne modifie aucune
  ancienne migration ») et disperserait le correctif sur des dizaines de fichiers au lieu de le
  centraliser.

### Stratégie recommandée (analyse — pas d'action à ce stade)

**Combiner C et E** : une **unique nouvelle migration additive**, avec un timestamp antérieur à
`20260605000000` (ex. `202606040000xx_baseline_pre_migration_schema.sql`), recréant de façon
strictement idempotente (`CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` / `DROP TRIGGER
IF EXISTS` + `CREATE TRIGGER`) les 13 tables manquantes identifiées en section 3 et le trigger
`trg_push_on_notification` identifié en section 4 — avec, pour ce dernier, une **neutralisation
explicite de l'appel réseau vers la production** pour tout environnement non-production (point
distinct à concevoir précisément lors de la correction, pas improvisé ici).

Cette combinaison :

- ne modifie, ne renomme, ne supprime **aucun** fichier existant (satisfait la règle 4 et la
  contrainte « les Corrections 1 à 6 restent intactes ») ;
- est un no-op sûr sur la production existante (les objets y existent déjà) ;
- permet à `supabase db reset` de réussir intégralement en local, depuis zéro ;
- diffère explicitement à plus tard (avec autorisation, en lecture seule) l'obtention du schéma exact
  et la réconciliation du ledger de migrations de production.

Option D reste la solution de repli si l'inventaire s'avérait bien plus large qu'anticipé une fois le
schéma réel de production consulté.

## 6. Informations à vérifier en production (lecture seule, différé — rien exécuté maintenant)

Aucune requête distante n'a été lancée. À vérifier plus tard, en lecture seule, sous autorisation
explicite :

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

Points à établir avant toute écriture :

- `20260605000000` (et plus généralement toutes les migrations antérieures à la création effective
  de `profiles`/`clients`/etc. dans le dépôt) sont-elles enregistrées comme appliquées côté
  production, et sous quel nom exact de version ?
- `profiles`, `clients`, `devis`, `factures`, `interventions`, `journal`, `messages`,
  `notifications`, `parametres_entreprise`, `photos`, `prestations`, `commissions`,
  `commission_receipts` existaient-elles déjà manuellement à la date du 5 juin 2026 (avant la
  première migration) ?
- Le schéma de production provient-il d'un dump initial / d'une création Dashboard plutôt que des
  migrations versionnées — et si oui, existe-t-il une trace (dump, export, ticket) de ce schéma
  initial ailleurs que dans la base elle-même ?
- Le trigger `trg_push_on_notification` sur `notifications` est-il réellement actif en production
  aujourd'hui, avec quelle définition exacte (confirmer qu'elle correspond bien à la dernière version
  trouvée dans `20260708000008`) ?
- Le dépôt Git et l'historique distant ont-ils divergé au-delà de ce point précis (autres objets créés
  ou modifiés uniquement côté Dashboard, jamais reportés dans une migration) ?

## 7. Contraintes de la future correction (rappel, non encore traité)

La solution finale devra respecter simultanément :

- une base neuve peut exécuter toutes les migrations depuis zéro (`supabase db reset` sans erreur) ;
- une base existante (production) ne recrée aucune table déjà présente ;
- aucune donnée de production n'est supprimée ;
- aucune migration déjà appliquée n'est rejouée dangereusement ;
- aucune FK n'est perdue ;
- aucune policy RLS n'est affaiblie ;
- aucune fonction ou trigger n'est dupliqué ;
- les Corrections 1 à 6 restent intactes, aucun de leurs fichiers n'est modifié ;
- `supabase db reset` local réussit intégralement, deux fois de suite (répétabilité) ;
- le schéma neuf obtenu correspond exactement au schéma attendu (y compris pour le trigger
  `trg_push_on_notification`, dont l'appel réseau vers la production devra être neutralisé pour tout
  environnement non-production).

## 8. Plan de tests à préparer (proposition, non exécuté)

### Bootstrap

1. `supabase stop --no-backup`.
2. Suppression/recréation complète de la stack locale (volumes Docker inclus, pour garantir un état
   strictement vide — pas seulement un `db reset` sur un volume déjà initialisé).
3. `supabase start`.
4. `supabase db reset`.
5. Critère de succès : zéro erreur de migration, code de sortie 0 sur les deux commandes.

### Comparaison du schéma final

Comparer, entre l'état local obtenu et le schéma de production (lecture seule) :

- liste des tables, colonnes (nom/type/nullable/défaut) ;
- contraintes FK ;
- index ;
- triggers (présence, table cible, timing, fonction associée) ;
- fonctions (signature, `SECURITY DEFINER`/`INVOKER`, `search_path`) ;
- policies RLS (par table, par commande) ;
- grants (`information_schema.role_table_grants`, `has_function_privilege`).

### Répétabilité

- Premier `supabase db reset` réussi.
- Second `supabase db reset` réussi (idempotence confirmée, pas de dépendance à un état résiduel du
  premier run).
- Aucune étape de création manuelle nécessaire entre les deux.

### Corrections 1 à 6 (uniquement après bootstrap réussi)

Dans l'ordre déjà établi lors des tentatives précédentes : tests unitaires (`npm run test:unit`),
tests SQL des Corrections 2 à 5 (`npm run test:security:sql`), tests RLS multi-tenant
(`npm run test:security:playwright`), Storage (`npm run test:security:storage`), Edge Functions
(`npm run test:security:edge-functions`), concurrence (`npm run test:security:concurrency`), puis
`npm run test:security` global.

## 9. Synthèse pour le rapport

1. **Erreur exacte** : `ERROR: relation "profiles" does not exist (SQLSTATE 42P01)`, à la première
   instruction de `20260605000000_push_subscriptions.sql`.
2. **Migration fautive** : `20260605000000_push_subscriptions.sql` (premier point d'échec ; pas la
   seule migration concernée par le problème de fond — voir point 3).
3. **Dépendance manquante** : 13 tables fondamentales (`profiles`, `clients`, `commissions`,
   `commission_receipts`, `devis`, `factures`, `interventions`, `journal`, `messages`,
   `notifications`, `parametres_entreprise`, `photos`, `prestations`) + le trigger
   `trg_push_on_notification` sur `notifications` — aucun n'est créé par une migration du dépôt.
4. **Historique chronologique** : socle applicatif créé hors dépôt avant le 5 juin 2026 ; 107
   migrations versionnées ensuite, dont aucune ne recrée ce socle ; premiers points d'impact en
   cascade identifiés (section 3).
5. **Autres erreurs de bootstrap potentielles** : catégorie unique dominante (le socle manquant,
   section 3-4) ; pas d'autre problème d'ordonnancement trouvé parmi les objets réellement créés par
   migration ; pas de `DROP` sans `IF EXISTS` ; extensions non bloquantes (fournies par la
   plateforme) ; **trouvaille distincte et sérieuse** : URL de production + jeton codés en dur dans
   4 migrations versionnées, dont une active à HEAD (`trg_push_on_notification`).
6. **Comparaison des options** : A et B écartées (insuffisantes et/ou risquées pour la production) ;
   C (nouvelle migration de bootstrap antérieure, idempotente) recommandée ; D gardée en réserve si
   le périmètre s'avère plus large après lecture du schéma de production ; E est la technique
   d'implémentation de C, pas une alternative séparée.
7. **Stratégie recommandée** : nouvelle migration additive, timestamp antérieur, strictement
   idempotente, recréant le socle manquant + neutralisant l'appel réseau de production du trigger de
   notifications pour tout environnement non-production — combinée à une réconciliation différée et
   autorisée du ledger de migrations de production.
8. **Risques pour la production** : aucun risque immédiat identifié pour une migration additive et
   idempotente (no-op si les objets existent déjà) ; le risque réel se trouve dans les options A/B
   (modification/renommage d'un fichier déjà appliqué) — écartées ; risque résiduel distinct et déjà
   présent aujourd'hui en production, indépendant de MIG-01 : le trigger de notifications appelle une
   URL de production codée en dur.
9. **Fichiers qui devraient être modifiés** : aucun fichier existant — seule l'ajout, dans une future
   correction autorisée, d'un **nouveau** fichier de migration serait nécessaire.
10. **Besoin de modifier une ancienne migration** : non — confirmé évitable par la stratégie
    recommandée.
11. **Plan de rollback** : `DROP` (avec `IF EXISTS`) des objets créés par la nouvelle migration de
    bootstrap uniquement — sans impact sur les 107 migrations existantes ni sur la production (où ces
    objets préexistent indépendamment de ce fichier).
12. **Tests nécessaires** : voir section 8 (bootstrap, comparaison de schéma, répétabilité,
    Corrections 1 à 6).
13. **Informations production à vérifier avant toute écriture** : voir section 6 — ledger de
    migrations, existence/date des 13 tables, origine du schéma (dump vs Dashboard), définition exacte
    du trigger de notifications, divergence dépôt/distant.

Analyse MIG-01 terminée. J'attends votre autorisation avant toute modification de l'historique des migrations.
