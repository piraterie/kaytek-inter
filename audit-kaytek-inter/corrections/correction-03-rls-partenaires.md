# Correction 3 — RLS-01 : restauration du contrôle admin sur `pir_select`

**Date** : 2026-07-23
**Branche** : `capacitor-android`
**Statut** : Correction appliquée (1 migration additive + 1 fichier de tests locaux), non commitée, non déployée, aucune opération distante exécutée.

---

## 1. Problème initial

La policy `pir_select` sur `public.partner_intervention_requests` n'imposait aucune vérification de rôle : tout membre authentifié (admin, assistant, intervenant) de l'organisation source pouvait lire l'intégralité des colonnes de ses propres demandes envoyées (quel que soit leur statut), et tout membre de l'organisation cible pouvait les lire dès que la demande passait à `accepted`/`in_progress`/`completed` — alors que les 5 autres tables du réseau partenaires (`partner_profiles`, `partner_connections`, `partner_connection_events`, `partner_messages`, `partner_intervention_events`) sont toutes strictement réservées aux admins depuis le correctif SEC-05, et que la page `/partenaires` est intégralement `Guard adminOnly` côté frontend.

## 2. Cause racine

`20260714000002_partner_request_status_gating.sql` a recréé intégralement `pir_select` pour ajouter un masquage par statut (objectif légitime), en réécrivant la condition depuis la version **pré-SEC-05** plutôt que d'ajouter sa nouvelle condition par un simple `AND` à la version sécurisée déjà en place — perdant silencieusement `is_admin_in_org(current_org_id())`. `20260715000009_fix_pir_update_rpc.sql`, en corrigeant par ailleurs un bug réel et distinct sur `pir_update` (conflit structurel Postgres RLS, correctement résolu), a recréé `pir_select` à l'identique de cette régression plutôt que de restaurer la version SEC-05, la pérennisant jusqu'à cette correction.

## 3. Historique résumé des migrations responsables

| # | Migration | Effet sur `pir_select` |
|---|---|---|
| 1 | `20260708000005_partner_intervention_requests_phase3.sql` | Création sans vérification de rôle |
| 2 | `20260708000008_security_phase1_critical_hardening.sql` (SEC-05) | **Ajoute `is_admin_in_org`** — première version sécurisée |
| 3 | `20260714000002_partner_request_status_gating.sql` | **Recrée sans `is_admin_in_org`**, ajoute le masquage par statut — cause racine |
| 4 | `20260715000003/004/008` (diagnostics) | Affaiblissements temporaires de `pir_update`/`pir_select` (`USING(true)`), tous corrigés dans la même série d'investigation, avant l'état final |
| 5 | `20260715000009_fix_pir_update_rpc.sql` | Corrige `pir_update` (bug distinct, résolu) mais **reconduit `pir_select` sans `is_admin_in_org`** — dernier état actif avant cette correction |

Aucune migration postérieure au 15/07/2026 ne retouche `pir_select`.

## 4. Condition avant correction

```sql
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    current_org_id() = source_organisation_id
    OR (
      current_org_id() = target_organisation_id
      AND status IN ('accepted', 'in_progress', 'completed')
    )
  );
```

## 5. Condition après correction

```sql
CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    public.is_admin_in_org(public.current_org_id())
    AND (
      public.current_org_id() = source_organisation_id
      OR (
        public.current_org_id() = target_organisation_id
        AND status IN ('accepted', 'in_progress', 'completed')
      )
    )
  );
```

Seule différence : ajout de `public.is_admin_in_org(public.current_org_id()) AND` en tête de condition, par un `AND` supplémentaire — le masquage par statut et les vérifications d'organisation source/cible sont conservés à l'identique, caractère pour caractère.

## 6. Fichier créé

`supabase/migrations/20260723000001_fix_pir_select_admin_check.sql` — contient uniquement : `DROP POLICY IF EXISTS "pir_select"`, la recréation avec le contrôle admin restauré, des commentaires expliquant la régression (historique complet), et des assertions statiques (schéma uniquement, aucune dépendance à une donnée réelle).

## 7. Policy modifiée

`public.partner_intervention_requests` → `pir_select` (SELECT). **Aucune autre policy, table, fonction, RPC, trigger ou fichier frontend n'a été modifié.**

## 8. Policies et objets volontairement non modifiés

`pir_insert`, `pir_update`, `partner_intervention_requests_before_update()` (trigger), `log_partner_intervention_event()`, `notify_on_partner_intervention_change()`, `respond_to_partner_intervention_request()`, `get_partner_requests_preview()`, toutes les policies de `partner_profiles`/`partner_connections`/`partner_connection_events`/`partner_messages`/`partner_intervention_events`, les helpers (`is_admin_in_org`, `current_org_id`, `is_connection_member`, `is_connection_accepted`, `is_partner_org`, `has_partner_relation`, `profile_belongs_to_org`), `src/lib/hooks/partners.ts`, `src/pages/PartenairesPage.tsx`, `src/components/CreateInterventionFromPartnerRequestModal.tsx`, toute route, tout rôle, toute donnée existante.

