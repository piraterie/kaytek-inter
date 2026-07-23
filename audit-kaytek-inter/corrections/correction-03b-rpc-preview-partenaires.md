# Correction 3 bis — RLS-07 : sécurisation de `get_partner_requests_preview()`

**Date** : 2026-07-24
**Branche** : `capacitor-android`
**Statut** : Correction appliquée (1 migration additive + 1 fichier de tests locaux + 1 fichier frontend), non commitée, non déployée, aucune opération distante exécutée.

---

## 1. Anomalie initiale

`public.get_partner_requests_preview(p_status text)` est une RPC `SECURITY DEFINER`, exécutable par `authenticated`, fournissant à l'organisation **cible** un aperçu des demandes partenaires `pending`/`refused` (nécessaire car `pir_select` masque délibérément ces lignes tant qu'elles ne sont pas acceptées — Correction 3/RLS-01). Contrairement à `respond_to_partner_intervention_request()` (même famille de RPC), elle ne vérifiait **jamais** `is_admin_in_org()` : un assistant ou un intervenant de l'organisation cible pouvait l'appeler directement (hors UI, `/partenaires` étant déjà `Guard adminOnly`) et recevoir cet aperçu.

## 2. Données accessibles avant correction

`id`, `connection_id`, `source_organisation_id`, `type_intervention`, `urgence`, `date_souhaitee`, `ville`, `description_partagee` (si `share_description`), `montant_partage` (si `share_montant`), `status`, `note_refus`, `created_at`, `updated_at` — pour toute demande `pending`/`refused` de l'organisation cible de l'appelant, quel que soit son rôle. **Jamais** adresse, téléphone, nom client, photos, consignes ou identifiant d'intervention source (colonnes absentes du type de retour, structurellement impossibles à exposer par cette fonction).

## 3. Rôle concerné

`assistant` et `intervenant` de l'organisation cible d'une demande `pending`/`refused`.

## 4. Fonction avant correction

```sql
CREATE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id uuid, connection_id uuid, source_organisation_id uuid,
  type_intervention text, urgence boolean, date_souhaitee timestamptz, ville text,
  description_partagee text, montant_partage numeric,
  status text, note_refus text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
$$;

REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;
```

## 5. Fonction après correction

```sql
CREATE OR REPLACE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id uuid, connection_id uuid, source_organisation_id uuid,
  type_intervention text, urgence boolean, date_souhaitee timestamptz, ville text,
  description_partagee text, montant_partage numeric,
  status text, note_refus text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_in_org(public.current_org_id()) THEN
    RAISE EXCEPTION 'Seul un administrateur peut consulter cet aperçu de demande partenaire';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
END;
$$;
```

Seules différences : le garde admin en tête de fonction, et le passage de `LANGUAGE sql` à `LANGUAGE plpgsql` (rendu nécessaire par ce garde). Signature, colonnes, filtres et masquage strictement identiques.

## 6. Raison du maintien de `SECURITY DEFINER`

La fonction doit lire des lignes que l'appelant (même admin) ne peut pas voir via `pir_select` — précisément les demandes `pending`/`refused` de sa propre organisation cible, masquées par statut depuis la Correction 3/RLS-01. Sans `SECURITY DEFINER`, la fonction ne renverrait jamais rien pour ces statuts, cassant sa raison d'être. Le garde admin ajouté ici compense ce bypass RLS en réintroduisant, à l'intérieur de la fonction elle-même, exactement le contrôle de rôle que `pir_select` applique pour les autres statuts.

## 7. Raison de la conversion en `plpgsql`

