# Phase 5 — Base de données et migrations

Date de l'analyse : 2026-07-21
Périmètre : schéma complet (`backup/backup-2026-06-10/database-schema.sql` comme référence de base + 102 migrations de `supabase/migrations/` rejouées mentalement dans l'ordre chronologique), fonctions SQL, triggers, contraintes, index. Méthode : lecture statique uniquement — aucune migration exécutée, aucune donnée modifiée. Cette phase complète les phases 3 (RLS) et 4 (Edge Functions) sans répéter leurs constats ; elle se concentre sur l'intégrité, la cohérence et la qualité du schéma lui-même.

---

## Résumé

Le schéma est globalement cohérent (types monétaires en `numeric` partout, horodatage en `timestamptz`, isolation multi-tenant par `organisation_id` indexée sur toutes les tables). Trois zones méritent une attention particulière : **(1)** la numérotation des devis/factures/interventions est calculée par un **compteur global partagé entre toutes les organisations**, jamais scopé par `organisation_id` — problématique pour la conformité de numérotation comptable française en environnement multi-tenant ; **(2)** le journal d'audit (`journal`), documenté comme "immuable par conception", a vu cette garantie explicitement levée par une migration ultérieure sans mécanisme de restriction au niveau colonne, ce qui permet à un admin de réécrire ou supprimer l'historique ; **(3)** plusieurs colonnes de clé étrangère très sollicitées par les policies RLS (jointures `EXISTS`) ne sont pas indexées, ce qui deviendra un point de performance à surveiller avec la volumétrie.

---

## 1. Vue d'ensemble du schéma

28 tables + 1 vue (`parametres_entreprise_public`), déjà cataloguées en détail phase 3 (matrice complète). Rappel des éléments structurels pertinents pour cette phase :

- **Types monétaires** : `numeric` (précision arbitraire) utilisé systématiquement pour tous les montants (`montant_ht`, `tva_montant`, `total_ttc`, `commission_pct`, `part_intervenant`, `acompte_recu`, etc.) — **aucun `float`/`real` trouvé** pour une valeur financière. Choix correct : `numeric` évite les erreurs d'arrondi binaire propres aux flottants.
- **Dates/horodatage** : `timestamptz` pour tous les événements (created_at, updated_at, date_prevue, signe_le, envoye_le, paye_le, rappel_*_envoye_at) — correct, stocké en UTC et converti à l'affichage. Colonnes `date` (sans heure) utilisées à bon escient pour les échéances/dates métier sans notion d'heure (`date_emission`, `date_echeance`, `date_paiement`, `relance_1_le`, `relance_2_le`, `valide_jusqu_au`). La seule conversion de fuseau observée est explicite et correcte (`send-reminders`, conversion `Europe/Paris` pour l'affichage horaire des rappels).
- **TVA** : type incohérent entre tables — `prestations.tva_pct` et `interventions.tva_pct` sont `integer`, tandis que `parametres_entreprise.tva_defaut` est `numeric`. Sans conséquence fonctionnelle (les taux 0/10/20 tiennent dans les deux types), mais incohérence de style à noter.
- **Enums** : **aucun type `ENUM` natif PostgreSQL** n'est utilisé — tous les champs à choix fermé (`role`, `statut`, `type`, `categorie`, `mode_paiement`, etc.) sont des `text` + contrainte `CHECK`. C'est un choix délibéré et judicieux dans ce contexte : il a permis d'étendre `role` à `'assistant'` (migration 20260708000007) et `activite`/`type`/`categorie` aux nouveaux métiers (chauffagiste, migration 20260707000002) par simple `ALTER ... DROP/ADD CONSTRAINT`, sans les complications qu'un `ALTER TYPE ... ADD VALUE` natif aurait impliquées (non transactionnel avant PG12, incompatible avec certains contextes). Pas un problème.
- **Index sur `organisation_id`** : présents et vérifiés sur les 28 tables qui possèdent la colonne (`idx_<table>_organisation_id` ou équivalent) — bon point, cf. §5.

---

## 2. Intégrité référentielle et suppressions en cascade

### DB-01 — Colonnes de clé étrangère vers `profiles(id)` sans comportement `ON DELETE` explicite sur les tables métier historiques

- **Gravité** : Moyenne
- **Confiance** : Confirmé (lecture du schéma de référence, aucune correction trouvée dans les 102 migrations)
- **Tables concernées** : `clients.created_by`, `interventions.intervenant_id` / `created_by` / `materiel_confirme_par`, `devis.intervenant_id` / `created_by`, `factures.created_by`, `commissions.intervenant_id`, `photos.uploaded_by`, `messages.expediteur_id` / `destinataire_id`, `notifications.user_id`, `devices.user_id`, `commission_receipts.intervenant_id` — toutes déclarées `REFERENCES public.profiles(id)` **sans `ON DELETE ...`**, donc avec le comportement par défaut PostgreSQL `NO ACTION` (bloquant).
- **Contraste** : les tables créées plus tard (`document_public_links.created_by`, `guide_progress.user_id`, `push_subscriptions.user_id`, toutes les tables `partner_*`) utilisent correctement `ON DELETE SET NULL` ou `ON DELETE CASCADE` — la leçon a été appliquée pour le nouveau code, mais jamais rétroportée sur les tables historiques.
- **Mécanique du problème** : `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` — donc supprimer un compte via `auth.admin.deleteUser()` (utilisé par l'Edge Function `supprimer-utilisateur`, cf. phase 4) déclenche la suppression en cascade de la ligne `profiles`. Mais **dès qu'une seule ligne** dans `interventions`, `devis`, `factures`, `commissions`, `photos`, `messages`, `notifications`, `devices`, `commission_receipts` ou `clients.created_by` référence encore ce profil, la contrainte `NO ACTION` fait échouer toute la transaction avec une violation de clé étrangère (`error code 23503`).
- **Impact concret** : en pratique, tout intervenant/admin ayant déjà été assigné à une intervention, créé un devis/client, envoyé un message ou uploadé une photo (donc quasiment tout compte actif au-delà du premier jour) **ne peut pas être supprimé** via `supprimer-utilisateur` — la fonction retournerait l'erreur Postgres brute au frontend (`return new Response(JSON.stringify({ error: error.message }), ...)`), sans message explicatif ("cet utilisateur a des données associées"). Ceci explique probablement, en creux, pourquoi la suppression de compte grand public passe par un processus manuel de 30 jours (`DeleteAccountPage`, cf. phase 2) plutôt qu'un bouton self-service instantané — mais cela ne semble pas avoir été anticipé pour la suppression interne d'un intervenant/assistant par un admin depuis `UsersPage`.
- **Recommandation** : décider explicitement, table par table, du comportement voulu (probablement `ON DELETE SET NULL` pour préserver l'historique des devis/factures/interventions même après suppression du profil auteur, à l'image de ce qui a été fait pour les tables `partner_*`), et faire réagir le frontend/`supprimer-utilisateur` à l'erreur `23503` par un message clair plutôt que par un message Postgres brut. Alternative déjà pratiquée ailleurs dans le projet (mémoire projet : "delete-guard with archive alternative" pour les interventions) : privilégier la désactivation (`actif = false`) à la suppression physique pour les profils ayant un historique métier.
- **Statut** : Vérifié par lecture du schéma ; non testé dynamiquement (aucune suppression réelle tentée).

### Autres cascades observées (cohérentes)

- `photos.intervention_id REFERENCES interventions(id) ON DELETE CASCADE` — cohérent (les photos n'ont pas de sens sans leur intervention).
- `profiles.organisation_id` / `clients.organisation_id` / `interventions.organisation_id` / `devis.organisation_id` / `factures.organisation_id` / `commissions.organisation_id` → `organisations(id) ON DELETE RESTRICT` — cohérent, empêche la suppression accidentelle d'une organisation tant qu'elle a des données liées.
- `partner_connections`, `partner_intervention_requests` → `ON DELETE CASCADE` vers `organisations`/`partner_connections` — cohérent avec la nature de ces tables satellites.
- `factures.devis_id REFERENCES devis(id)` sans `ON DELETE` (donc `NO ACTION`) : empêche de supprimer un devis déjà transformé en facture — comportement probablement voulu (protège la traçabilité comptable), mais partage le même défaut que DB-01 : l'erreur Postgres brute remonterait telle quelle si un admin tentait cette suppression (aucune fonction dédiée ne l'intercepte, la suppression passant directement par le frontend + RLS `devis_delete`).

---

## 3. Absence de contraintes de cohérence financière sur `devis` / `factures`

- **Gravité** : Moyenne
- **Confiance** : Confirmé
- **Description** : `devis.lignes` est un simple `jsonb NOT NULL DEFAULT '[]'` sans aucune validation de structure ou de contenu au niveau base de données (pas de `CHECK` sur le schéma JSON, pas de contrainte applicative type `jsonb_matches_schema`). Aucune contrainte `CHECK` ne garantit que :
  - `devis.total_ttc = devis.total_ht + devis.tva_montant` (ou une tolérance d'arrondi) ;
  - `devis.total_ht`/`total_ttc` correspondent à la somme des `lignes[].total_ht`/`total_ttc` ;
  - `factures.montant_ttc = factures.montant_ht + factures.tva_montant` ;
  - `factures.acompte_recu <= factures.montant_ttc` ;
  - les taux de TVA utilisés dans `lignes[].tva_pct` appartiennent à l'ensemble autorisé (0/10/20).
- **Recoupement avec la phase 3** : les policies RLS `devis_insert`/`devis_update`/`factures_insert`/`factures_update` ne vérifient que `organisation_id` et le rôle/propriété — **jamais la cohérence des montants**. Combiné à l'absence de toute contrainte `CHECK`, la seule barrière contre un devis/facture aux montants incohérents (par bug frontend, ou appel direct à l'API avec un JWT valide) est la logique JavaScript côté client, entièrement contournable.
- **Scénario** : un utilisateur autorisé (intervenant créateur, admin) modifiant directement l'appel `supabase.from('devis').insert(...)` (ex. depuis la console développeur) peut enregistrer `total_ht: 10, tva_montant: 0, total_ttc: 999999` sans qu'aucune couche ne le bloque.
- **Impact** : risque de données financières incohérentes en base (documents PDF générés à partir de ces valeurs, comptabilité, commissions calculées sur `montant_ttc` via `auto_commission()` — une incohérence ici se propage directement au calcul de commission de l'intervenant).
- **Recommandation** : ajouter des contraintes `CHECK` de tolérance (ex. `ABS(total_ttc - (total_ht + tva_montant)) < 0.01`) sur `devis` et `factures`, et envisager une validation de structure minimale sur `lignes` (fonction `CHECK` ou trigger `BEFORE INSERT/UPDATE`).
- **Statut** : Vérifié (absence confirmée sur les deux tables, dans le schéma de référence et dans les 102 migrations).

---

## 4. Numérotation des devis, factures et interventions

### DB-02 — Numérotation partagée globalement entre toutes les organisations (pas de scoping par `organisation_id`)

- **Gravité** : **Élevée** (conformité comptable/légale en environnement multi-tenant)
- **Confiance** : Confirmé
- **Fichiers** : `supabase/migrations/20260610000023_fix_facture_numero_rls.sql` (`gen_numero_facture()`), `20260610000024_fix_devis_intervention_numero_rls.sql` (`generate_devis_numero()`, `gen_numero_intervention()`)
- **Description** : les trois fonctions de génération de numéro (devis `DEV-YYYY-NNN`, facture `FAC-YYYY-NNN`, intervention `INT-YYYY-NNN`) calculent toutes le prochain numéro ainsi :
  ```sql
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix)+1) AS INTEGER)), 0)
  FROM public.devis          -- (ou factures / interventions)
  WHERE numero ~ ('^' || prefix || '[0-9]+$')
  ```
  **Cette requête ne filtre jamais par `organisation_id`.** Le préfixe ne contient que l'année (`DEV-2026-`), pas l'organisation. Conséquence directe : **toutes les organisations de la plateforme partagent la même séquence de numérotation par année et par type de document.** Une organisation qui crée son tout premier devis après que 40 autres organisations en ont déjà créé sur l'année en cours obtiendra `DEV-2026-041`, pas `DEV-2026-001`.
- **Vérification de la protection anti-doublon** : le verrou `pg_advisory_xact_lock(hashtext('dev_numero_lock'))` (ou `'fac_numero_lock'`/`'int_numero_lock'`/`'factures_numero_lock'`) est lui aussi une clé **globale**, pas dérivée de l'organisation — ce qui est *correct pour éviter les doublons* (deux organisations créant un devis à la même milliseconde ne peuvent pas obtenir le même numéro), mais confirme bien que toutes les organisations sont sérialisées sur un seul verrou, un goulot d'étranglement de concurrence à l'échelle de la plateforme entière plutôt que par organisation.
- **Impact métier/légal** : en France, la numérotation des factures doit être **chronologique et continue par entité émettrice** (Code de commerce, art. L123-12 et suivants ; tolérance zéro sur les trous inexpliqués lors d'un contrôle fiscal). Avec cette implémentation, une organisation cliente qui examine sa propre séquence de factures verra des sauts de numéros dus aux factures des *autres* organisations du SaaS — cela ne constitue pas des "trous" au sens strict pour cette organisation (chaque organisation garde une séquence strictement croissante et sans doublon **au sein de sa propre vue**, puisque les policies RLS filtrent par `organisation_id` à la lecture), mais le format `FAC-2026-NNN` expose de fait un identifiant qui n'est *pas propre à l'entreprise émettrice* — un expert-comptable ou un contrôleur fiscal examinant la séquence `FAC-2026-014, FAC-2026-017, FAC-2026-023` d'une organisation pourrait légitimement s'interroger sur les numéros manquants, qui n'existent tout simplement pas *pour elle* mais appartiennent à d'autres entreprises. C'est un facteur de risque en cas de contrôle, même si la RLS empêche toute organisation de voir les factures des autres.
- **Effet de bord additionnel** : le numéro révèle indirectement le volume total de documents créés sur toute la plateforme (fuite d'information mineure sur l'activité commerciale d'autres clients du SaaS).
- **Recommandation** : scoper la requête `MAX()` et le verrou advisory par `organisation_id` (ex. `hashtext('dev_numero_lock_' || NEW.organisation_id::text)` et ajouter `AND organisation_id = NEW.organisation_id` au `WHERE`), pour que chaque organisation ait sa propre séquence continue commençant à 1 chaque année, conforme aux exigences comptables françaises pour chaque entité émettrice indépendante.
- **Statut** : Vérifié — confirmé par lecture directe du corps SQL des trois fonctions, aucune migration ultérieure ne modifie ce comportement.

### Historique de réécritures multiples (signal de fragilité, déjà partiellement résolu)

Les commentaires des migrations `20260610000023`/`20260610000024` documentent eux-mêmes un historique instable :
- Au moins 3 réécritures successives de `generate_devis_numero()` avant la version actuelle, y compris une variante basée sur `nextval('devis_numero_seq')` qui **ne réinitialisait pas le compteur chaque année** — bug corrigé en repassant sur un calcul `MAX()+1` par préfixe annuel.
- Deux noms de fonction ont coexisté pour les interventions (`generate_intervention_numero()` et `gen_numero_intervention()`) et pour les factures (`generate_facture_numero()` et `gen_numero_facture()`) avant nettoyage explicite (`DROP FUNCTION`, migration `20260610000026`).
- La cause racine documentée de la bascule d'une version à l'autre (`20260610000023`/`24`) : les anciennes fonctions n'étaient pas `SECURITY DEFINER` avec `SET search_path`, donc leur `SELECT MAX(numero)` était lui-même filtré par les policies RLS du rôle appelant (Phase 5 RLS, 2026-06-10) → un utilisateur ne voyant pas tous les devis via RLS calculait un `MAX` sur un sous-ensemble → génération d'un numéro déjà existant → violation `UNIQUE` (23505). C'est un bug d'interaction RLS/trigger classique, correctement diagnostiqué et corrigé.
- **Donnée historique potentiellement à risque** : si des lignes ont été insérées durant la période où une séquence `nextval()` sans réinitialisation annuelle était active, il est possible que certains numéros historiques ne suivent pas le format `PREFIX-YYYY-NNN` actuel (non vérifiable sans accès à la base réelle — cf. §7).
- **Statut** : Historique résolu pour la partie technique (search_path/SECURITY DEFINER) ; le scoping par organisation (DB-02) reste, lui, non résolu à ce jour.

### Réponses aux points demandés sur la numérotation

| Point demandé | Constat |
|---|---|
| Création simultanée (concurrence) | Protégée par `pg_advisory_xact_lock` (verrou transactionnel) — deux INSERT concurrents ne peuvent pas obtenir le même numéro, y compris entre deux organisations différentes (verrou global). |
| Modification manuelle du numéro | Le trigger ne régénère un numéro que si `NEW.numero IS NULL OR NEW.numero = ''` — un `UPDATE` modifiant manuellement `numero` sur une ligne existante n'est **pas empêché** par le trigger (`BEFORE INSERT` uniquement, pas `BEFORE UPDATE`), donc rien n'empêche en théorie qu'un `UPDATE` direct (par un admin, ou un appel API) fixe un `numero` arbitraire, y compris un doublon — la seule protection resterait une contrainte `UNIQUE` sur la colonne `numero`, **qui n'a pas été trouvée** dans le schéma (`numero` n'est pas déclaré `UNIQUE` dans `devis`/`factures`/`interventions` — seule la requête `SELECT ... GROUP BY numero HAVING COUNT(*) > 1` de vérification post-migration suggère que l'absence de doublon est *surveillée*, pas *garantie structurellement*). |
| Suppression | Aucun mécanisme de réutilisation automatique d'un numéro supprimé — le calcul `MAX()+1` peut réutiliser un numéro seulement si la ligne portant le plus grand numéro de l'année est supprimée puis qu'une nouvelle ligne est créée avant qu'une autre n'ait repris ce même maximum ; en pratique cela ne crée pas de doublon actif (il n'y a qu'une ligne à la fois avec ce numéro) mais peut créer une discontinuité dans l'historique si des lignes intermédiaires existent encore. |
| Passage d'une année à l'autre | Géré correctement : le préfixe inclut `EXTRACT(YEAR FROM NOW())`, donc le compteur repart bien à `001` chaque 1er janvier pour chaque type de document (`DEV-2027-001` après `DEV-2026-NNN`). |
| Numérotation par organisation | **Non implémentée** — voir DB-02 ci-dessus, c'est le constat central de cette section. |

---

## 5. Journal d'audit — garantie d'immuabilité levée sans restriction de colonne

### DB-03 — Un admin peut modifier ou supprimer l'historique du journal, sans restriction technique au champ censé être modifiable

- **Gravité** : Moyenne (intégrité de la piste d'audit, pas fuite cross-tenant)
- **Confiance** : Confirmé
- **Fichiers** : `supabase/migrations/20260610000018_rls_phase2_admin_simple_tables.sql` (commentaire : *"Pas d'UPDATE ni DELETE sur journal : log immuable par conception"*), `supabase/migrations/20260611000001_journal_delete_update_admin.sql` (ajoute `journal_update`/`journal_delete` le lendemain)
- **Description — migration contradictoire identifiée** : la Phase 2 RLS (10/06/2026) documente explicitement `journal` comme un log immuable, volontairement sans policy UPDATE/DELETE. Dès le lendemain (11/06/2026), une nouvelle migration réintroduit ces deux policies pour répondre à un besoin produit réel (`JournalPage` permet d'annoter/supprimer des entrées). La migration elle-même reconnaît la limite : *"RLS ne peut pas restreindre par colonne ; la restriction au seul champ 'description' est assurée par le code frontend [...] Un trigger BEFORE UPDATE peut renforcer cela si nécessaire"* — ce trigger de renforcement **n'a jamais été créé** dans les migrations ultérieures (vérifié : aucune migration ne crée de trigger `BEFORE UPDATE` sur `journal`).
- **Conséquence** : la policy RLS `journal_update` autorise un admin à modifier **n'importe quelle colonne** d'une entrée (`action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`, `user_id`, `description`), pas seulement `description` comme l'interface prévue le suggère. Combinée à `journal_delete` (suppression totale d'entrées ou de tout le journal via `useDeleteAllJournal`), un admin — y compris un compte compromis — peut réécrire ou effacer intégralement l'historique des actions de son organisation.
- **Impact** : le journal perd sa valeur de preuve en cas d'incident de sécurité ou de litige interne (ex. un admin qui supprimerait discrètement les traces d'une action contestée). Reste strictement intra-organisation (un admin ne peut altérer que le journal de sa propre organisation, cf. phase 3).
- **Recommandation** : ajouter le trigger `BEFORE UPDATE` déjà envisagé dans le commentaire de la migration, rejetant toute tentative de modifier une colonne autre que `description` ; envisager de retirer le `DELETE` global (`useDeleteAllJournal`) au profit d'une politique de rétention/archivage plutôt qu'une suppression manuelle, ou au minimum journaliser (dans un journal séparé, non supprimable par les mêmes acteurs) les suppressions/modifications du journal lui-même.
- **Statut** : Vérifié (les deux migrations existent telles que décrites, aucun trigger de restriction trouvé).

---

## 6. Index manquants

### DB-04 — Colonnes de clé étrangère fortement sollicitées par les policies RLS sans index dédié

- **Gravité** : Moyenne (performance, pas sécurité ni intégrité)
- **Confiance** : Confirmé
- **Description** : recherche exhaustive de tous les `CREATE INDEX` dans les 102 migrations — chaque table possède bien un index sur `organisation_id`, mais **aucun index n'existe** sur les colonnes suivantes, pourtant utilisées dans des sous-requêtes `EXISTS` au sein même des policies RLS (phase 3) et dans les requêtes applicatives courantes :
  - `devis.client_id`, `devis.intervenant_id`
  - `interventions.client_id`, `interventions.intervenant_id`
  - `factures.client_id`, `factures.devis_id`, `factures.intervention_id`
  - `photos.intervention_id`
  - `messages.expediteur_id`, `messages.destinataire_id`
  - `commissions.intervenant_id`, `commissions.intervention_id`
  - `clients.created_by`
- **Pourquoi c'est significatif** : PostgreSQL n'indexe **jamais automatiquement** le côté "many" d'une clé étrangère (seule la colonne référencée, généralement une clé primaire, est indexée par défaut). Or plusieurs policies RLS analysées en phase 3 exécutent des `EXISTS (SELECT 1 FROM interventions i WHERE i.client_id = clients.id AND i.intervenant_id = auth.uid() ...)` — sans index sur `interventions.client_id`/`intervenant_id`, chacune de ces vérifications RLS déclenche un balayage séquentiel (`Seq Scan`) de la table `interventions` à chaque ligne de `clients` évaluée, un coût qui croît linéairement avec le volume de données.
- **Impact** : aucun aujourd'hui avec un faible volume de données ; deviendra un point de ralentissement mesurable (listes clients/interventions, dashboard, exports) à mesure que le nombre d'interventions/devis/factures par organisation augmente. Sujet approfondi en phase 9 (performances), mentionné ici comme un constat de conception de schéma.
- **Recommandation** : ajouter des index sur ces colonnes, en priorité `interventions.client_id`, `interventions.intervenant_id`, `devis.client_id`, `devis.intervenant_id` (les plus utilisées dans les policies RLS `clients_select` et `photos_select`).
- **Statut** : Vérifié (absence confirmée par recherche exhaustive des `CREATE INDEX` dans les migrations).

---

## 7. Migrations dupliquées, contradictoires ou suspectes

- **Numérotation (DB-02)** : voir §4 — au moins 3 réécritures successives de la fonction de numérotation devis, deux noms de fonction coexistants pour interventions/factures avant nettoyage. Historique instable mais résolu pour sa partie technique.
- **Journal (DB-03)** : contradiction directe et documentée entre `20260610000018` ("log immuable par conception") et `20260611000001` (ajout UPDATE/DELETE le lendemain) — la seconde migration l'assume et l'explique, ce n'est donc pas une "erreur" au sens d'un oubli, mais bien une garantie de sécurité initialement affichée puis affaiblie pour un besoin produit, sans compensation technique complète.
- **`prestations_admin_insert`/`prestations_admin_update`** (créées 2026-06-06, orphelines non scopées par organisation) : déjà couvert phase 3 (SEC-02) — confirmé disparues de l'état actuel, DROP défensif documenté dans `20260708000008`.
- **26 migrations `diag_*`/`test_fixture_*`/`cleanup_*`** concentrées entre le 13 et le 15 juillet 2026 (déjà dénombrées en phase 1) : ce sont des artefacts de débogage en production autour de `partner_intervention_requests`/`clients` — voir phase 3 (RLS-01) pour la régression de sécurité qui en a résulté sur `pir_select`. Ces migrations ne créent ni ne suppriment de schéma de données significatif au-delà de fonctions de diagnostic temporaires (déjà nettoyées), mais témoignent d'un mode de résolution de bug par itérations successives directement en production plutôt qu'en environnement de test.
- **Root SQL files** (`fix-*.sql`, `add-*.sql`, `diagnostic-*.sql` à la racine du dépôt, hors `supabase/migrations/`) : plusieurs migrations officielles (`20260610000023`, `20260610000024`) citent explicitement ces fichiers racine comme leurs prédécesseurs historiques (`fix-all-numeros.sql`, `fix-devis-numero.sql`, `fix-gen-numero-intervention.sql`, `fix-intervention-numero.sql`, `fix-devis-triggers-cleanup.sql`, `fix-triggers-manquants.sql`) — confirmation supplémentaire (cf. phase 1 finding #5) que le schéma réel de production a été modifié par des scripts exécutés manuellement hors du dossier de migrations versionné, avant d'être partiellement rattrapé a posteriori. Risque de confusion pour quiconque chercherait la source de vérité du schéma en lisant uniquement `supabase/migrations/`.
- **`devis.modele_id`** : valeur par défaut incohérente entre `20260606000001_devis_modele_id.sql` (`DEFAULT 0`) et le schéma de référence du 2026-06-10 (`DEFAULT 1`) — changement mineur non documenté par une migration dédiée, sans impact fonctionnel actuel (le défaut le plus récent l'emporte), mais illustre la difficulté à tracer précisément l'évolution du schéma uniquement depuis les migrations.

---

## 8. Champs obsolètes

- **`devis.pdf_url`, `factures.pdf_url`** : colonnes présentes dans le schéma mais jamais renseignées par le code applicatif actuel — confirmé en phase 3/4 que les PDF sont transmis en pièce jointe email en base64 (`envoyer-email`), jamais stockés dans le bucket `pdf-documents` (lui-même qualifié de "dead code" par son propre commentaire de migration). Colonnes mortes, sans risque, mais à nettoyer ou à documenter comme réservées à un usage futur.
- **Fonctions SQL orphelines déjà supprimées** : `generate_facture_numero()`, `generate_intervention_numero()` (remplacées, DROP confirmé) — plus un problème, mentionné pour mémoire.
- **Fonctions de diagnostic temporaires** (`diag_pir_update_check`, `diag_notif_check_fn`, etc.) : créées et supprimées dans la même série de migrations de juillet — cohérent, pas de résidu trouvé.

---

## 9. Cohérence entre les types TypeScript et SQL

Comparaison de `src/types/index.ts` avec le schéma SQL (`Intervention`, `Devis`, `Facture`, `Commission`, `Message`) :

- Tous les champs `numeric` SQL (montants, pourcentages) sont typés `number` côté TypeScript — cohérent pour l'usage actuel (montants d'ordre de grandeur raisonnable), mais à surveiller : `numeric` a une précision arbitraire côté Postgres tandis que `number` (IEEE 754 double) en JavaScript perd en précision au-delà de 2^53 — sans risque réel ici (montants de factures de quelques milliers d'euros maximum), donc un simple point de vigilance théorique, pas un défaut.
- Les champs optionnels/nullable (`?:` en TypeScript) correspondent globalement aux colonnes nullable en SQL (ex. `signature_url?`, `remise_montant?`) — cohérence globale confirmée sur les tables inspectées.
- `organisation_id` n'apparaît **volontairement pas** dans les types de domaine frontend (`Devis`, `Facture`, `Intervention`, etc. tels qu'utilisés par les composants) alors qu'il est `NOT NULL` en base sur toutes ces tables — cohérent avec le constat de la phase 3 (aucun store frontend d'organisation active, l'isolation étant entièrement déléguée à la RLS) : le frontend n'a simplement pas besoin de manipuler cette colonne.
- Aucune incohérence de type bloquante trouvée sur l'échantillon inspecté (`Intervention`, `Devis`, `Facture`, `Commission`, `Message`, `LigneDevis`).

---

## 10. Points positifs constatés

- Protection anti-course sur la numérotation via `pg_advisory_xact_lock` — robuste, correctement expliquée et testée par les requêtes de vérification intégrées à chaque migration.
- `auto_commission()` utilise `ROUND(..., 2)` pour les calculs monétaires — arrondi explicite et correct, pas d'accumulation d'erreur de précision.
- Toutes les migrations de durcissement (Phase 0 à 8, SEC-01 à 06, FE-01, STRIPE-03) intègrent systématiquement une section "VÉRIFICATION" avec des requêtes de contrôle post-migration (comptage de policies, vérification `SECURITY DEFINER`, recherche de doublons de numéro) — discipline d'ingénierie au-dessus de la moyenne pour ce genre de projet.
- Usage cohérent de `SET search_path = public` sur toutes les fonctions `SECURITY DEFINER` récentes — protège contre le détournement de search_path, une classe de vulnérabilité PostgreSQL classique.

---

## 11. Éléments non vérifiables dans cette phase

- **Données réelles en production** : aucune requête n'a été exécutée contre la base — les risques de doublons de numérotation historiques (période `nextval()` sans reset annuel, cf. §4) ne peuvent être confirmés ou infirmés sans un accès à la base réelle.
- **Volumétrie réelle des tables** : impossible d'évaluer l'impact concret des index manquants (DB-04) sans connaître le nombre réel de lignes par table et par organisation.
- **Comportement réel d'une suppression de profil** (DB-01) : analyse déduite de la lecture des contraintes SQL, pas testée dynamiquement (aurait nécessité une suppression réelle, exclue par les règles de cette phase).
- **Contenu détaillé de `guide_videos`/`guide_news`** : RLS confirmée en phase 3, contraintes de colonnes non examinées en détail ici (priorité basse, contenu non sensible).
- **Schéma exact de `founder_seats`** (table créée hors dépôt par l'intégration Stripe externe) : colonnes et contraintes non visibles depuis les migrations.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
