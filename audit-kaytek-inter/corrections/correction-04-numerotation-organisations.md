# Correction 4 — DB-02 : numérotation des devis, factures et interventions par organisation

**Date** : 2026-07-25
**Branche** : `capacitor-android`
**Statut** : Correction appliquée (1 migration additive + 1 fichier de tests locaux), non commitée, non déployée, aucune opération distante exécutée.

---

## 1. Mécanisme avant correction

Chaque table (`devis`, `factures`, `interventions`) portait un trigger `BEFORE INSERT` appelant respectivement `generate_devis_numero()`, `gen_numero_facture()`, `gen_numero_intervention()` :
```sql
IF NEW.numero IS NULL OR NEW.numero = '' THEN
  PERFORM pg_advisory_xact_lock(hashtext('<table>_numero_lock'));
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix)+1) AS INTEGER)), 0)
  INTO maxn FROM public.<table> WHERE numero ~ ('^' || prefix || '[0-9]+$');
  NEW.numero := prefix || LPAD((maxn+1)::TEXT, 3, '0');
END IF;
```
Verrou et calcul **globaux** (toutes organisations confondues), et surtout : un `numero` explicite non vide fourni par l'appelant était **conservé tel quel**, sans aucune vérification — combiné à l'absence totale de contrainte `UNIQUE` sur `numero` (confirmée par recherche exhaustive), rien n'empêchait un doublon si un appel direct (hors frontend officiel) fournissait un numéro arbitraire.

## 2. Mécanisme après correction

Trigger (mêmes noms, mêmes triggers, corps remplacé) :
```sql
IF NEW.organisation_id IS NULL THEN
  RAISE EXCEPTION 'organisation_id requis pour la numérotation du devis';
END IF;
NEW.numero := public.next_document_number(NEW.organisation_id, 'devis');
RETURN NEW;
```
`NEW.numero` est **systématiquement écrasé**, quelle que soit la valeur fournie (vide, remplie, valide, falsifiée). La génération elle-même passe par `public.next_document_number(organisation_id, document_type)`, atomique via `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` sur une nouvelle table `document_counters`, scopée par organisation, type de document et année.

## 3. Raison de l'abandon de `MAX()+1`

