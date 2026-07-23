# Analyse SEC2-02 — Droit EXECUTE inattendu du rôle `anon`

Document d'**analyse uniquement**. Aucun fichier n'a été modifié. Aucune commande distante exécutée.
Toutes les vérifications ont été menées **localement**, y compris via un conteneur Postgres
**jetable et isolé** (image Supabase exacte, sans lien avec le projet ni ses données), détruit à la
fin de chaque test.

## 1. Erreur exacte reproduite

```bash
$ docker ps                     # exit 0
$ supabase stop --no-backup     # exit 0
$ supabase start
...
Applying migration 20260722000001_subscription_access_enforcement.sql...
Stopping containers...
ERROR: Assertion échouée : anon a EXECUTE sur current_organisation_has_app_access() (SQLSTATE P0001)
At statement: 48
(exit 1)
```

Reproduit deux fois, résultat strictement identique. Conteneurs arrêtés automatiquement par le CLI
(confirmé : `docker ps -a` vide, `supabase status` répond `No such container` après coup) — aucun
nettoyage manuel nécessaire.

- **Migration** : `20260722000001_subscription_access_enforcement.sql`, statement n°48.
- **Assertion exacte** (lignes 584-585 du fichier) :
  ```sql
  IF has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : anon a EXECUTE sur current_organisation_has_app_access()';
  END IF;
  ```
- **Fonction et signature exactes** : `public.current_organisation_has_app_access()` — 0 argument,
  `RETURNS boolean`.
- **Rôle testé** : `anon`.
- **Résultat attendu par l'assertion** : `false` (pas de droit EXECUTE).
- **Résultat obtenu réellement** : `true` — l'assertion échoue précisément parce qu'elle est
  **correcte** et détecte un vrai droit effectif (voir section 8).

## 2. ACL brute et privilèges effectifs

Impossible d'inspecter l'état exact "juste avant l'assertion" dans le projet lui-même : chaque
migration s'exécute dans sa propre transaction et le CLI détruit la stack entière dès la première
erreur (aucun état intermédiaire persistant n'est accessible). Conformément à la suggestion de
l'énoncé (section 7 : *« reproduis localement avec une fonction temporaire dans une transaction si
nécessaire »*), la reproduction a été faite dans un **conteneur Postgres jetable isolé**, utilisant
l'image exacte du projet (`public.ecr.aws/supabase/postgres:17.6.1.121`, confirmée via
`docker images`), sans aucune migration du projet — uniquement pour isoler le comportement des
privilèges par défaut de la plateforme elle-même.

Séquence reproduite à l'identique de `20260722000001` (CREATE, ALTER OWNER, REVOKE ALL FROM PUBLIC,
GRANT à `authenticated`/`service_role`) :

```sql
CREATE OR REPLACE FUNCTION public.sec202_acl_demo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true; $$;
ALTER FUNCTION public.sec202_acl_demo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sec202_acl_demo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sec202_acl_demo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sec202_acl_demo() TO service_role;
```

Résultat (`aclexplode`, grantee traduit) :

| oid | grantee | grantor | privilege_type | is_grantable |
|---|---|---|---|---:|
| `sec202_acl_demo()` | `postgres` | `postgres` | EXECUTE | false |
| **`sec202_acl_demo()`** | **`anon`** | **`postgres`** | **EXECUTE** | false |
| `sec202_acl_demo()` | `authenticated` | `postgres` | EXECUTE | false |
| `sec202_acl_demo()` | `service_role` | `postgres` | EXECUTE | false |

`anon` détient un privilège **EXECUTE direct**, accordé par `postgres`, **exactement comme
`authenticated`/`service_role`** — la seule différence est que `authenticated`/`service_role` ont
*aussi* reçu un `GRANT` explicite (redondant), tandis qu'`anon` n'a **jamais** reçu de `GRANT`
explicite ni de `REVOKE` explicite : son droit vient d'ailleurs (section 5).

