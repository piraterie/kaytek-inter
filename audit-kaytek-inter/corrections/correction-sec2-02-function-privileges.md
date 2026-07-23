# Correction SEC2-02 — Durcissement des privilèges EXECUTE des fonctions sensibles

## 0. Résultat en une phrase

**SEC2-02 est implémentée et validée dans son périmètre exact** : les 4 migrations historiques
autorisées ont été corrigées, une migration additive de durcissement a été créée, et le premier
`supabase db reset` a **traversé avec succès Corrections 2, 3, 3 bis et 4 en entier** (toutes leurs
assertions de privilèges, y compris les nouvelles, ont réussi). Le reset s'est ensuite arrêté dans
Correction 5 (`20260726000001`) sur une assertion **totalement indépendante de SEC2-02** — un artefact
connu de `information_schema.triggers` qui compte deux fois un trigger `AFTER INSERT OR UPDATE`
(un par type d'événement). Conformément à la règle « arrête-toi au premier échec critique, ne corrige
aucune autre anomalie sans autorisation », je me suis arrêté sans y toucher. **Le critère « deux
resets complets réussissent » n'est donc pas atteint**, et la suite `npm run test:security*` n'a pas
été exécutée.

## 1. Cause racine (rappel, confirmée en amont)

L'image Postgres locale de Supabase définit, dans `pg_default_acl`, un privilège par défaut
accordant `EXECUTE` directement à `anon`/`authenticated`/`service_role` sur toute nouvelle fonction
créée par `postgres` dans `public`. `REVOKE ALL ... FROM PUBLIC` ne retire que l'entrée `PUBLIC` —
jamais ce droit direct. Confirmé empiriquement (conteneur Postgres jetable isolé, détruit après
usage) lors de l'analyse SEC2-02 précédente.

## 2. Default privileges observés

```
role     | schema | defaclobjtype | defaclacl
postgres | public | f (functions) | {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

Non modifié par cette correction (règle absolue : « ne modifie pas les default privileges globaux »).

## 3. Fonctions concernées

`current_organisation_has_app_access()`, `get_my_app_access_status()`,
`get_partner_requests_preview(text)`, `next_document_number(uuid, text)`,
`calculate_commission_for_facture(uuid)`.

## 4. Appelants réels (analyse effectuée avant toute modification)

| Fonction | Appelée par | Rôle nécessaire | RPC frontend nécessaire | Grant minimal |
|---|---|---|---|---|
| `current_organisation_has_app_access()` | 19 policies RLS de mutation (clients/interventions/devis/factures/messages/photos/commissions/commission_receipts/document_public_links) + 4 policies Storage ; appelée en interne par `get_my_app_access_status()` | **`authenticated`** (confirmé empiriquement : l'évaluation d'une policy RLS référençant une fonction exige que le rôle interrogeant dispose lui-même d'EXECUTE — le revoquer casse toutes les mutations métier) ; `service_role` (design existant) | Non (jamais appelée en RPC directe — grep exhaustif `src/`, `supabase/functions/`) | `authenticated`, `service_role` |
| `get_my_app_access_status()` | Edge Functions `envoyer-email`/`inviter-intervenant`/`send-reminders` via `userClient.rpc(...)`, avec le JWT réel de l'appelant (rôle effectif `authenticated`, jamais `anon` réel une fois la validation de token passée) | `authenticated` | Oui (indirectement, via Edge Functions) | `authenticated`, `service_role` |
| `get_partner_requests_preview(text)` | Frontend `src/lib/hooks/partners.ts:267-268`, `supabase.rpc('get_partner_requests_preview', {p_status})` | `authenticated` (garde admin déjà vérifiée **à l'intérieur** de la fonction — `is_admin_in_org`, Correction 3 bis) | **Oui** | `authenticated`, `service_role` |
| `next_document_number(uuid, text)` | Exclusivement les triggers `set_devis_numero`/`set_facture_numero`/`set_intervention_numero` (fonctions SECURITY DEFINER, propriétaire `postgres`) — confirmé empiriquement (conteneur jetable) qu'une chaîne SECURITY DEFINER→SECURITY DEFINER n'exige **aucun** droit direct pour le rôle ayant initié la transaction | **Aucun** | Non (0 occurrence dans `src/`, `supabase/functions/`) | **Aucun grant** |
| `calculate_commission_for_facture(uuid)` | Exclusivement les triggers `trigger_calculate_commission_on_facture_payee`/`trigger_recalculate_commission_on_materiel_change` (même mécanisme) | **Aucun** | Non | **Aucun grant** |

## 5. Modèle d'autorisation choisi (état final)

| Fonction | `PUBLIC` | `anon` | `authenticated` | `service_role` |
|---|---:|---:|---:|---:|
| `current_organisation_has_app_access()` | révoqué | révoqué | **conservé** (nécessaire aux policies RLS) | conservé |
| `get_my_app_access_status()` | révoqué | révoqué | conservé | conservé |
| `get_partner_requests_preview(text)` | révoqué | révoqué | conservé | conservé |
| `next_document_number(uuid, text)` | révoqué | révoqué | **révoqué** | **révoqué** |
| `calculate_commission_for_facture(uuid)` | révoqué | révoqué | **révoqué** | **révoqué** |

Écart assumé par rapport à l'exemple illustratif de l'autorisation pour
`current_organisation_has_app_access()` (qui ne montrait que `PUBLIC`/`anon`) : le texte de
l'autorisation lui-même conditionne la conservation d'`authenticated` à « un appel direct réel qui le
nécessite » — la dépendance des policies RLS constitue precisément ce besoin réel, confirmé
empiriquement avant toute modification (voir section 7 pour la preuve).

## 6. Droits avant / après (par fonction)

### `current_organisation_has_app_access()`
- **Avant** : `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role` — `anon`
  restait effectif via le privilège par défaut, jamais révoqué.
- **Après** : ajout d'un `REVOKE ALL ... FROM anon` explicite, immédiatement après le `REVOKE ALL
  FROM PUBLIC` existant. `authenticated`/`service_role` inchangés.

### `get_my_app_access_status()`
- **Avant** : identique au cas ci-dessus.
- **Après** : ajout d'un `REVOKE ALL ... FROM anon` explicite.

### `get_partner_requests_preview(text)`
- **Avant** : `REVOKE ALL FROM PUBLIC` + `GRANT TO authenticated, service_role` — `anon` effectif
  (droit hérité de la recréation `DROP`+`CREATE` en `20260715000011`, jamais révoqué depuis, y
  compris par le `CREATE OR REPLACE` de Correction 3 bis qui ne réinitialise pas l'ACL d'un objet
  déjà existant).
- **Après** : ajout d'un `REVOKE ALL ... FROM anon` explicite.

### `next_document_number(uuid, text)`
- **Avant** : `REVOKE ALL FROM PUBLIC` uniquement — `anon` ET `authenticated` restaient effectifs
  malgré le commentaire *« Explicitement aucun GRANT à anon ni authenticated »*.
- **Après** : `REVOKE ALL` explicite pour `anon`, `authenticated`, **et `service_role`** (aucun appel
  direct identifié pour ce dernier non plus — durcissement complet de l'intention documentée).

### `calculate_commission_for_facture(uuid)`
- **Avant** : identique au cas ci-dessus.
- **Après** : `REVOKE ALL` explicite pour `anon`, `authenticated`, et `service_role`.

## 7. Preuve empirique du modèle (avant toute modification)

Deux tests isolés, dans des conteneurs Postgres jetables (image exacte du projet, aucun lien avec les
données réelles, détruits immédiatement après usage) :

1. **RLS + fonction SECURITY DEFINER référencée dans une policy** : `authenticated` sans EXECUTE
   direct sur une fonction utilisée dans `USING (...)` → `SELECT` échoue avec
   `ERROR: permission denied for function ...`. **Conclusion : `authenticated` doit conserver EXECUTE
   sur `current_organisation_has_app_access()`.**
2. **Chaîne de triggers SECURITY DEFINER → SECURITY DEFINER** : `authenticated` sans EXECUTE direct
   sur une fonction interne appelée uniquement depuis un trigger (lui-même SECURITY DEFINER,
   propriétaire `postgres`) → l'`INSERT` déclenchant le trigger **réussit sans erreur**. Un appel
   *direct* (`SELECT fonction()`) par ce même rôle échoue bien avec *permission denied*. **Conclusion :
   `next_document_number()`/`calculate_commission_for_facture()` n'ont besoin d'aucun droit direct
   pour que les triggers continuent de fonctionner.**

## 8. Migrations historiques modifiées

- `supabase/migrations/20260722000001_subscription_access_enforcement.sql` — ajout des `REVOKE ...
  FROM anon` pour les 2 fonctions ; ajout des assertions `service_role` (explicites, jamais
  supposées) pour les 2 fonctions.
- `supabase/migrations/20260724000001_secure_get_partner_requests_preview.sql` — ajout du `REVOKE ...
  FROM anon` (l'assertion `has_function_privilege` existante, déjà correcte, n'a pas eu besoin
  d'être modifiée).
- `supabase/migrations/20260725000001_organisation_scoped_document_numbering.sql` — ajout des
  `REVOKE ... FROM anon/authenticated/service_role` ; ajout de l'assertion `service_role`.
- `supabase/migrations/20260726000001_unify_commission_calculation.sql` — même traitement.

Dans les 4 fichiers, les `REVOKE` ajoutés sont placés **immédiatement après** le `REVOKE ALL FROM
PUBLIC` déjà présent, lui-même déjà positionné après le `CREATE OR REPLACE FUNCTION` — aucune
logique métier, aucune policy, aucun trigger n'a été touché. Aucune assertion existante n'a été
supprimée ni affaiblie ; seules des assertions `service_role` ont été **ajoutées**.

## 9. Migration additive créée

`supabase/migrations/20260727000002_harden_sensitive_function_execute_privileges.sql` — postérieure à
toutes les migrations existantes. Réapplique, de façon strictement idempotente (uniquement des
`REVOKE`/`GRANT`, aucune recréation de fonction, aucune donnée, aucune policy, aucun secret), l'état
final des 5 fonctions, avec assertions complètes (anon/authenticated/service_role vérifiés
explicitement pour chacune). Nécessaire car les 4 migrations ci-dessus sont très probablement déjà
enregistrées comme appliquées sur toute base ayant déjà tourné ces migrations.

## 10. Assertions ajoutées

- Correction 2 : `service_role` vérifié explicitement pour les 2 fonctions (2 nouvelles assertions).
- Correction 3 bis : aucune assertion ajoutée (l'existante couvrait déjà anon/authenticated/
  service_role correctement).
- Correction 4 : `service_role` vérifié explicitement pour `next_document_number` (1 nouvelle
  assertion, en plus de l'anon/authenticated existante).
- Correction 5 : idem pour `calculate_commission_for_facture`.
- Migration additive : 5 blocs d'assertions complets (un par fonction), redondants avec les 4
  migrations historiques mais nécessaires pour une base où celles-ci sont déjà marquées appliquées.

## 11. Résultat du premier reset

```bash
$ docker ps                     # exit 0
$ supabase stop --no-backup     # exit 0
$ supabase start
...
Applying migration 20260722000001_subscription_access_enforcement.sql...   ← réussie (assertions SEC2-02 incluses)
Applying migration 20260723000001_fix_pir_select_admin_check.sql...        ← réussie
Applying migration 20260724000001_secure_get_partner_requests_preview.sql...← réussie (assertion anon/authenticated/service_role incluse)
Applying migration 20260725000001_organisation_scoped_document_numbering.sql...← réussie (assertion service_role incluse)
Applying migration 20260726000001_unify_commission_calculation.sql...
Stopping containers...
ERROR: Assertion échouée : trigger facture payée manquant (trouvé 2) (SQLSTATE P0001)
(exit 1)
```

**Toutes les migrations touchées par SEC2-02 ont réussi**, y compris leurs assertions de privilèges
nouvellement ajoutées/renforcées. L'échec survient **plus loin dans le même fichier**
(`20260726000001`), à une assertion **sans rapport avec les privilèges** :

```sql
-- 11.2 — Nouveaux triggers présents et attachés aux bonnes tables.
SELECT count(*) INTO v_count FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table = 'factures'
  AND trigger_name = 'trg_calculate_commission_on_facture_payee';
IF v_count <> 1 THEN
  RAISE EXCEPTION 'Assertion échouée : trigger facture payée manquant (trouvé %)', v_count;
END IF;
```

**Cause identifiée (analyse, aucune correction effectuée)** : le trigger est défini
`AFTER INSERT OR UPDATE ON public.factures` (un seul trigger, deux types d'événements combinés).
`information_schema.triggers` (vue standard SQL, sans concept natif de « OR » entre événements)
rapporte un **trigger multi-événements comme une ligne par type d'événement** — soit 2 lignes ici pour
1 seul trigger réel (confirmé : les deux autres triggers voisins de la même assertion,
`trg_recalculate_commission_on_materiel_change` et `trg_protect_finalized_commission`, sont chacun
`AFTER UPDATE`/`BEFORE UPDATE` seuls — un seul événement — et n'auraient pas ce problème). C'est un
artefact **préexistant** de Correction 5, **totalement indépendant de SEC2-02** (aucune ligne
modifiée par cette correction n'est impliquée), révélé uniquement maintenant parce qu'aucune
tentative de reset précédente n'était jamais arrivée aussi loin. Conformément aux règles de cette
correction (« ne corrige aucune autre anomalie sans autorisation », « arrête-toi au premier échec
critique »), **aucune tentative de correction n'a été faite**.

Conteneurs : arrêtés automatiquement par le CLI (confirmé : `docker ps -a` vide, `supabase status`
répond `No such container`) — aucun nettoyage manuel nécessaire.

## 12. Résultat du second reset

**Non exécuté** — le premier reset ne s'étant pas terminé avec succès, un second reset n'apporterait
aucune information supplémentaire.

## 13. Tests RPC anon / authenticated

**Non exécutés contre le projet réel** — ces tests sont explicitement conditionnés par l'autorisation
à la réussite des deux resets complets, non atteinte. Les vérifications empiriques de la section 7
(conteneurs jetables isolés, reproduisant exactement les séquences CREATE/REVOKE/GRANT des migrations
réelles) constituent la seule validation réalisée dans cette session, et sont considérées comme une
preuve directe et suffisante du mécanisme, mais **pas** un test RPC de bout en bout contre l'API
PostgREST réelle du projet.

## 14. Fonctionnement des triggers internes

Non vérifié dynamiquement (pas de reset complet). Argumenté et prouvé mécaniquement (section 7,
test 2) : la révocation totale des droits sur `next_document_number()`/
`calculate_commission_for_facture()` ne peut pas casser leurs triggers respectifs, par construction
du modèle de privilèges Postgres (SECURITY DEFINER + propriétaire `postgres`).

## 15. Tests des Corrections 1 à 6

**Non exécutés** — conditionnés à la réussite des deux resets complets, non atteinte.
`npm run test:unit`, `test:security:sql`, `test:security:storage`, `test:security:edge-functions`,
`test:security:concurrency`, `test:security:playwright`, `test:security` : aucun lancé.

## 16. Fonctions à auditer ultérieurement

Recherche statique (`CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION`/`GRANT EXECUTE`/`REVOKE`/
`SECURITY DEFINER`) sur l'ensemble du dépôt : **55 fonctions distinctes** créées au total. Aucune
n'a été corrigée (hors périmètre strict de SEC2-02). Sous-ensemble examiné, priorisé par risque
apparent (fonctions acceptant un paramètre d'identifiant sans dérivation d'identité interne, ou sans
aucun `REVOKE` du tout) :

| Fonction | Rôle potentiellement exposé | Contrôle d'identité interne | Niveau de risque |
|---|---|---|---|
| `provision_subscriber_organisation()` | `anon`/`authenticated` (aucun `REVOKE` trouvé pour cette fonction, dans aucun fichier) | Conçue pour un contexte trigger/service_role (`auth.uid()` attendu NULL) — à confirmer qu'elle n'est pas appelable en RPC directe avec un effet exploitable | **Moyen** — absence totale de durcissement explicite, à vérifier en priorité |
| `admin_delete_user_push_subscriptions(target_user_id uuid)` | `anon`/`authenticated` (un seul `REVOKE`, sans détail anon explicite trouvé) | **Oui** — vérifie `is_admin_in_org(caller_org)` et que la cible appartient à la même organisation avant toute suppression | **Faible** — accepte un paramètre libre mais se protège correctement en interne |
| `search_partner_profiles(query text)` | `anon`/`authenticated` (`REVOKE ALL FROM PUBLIC` présent, `anon` non vérifié) | **Oui** — `current_org_id()` NULL pour un appelant sans session → retour vide immédiat | **Faible** — NULL-safe comme `current_organisation_has_app_access()` |
| `get_my_organisation_subscription_status()` | `anon`/`authenticated` (aucun `REVOKE` trouvé) | **Oui** — dérive via `auth.uid()` | **Faible** — NULL-safe |
| `respond_to_partner_intervention_request(uuid, text, text)` | `anon`/`authenticated` (`REVOKE`/`GRANT` présents en `20260715000009`, `anon` non vérifié explicitement) | **Oui** — vérifie `is_admin_in_org`, l'organisation cible et le statut `pending` avant toute action | **Faible-moyen** — bien protégée en interne, mais mérite la même vérification `has_function_privilege('anon', ...)` que les 5 fonctions de SEC2-02 |
| `generate_partner_code()` | `anon`/`authenticated` (aucun `REVOKE` trouvé) | N/A (génère un code aléatoire, ne lit/écrit aucune donnée sensible) | **Très faible** |
| `seed_default_prestations(p_org_id uuid)` | `anon`/`authenticated` | **Oui** — durci séparément en `20260707000003_harden_seed_default_prestations.sql` (vérifie explicitement `is_admin_in_org(p_org_id)`, rejette un appel anonyme) | **Faible** — déjà traité par une correction dédiée antérieure |

**Recommandation (aucune action)** : un audit systématique et exhaustif des 55 fonctions
(`has_function_privilege('anon', ...)` pour chacune, contre une base locale une fois le bootstrap
complet obtenu) serait la suite naturelle, hors périmètre de cette correction.

## 17. Impact potentiel sur la production

- Les 4 migrations historiques modifiées sont très probablement déjà enregistrées comme appliquées
  en production — **ces modifications locales ne seront pas rejouées automatiquement là-bas**.
- La migration additive `20260727000002` est celle qui pourra, plus tard, corriger une base
  existante (idempotente, sûre à exécuter qu'elle soit déjà dans le bon état ou non) — mais elle
  n'a pas été appliquée à la production et ne le sera pas sans action distincte et autorisée.
- Les privilèges réels de production devront être audités en lecture seule avant toute décision de
  déploiement.
- **`next_document_number()` et `calculate_commission_for_facture()` doivent être considérées comme
  potentiellement exposées à `anon` en production tant que celle-ci n'a pas été vérifiée** — le
  mécanisme racine (privilège par défaut de plateforme) n'a rien de spécifique à cet environnement
  local, il s'applique à toute instance Supabase utilisant la même image de base.
- Aucun déploiement, aucun `migration repair`, aucune requête distante n'a été effectué.

## 18. Rollback local exact

```bash
git checkout -- \
  supabase/migrations/20260722000001_subscription_access_enforcement.sql \
  supabase/migrations/20260724000001_secure_get_partner_requests_preview.sql \
  supabase/migrations/20260725000001_organisation_scoped_document_numbering.sql \
  supabase/migrations/20260726000001_unify_commission_calculation.sql
rm supabase/migrations/20260727000002_harden_sensitive_function_execute_privileges.sql
supabase stop --no-backup
```

## 19. Fichiers modifiés

- `supabase/migrations/20260722000001_subscription_access_enforcement.sql`
- `supabase/migrations/20260724000001_secure_get_partner_requests_preview.sql`
- `supabase/migrations/20260725000001_organisation_scoped_document_numbering.sql`
- `supabase/migrations/20260726000001_unify_commission_calculation.sql`
- `supabase/migrations/20260727000002_harden_sensitive_function_execute_privileges.sql` (nouveau)
- `audit-kaytek-inter/corrections/correction-sec2-02-function-privileges.md` (ce rapport, nouveau)

Aucun autre fichier (MIG-01, MIG-02, frontend, Edge Functions, policies métier, données) n'a été
modifié.

## 20. Confirmation — aucune opération distante

Aucune commande n'a contacté un projet Supabase distant. Aucun `supabase db push`, aucun `migration
repair`, aucune requête contre la production, aucune modification de default privilege global. Les
deux conteneurs Postgres jetables utilisés pour les tests empiriques (section 7) ont été détruits
(`docker rm -f`) immédiatement après usage. `docker ps -a`/`supabase status` confirment qu'aucune
stack locale n'est restée active après cette session. Aucun commit, aucun push, aucun déploiement.

SEC2-02 non validée. Au moins un privilège sensible, un bootstrap ou une suite critique reste en échec. J'attends votre autorisation avant toute nouvelle correction.
