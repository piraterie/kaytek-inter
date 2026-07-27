# Phase 7 — Facturation, abonnements et Stripe

Date de l'analyse : 2026-07-21
Méthode : lecture de code (`src/pages/DevisFormPage.tsx`, `src/pages/DevisApercuPage.tsx`, `src/pages/FacturesPage.tsx`, `src/lib/hooks/index.ts`, `src/lib/subscription.ts`, `src/App.tsx`), des migrations Stripe/abonnement (`20260709000002`, `20260710000001`, `20260711000001`, `20260711000003`, `20260711000004`), et recoupement exhaustif avec les phases 1 à 6 (aucun de ces constats n'est répété en détail, seulement référencé). Recherche complémentaire ciblée dans `.env.*` (noms de variables uniquement) pour confirmer l'absence de toute clé Stripe dans ce dépôt. Aucune modification, aucun appel réel à Stripe ou à une Edge Function.

**Avertissement de périmètre, à lire avant le reste du rapport** : ce dépôt ne contient **aucun code d'intégration Stripe** (pas de SDK `stripe`/`@stripe/*` en dépendance, aucune Edge Function de type webhook/checkout/portail, aucune clé Stripe dans les fichiers d'environnement présents). La création de session Checkout, la gestion du webhook, le portail client, les remboursements et la synchronisation initiale des statuts d'abonnement sont assurés par une **application externe** (kaytekinter.fr, hébergée sur Netlify — confirmé phases 1 et 3), qui écrit ensuite directement dans les tables `subscriptions`/`stripe_webhook_events`/`founder_seats` de cette même base Supabase. La majorité des points demandés dans cette phase (webhook, signature, rejeu, Checkout, portail, remboursement) sont donc **non vérifiables depuis ce dépôt** ; ce rapport documente précisément ce qui est vérifiable côté Kaytek Inter (schéma, RPC, gating applicatif) et liste explicitement ce qui ne l'est pas.

---

## 1. Facturation métier

### Calcul HT / TVA / TTC / remises / arrondis

- Déjà analysé en détail en **phase 6 (FONC-01)** : le calcul applique la remise sur le total TTC puis déduit la TVA par différence (`tva = totalFinal - tot.ht`, `src/pages/DevisFormPage.tsx:122-125`), sans jamais réduire le HT. **Toute remise dépassant ~9 % (TVA 10 %) ou ~17 % (TVA 20 %) produit un montant de TVA négatif**, stocké en base, affiché à l'écran et rendu sur le PDF du devis puis de la facture issue de sa transformation. Repris ici car il s'agit du cœur du sujet "facturation" de cette phase — voir phase 6 pour le détail complet du calcul et le scénario reproductible.
- Arrondis : cohérents à 2 décimales (`Math.round(x*100)/100`) partout où vérifié (lignes de devis, remise, commissions) — pas de problème d'arrondi identifié en dehors du bug de signe ci-dessus.
- Absence de toute contrainte `CHECK` en base garantissant `montant_ht + tva_montant = montant_ttc` (**DB-04**, phase 5) — la seule protection contre un montant incohérent est le calcul JavaScript, entièrement contournable par un appel direct à l'API avec un JWT valide (cf. phase 2/3, scénario "modification d'un montant envoyé au backend").

### Acomptes

- **FACT-01 — Fonctionnalité d'acompte présente en base mais non exploitable depuis l'interface**
  - **Gravité** : Faible
  - **Confiance** : Confirmé
  - **Description** : la colonne `factures.acompte_recu` existe (numeric, défaut 0) et les statuts `'acompte'`/`'partiel'` sont définis dans la contrainte `CHECK` de `statut_paiement`, apparaissent dans les filtres de `FacturesPage.tsx` (`STATUTS`, ligne 25) et sont même rendus sur `PublicDocumentPage.tsx` (badge "Acompte reçu"). **Aucun composant ni gestionnaire d'événement dans `FacturesPage.tsx` ne permet cependant de saisir un montant d'acompte ou de faire transitionner une facture vers `'acompte'`/`'partiel'`** — seule la transition vers `'payee'` (paiement intégral) a été trouvée (`handleMarkPaid`/`handleMarkPaidIntervenant`, lignes 93-101). `acompte_recu` reste donc toujours à sa valeur par défaut (0) en pratique.
  - **Impact** : fonctionnalité de paiement partiel visiblement prévue au niveau du schéma et de l'affichage, mais inutilisable en l'état — pas un risque de sécurité, plutôt une fonctionnalité incomplète ou un reliquat d'une version antérieure du produit.
  - **Recommandation** : soit compléter l'UI (champ de saisie du montant d'acompte + action dédiée), soit retirer les statuts non atteignables pour éviter la confusion.
  - **Statut** : Vérifié par recherche exhaustive de `acompte_recu`/`mode_paiement` dans `FacturesPage.tsx`.

