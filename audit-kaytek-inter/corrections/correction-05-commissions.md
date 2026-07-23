# Correction 5 — FONC-02 : uniformisation du calcul des commissions

**Date** : 2026-07-26
**Branche** : `capacitor-android`
**Statut** : Correction appliquée (1 migration additive + 1 requête de rapport en lecture seule + 1 fichier de tests locaux + adaptation d'un hook frontend), non commitée, non déployée, aucune opération distante exécutée, aucune donnée historique modifiée.

---

## 1. Les deux formules avant correction

**Chemin 1 — trigger `auto_commission()`** (`AFTER UPDATE ON interventions`, sur passage à `statut='termine'`) :
```
commission_admin = ROUND(interventions.montant_ttc × commission_pct / 100, 2)
part_intervenant  = interventions.montant_ttc − commission_admin
```
Traite `commission_pct` comme la part de **l'entreprise**, ignore totalement le matériel (`cout_pieces`/`materiel_confirme`), n'utilise jamais `factures.montant_ttc`, ne renseigne jamais `facture_id`.

**Chemin 2 — `useCommissionsData()`** (recalcul frontend à la volée, page Commissions) :
```
base = MAX(0, factures.montant_ttc − (cout_pieces si materiel_confirme))
commission_intervenant = ROUND(base × commission_pct / 100, 2)
reste_entreprise = base − commission_intervenant
```
Traite `commission_pct` comme la part de **l'intervenant** (confirmé : la page labellise ce montant "Ma commission"), déduit le matériel confirmé, recalcule avec le taux **courant** du profil à chaque affichage.

Ces deux lectures de `commission_pct` sont mathématiquement opposées — exemple validé : facture 900 € commissionnable, taux 30 % → 270 € pour l'intervenant (formule correcte) contre 630 € pour l'intervenant selon l'ancienne logique du trigger (100 % − 30 %).

## 2. Formule métier validée

```
montant_ttc_source   = factures.montant_ttc
cout_pieces_applique = interventions.cout_pieces si materiel_confirme = true, sinon 0
base_commissionnable = MAX(0, montant_ttc_source − cout_pieces_applique)
part_intervenant      = ROUND(base_commissionnable × commission_pct / 100, 2)
commission_admin      = base_commissionnable − part_intervenant   (dérivé par soustraction, jamais arrondi indépendamment)
```
`commission_pct` = taux de l'**intervenant** partout. Identité garantie au centime : `part_intervenant + commission_admin = base_commissionnable` (contrainte `CHECK`, §7).

## 3. Événement déclencheur

Le calcul définitif se déclenche au passage de `factures.statut_paiement` à `'payee'` (trigger `AFTER INSERT OR UPDATE ON factures`) — plus jamais à la clôture d'une intervention. Le trigger ne se redéclenche pas sur un `UPDATE` d'une facture déjà payée sans changement de statut (condition `OLD.statut_paiement IS DISTINCT FROM 'payee'`). Paiement partiel (`acompte_recu`) : non pris en compte, la commission reste différée jusqu'au statut `payee` intégral, conformément à la décision validée.

## 4. Traitement du matériel

Déduit du TTC **avant** application du taux, uniquement si `materiel_confirme = true` **au moment du calcul**. Un recalcul est autorisé — uniquement si la commission n'est pas finalisée — lorsque `cout_pieces` ou `materiel_confirme` change après coup sur l'intervention liée (nouveau trigger dédié, §9). `materiel_payeur` a été explicitement vérifié : il n'intervient dans aucun terme de la formule validée, et n'a donc **pas** été inclus dans la condition de déclenchement du recalcul (évite des recalculs inutiles sans effet sur les montants) ni dans les colonnes figées de `commissions` — il reste lu en direct depuis `interventions` côté frontend, purement informatif.

## 5. Taux figé

`commission_pct` est copié depuis `profiles.commission_pct` **uniquement à la création initiale** de la ligne. Tout recalcul ultérieur (matériel confirmé/modifié) **conserve** ce taux déjà figé — il n'est jamais relu depuis le profil. Techniquement garanti par construction : la clause `INSERT ... ON CONFLICT DO UPDATE` de `calculate_commission_for_facture()` n'inclut jamais `commission_pct` dans son `SET`, donc même en cas de conflit (recalcul ou concurrence), la valeur déjà écrite est structurellement préservée quelle que soit la valeur courante du profil.

## 6. Nouvelles colonnes (`public.commissions`)

`montant_ttc_source numeric`, `cout_pieces_applique numeric`, `materiel_confirme_applique boolean`, `base_commissionnable numeric`, `formule_version integer` — toutes **nullables**, aucune ligne historique modifiée. `formule_version = 2` pour toute nouvelle ligne ; `NULL` pour les lignes historiques (jamais rétro-attribué). Les colonnes préexistantes (`part_intervenant`, `commission_admin`, `commission_pct`, `montant_total_client`) **n'ont pas été renommées** — pour les nouvelles lignes, `part_intervenant` contient désormais réellement la commission de l'intervenant, `commission_admin` la part réelle de l'entreprise, `montant_total_client` le TTC de la facture (documenté en commentaire SQL sur chaque colonne).

## 7. Mécanisme d'idempotence

Audit bloquant des doublons `(facture_id, intervenant_id)` avant toute modification de schéma, puis index `UNIQUE (facture_id, intervenant_id) WHERE facture_id IS NOT NULL`. La fonction `calculate_commission_for_facture()` utilise `INSERT ... ON CONFLICT (facture_id, intervenant_id) ... DO UPDATE` : deux transitions concurrentes vers `payee` (ou un rejeu) ne produisent jamais qu'une seule ligne — le conflit est résolu atomiquement par PostgreSQL, pas par une vérification applicative préalable. Contraintes `CHECK` additionnelles (actives uniquement si `formule_version = 2`, jamais sur les lignes historiques) : taux 0-100, montants non négatifs, coût matériel non négatif, base non négative, base ≤ TTC source, champs v2 tous renseignés, et l'identité `part_intervenant + commission_admin = base_commissionnable`.

## 8. Ancien trigger désactivé

`trg_auto_commission` (`AFTER UPDATE ON interventions`) **supprimé** — c'était le seul objet appelant `auto_commission()`. La fonction `auto_commission()` elle-même **n'est pas supprimée** (conservée pour faciliter un rollback exact), mais devient orpheline : plus aucun trigger ne l'invoque, donc plus aucune commission n'est créée à la clôture d'une intervention. Assertion statique dédiée confirmant l'absence du trigger et la présence de la fonction.

## 9. Nouveau trigger

`trg_calculate_commission_on_facture_payee` (`AFTER INSERT OR UPDATE ON factures`) appelle exclusivement `calculate_commission_for_facture(NEW.id)` sur transition vers `'payee'`. `trg_recalculate_commission_on_materiel_change` (`AFTER UPDATE ON interventions`) rappelle la même fonction pour chaque facture payée liée, uniquement si `cout_pieces` ou `materiel_confirme` a changé — la fonction elle-même applique toutes les gardes (non finalisée, taux figé conservé, jamais une ligne `formule_version IS NULL` puisque ces lignes n'ont jamais de `facture_id` renseigné, donc structurellement invisibles à ces requêtes).

## 10. Protection des commissions finalisées

Trigger `trg_protect_finalized_commission` (`BEFORE UPDATE ON commissions`) : si `OLD.statut = 'paye'` **ou** une ligne `commission_receipts` correspondante a `recue = true`, toute tentative de modifier l'un des 13 champs financiers/structurels listés (`montant_total_client`, `commission_pct`, `part_intervenant`, `commission_admin`, `montant_ttc_source`, `cout_pieces_applique`, `materiel_confirme_applique`, `base_commissionnable`, `formule_version`, `facture_id`, `intervention_id`, `intervenant_id`, `organisation_id`) est refusée (`RAISE EXCEPTION`). Les transitions de `statut` elles-mêmes et la lecture restent toujours possibles.

**Limite résiduelle assumée, non corrigée** : une commission **non finalisée** reste modifiable directement par un admin via `UPDATE` (la policy `commissions_update`, inchangée, n'a jamais restreint les colonnes modifiables) — seule la création directe (`INSERT`) a été durcie, et seules les lignes finalisées sont protégées en écriture. Un admin conserve donc la possibilité d'éditer manuellement une commission en cours, cohérent avec le niveau de confiance déjà accordé à ce rôle ailleurs dans l'application (ex. `factures_update`), mais à signaler comme un point de vigilance si un contrôle plus strict est souhaité ultérieurement.

## 11. Durcissement RLS

`commissions_insert` recréée en `WITH CHECK (false)` — plus aucun `INSERT` direct, pour aucun rôle (admin compris), puisqu'aucune fonction administrative sécurisée équivalente n'existe encore pour un usage manuel. Toute création passe désormais exclusivement par `calculate_commission_for_facture()` (`SECURITY DEFINER`, jamais accordée en `EXECUTE` à `authenticated`/`anon`, appelée uniquement par les triggers). `commissions_select`/`commissions_update`/`commissions_delete` et les **quatre** policies de `commission_receipts` (`cr_select`/`cr_insert`/`cr_update`/`cr_delete`) sont **strictement inchangées** — vérifié par assertion de comptage dans la migration elle-même.

## 12. Adaptations Dashboard / page Commissions / exports

- **`useDashboard()` / `useCommissions()`** : **aucune modification** — ces hooks lisaient déjà directement les colonnes stockées de `commissions` (`commission_admin`, `part_intervenant`), sans recalcul propre. Le bug résidait uniquement dans la valeur produite côté trigger, désormais corrigée à la source ; ces deux hooks affichent donc automatiquement les bonnes valeurs sans changement de code, et continuent d'inclure les lignes historiques (`formule_version IS NULL`) exactement comme avant.
- **`useCommissionsData()`** (`src/lib/hooks/index.ts`) : réécrite pour lire directement les lignes `commissions` où `formule_version = 2` (jointes à `factures`/`interventions`/`profiles` pour l'affichage uniquement), au lieu de recalculer depuis `factures.montant_ttc`/`interventions.cout_pieces`/`profiles.commission_pct` courants. **Le nom et la forme des champs retournés sont volontairement inchangés** (`commission_intervenant`, `reste_entreprise`, `cout_pieces`, `base_commissionnable`, `commission_pct`, etc.) — ils sont désormais sourcés depuis les colonnes figées correspondantes (`part_intervenant`, `commission_admin`, `cout_pieces_applique`…) plutôt que recalculés, ce qui a permis de **ne modifier aucun autre fichier** (`CommissionsPage.tsx` et `exportPremium.ts` consomment ces champs sans changement).
- **`CommissionsPage.tsx`** : **non modifiée** — continue de n'afficher que les factures payées avec commission calculée (`formule_version = 2`), exactement le même périmètre qu'avant cette correction (elle n'a jamais affiché les lignes historiques du trigger, qui n'étaient de toute façon jamais liées à une facture payée dans son ancienne requête non plus). Aucun indicateur "Ancien calcul" n'a été ajouté : la page ne les affiche pas, comme avant.
- **`exportPremium.ts`** : **non modifiée** — vérifié qu'aucune formule financière n'y était implémentée ; le fichier ne fait qu'agréger/formater les champs déjà calculés par `useCommissionsData()`, donc hérite automatiquement de la correction.
- **Libellés** (§14 de l'autorisation) : déjà corrects dans `CommissionsPage.tsx` — `commission_intervenant`/"Ma commission" correspond bien à `part_intervenant` (désormais la vraie commission de l'intervenant), `reste_entreprise`/"Reste entreprise" correspond à `commission_admin` (désormais la vraie part entreprise) ; aucun libellé ne présentait l'inverse, donc aucun changement de texte n'était nécessaire — seule la **source des chiffres** a changé.

## 13. Traitement des lignes historiques

**Aucune ligne historique modifiée.** `formule_version` reste `NULL` pour toutes les lignes déjà existantes. Les contraintes v2 (§7) ne s'appliquent jamais à elles (`formule_version IS DISTINCT FROM 2 OR ...`). Elles restent structurellement invisibles aux deux nouveaux triggers (jamais de `facture_id` renseigné) et à la fonction centrale (recherche toujours par `facture_id`). Elles continuent d'apparaître au Dashboard exactement comme avant (§12).

## 14. Requête de rapport d'écarts (lecture seule)

`audit-kaytek-inter/corrections/commissions-ecarts-historiques.sql` — pour chaque ligne `formule_version IS NULL`, calcule à titre indicatif (jamais écrit) la base et la commission intervenant que produirait la formule v2, à partir de la facture potentiellement liée (reconstituée par jointure sur `intervention_id`, `facture_id` n'ayant jamais été renseigné par l'ancien trigger — limite explicitement documentée en en-tête : plusieurs factures candidates possibles si une intervention en a généré plus d'une, cf. FACT-02) et de l'état matériel **actuel** (pas nécessairement celui de l'époque). Aucun `UPDATE`. Non exécutée dans cette session (nécessite une base réelle peuplée).

## 15. Tests écrits

`audit-kaytek-inter/corrections/tests/correction-05-commission-tests.sql` (`BEGIN...ROLLBACK`) : calculs (sans matériel, matériel confirmé, matériel non confirmé, matériel = TTC, matériel > TTC, taux 0 %, taux 100 %, arrondis) ; déclenchement (création directe payée, transition impayée→payée, non-régénération sur `UPDATE` sans changement pertinent, rejeu/double déclenchement → idempotence) ; valeurs figées (changement de taux sans effet rétroactif, recalcul matériel autorisé si non finalisée, refusé si finalisée) ; sécurité (`INSERT` direct intervenant refusé, `INSERT` direct admin refusé, lecture intervenant/admin conservée, cross-tenant refusé) ; historique (ligne `formule_version IS NULL` insérée directement puis vérifiée inchangée après modification du matériel de son intervention) ; immutabilité (`statut='paye'` et `commission_receipts.recue=true` bloquent la modification financière).

## 16. Tests exécutés

**Aucun test SQL n'a pu être exécuté** — Docker indisponible dans cet environnement (`docker ps` échoue), pas de base Supabase locale démarrable, aucune tentative contre la production.

Réellement exécutés dans cette session :
- `npm run typecheck` → une seule erreur, identique et pré-existante (`DevisFormPage.tsx:191`) — aucune nouvelle erreur.
- `npm run build` → succès (`✓ built in 11.23s`), precache PWA 3690.62 KiB (quasi identique à l'état précédent).
- `npx vitest run` → 42/42 tests toujours passants, suite non affectée.

## 17. Limites

Validation purement statique et par relecture (assertions de migration, relecture ligne à ligne du fichier de tests et du hook modifié). Le comportement empirique réel — en particulier l'idempotence sous concurrence réelle (deux transitions simultanées), le recalcul matériel en conditions réelles, et l'ampleur des écarts historiques (§14) — n'a pas pu être vérifié dynamiquement dans cet environnement.

## 18. FONC-04 — anomalie distincte, non traitée

**Cycle de vie des commissions après annulation de facture ou réaffectation d'intervention** — non traité dans cette correction, conformément à l'instruction explicite. Aucun comportement automatique n'a été inventé : une facture annulée après création d'une commission, ou une intervention réaffectée à un autre intervenant après création d'une commission, laissent aujourd'hui la commission telle quelle (ni annulée, ni réattribuée). À traiter comme correction séparée si nécessaire.

## 19. Coexistence temporaire des deux statuts

`commissions.statut` (administratif, `a_payer`/`paye`) et `commission_receipts.recue` (confirmation par l'intervenant) restent **deux mécanismes distincts, non fusionnés**, conformément à la décision validée. La finalisation (immutabilité, §10) est atteinte si **l'un ou l'autre** indique un règlement terminé. **Dette produit documentée, non résolue** : le Dashboard (`useDashboard()`) continue de calculer "Commissions à payer"/"Mes gains" à partir du seul `commissions.statut` (jamais mis à jour via l'UI aujourd'hui, `useUpdateCommission()` restant un mécanisme mort, non ré-activé par cette correction) — une commission déjà marquée `recue` par l'intervenant via `commission_receipts` continue donc d'apparaître comme "à payer" au Dashboard. Ce n'est pas une régression introduite ici (comportement déjà présent avant la correction), mais reste un écart connu entre les deux écrans, hors périmètre de cette correction (qui portait sur le **montant**, pas sur la réconciliation des deux statuts).

## 20. Rollback SQL exact

```sql
-- 1. Restaurer commissions_insert à son état précédent (Correction 2)
DROP POLICY IF EXISTS "commissions_insert" ON public.commissions;
CREATE POLICY "commissions_insert" ON public.commissions
  FOR INSERT
  WITH CHECK (
    organisation_id = current_org_id()
    AND (
      is_admin_in_org(current_org_id())
      OR (is_intervenant_in_org(current_org_id()) AND intervenant_id = auth.uid())
    )
    AND current_organisation_has_app_access()
  );

-- 2. Retirer les nouveaux triggers et fonctions
DROP TRIGGER IF EXISTS trg_protect_finalized_commission ON public.commissions;
DROP TRIGGER IF EXISTS trg_recalculate_commission_on_materiel_change ON public.interventions;
DROP TRIGGER IF EXISTS trg_calculate_commission_on_facture_payee ON public.factures;
DROP FUNCTION IF EXISTS public.protect_finalized_commission_fields();
DROP FUNCTION IF EXISTS public.trigger_recalculate_commission_on_materiel_change();
DROP FUNCTION IF EXISTS public.trigger_calculate_commission_on_facture_payee();
DROP FUNCTION IF EXISTS public.calculate_commission_for_facture(uuid);

-- 3. Restaurer l'ancien trigger (la fonction auto_commission() a été conservée)
CREATE TRIGGER trg_auto_commission
  AFTER UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.auto_commission();

-- 4. Retirer l'index unique et les contraintes v2
DROP INDEX IF EXISTS public.commissions_facture_intervenant_unique;
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_v2_pct_range,
  DROP CONSTRAINT IF EXISTS commissions_v2_montants_non_negatifs,
  DROP CONSTRAINT IF EXISTS commissions_v2_champs_requis,
  DROP CONSTRAINT IF EXISTS commissions_v2_cout_pieces_non_negatif,
  DROP CONSTRAINT IF EXISTS commissions_v2_base_non_negative,
  DROP CONSTRAINT IF EXISTS commissions_v2_base_le_ttc,
  DROP CONSTRAINT IF EXISTS commissions_v2_parts_egalent_base;

-- 5. Retirer les colonnes additives (perd les valeurs v2 déjà calculées —
--    à n'exécuter qu'en cas de rollback complet décidé, jamais automatiquement)
ALTER TABLE public.commissions
  DROP COLUMN IF EXISTS montant_ttc_source,
  DROP COLUMN IF EXISTS cout_pieces_applique,
  DROP COLUMN IF EXISTS materiel_confirme_applique,
  DROP COLUMN IF EXISTS base_commissionnable,
  DROP COLUMN IF EXISTS formule_version;
```
Purement additif/réversible — aucune donnée historique de `commissions`/`commission_receipts`/`factures`/`interventions`/`profiles` n'est jamais touchée dans un sens comme dans l'autre.

## 21. Rollback frontend

```
git checkout -- src/lib/hooks/index.ts
```
Restaure l'état précédent de tout le fichier (y compris d'éventuelles modifications non liées de la Correction 1 sur ce même fichier — à vérifier au cas par cas si un rollback partiel est souhaité plutôt qu'un rollback complet du fichier).

## 22. Commandes de déploiement futures (documentées, non exécutées)

```
supabase db push     # applique la migration — uniquement après exécution réussie des tests locaux (§15/§16) et exécution du rapport d'écarts (§14) sur une base réelle pour évaluer l'ampleur historique avant tout déploiement
```
Aucune commande Supabase distante n'a été exécutée dans cette session.

---

**Correction 5 terminée. Je n'ai commencé aucune autre correction. J'attends votre autorisation.**