`has_function_privilege` (reproduit sur `current_organisation_has_app_access()` réel, motif
identique) :

| Rôle | EXECUTE |
|---|---:|
| `anon` | **true** |
| `authenticated` | true (attendu) |
| `service_role` | true (attendu) |
| `public` (pseudo-rôle) | valide dans `has_function_privilege` — a retourné `true`/`false` selon l'état testé ; **contrairement à l'avertissement de l'énoncé, cette forme fonctionne normalement** (pas besoin de repli sur les catalogues bruts) |

## 3. Rôle ou mécanisme source — trouvé et confirmé empiriquement

Sur une instance du **même conteneur Postgres de base, sans aucune migration appliquée** :

```sql
SELECT defaclrole::regrole AS role, defaclnamespace::regnamespace AS schema, defaclobjtype, defaclacl
FROM pg_default_acl ORDER BY role, schema;
```

révèle, parmi 24 lignes, celle-ci :

```
role     | schema | defaclobjtype | defaclacl
postgres | public | f             | {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

**C'est la source exacte.** L'image Postgres locale fournie par la Supabase CLI définit, dès son
initialisation, un privilège par défaut équivalent à :

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

Conséquence directe : **toute nouvelle fonction créée par le rôle `postgres`** (celui qui exécute
toutes les migrations) **dans le schéma `public` reçoit automatiquement, au moment même de sa
création, un GRANT EXECUTE direct à `anon`, `authenticated` et `service_role`** — en plus du GRANT
implicite standard à `PUBLIC` que tout Postgres accorde par défaut à toute nouvelle fonction.

Test isolé, confirmé par étapes successives sur la même fonction :

| Étape | `anon` EXECUTE |
|---|---:|
| Juste après `CREATE FUNCTION` (aucun REVOKE/GRANT) | **true** |
| Après `REVOKE ALL ... FROM PUBLIC` | **true (inchangé)** |
| Après `REVOKE EXECUTE ... FROM anon` explicite | **false** |
| Après un `CREATE OR REPLACE FUNCTION` sur la fonction **déjà existante** (sans `DROP` préalable) | **false (préservé — CREATE OR REPLACE ne réapplique pas les privilèges par défaut sur un objet déjà existant)** |
| Après un `DROP FUNCTION` puis un nouveau `CREATE OR REPLACE FUNCTION` (recréation véritable) | **true (redevient vrai — le privilège par défaut se réapplique à chaque création réelle, pas à un simple remplacement)** |

**Conclusion mécanique précise** : `REVOKE ALL ... FROM PUBLIC` ne retire que l'entrée `PUBLIC`
(grantee `0`, notée `=X/...` dans l'ACL) — il ne retire **jamais** un privilège accordé
**directement** à un rôle nommé (`anon`, `authenticated`, `service_role`) par le mécanisme des
privilèges par défaut. Ce sont deux entrées ACL distinctes et indépendantes ; révoquer l'une ne
révoque pas l'autre.

## 4. Memberships de rôles (rule 13 — vérifié, pas supposé)

```sql
SELECT member.rolname, parent.rolname, m.admin_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE member.rolname IN ('anon','authenticated','service_role')
   OR parent.rolname IN ('anon','authenticated','service_role');