### Transformation devis → facture

- Couvert phase 6 : vérification qu'une facture n'existe pas déjà pour le devis (`useDevisToFacture`, `src/lib/hooks/index.ts:726-774`), retry automatique sur conflit de numéro. Repris ici sous l'angle "création simultanée" demandé par cette phase :

- **FACT-02 — Condition de course (TOCTOU) permettant la création de deux factures pour le même devis**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé
  - **Fichier** : `src/lib/hooks/index.ts:734-741` (`useDevisToFacture`)
  - **Description** : la vérification "une facture existe-t-elle déjà pour ce devis ?" (`SELECT count(*) FROM factures WHERE devis_id = ...`) et l'`INSERT` de la nouvelle facture sont **deux opérations séparées, non transactionnelles côté client**, et **aucune contrainte `UNIQUE` n'existe sur `factures.devis_id`** en base (vérifié : absente du schéma de référence et de toutes les migrations). Le bouton "Transformer en facture" est bien désactivé pendant l'exécution de la mutation (`disabled={toFacture.isPending}`, `DevisApercuPage.tsx:250` et suivants) — ce qui protège contre un double-clic sur le **même** onglet — mais ne protège pas contre deux requêtes réellement concurrentes (deux onglets ouverts sur le même devis, deux admins agissant simultanément, ou un retry réseau).
  - **Scénario** : deux requêtes quasi simultanées passent toutes les deux le `SELECT count` (qui renvoie 0 pour les deux) avant que l'une ou l'autre n'ait inséré sa ligne — résultat : deux factures distinctes pour le même devis, chacune avec son propre numéro (la protection anti-doublon de numérotation, **DB-02** phase 5, empêche seulement que les deux factures aient le *même* numéro, pas qu'il y en ait deux).
  - **Impact** : double facturation potentielle d'un même devis — impact client/comptable réel si cela se produit, même si la fenêtre de course est étroite en usage normal.
  - **Recommandation** : ajouter une contrainte `UNIQUE (devis_id)` sur `factures` (partielle si nécessaire, ex. `WHERE devis_id IS NOT NULL`), qui ferait échouer proprement la seconde tentative avec une erreur `23505` déjà gérée par le code existant pour les conflits de numéro.
  - **Statut** : Vérifié par analyse de code ; non reproduit en conditions réelles (pas de test de charge/concurrence exécuté).

### Numérotation, statuts, modification après création, suppression

- Numérotation : voir **DB-02** (phase 5) — compteur global à toute la plateforme, non scopé par organisation. Repris ici car directement au cœur du sujet "facturation" : c'est le point de non-conformité le plus significatif pour la facturation légale en environnement multi-tenant.
- Statuts (`en_attente_validation → impayee/annulee → payee`, plus `acompte`/`partiel` non atteignables, cf. FACT-01) : transitions non validées côté serveur au-delà de la RLS (organisation + rôle), cohérent avec le constat général de la phase 6 sur l'absence de machine à états pour les tables métier "simples" (à la différence des tables `partner_*`).
- Modification après création : `useUpdateFacture` (phase 6) permet de modifier n'importe quel champ d'une facture existante tant que la RLS l'autorise (admin, ou intervenant créateur hors statuts `payee`/`annulee` — cf. policies `factures_update`, phase 3) — y compris potentiellement les montants, sans recalcul ni validation de cohérence HT/TVA/TTC (cf. **DB-04**).
- Suppression : `useDeleteFacture`/`useDeleteAllFactures` ne distinguent pas le statut de la facture — une facture déjà payée peut être supprimée aussi facilement qu'une facture impayée (déjà noté phase 6), perdant potentiellement une preuve de paiement sans étape de confirmation renforcée spécifique.