## 9. Tests écrits

Fichier : `audit-kaytek-inter/corrections/tests/correction-03-partner-rls-tests.sql`. Couvre exactement les scénarios demandés :
- **Organisation source** : admin (visible, tout statut testé pending/accepted/refused), assistant et intervenant (refusés — cœur de la non-régression).
- **Organisation cible** : admin sur `pending`/`refused` (refusé, masquage par statut préservé), admin sur `accepted`/`in_progress`/`completed` (visible), assistant et intervenant sur demande acceptée (refusés — cœur de RLS-01).
- **Isolation** : organisation tierce sans relation (refusé), identifiant de demande externe depuis la source et depuis la cible (refusé dans les deux sens), connexion redevenue `pending` après une demande déjà `accepted` (comportement inchangé — `pir_select` ne relit jamais le statut de la connexion, seulement celui de la demande, non affecté par cette correction).
- **Non-régression** : `pir_insert` admin (réussit) et assistant (refusé), `pir_update` admin cible (transition `accepted → in_progress` réussie) et assistant cible (0 ligne affectée), `respond_to_partner_intervention_request()` (comportement admin inchangé, accepte une demande `pending`).

Enveloppé dans `BEGIN ... ROLLBACK` — aucune donnée de test ne persiste même en cas d'exécution accidentelle.

## 10. Tests réellement exécutés

**Aucun test SQL/RLS n'a pu être exécuté** — même limitation que les Corrections 2 : Docker indisponible dans cet environnement (`docker ps` échoue), donc pas de base Supabase locale démarrable, et aucun projet de test distinct disponible. **Aucune tentative contre la production.**