- **Non scopé par organisation** (compteur partagé par toutes les organisations — c'est DB-02 lui-même).
- **Non protégé par contrainte** : ne générait un numéro que si vide ; un numéro explicite non vide n'était jamais validé contre l'existant.
- **Contention inutile** : le verrou `pg_advisory_xact_lock` était pris par table, pas par organisation — toutes les organisations créant un devis se sérialisaient entre elles sans raison.
- `INSERT ... ON CONFLICT (organisation_id, document_type, period_key) DO UPDATE ... RETURNING` élimine ces trois problèmes : le verrou de ligne implicite pris par `ON CONFLICT DO UPDATE` rend l'opération atomique sans verrou explicite, scopé naturellement par la clé composite (aucune contention entre organisations non liées).

## 4. Structure de `document_counters`

```sql
CREATE TABLE public.document_counters (
  organisation_id uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  document_type   text        NOT NULL CHECK (document_type IN ('devis', 'factures', 'interventions')),
  period_key      text        NOT NULL CHECK (period_key ~ '^\d{4}$'),
  current_value   bigint      NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, document_type, period_key)
);
```
`ON DELETE CASCADE` confirmé compatible : `devis`/`factures`/`interventions` ont déjà `organisation_id ... ON DELETE RESTRICT` vers `organisations` — une organisation ayant le moindre historique ne peut de toute façon jamais être supprimée ; le `CASCADE` ici ne fait que permettre le nettoyage de compteurs devenus orphelins dans le seul cas (aujourd'hui impossible en pratique) d'une organisation sans aucun document supprimée. RLS activée, **aucune policy** pour `authenticated`/`anon` (deny-all par défaut), et `REVOKE ALL` explicite sur la table pour ces deux rôles par hygiène (indépendamment des privilèges par défaut de la plateforme).

## 5. Fonction centrale

```sql
CREATE OR REPLACE FUNCTION public.next_document_number(
  p_organisation_id uuid,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
...
INSERT INTO public.document_counters (organisation_id, document_type, period_key, current_value)
VALUES (p_organisation_id, p_document_type, v_period, 1)
ON CONFLICT (organisation_id, document_type, period_key)
DO UPDATE SET current_value = document_counters.current_value + 1, updated_at = now()
RETURNING current_value INTO v_next;
RETURN v_prefix || v_period || '-' || LPAD(v_next::text, 3, '0');
$$;
```
Volatilité : aucune clause `STABLE`/`IMMUTABLE` déclarée — la fonction est donc `VOLATILE` (comportement par défaut), correct puisqu'elle modifie `document_counters` à chaque appel.

## 6. Utilisation de `NEW.organisation_id`

La fonction reçoit l'organisation **en paramètre explicite** (`NEW.organisation_id`, transmis par le trigger), pas uniquement via `current_org_id()` — permet aux traitements internes légitimes (futures migrations contrôlées, appels `service_role` sans JWT utilisateur) de générer un numéro pour une organisation donnée. Ceci ne compromet pas la sécurité : pour un appel utilisateur normal, la policy `WITH CHECK` de la table cible (`devis_insert`/`factures_insert`/`interventions_insert`, **inchangées** par cette migration) impose déjà `organisation_id = current_org_id()`.

**Ordre PostgreSQL vérifié et documenté** : (1) le trigger `BEFORE INSERT` s'exécute et modifie `NEW` (y compris `NEW.numero`, et l'incrément de `document_counters` qu'il déclenche) ; (2) la policy `WITH CHECK` de la table est évaluée sur la ligne finale `NEW` ; (3) si `WITH CHECK` échoue, **toute la transaction/instruction** — y compris l'incrément fait par le trigger à l'étape 1 — est annulée. Une tentative avec un `organisation_id` falsifié dans le payload : (a) est refusée par la policy existante, inchangée ; (b) ne laisse **aucun incrément persistant** dans `document_counters` (vérifié par test dédié, voir §13).

## 7. Raison pour laquelle le numéro client est toujours écrasé

Le contrat précédent ("numéro non vide = accepté") permettait à tout appelant de fournir un numéro arbitraire, y compris un doublon, sans aucune vérification serveur. Le nouveau contrat : `NEW.numero` est **inconditionnellement** remplacé par `next_document_number(...)`, qu'il soit vide, rempli, valide, falsifié ou déjà utilisé — élimine cette confiance par construction, sans dépendre uniquement de la contrainte `UNIQUE` (qui reste un second filet, voir §8) ni d'une convention frontend (qui existait déjà mais n'était pas une garantie serveur).

**Import historique** : aucun bypass public n'a été créé. Un futur import avec conservation de numéros historiques devra passer par une procédure d'administration séparée (`service_role`, hors trigger normal, hors accès `authenticated`), non traitée dans cette correction.

## 8. Contraintes composites

```sql
ALTER TABLE public.devis         ADD CONSTRAINT devis_organisation_numero_unique         UNIQUE (organisation_id, numero);
ALTER TABLE public.factures      ADD CONSTRAINT factures_organisation_numero_unique      UNIQUE (organisation_id, numero);
ALTER TABLE public.interventions ADD CONSTRAINT interventions_organisation_numero_unique UNIQUE (organisation_id, numero);
```

## 9. Précontrôles de doublons

Bloc `DO` exécuté **avant** toute création de table, recherchant les doublons `(organisation_id, numero)` existants sur les trois tables ; `RAISE EXCEPTION` explicite et arrêt complet de la migration (aucune donnée touchée) si le moindre doublon est détecté — jamais de correction automatique.

## 10. Contrôle des éventuels index/contraintes globaux hors dépôt

Bloc `DO` exécuté en tout premier, recherchant dans `pg_constraint`/`pg_index` toute contrainte ou index `UNIQUE` portant sur `numero` **seul** (donc global) sur les trois tables — recherche exhaustive dans ce dépôt confirmant qu'aucun n'existe aujourd'hui dans les migrations versionnées, mais un tel objet aurait pu être créé hors dépôt (même dérive que RLS-02/policies Storage orphelines, phase 3). Si détecté : la migration s'arrête avec un message explicite, **sans jamais tenter de le supprimer en devinant son nom** — un audit manuel est requis avant tout déploiement réel.

## 11. Initialisation des compteurs

Agrégation en lecture seule par organisation et année, suffixe numérique extrait sans limite de longueur (`\d+`, pas `\d{3}` — un suffixe `1500` est correctement capturé, `LPAD` ne fixant qu'une largeur minimale) :
```sql
INSERT INTO public.document_counters (...)
SELECT organisation_id, 'devis', substring(numero from 'DEV-(\d{4})-'), MAX(substring(numero from '(\d+)$')::bigint)
FROM public.devis WHERE numero ~ '^DEV-\d{4}-\d+$'
GROUP BY organisation_id, substring(numero from 'DEV-(\d{4})-')
ON CONFLICT (...) DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value), updated_at = now();
```
(Idem pour `factures`/`FAC-` et `interventions`/`INT-`.) **Aucune ligne** de `devis`/`factures`/`interventions` n'est modifiée — uniquement une lecture agrégée.

**Garde-fou supplémentaire ajouté** (au-delà de la demande initiale de l'analyse) : pour une organisation sans aucun numéro conforme pour un type donné (qui démarrerait donc à `001` pour l'année en cours), un bloc dédié vérifie explicitement qu'aucune ligne existante de cette organisation ne porte déjà exactement ce numéro cible (`PREFIX-<année de la migration>-001`) — si c'est le cas, la migration s'arrête avant toute création, plutôt que de laisser la future contrainte `UNIQUE` le découvrir seulement au moment d'une vraie insertion en production. **Portée assumée de cette vérification** : elle ne couvre que l'année en cours au moment de l'application de la migration (seule cible concrètement connaissable à cet instant) — la contrainte `UNIQUE(organisation_id, numero)` reste le filet de sécurité ultime pour tout autre cas résiduel non anticipable.

## 12. Formats historiques non conformes

Les numéros ne respectant pas `^PREFIX-\d{4}-\d+$` (ère `nextval()` historique mentionnée dans `20260610000024`) sont **exclus** du calcul d'agrégation par la clause `WHERE` — ni erreur, ni tentative d'extraction hasardeuse, ni modification. **Résultat attendu, mesuré sur le jeu de fixtures de test local** (Partie B du fichier de tests, non exécuté faute d'environnement — voir §13) : sur 4 lignes de test injectées (`DEV-2025-001`, `DEV-2025-1500`, `DEV-2024-007`, `DEVIS-FORMAT-INCONNU-42`), **3 conformes** (correctement agrégées : max 2025 = 1500, max 2024 = 7) et **1 non conforme** (exclue silencieusement, sans erreur). Stratégie en présence de formats non conformes : l'organisation concernée démarre simplement à `001` pour la période où seul un format non conforme existe — sûr par construction, le format cible étant structurellement différent de tout format non conforme historique (aucune collision possible).

## 13. Fuseau `Europe/Paris`

`to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY')` utilisé identiquement pour la clé de période (`period_key`) et pour le préfixe visible du numéro — élimine le cas où un serveur en UTC assignerait encore l'année précédente à un document créé entre minuit et 1h du matin heure française (hiver, UTC+1). Test dédié écrit (non exécuté) : `23h30 UTC le 31/12` (= `00h30 le 01/01` à Paris) doit donner `2026`, `22h00 UTC le 31/12` (encore `23h00` le `31/12` à Paris) doit donner `2025` — vérifie l'expression de conversion directement, sans dépendre de l'horloge réelle de la session.

## 14. Tests écrits

`audit-kaytek-inter/corrections/tests/correction-04-numbering-tests.sql` (`BEGIN...ROLLBACK`), en 2 parties :
- **Partie A** (comportement post-migration réel) : premier/deuxième devis org A, premier devis org B (même numéro autorisé), compteurs devis/factures/interventions indépendants, doublon intra-organisation refusé par la contrainte `UNIQUE` (trigger temporairement désactivé pour forcer le cas), numéro falsifié dans le payload ignoré et remplacé, organisation falsifiée refusée **et** aucun incrément résiduel dans `document_counters`, appel direct de `next_document_number()` par `authenticated` refusé, accès direct à `document_counters` par `authenticated` refusé, utilisateur anonyme refusé, profil désactivé refusé (non-régression RLS existante), suppression d'un document puis nouvelle création (numéro jamais réutilisé, compteur cohérent).
- **Partie B** (ré-validation de la logique d'initialisation) : l'initialisation réelle ne s'exécute qu'une fois, au moment de la migration — ce bloc réinjecte des données historiques fictives (trigger temporairement désactivé, pattern déjà utilisé dans `20260714000012`) et reproduit exactement la requête d'agrégation de la migration pour en vérifier le résultat (suffixe > 999, plusieurs années, exclusion des formats non conformes).
- **Fuseau horaire** : test direct de l'expression de conversion (§13).
- **Concurrence** : instructions documentées pour un test multi-connexions réel (`pgbench`/sessions `psql` parallèles), non simulable dans une seule transaction SQL.

## 15. Tests exécutés

**Aucun test SQL n'a pu être exécuté** — Docker indisponible dans cet environnement (`docker ps` échoue), pas de base Supabase locale démarrable, aucune tentative contre la production.

Réellement exécutés dans cette session :
- `npm run typecheck` → une seule erreur, identique et pré-existante (`DevisFormPage.tsx:191`) — aucune nouvelle erreur (cohérent : aucun fichier frontend n'a été modifié par cette correction, confirmée non nécessaire par le donneur d'ordre).
- `npm run build` → succès (`✓ built in 10.61s`), precache PWA 3690.71 KiB, strictement identique à l'état de fin de Correction 3 bis.
- `npx vitest run` → 42/42 tests toujours passants, suite non affectée.

## 16. Limites

Validation purement statique et par relecture (assertions de migration, relecture ligne à ligne du fichier de tests). Le comportement empirique réel — en particulier l'ordre trigger/RLS documenté en §6, le calcul d'initialisation sur de vraies données historiques, et le comportement sous concurrence réelle — n'a pas pu être vérifié dynamiquement dans cet environnement. Les schémas exacts de `devis`/`factures`/`interventions` utilisés pour construire les fixtures de test proviennent de la lecture du schéma de référence (`backup/backup-2026-06-10/database-schema.sql`) et des migrations ultérieures ; un léger écart de colonnes NOT NULL non documenté dans ce dépôt pourrait nécessiter un ajustement mineur du fichier de tests au moment de son exécution réelle.

## 17. DB-07 — anomalie distincte, non corrigée

**Numéro de document modifiable après création** : la contrainte `UNIQUE(organisation_id, numero)` empêche un doublon mais n'empêche pas un admin de modifier `numero` vers une autre valeur libre via un `UPDATE` direct (les policies `devis_update`/`factures_update`/`interventions_update`, inchangées par cette correction, autorisent déjà la modification d'un document existant par un admin, sans distinction de colonne). Gravité par type :
- **Facture** : gravité **élevée** — la numérotation des factures doit rester chronologique et non modifiable après émission pour des raisons comptables ; c'est le cas le plus sensible.
- **Devis** : gravité **faible à moyenne** — un devis n'a pas la même contrainte légale de numérotation continue.
- **Intervention** : gravité **faible** — identifiant principalement opérationnel.

**Non traité dans cette correction** (nécessiterait un nouveau trigger d'immutabilité, hors périmètre de DB-02 tel qu'autorisé). Une future correction devra probablement, au minimum, interdire le changement de `numero` sur une facture après insertion.

## 18. Objet potentiel `devis_numero_seq` — non supprimé

Une ancienne version de `generate_devis_numero()` utilisait `nextval('devis_numero_seq')` (mentionné uniquement en commentaire dans `20260610000024`, jamais créée ni supprimée dans une migration versionnée) — possible dérive de configuration hors dépôt (même schéma que RLS-02). **Aucun `DROP SEQUENCE` n'a été inclus dans cette migration**, conformément à l'instruction explicite : son état réel et ses dépendances en production ne sont pas vérifiables depuis ce dépôt, et sa suppression apporterait peu de valeur face au risque de casser un objet créé hors dépôt. À auditer séparément (`SELECT * FROM pg_sequences WHERE sequencename = 'devis_numero_seq'` sur la base réelle) avant toute décision.

## 19. Rollback SQL exact

```sql
-- 1. Retirer les contraintes composites
ALTER TABLE public.devis         DROP CONSTRAINT IF EXISTS devis_organisation_numero_unique;
ALTER TABLE public.factures      DROP CONSTRAINT IF EXISTS factures_organisation_numero_unique;
ALTER TABLE public.interventions DROP CONSTRAINT IF EXISTS interventions_organisation_numero_unique;

-- 2. Restaurer le corps précédent des 3 fonctions trigger (texte exact
--    de 20260610000023/20260610000024, jamais modifié depuis)
CREATE OR REPLACE FUNCTION public.generate_devis_numero()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func_dev$
DECLARE
  yr TEXT := EXTRACT(YEAR FROM NOW())::TEXT;
  prefix TEXT := 'DEV-' || yr || '-';
  maxn INTEGER := 0;
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('dev_numero_lock'));
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0)
      INTO maxn FROM public.devis WHERE numero ~ ('^' || prefix || '[0-9]+$');
    NEW.numero := prefix || LPAD((maxn + 1)::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$func_dev$;
-- (même schéma pour gen_numero_facture() → 'FAC-'/factures et
-- gen_numero_intervention() → 'INT-'/interventions, textes exacts
-- disponibles dans 20260610000023.sql et 20260610000024.sql)

-- 3. Supprimer la fonction centrale et la table de compteurs
DROP FUNCTION IF EXISTS public.next_document_number(uuid, text);
DROP TABLE IF EXISTS public.document_counters;
```
Purement additif/réversible — aucune donnée de `devis`/`factures`/`interventions` n'est jamais touchée dans un sens comme dans l'autre.

## 20. Commandes de déploiement futures (documentées, non exécutées)

```
supabase db push     # applique la migration — uniquement après exécution réussie des tests locaux (§14/§15) et audit manuel §10 sur la base réelle
```
Aucune commande Supabase distante n'a été exécutée dans cette session.

---

**Correction 4 terminée. Je n'ai commencé aucune autre correction. J'attends votre autorisation.**