`LANGUAGE sql` ne supporte pas la syntaxe procédurale `RAISE EXCEPTION`. La conversion vers `plpgsql` était donc une condition technique incontournable pour appliquer l'Option A (refus explicite) validée. `CREATE OR REPLACE FUNCTION` a été utilisé (pas de `DROP FUNCTION`) : PostgreSQL autorise le changement de `LANGUAGE` et du corps par `CREATE OR REPLACE` tant que les types de paramètres et le type de retour (ici : les 13 colonnes `OUT` de `RETURNS TABLE`, identiques) ne changent pas — ce qui est le cas ici. Cela élimine toute fenêtre de disparition de la fonction et tout risque lié à un `DROP`/`CASCADE` sur d'éventuelles dépendances (aucune trouvée : ni vue, ni autre fonction ne référence `get_partner_requests_preview`).

## 8. Signature et colonnes

Strictement inchangées : `get_partner_requests_preview(p_status text DEFAULT 'pending')`, 13 colonnes de retour identiques (noms, types, ordre). Vérifié par assertion statique dans la migration (`pg_get_function_arguments`/`pg_get_function_result`) et par test local dédié (tentative de sélection des colonnes interdites, doit échouer avec `undefined_column`).

## 9. Grants/Revokes

```sql
REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO service_role;
```
Aucun droit `anon`. `authenticated` conserve `EXECUTE` précisément parce que la fonction vérifie désormais elle-même le rôle admin. `service_role` ajouté par hygiène (cohérent avec la Correction 2), sans qu'aucun appelant actuel n'en ait besoin (aucune Edge Function n'appelle cette RPC).

## 10. Absence de bypass service role

Le corps de la fonction ne teste ni `current_user`, ni aucun rôle PostgreSQL — l'autorisation reste dérivée exclusivement de `auth.uid()` via `current_org_id()`/`is_admin_in_org()`. Un appel effectué avec le rôle `service_role` mais **sans** contexte JWT utilisateur (donc `auth.uid()` NULL) est refusé exactement comme un appel `authenticated` non-admin (`current_org_id()` renvoie NULL, `is_admin_in_org(NULL)` renvoie `false`). Vérifié par assertion statique dans la migration (recherche de `current_user`/`service_role` dans `pg_proc.prosrc` — absent).

## 11. Modification du hook (`src/lib/hooks/partners.ts`)

`usePartnerInterventionRequests()` :
```ts
enabled: !!org && isAdm(),
```
sur le `useQuery` (remplace `enabled: !!org`), identique au pattern déjà utilisé par `usePartnerConnections()`/`usePartnerUnreadCounts()`. Défense en profondeur uniquement — ne remplace jamais le garde serveur ci-dessus, qui reste la seule protection réelle contre un appel API direct.

## 12. Modification Realtime

```ts
useEffect(() => {
  if (!org || !isAdm()) return
  ...
}, [org, qc])
```
Le canal Realtime `partner-intervention-requests-${org}` n'est plus ouvert du tout pour un non-admin (auparavant ouvert dès que `org` était défini, indépendamment du rôle). Le nettoyage (`return () => supabase.removeChannel(ch)`) reste inchangé et continue de s'exécuter normalement au démontage. **Limite documentée, non corrigée ici** (hors périmètre, comportement pré-existant identique sur les hooks voisins) : `org`/`isAdm()` sont des lectures ponctuelles (`getState()`) du store Zustand, pas des abonnements réactifs — un changement de rôle ou d'organisation *en cours de session, sans re-rendu du composant appelant*, ne referme/rouvre pas automatiquement le canal. Ce n'est pas une régression introduite par cette correction : c'est le même comportement que `usePartnerConnections()`/`usePartnerUnreadCounts()` aujourd'hui.

## 13. Tests écrits

`audit-kaytek-inter/corrections/tests/correction-03b-partner-preview-rpc-tests.sql` (`BEGIN...ROLLBACK`), couvrant :
- **Autorisations** : admin cible actif (autorisé, 1 ligne) ; assistant/intervenant cible (refusés) ; assistant/intervenant source (refusés) ; utilisateur anonyme (refusé) ; admin cible désactivé (refusé) ; admin d'une organisation tierce (autorisé à appeler, 0 ligne) ; admin source non-cible (0 ligne).
- **Statuts** : `pending`/`refused` → 1 ligne chacun ; `accepted`/`in_progress`/`completed`/valeur arbitraire → 0 ligne.
- **Données** : masquage `description_partagee`/`montant_partage` conforme aux flags `share_*` (testé positif et négatif) ; absence structurelle des colonnes interdites (test par tentative de sélection, doit échouer en `undefined_column`).
- **Privilèges** : `anon` sans `EXECUTE`, `authenticated` et `service_role` avec `EXECUTE`.

## 14. Tests exécutés

**Aucun test SQL n'a pu être exécuté** — Docker indisponible dans cet environnement (`docker ps` échoue), pas de base Supabase locale démarrable, aucune tentative contre la production.

Réellement exécutés dans cette session :
- `npm run typecheck` → une seule erreur, identique et pré-existante (`DevisFormPage.tsx:191`) — aucune nouvelle erreur.
- `npm run build` → succès (`✓ built in 10.78s`), precache PWA 3690.71 KiB (quasi identique à l'état précédent, +0.01 Ko — cohérent avec les 2 lignes de commentaire/logique ajoutées dans `partners.ts`).
- `npx vitest run` → 42/42 tests toujours passants, suite non affectée (aucun fichier testé par Vitest n'a été touché).

## 15. Limites

Validation purement statique (relecture du SQL final, assertions de migration, relecture du diff frontend) — aucune exécution dynamique réelle. Le comportement exact de PostgreSQL pour `CREATE OR REPLACE FUNCTION` changeant `LANGUAGE sql → plpgsql` (accepté sans erreur, sans changement d'OID de la fonction) est documenté et cohérent avec la documentation PostgreSQL, mais non revérifié empiriquement dans cet environnement.

## 16. Dette documentée — `organisations.actif` dans les fonctions partenaires

`is_admin_in_org()` vérifie `profiles.actif = true` mais **aucune fonction du réseau partenaires** (`get_partner_requests_preview`, `respond_to_partner_intervention_request`, `search_partner_profiles`, les helpers `is_connection_member`/`is_connection_accepted`/`has_partner_relation`/`is_partner_org`) ne vérifie `organisations.actif`. Une organisation désactivée dont l'admin a un profil encore actif conserverait donc un accès fonctionnel complet au réseau partenaires. **Non traité dans cette correction** (ni dans RLS-01/Correction 3), conformément à l'instruction explicite de ne pas élargir le périmètre — à documenter comme anomalie distincte si une correction dédiée est souhaitée ultérieurement, potentiellement transversale à l'ensemble des fonctions partenaires plutôt que spécifique à `get_partner_requests_preview`.

## 17. Rollback SQL exact

```sql
CREATE OR REPLACE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id                      uuid,
  connection_id           uuid,
  source_organisation_id  uuid,
  type_intervention       text,
  urgence                 boolean,
  date_souhaitee          timestamptz,
  ville                   text,
  description_partagee    text,
  montant_partage         numeric,
  status                  text,
  note_refus              text,
  created_at              timestamptz,
  updated_at              timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
$$;

REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;
```
(Restaure exactement l'état d'avant cette correction — y compris la réouverture du bypass RLS-07 — à n'utiliser qu'en cas de problème bloquant constaté après déploiement.)

## 18. Rollback frontend

```
git checkout -- src/lib/hooks/partners.ts
```
(Fichier suivi par git — restaure l'état d'avant cette correction, y compris pour les modifications d'autres corrections éventuelles sur ce même fichier ; aucune autre correction ne l'a modifié à ce jour, donc ce rollback est ciblé.)

## 19. Commandes de déploiement futures (documentées, non exécutées)

```
supabase db push     # applique la migration — uniquement après exécution réussie des tests locaux (§13/§14)
```
Aucune commande Supabase distante n'a été exécutée dans cette session.

---

**RLS-07 corrigée. Je n'ai commencé aucune autre correction. J'attends votre autorisation.**