Ce qui a été réellement exécuté :
- `npm run typecheck` → une seule erreur, identique et pré-existante (`DevisFormPage.tsx:191`, déjà documentée dans les Corrections 1/2) — aucune nouvelle erreur (cohérent : aucun fichier TypeScript n'a été touché par cette correction).
- `npm run build` → succès (`✓ built in 10.54s`), precache PWA 3690.70 KiB, strictement identique à l'état de fin de Correction 2 (aucun fichier frontend modifié).
- `npx vitest run` → 42/42 tests toujours passants, suite non affectée.

## 11. Limites de validation

Cette correction n'a été vérifiée que par :
1. relecture manuelle exhaustive du SQL final de `pir_select` avant/après (pas seulement des commentaires des migrations, conformément à la règle de cette correction) ;
2. les assertions statiques intégrées à la migration elle-même (existence de la policy, présence de `is_admin_in_org`, des contrôles `source_organisation_id`/`target_organisation_id`, des 3 statuts, présence inchangée de `pir_insert`/`pir_update`, exactement 3 policies sur la table) ;
3. la relecture du fichier de tests locaux pour en vérifier la cohérence logique (ordre des scénarios, restauration de l'état entre chaque test, alignement avec le trigger de machine à états).

**Aucune exécution réelle contre une base Postgres n'a eu lieu.** Le risque principal résiduel de cette correction est donc l'absence de validation dynamique — à effectuer avant tout déploiement (commandes fournies en §16).

## 12. Vérification Realtime à effectuer

`usePartnerInterventionRequests()` (`src/lib/hooks/partners.ts:235-242`) ouvre bien une souscription Realtime sur `partner_intervention_requests` :
```ts
const ch = supabase.channel(`partner-intervention-requests-${org}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_intervention_requests' },
    () => qc.invalidateQueries({ queryKey: ['partner-intervention-requests', org] }))
  .subscribe()
```
Aucun `filter` n'est appliqué côté client (souscription à toute la table) — l'isolation dépend donc entièrement de la réévaluation, par Supabase Realtime, de la policy `SELECT` de la table pour chaque abonné au moment de la diffusion (comportement standard documenté de `postgres_changes`, non spécifique à ce correctif). **Non modifié, non testé dynamiquement dans cette session.**

**À ajouter aux tests manuels futurs** :
- un assistant ou un intervenant connecté ne doit plus recevoir d'événement `postgres_changes` contenant une ligne de `partner_intervention_requests` (avant cette correction, ils pouvaient en recevoir pour les demandes de leur propre organisation) ;
- un admin doit continuer à recevoir normalement les événements pour les demandes qu'il peut déjà lire (source, ou cible avec statut `accepted`/`in_progress`/`completed`).

## 13. RLS-07 — anomalie distincte, non corrigée dans cette intervention

**`public.get_partner_requests_preview()`** :
- `SECURITY DEFINER`, exécutable par `authenticated` (`GRANT EXECUTE ... TO authenticated`, aucune restriction).
- **Ne vérifie jamais `is_admin_in_org()`** en interne, contrairement à `respond_to_partner_intervention_request()` qui, elle, effectue cette vérification explicitement.
- Peut donc exposer, à un assistant ou un intervenant de l'organisation cible, un aperçu partiel des demandes `pending`/`refused` (`ville`, `type_intervention`, `date_souhaitee`, `urgence`, `description_partagee` si `share_description`, `montant_partage` si `share_montant`, `note_refus`, `created_at`, `updated_at`) — jamais l'adresse, le téléphone, le nom du client, les photos ni les consignes (ces colonnes ne font pas partie du `RETURNS TABLE` de la fonction), mais c'est la même catégorie de problème que RLS-01 : une donnée partenaire accessible à un rôle non-admin par un chemin serveur.
- **Devra être corrigée immédiatement après cette correction**, avant de considérer le réseau partenaires comme entièrement sécurisé — **RLS-01 ne ferme pas totalement l'accès non-admin aux données partenaires tant que RLS-07 reste ouverte.**
- La future correction devra impérativement **préserver l'aperçu admin** des demandes `pending`/`refused` (fonctionnalité légitime et toujours nécessaire pour qu'un admin décide d'accepter/refuser sans attendre l'acceptation) — la correction consistera à ajouter une vérification `IF NOT public.is_admin_in_org(public.current_org_id()) THEN RETURN; END IF;` (ou équivalent) en tête de fonction, jamais à retirer l'aperçu lui-même.
- **Non corrigée dans cette intervention**, conformément à l'instruction explicite de ne traiter qu'une seule anomalie par correction.

## 14. Amélioration frontend non appliquée

`usePartnerInterventionRequests()` (`src/lib/hooks/partners.ts:231`) ne porte pas de garde `enabled: !!org && isAdm()`, contrairement à ses deux hooks voisins `usePartnerConnections`/`usePartnerUnreadCounts` qui portent explicitement ce garde et le commentaire *"Réseau partenaires réservé à l'admin — assistant/intervenant ne doivent jamais charger ces données, même hors affichage"*. Ajouter ce même garde constituerait une défense en profondeur cohérente, mais :
- ne remplace jamais la policy RLS (seule protection réelle contre un appel API direct) ;
- n'est pas nécessaire pour corriger RLS-01, qui est un problème serveur déjà résolu par cette migration ;
- sera traitée avec RLS-07 ou dans une correction frontend séparée, sur autorisation explicite.

**Non appliqué dans cette correction.**

## 15. Risque résiduel

- **Validation dynamique non effectuée** (§11) — risque principal, à lever avant déploiement.
- **RLS-07 reste ouverte** (§13) — le réseau partenaires n'est pas encore intégralement sécurisé après cette seule correction.
- Aucun risque de régression identifié sur `pir_insert`/`pir_update`/les triggers/les RPC/les autres tables — tous vérifiés inchangés par relecture directe du texte de la migration (aucun `DROP`/`CREATE` autre que `pir_select`).
- Aucune donnée existante affectée : cette correction ne modifie que la définition d'une policy, jamais une ligne de table.

## 16. Rollback exact

Restaure exactement la version précédente de `pir_select` (celle de `20260715000009_fix_pir_update_rpc.sql`), sans toucher à aucune autre policy :

```sql
DROP POLICY IF EXISTS "pir_select" ON public.partner_intervention_requests;

CREATE POLICY "pir_select" ON public.partner_intervention_requests
  FOR SELECT
  USING (
    current_org_id() = source_organisation_id
    OR (
      current_org_id() = target_organisation_id
      AND status IN ('accepted', 'in_progress', 'completed')
    )
  );
```

Côté fichiers :
```
git checkout -- .  # n'affecte rien ici : les 2 fichiers de cette correction sont non trackés
rm supabase/migrations/20260723000001_fix_pir_select_admin_check.sql
rm audit-kaytek-inter/corrections/tests/correction-03-partner-rls-tests.sql
```
(Le SQL de restauration ci-dessus n'a pas été exécuté — fourni pour référence uniquement, à appliquer seulement si un rollback réel s'avérait nécessaire après déploiement.)

## 17. Commandes de déploiement futures (documentées, non exécutées)

```
supabase db push          # applique la migration — uniquement après exécution réussie des tests locaux (§9/§11)
```
Aucune commande Supabase distante n'a été exécutée dans cette session.

---

**Correction 3 terminée. Je n'ai pas commencé RLS-07 ni la correction suivante. J'attends votre autorisation.**