### Cohérence interface / base / PDF

- Vérifiée cohérente **au sens strict** : le PDF (`src/lib/pdf/generator.tsx`) affiche exactement les valeurs stockées en base (`devis.total_ht`, `tva_montant`, `total_ttc`), sans recalcul indépendant — ce qui signifie qu'il n'y a **pas de divergence entre ce que l'admin voit à l'écran, ce qui est stocké, et ce qui est imprimé/envoyé**, mais aussi que le **bug FONC-01 (TVA négative) est fidèlement reproduit sur le document final**, sans aucune couche de validation qui l'intercepterait avant impression/envoi.

### Doubles soumissions (hors transformation devis→facture)

- Spot-check déjà réalisé en phase 2 sur le bouton de sauvegarde de devis (`create.isPending || update.isPending`) — protection correcte contre le double-clic sur le même onglet. Le même pattern (`disabled={...isPending}`) est appliqué de façon cohérente sur les boutons de `DevisApercuPage.tsx` (transformer, dupliquer, partager). Aucune protection au-delà du simple statut de mutation React Query n'a été trouvée nulle part dans le code (pas de verrou serveur, pas de clé d'idempotence transmise à l'API) — suffisant pour l'usage normal (un seul onglet, un seul clic), insuffisant face à une vraie concurrence (cf. FACT-02).

---

## 2. Stripe

### Ce qui existe réellement dans ce dépôt

| Élément | Nature | Fichier |
|---|---|---|
| Table `subscriptions` | Documentée a posteriori (créée à l'origine par l'app externe) | `supabase/migrations/20260709000002_version_stripe_tables.sql` |
| Table `stripe_webhook_events` | Idem — deny-all RLS (aucune policy, accès service_role uniquement) | idem |
| Table `founder_seats` | Créée entièrement hors dépôt — colonnes/contraintes non visibles ici | référencée uniquement dans `20260711000003` |
| RPC `get_my_organisation_subscription_status()` | Lecture seule, `SECURITY DEFINER`, dérive l'organisation de l'appelant depuis son JWT | `20260711000001_organisation_subscription_status_rpc.sql` |
| Trigger `provision_subscriber_organisation()` | Crée automatiquement organisation + profil admin quand une ligne `subscriptions` passe à `trialing`/`active` sans organisation liée | `20260710000001_provision_subscriber_organisation.sql` |
| Fonction `claim_founder_seat()` | Incrémente un compteur de places "fondateur" — accès restreint à `service_role` depuis le correctif STRIPE-03 | `20260711000003_secure_sensitive_settings_and_founder_seats.sql` |
| `src/lib/subscription.ts` | Logique frontend de blocage (`isSubscriptionAccessAllowed`, `fetchSubscriptionBlocked`) | déjà détaillé phase 2 (**SEC2-01**) |

### Ce qui n'existe pas dans ce dépôt (non vérifiable)

- **Création de session Checkout** : aucune trace — doit être implémentée côté site externe.
- **Webhook Stripe (réception, vérification de signature, traitement des événements)** : aucune Edge Function de ce type dans `supabase/functions/` (les 7 fonctions ont été exhaustivement analysées en phase 4 : aucune ne traite d'événement Stripe). La table `stripe_webhook_events` existe pour stocker les événements traités (probablement pour déduplication/idempotence côté receveur), mais **le code qui y écrit et qui vérifie la signature du webhook n'est pas dans ce dépôt**.
- **Rejeu d'un webhook, événements reçus dans le désordre, échec de paiement, statut incomplet, remboursement, portail client, passage d'une offre à une autre, suppression du client Stripe** : tous ces mécanismes dépendent du code de traitement du webhook, absent d'ici. **Non vérifiable.**
- **Clés test/production** : aucune clé Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `sk_live_`/`sk_test_`, etc.) trouvée dans `.env.local`, `.env.production`, `.env.beta-test`, `.env.guide`, ni dans aucun fichier suivi par git — cohérent avec l'absence de code Stripe dans ce dépôt. Impossible de déterminer si l'app externe utilise des clés de test ou de production, ni comment leur bascule est gérée.
- **Contrôle backend des offres et montants (prix envoyé à Stripe)** : la table `subscriptions.plan` accepte `starter`/`pro`/`enterprise`, mais aucune table/logique de ce dépôt ne définit de montant associé à un plan, ni ne revalide un prix — ce contrôle, s'il existe, est entièrement du ressort du code externe (Stripe Price IDs configurés côté Stripe Dashboard et/ou côté site externe). **Non vérifiable depuis ce dépôt.**