```

Résultat (sur l'image de base, avant toute migration) :

| member_role | inherited_role |
|---|---|
| `authenticator` | `authenticated` |
| `authenticator` | `anon` |
| `authenticator` | `service_role` |
| `postgres` | `authenticated` |
| `postgres` | `anon` |
| `postgres` | `service_role` |

**`anon` n'hérite d'aucun rôle, et aucun rôle n'hérite d'`anon`** (aucune ligne où `anon` est `member`
d'un autre rôle que lui-même, ni où un autre rôle hérite d'`anon`). Seuls `authenticator` (le rôle de
connexion PostgREST, qui bascule via `SET ROLE` selon le JWT) et `postgres` sont membres des trois
rôles applicatifs. **`anon` et `authenticated` sont bien indépendants l'un de l'autre** — leur
`rolinherit=true` respectif ne change rien ici puisqu'aucun lien de membership direct n'existe entre
eux. Le droit `EXECUTE` d'`anon` n'est donc **pas** un effet d'héritage de rôle : c'est un privilège
direct (section 3).

## 5. Ordre exact des instructions dans `20260722000001` (fonction concernée)

| # | Ligne | Instruction |
|---|---|---|
| 1 | 81 | `CREATE OR REPLACE FUNCTION public.current_organisation_has_app_access()` — **création réelle** (fonction inexistante avant ce fichier, confirmé par recherche exhaustive lors de MIG-01) → déclenche le privilège par défaut |
| 2 | 115 | `ALTER FUNCTION ... OWNER TO postgres` — aucun effet ACL |
| 3 | 121 | `REVOKE ALL ON FUNCTION ... FROM PUBLIC` — retire uniquement l'entrée `PUBLIC` |
| 4 | 122 | `GRANT EXECUTE ... TO authenticated` — redondant (déjà accordé par défaut) |
| 5 | 123 | `GRANT EXECUTE ... TO service_role` — redondant (déjà accordé par défaut) |
| 6 | 124 | Commentaire : *« Aucun GRANT à anon »* — vrai littéralement (aucune ligne `GRANT ... TO anon` n'existe), mais **le privilège existe déjà sans avoir besoin d'un GRANT explicite** |
| — | 584 | Assertion — échoue |

Vérifications demandées :
- **Fonction créée plusieurs fois ?** Non — une seule occurrence de `CREATE OR REPLACE FUNCTION
  public.current_organisation_has_app_access` dans tout le dépôt (confirmé par grep exhaustif lors
  de MIG-01).
- **`CREATE OR REPLACE FUNCTION` après le `REVOKE` ?** Non, dans ce fichier précis.
- **Second `GRANT` plus tard ?** Non — aucune autre ligne du dépôt ne touche cette fonction après ce
  fichier (confirmé par grep).
- **Signature exacte dans le `REVOKE`/l'assertion ?** Oui, `current_organisation_has_app_access()`
  (0 argument) correspond exactement à la seule signature existante.
- **Surcharge de même nom ?** Aucune — une seule fonction de ce nom dans tout le schéma `public`.
- **La bonne surcharge est-elle visée par l'assertion ?** Oui, sans ambiguïté.

## 6. Recherche exhaustive dans tout l'historique

| Recherche | Résultat |
|---|---|
| `ALTER DEFAULT PRIVILEGES` dans `supabase/migrations/*.sql` | **Aucune occurrence** — confirme que ce n'est **pas** une migration du dépôt qui a introduit ce défaut |
| `GRANT ... ON ALL FUNCTIONS` / `GRANT ALL FUNCTIONS` | **Aucune occurrence** |
| `GRANT ... TO anon` (explicite) | **Aucune occurrence dans tout le dépôt** |
| Fonctions créées par MIG-01 (bootstrap) | Vérifiées séparément (non concernées par SEC2-02, mais par prudence) : `handle_new_user()`, `set_updated_at()`, `claim_founder_seat()`, `get_push_endpoint_url()`, `get_push_anon_key()` — ces deux dernières (MIG-01B) **révoquent déjà explicitement `anon` ET `authenticated`** (`REVOKE ALL ... FROM anon, authenticated`), donc **non affectées** par ce gap malgré le même mécanisme sous-jacent |

**Conclusion** : le mécanisme responsable n'est **inscrit dans aucun fichier de ce dépôt** — c'est
une propriété de la **plateforme Supabase locale elle-même** (l'image `supabase/postgres`), présente
dès l'initialisation du conteneur, avant même la première migration. Toute fonction créée par
`postgres` dans `public` en hérite automatiquement, quel que soit le fichier de migration qui la
crée.

## 7. Effet de `CREATE OR REPLACE FUNCTION` — comportement réel vérifié

- Une **nouvelle** fonction reçoit `EXECUTE` pour `PUBLIC` par défaut (comportement Postgres
  standard, documenté) **et**, sur cette plateforme spécifiquement, un `EXECUTE` direct
  supplémentaire pour `anon`/`authenticated`/`service_role` (privilège par défaut Supabase, section 3).
- `CREATE OR REPLACE FUNCTION` sur une fonction **déjà existante** **conserve** son ACL actuelle —
  vérifié empiriquement (une fonction dont l'accès `anon` avait été explicitement révoqué reste
  révoquée après un `CREATE OR REPLACE` ultérieur).
- Un `REVOKE` placé avant un `CREATE OR REPLACE` **peut être annulé**, mais **uniquement** si ce
  `CREATE OR REPLACE` correspond en réalité à une **recréation complète** (précédée d'un `DROP
  FUNCTION` explicite, ou s'il s'agit de la toute première création de cette fonction/signature) —
  jamais par un simple remplacement de corps sur un objet qui persiste.
- La fonction `current_organisation_has_app_access()` **n'existait pas avant**
  `20260722000001` (confirmé exhaustivement) : sa création dans ce fichier est donc une création
  **réelle**, pas un remplacement — elle a bien reçu le privilège par défaut à cet instant précis.

## 8. Validité de l'assertion

`has_function_privilege('anon', 'public.current_organisation_has_app_access()', 'EXECUTE')` est la
fonction Postgres canonique pour tester un **droit effectif** — elle prend en compte les droits
directs, `PUBLIC`, et l'héritage de rôle combinés (ce n'est pas une simple lecture de l'ACL brute).
Sur ce cas précis : droit direct confirmé (section 3), aucun héritage impliqué (section 4, `anon`
indépendant), objet et signature sans ambiguïté (section 5).

**L'assertion est exacte et révèle un vrai droit effectif** — ce n'est ni une erreur de signature, ni
un mauvais objet, ni un faux positif d'interprétation. Conformément à la règle 8 de l'énoncé : *« si
l'assertion est correcte et révèle un vrai droit effectif, la correction doit supprimer ce droit »*.
**L'assertion ne doit pas être supprimée ni affaiblie.**

### Sévérité pratique (nuance importante)

`current_organisation_has_app_access()` et `get_my_app_access_status()` dérivent **toutes deux**
l'organisation exclusivement via `auth.uid()`. Pour un appelant `anon` (non authentifié), `auth.uid()`
vaut `NULL` : la clause `WHERE p.id = auth.uid()` ne retrouve aucun profil, et
`COALESCE(..., false)` renvoie `false` — l'exploitation directe de ce droit `EXECUTE` par un
véritable client anonyme **ne renverrait qu'un résultat négatif sans valeur informative**. Le risque
ici relève donc du **principe de moindre privilège / défense en profondeur** (l'intention documentée
— *« Aucun GRANT à anon »* — n'est pas respectée dans les faits) plutôt que d'une fuite de données ou
d'un contournement immédiatement exploitable *pour ces deux fonctions précises*. **Ce constat ne
s'étend pas** aux deux autres fonctions identifiées en section 11, nettement plus sensibles.

## 9. Comparaison des options

### Option A — `REVOKE EXECUTE ... FROM anon`

```sql
REVOKE EXECUTE ON FUNCTION public.current_organisation_has_app_access() FROM anon;
```

Vérifié empiriquement (section 3) : **suffit à elle seule**, que `PUBLIC` ait ou non déjà été
révoqué au préalable — les deux révocations sont indépendantes et n'interfèrent pas.

### Option B — Double révocation (`PUBLIC` puis `anon`)

```sql
REVOKE ALL ON FUNCTION ... FROM PUBLIC;
REVOKE ALL ON FUNCTION ... FROM anon;
```

Redondante avec le `REVOKE ALL FROM PUBLIC` déjà présent dans `20260722000001`, mais
**parfaitement idempotente** : `REVOKE` sur un privilège déjà absent ne produit ni erreur ni effet de
bord (contrairement à `GRANT` sur un rôle inexistant, qui échouerait). Sûre à rejouer indéfiniment.

### Option C — Corriger les privilèges par défaut globalement

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

- **Ne corrige rien rétroactivement** : les privilèges par défaut ne s'appliquent qu'aux objets créés
  **après** l'exécution de cet `ALTER` — toutes les fonctions déjà créées (dont
  `current_organisation_has_app_access()` elle-même) resteraient affectées sans un `REVOKE` explicite
  en plus.
- **Périmètre trop large** : s'appliquerait à *toute* future fonction du schéma `public`, y compris
  celles qui *souhaitent* réellement être appelables par `anon` (aucune identifiée aujourd'hui, mais
  non vérifié exhaustivement — risque non nul).
- **Risque non négligeable** : modifier un comportement de plateforme (pas un objet applicatif) sans
  preuve qu'aucune fonction future n'en dépendrait légitimement. Rejetée comme solution **immédiate**
  et **suffisante** à elle seule — pourrait éventuellement compléter une correction plus large
  (préventif pour l'avenir), mais jamais en remplacement des `REVOKE` explicites déjà nécessaires
  pour les fonctions existantes.

### Option D — Repositionner les `REVOKE` après le dernier `CREATE OR REPLACE`

Non pertinent pour `current_organisation_has_app_access()`/`get_my_app_access_status()` : une seule
définition existe, dans un seul fichier, sans recréation ultérieure. **Pertinent en revanche pour
`get_partner_requests_preview()`** (section 11) qui a été recréée (`DROP` + `CREATE`) après sa
définition initiale — mais vérifié (section 7) que `CREATE OR REPLACE` seul (sans `DROP` préalable,
cas de Correction 3 bis) préserve l'ACL existante : repositionner ne changerait rien à ce cas précis,
un `REVOKE` explicite reste nécessaire quel que soit l'endroit où on le place dans la chaîne.

### Option E — Assertion plus précise

Non applicable : l'assertion actuelle est déjà précise, sans ambiguïté de signature ni d'objet
(section 5, section 8). Aucune modification de l'assertion n'est justifiée.

## 10. Helper et RPC — `get_my_app_access_status()`

Même inspection appliquée à `public.get_my_app_access_status()` (lignes 139-160 du même fichier) :

- **Création** : ligne 139, `CREATE OR REPLACE FUNCTION` — également une création réelle (confirmé :
  fonction inexistante avant ce fichier).
- **REVOKE/GRANT** : lignes 158-160 — `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO
  authenticated`, `GRANT EXECUTE ... TO service_role` — **exactement le même motif**, aucun `REVOKE
  ... FROM anon` explicite.
- **Conclusion** : par le même mécanisme (section 3), `get_my_app_access_status()` a
  **très probablement** (mécanisme déterministe et identique, haute confiance) le même droit `anon`
  EXECUTE effectif que `current_organisation_has_app_access()` — non vérifié directement contre le
  projet réel (le bootstrap n'atteint jamais ce point, l'assertion sur la première fonction bloque
  avant), mais reproduit et confirmé par le test isolé de la section 2/3 utilisant la séquence
  identique. **Ne pas corriger uniquement le helper sans la RPC** : les deux partagent le même défaut,
  pour la même raison exacte.

## 11. Autres fonctions sensibles (inspection statique uniquement, aucune correction)

| Fonction | Correction | Intention documentée | REVOKE présent | GRANT explicite | Anon EXECUTE effectif (déduit du mécanisme confirmé) | Sévérité si confirmé |
|---|---|---|---|---|---|---|
| `get_partner_requests_preview(text)` | 3 bis | *« Aucun GRANT à anon »* | `REVOKE ALL FROM PUBLIC` | `authenticated`, `service_role` | **Très probable** (recréée par `DROP`+`CREATE` en `20260715000011`, jamais de `REVOKE ... FROM anon` explicite à aucun stade ; `CREATE OR REPLACE` ultérieur de Correction 3 bis préserve cet état) | Modérée — dérive `current_org_id()` via `auth.uid()`, probablement NULL-safe comme les deux fonctions ci-dessus (non vérifié en détail, hors périmètre de cette analyse) |
| `next_document_number(uuid, text)` | 4 | *« Explicitement aucun GRANT à anon ni authenticated »* | `REVOKE ALL FROM PUBLIC` uniquement | **Aucun** (intentionnel) | **Très probable** — création réelle, seule révocation présente porte sur `PUBLIC` | **Élevée** — la fonction ne dérive **aucune identité appelante** (ni `auth.uid()`, ni vérification de rôle) : elle fait confiance à un appel interne exclusivement via triggers. Si `anon` peut réellement l'appeler (via PostgREST `/rpc/next_document_number`, exposé par défaut à tout rôle disposant d'EXECUTE), **un appelant non authentifié pourrait réserver/incrémenter un numéro de document pour n'importe quelle organisation**, sans aucune vérification |
| `calculate_commission_for_facture(uuid)` | 5 | *« Aucun GRANT à anon ni authenticated : appelée uniquement par les triggers »* | `REVOKE ALL FROM PUBLIC` uniquement | **Aucun** (intentionnel) | **Très probable** — même motif exact | **Élevée** — aucune dérivation d'identité appelante ; si exposée à `anon` via RPC, un appelant non authentifié pourrait déclencher un recalcul de commission pour n'importe quelle facture de n'importe quelle organisation |

**Point additionnel majeur** : les trois migrations concernées (`20260724000001`, `20260725000001`,
`20260726000001`) contiennent **chacune leur propre assertion** `has_function_privilege('anon', ...,
'EXECUTE')`, identique en esprit à celle de Correction 2 (confirmé par recherche exhaustive : les
trois fichiers contiennent bien cette vérification). **Si SEC2-02 n'était corrigée que pour
`current_organisation_has_app_access()`/`get_my_app_access_status()`, le bootstrap échouerait très
probablement de nouveau, de façon quasi certaine, sur l'une de ces trois assertions dès que le
bootstrap les atteindrait** — un schéma « une correction, un blocage suivant » déjà rencontré
plusieurs fois dans cette série d'analyses (MIG-01, MIG-02). **Ceci n'est pas vérifié empiriquement
contre le projet réel** (le bootstrap ne les atteint jamais tant que Correction 2 bloque en premier)
mais déduit avec une confiance élevée du mécanisme root-caused et confirmé en section 3.

**Recommandation de vigilance (aucune action) :** compte tenu de la sévérité potentiellement élevée
pour `next_document_number()`/`calculate_commission_for_facture()` (fonctions sans dérivation
d'identité, contrairement aux deux fonctions du périmètre SEC2-02), il serait justifié qu'une future
correction traite ces deux fonctions en priorité, indépendamment de l'ordre de découverte par le
bootstrap — **mais aucune action n'est prise ici**, conformément au périmètre strict de cette
analyse.

## 12. Comparaison des options — synthèse et stratégie recommandée

Cohérent avec le précédent établi par MIG-01/MIG-02 : **modifier directement une migration déjà
probablement appliquée en production** (`20260722000001`, et de même pour `20260724000001`/
`20260725000001`/`20260726000001` si une correction élargie était autorisée un jour) porterait le
même risque de divergence de checksum déjà documenté — à éviter par principe.

**Stratégie recommandée (analyse — aucune action à ce stade)** : une **nouvelle migration
corrective, postérieure à toutes les migrations existantes** (à l'image de MIG-01B), contenant
uniquement des `REVOKE EXECUTE ... FROM anon` explicites (Option A) pour
`current_organisation_has_app_access()` et `get_my_app_access_status()` — strictement dans le
périmètre nommé de SEC2-02 — accompagnée d'assertions de vérification. Aucune migration existante ne
serait modifiée ; aucune donnée métier touchée ; effet immédiat et sans ambiguïté (confirmé
empiriquement suffisant, section 3).

Une correction séparée et explicitement autorisée devra être envisagée pour les trois fonctions de la
section 11, dont deux (`next_document_number`, `calculate_commission_for_facture`) présentent un
risque plus élevé.

## 13. Fichiers qui seraient modifiés (si autorisé plus tard)

- Une **nouvelle** migration (ex. `20260728000001_revoke_anon_execute_helper_functions.sql`),
  contenant les `REVOKE EXECUTE ... FROM anon` pour les deux fonctions de Correction 2 uniquement.
- **Aucune migration existante ne serait modifiée** (ni `20260722000001`, ni MIG-01, ni MIG-02).
- `audit-kaytek-inter/corrections/correction-sec2-02-function-privileges.md` (futur rapport de
  correction, pas créé dans cette phase).

## 14. Tests nécessaires après autorisation

```bash
supabase stop --no-backup
supabase start
supabase db reset   # répétabilité
```

Puis vérifier `has_function_privilege('anon', ..., 'EXECUTE') = false` pour les deux fonctions, que
l'assertion de `20260722000001` passe, et que le bootstrap progresse au-delà — en s'attendant
probablement à rencontrer ensuite l'une des 3 assertions de la section 11 (à traiter séparément, sous
nouvelle autorisation, sans surprise si cela se produit).

## 15. Impact production

- `current_organisation_has_app_access()`/`get_my_app_access_status()` sont très probablement déjà
  créées en production avec ce même droit `anon` EXECUTE effectif (le mécanisme est une propriété de
  plateforme, pas spécifique à cet environnement local) — **à vérifier en lecture seule séparément**,
  jamais supposé.
- Une nouvelle migration corrective ne serait pas rejouée automatiquement en production (même
  principe que MIG-01/MIG-02) — nécessiterait une réconciliation de ledger distincte, non effectuée
  ici.
- Aucune requête, aucun `migration repair`, aucune modification de configuration distante n'a été
  exécutée par cette analyse.

## 16. Rollback

Analyse uniquement — aucune modification effectuée, donc aucun rollback nécessaire à ce stade.
Les deux conteneurs Postgres jetables utilisés pour les tests isolés ont été détruits
(`docker rm -f`) immédiatement après usage ; confirmé par `docker ps -a` vide.

## 17. Niveau de confiance

| Élément | Confiance |
|---|---:|
| Mécanisme racine (privilège par défaut de la plateforme, `pg_default_acl`) | **Élevée** — confirmé directement par requête sur l'image de base, sans aucune migration du projet |
| `REVOKE ALL FROM PUBLIC` n'affecte pas un GRANT direct par défaut | **Élevée** — confirmé empiriquement par test isolé reproduisant exactement la séquence de la migration réelle |
| `anon`/`authenticated` indépendants (pas d'héritage) | **Élevée** — vérifié par requête sur `pg_auth_members`, pas supposé |
| Validité de l'assertion (vrai positif, pas une erreur de signature) | **Élevée** |
| `get_my_app_access_status()` affectée du même défaut | **Élevée** (mécanisme déterministe identique) mais **non vérifiée directement contre le projet réel** (bootstrap ne l'atteint jamais) |
| `get_partner_requests_preview`/`next_document_number`/`calculate_commission_for_facture` affectées du même défaut | **Élevée** par le même raisonnement, **non vérifiées empiriquement contre le projet réel** |
| Sévérité élevée pour `next_document_number`/`calculate_commission_for_facture` (absence de dérivation d'identité) | **Moyenne-élevée** — lecture directe du code confirme l'absence de vérification d'identité dans le corps de ces fonctions ; l'exploitabilité réelle via PostgREST (exposition RPC effective) n'a pas été testée en conditions réelles (aucun appel RPC n'a été effectué, conformément à l'interdiction de contacter quoi que ce soit au-delà du strict local) |

Analyse SEC2-02 terminée. J'attends votre autorisation avant toute modification des privilèges de fonctions.