### Le seul point de contrôle serveur trouvé côté "montant/offre" : `claim_founder_seat()`

- Avant le correctif STRIPE-03 (2026-07-11), cette fonction était appelable par `anon` **sans aucune vérification d'identité ni de souscription Stripe réelle** — n'importe qui pouvait épuiser le compteur public de places "fondateur" sans payer (déjà documenté phase 3). Corrigée : restreinte à `service_role` uniquement désormais, ce qui casse volontairement l'appel actuel du site externe tant qu'il n'est pas mis à jour pour utiliser une clé service_role (note explicite de la migration elle-même). **Statut réel de cette mise à jour côté site externe : non vérifiable depuis ce dépôt.**

---

## 3. Contrôle de l'accès selon l'abonnement

Synthèse croisée avec les phases 2 et 3 (détail complet déjà donné, **SEC2-01**) :

| Couche | Contrôlé ? | Détail |
|---|---|---|
| **Interface** (React) | ✅ Oui | `Guard`/`SubscriptionBlockedScreen` dans `App.tsx` bloquent l'affichage si `subscriptionBlocked` est vrai. |
| **Routes** (React Router) | ✅ Oui, mais dépend du même mécanisme frontend | Aucune route n'est protégée indépendamment — c'est le même `Guard` qui gate à la fois les rôles et l'abonnement. |
| **Edge Functions** | ❌ Non vérifié comme contrôlé | Aucune des 7 fonctions analysées en phase 4 ne vérifie le statut d'abonnement de l'organisation appelante avant d'exécuter son action (envoi d'email, invitation, suppression, etc.). |
| **RPC** | ⚠️ Partiel | `get_my_organisation_subscription_status()` est la RPC qui *renseigne* le statut, mais aucune autre RPC (`respond_to_partner_intervention_request`, `seed_default_prestations`, etc.) ne vérifie elle-même que l'abonnement de l'appelant est actif avant de s'exécuter. |
| **Base de données (RLS)** | ❌ **Non contrôlé — confirmé phase 3 (SEC2-01)** | Recherche exhaustive dans les 102 migrations : `subscription_status` n'apparaît dans **aucune** policy `USING`/`WITH CHECK` des tables métier (`clients`, `devis`, `factures`, `interventions`, etc.). Une organisation dont l'abonnement est expiré/annulé garde un accès complet aux données via l'API directe. |
| **Admin** | Bloqué côté UI comme les autres rôles | Message spécifique ("régularisez votre abonnement") mais même mécanisme, mêmes limites. |
| **Assistant** | Idem | Message générique ("contactez votre administrateur"). |
| **Intervenant** | Idem | Message générique. |

**Conclusion inchangée depuis la phase 2** : le gating d'abonnement est un vernis d'interface, pas une garantie de sécurité de la base de données. Un utilisateur qui n'exécute pas le code React officiel (script, JWT réutilisé hors navigateur) conserve un accès complet à son organisation quel que soit le statut réel de son abonnement Stripe.

---

## 4. Scénarios évalués

| # | Scénario | Résultat |
|---|---|---|
| 1 | Utilisateur avec abonnement expiré | Bloqué **côté UI uniquement** (écran `SubscriptionBlockedScreen`) ; accès aux données via l'API directe non bloqué — cf. **SEC2-01**. |
| 2 | Contournement de l'écran de blocage | **Confirmé possible** — voir SEC2-01/phase 2 : le blocage n'est qu'un état React, aucune policy RLS ne le fait respecter. |
| 3 | Modification du prix envoyé à Stripe | **Non vérifiable** — la création de session Checkout (où un prix/Price ID serait transmis) n'existe pas dans ce dépôt. |
| 4 | Rejeu d'un webhook | **Non vérifiable** — code de traitement du webhook absent de ce dépôt. La table `stripe_webhook_events` (clé primaire `id text`, probablement l'ID d'événement Stripe) suggère une intention de déduplication par le code externe, mais son mécanisme réel n'est pas visible ici. |
| 5 | Webhook reçu dans le désordre | **Non vérifiable** — idem. |
| 6 | Paiement réussi mais base non mise à jour | **Non vérifiable directement**, mais **structurellement plausible** : `provision_subscriber_organisation()` ne s'exécute que sur `INSERT`/`UPDATE` de la table `subscriptions` — si le webhook externe échoue à écrire cette ligne après un paiement Stripe réussi, rien dans ce dépôt ne détecterait ni ne corrigerait cet état (pas de réconciliation périodique trouvée). Cohérent avec la mémoire projet mentionnant un écart constaté (6 abonnés Stripe vs 2 organisations provisionnées) lors d'un audit antérieur — état non revérifié dans cette phase. |
| 7 | Base active mais abonnement Stripe annulé | Si `subscriptions.subscription_status` n'est jamais mis à jour vers `canceled` (webhook manqué), l'organisation resterait indéfiniment "active" du point de vue de `isSubscriptionAccessAllowed()` — **non vérifiable sans accès à la synchronisation réelle**, mais le mécanisme frontend lui-même se contente strictement de lire cette colonne sans vérification croisée auprès de Stripe. |
| 8 | Double création d'abonnement | `provision_subscriber_organisation()` a un garde-fou explicite : *"Déjà provisionné (rejeu webhook, 2e event) — court-circuit immédiat"* (`IF NEW.organisation_id IS NOT NULL THEN RETURN NEW`) — protège contre un double provisioning **pour une même ligne `subscriptions`**. Ne protège pas contre la création de deux lignes `subscriptions` distinctes pour le même `user_id` (la table a `stripe_customer_id`/`stripe_subscription_id` en `UNIQUE`, mais `user_id` est la clé primaire — donc un second `INSERT` avec le même `user_id` échouerait nativement au niveau de la PK ; un test réel serait nécessaire pour confirmer le comportement exact du webhook externe face à ce cas). |
| 9 | Passage d'une offre à une autre | **Non vérifiable** — dépend du code externe. Côté DB, `subscriptions.plan` accepte simplement une nouvelle valeur (`starter`/`pro`/`enterprise`) via `UPDATE`, sans logique de proratisation ni de validation visible ici. |
| 10 | Suppression du client Stripe | **Non vérifiable** — aucun code de ce dépôt ne réagit à un événement `customer.deleted`. `subscriptions.user_id` a `ON DELETE CASCADE` vers `auth.users`, donc si l'utilisateur Supabase est supprimé, sa ligne `subscriptions` disparaît aussi — mais l'inverse (client Stripe supprimé côté Stripe) n'a pas de contrepartie visible ici. |

---

## 5. Éléments non vérifiables dans cette phase

- L'intégralité du traitement du webhook Stripe (réception, vérification HMAC de la signature, idempotence par `stripe_webhook_events.id`, gestion des événements `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`, etc.) : code absent de ce dépôt.
- La création de session Checkout et le portail client Stripe : absents de ce dépôt.
- Les clés Stripe utilisées (test vs production) et leur gestion : absentes de ce dépôt.
- L'état réel de la synchronisation entre Stripe et la table `subscriptions` en production (écart précédemment constaté selon la mémoire projet — "Stripe self-service gap", 6 abonnés vs 2 organisations — non revérifié dans cette phase, aucun accès à la base réelle).
- Le schéma exact et les policies de `founder_seats` (table créée hors dépôt).
- Le comportement réel du site externe (kaytekinter.fr) après le correctif STRIPE-03 qui a cassé volontairement son appel à `claim_founder_seat()` avec la clé anonyme — la migration indique explicitement que ce site "n'est pas encore mis à jour" à la date de son écriture ; son état actuel n'a pas été revérifié.
- Tout comportement dynamique (aucun appel réel à Stripe, à une Edge Function, ni de test de concurrence exécuté pour confirmer FACT-02).

---

**Phase terminée. J'attends votre autorisation pour continuer.**
