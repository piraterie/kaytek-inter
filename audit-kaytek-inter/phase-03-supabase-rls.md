# Phase 3 — Supabase, RLS et isolation multi-tenant

Date de l'analyse : 2026-07-21
Méthode : lecture intégrale des 102 fichiers de `supabase/migrations/` (reconstruction chronologique de l'état **final** de chaque policy — la plupart des tables ont été modifiées plusieurs fois via `DROP POLICY IF EXISTS` + `CREATE POLICY`), du schéma de référence `backup/backup-2026-06-10/database-schema.sql`, des 7 Edge Functions, et croisement avec les constats des phases 1 et 2. Aucune requête exécutée contre une base réelle (pas d'accès Supabase distant dans ce périmètre) — toutes les conclusions viennent de la lecture du code SQL versionné. Aucune policy modifiée.

---

## Réponse à la priorité absolue

**Un utilisateur d'une organisation peut-il accéder aux données d'une autre organisation ?**

**Non, pas par les chemins vérifiés dans cette phase**, pour l'ensemble des tables métier cœur (clients, interventions, devis, factures, commissions, profiles, photos, messages, prestations, paramètres, appareils). Le pattern appliqué est cohérent et correctement conçu : `organisation_id` n'est **jamais** fait confiance tel que fourni par le client — chaque `WITH CHECK`/`USING` le re-dérive côté serveur via `current_org_id()`/`is_same_org()`, des fonctions `SECURITY DEFINER` qui lisent `profiles.organisation_id` à partir de `auth.uid()` (donc du JWT, non falsifiable côté client).

Cependant, l'analyse a mis au jour **une régression confirmée** sur le réseau partenaires (`partner_intervention_requests` — voir RLS-01 ci-dessous) qui expose des données clients partagées entre organisations partenaires à des rôles non-admin (assistant/intervenant) au sein des deux organisations concernées, en contradiction avec un correctif de sécurité antérieur (SEC-05) qui avait explicitement fermé cet accès. Ce n'est pas une fuite *cross-tenant arbitraire* (elle ne concerne que les deux organisations déjà en relation partenaire), mais c'est un contournement confirmé d'une restriction de rôle au niveau RLS.

Un historique de **faille cross-org réelle et déjà corrigée** a également été identifié sur Supabase Storage (11 policies orphelines créées hors migration, actives entre le 10/06 et le 11/07/2026 — voir RLS-02) : à traiter comme un signal fort sur le risque de dérive de configuration hors version control, pas comme une vulnérabilité actuellement active.

---

## 1. Fonctions helper RLS — analyse

Toutes `SECURITY DEFINER`, `STABLE`, `SET search_path = public` (protège contre le détournement de search_path), définies dans `20260610000016_rls_helpers_multitenant.sql` et étendues ensuite. Elles constituent la fondation de tout le modèle multi-tenant :

| Fonction | Définition | Évaluation |
|---|---|---|
| `current_org_id()` | `SELECT organisation_id FROM profiles WHERE id = auth.uid()` | Racine de confiance : dérive TOUJOURS l'org depuis le JWT, jamais depuis un paramètre client. NULL si profil absent → verrouille par défaut (fail-closed). |
| `is_same_org(row_org_id)` | `EXISTS(... profiles WHERE id=auth.uid() AND organisation_id=row_org_id)` | Idem, fail-closed. |
| `is_admin_in_org(org_id)` | `role='admin' AND actif=true` pour `auth.uid()` dans `org_id` | Inclut `actif=true` — un admin désactivé perd ce helper (cf. phase 2, SEC2-03). |
| `is_intervenant_in_org(org_id)` | idem pour `role='intervenant'` | Ajouté par SEC-01 (2026-07-08) pour fermer l'accès financier aux assistants. |
| `is_assistant_in_org(org_id)` | idem pour `role='assistant'` | — |
| `can_manage_operations(org_id)` | `is_admin_in_org OR is_assistant_in_org` | Utilisé pour clients/interventions/photos. |
| `is_partner_org` / `has_partner_relation` / `is_connection_member` / `is_connection_accepted` | vérifient l'existence/statut d'une `partner_connections` entre deux orgs | Corrects, `SECURITY DEFINER` nécessaire car l'appelant n'a pas de policy SELECT propre sur les connexions d'une autre org. |
| `profile_belongs_to_org` | vérification d'appartenance d'un profil cible à une org (utilisé dans `pir_insert`) | Correct. |

**Aucune fonction `is_same_org`/`is_admin_in_org` n'accepte l'organisation comme un paramètre de confiance venant du frontend sans la comparer à `current_org_id()` dérivé du JWT** — c'est le point le plus important de cette phase : le scénario 1 (modifier `organisation_id` dans une requête) échoue systématiquement.

---

## 2. Matrice des tables

*RLS = Row Level Security activée. Risque évalué du point de vue isolation multi-tenant (cross-org), pas sécurité générale (voir phase 2 pour le reste).*

| Table | Données | `organisation_id` | RLS | SELECT | INSERT | UPDATE | DELETE | Risque |
|---|---|---|---|---|---|---|---|---|
| `organisations` | nom, slug, plan, actif | (c'est l'org) | ✅ | propre org uniquement (placeholder `auth.uid() IS NOT NULL` corrigé le jour même, 20260610000002) | aucune policy authenticated | aucune policy authenticated | aucune policy authenticated | **Faible** — fenêtre de risque historique refermée le jour-même, non exploitable aujourd'hui |
| `profiles` | email, rôle, `commission_pct`, `actif`, téléphone | ✅ | ✅ | `is_same_org` (tout membre voit les profils de son org) | org = `current_org_id()` | soi-même ou admin ; **trigger** `protect_profile_sensitive_fields` verrouille role/actif/organisation_id/commission_pct/can_create_documents/can_bypass_validation/type_intervenant pour un non-admin | admin de l'org | **Faible** — double protection policy + trigger |
| `clients` | nom, tél, email, adresse | ✅ | ✅ | `can_manage_operations` OU créateur OU intervenant/devis lié | `can_manage_operations` OU intervenant (org forcée) | admin/assistant, org forcée | admin uniquement | **Faible** |
| `interventions` | adresse intervention, description | ✅ | ✅ | `can_manage_operations` OU intervenant assigné | idem (+ intervenant créateur) | idem + assigné | admin uniquement | **Faible** |
| `devis` | montants, prestations | ✅ | ✅ | admin OU (intervenant : créateur/assigné) | admin OU (intervenant, créateur=soi) | admin OU (intervenant, créateur=soi, statuts non finaux) | admin uniquement | **Faible** (post SEC-01) |
| `factures` | montants, statut paiement | ✅ | ✅ | admin OU (intervenant : créateur/assigné) | admin OU (intervenant, créateur=soi) | admin uniquement | admin uniquement | **Faible** (post SEC-01) |
| `commissions` | % et montants intervenant | ✅ | ✅ | admin OU intervenant concerné | admin OU intervenant (soi) | admin uniquement | admin uniquement | **Faible** (post SEC-01) |
| `commission_receipts` | reçus de commission | ✅ | ✅ | admin OU intervenant concerné | admin OU intervenant (soi) | admin OU intervenant (soi) | admin uniquement | **Faible** (post SEC-01) |
| `photos` | photos intervention (storage_path) | ✅ | ✅ | `can_manage_operations` OU intervenant assigné (join interventions) | org + intervention liée dans la même org | *aucune policy UPDATE* | admin OU auteur upload | **Faible** |
| `messages` | messagerie interne | ✅ | ✅ | expéditeur/destinataire/admin, même org | expéditeur=soi, destinataire même org (anti cross-org) | destinataire (lu) ou admin | *aucune policy DELETE* | **Faible** |
| `notifications` | titres/contenus notifs | ✅ | ✅ | destinataire=soi uniquement | **tout membre de l'org pour n'importe quel destinataire de la même org** (cf. RLS-04) | destinataire=soi | destinataire=soi | **Faible-Moyen** (spoofing intra-org possible, jamais cross-org) |
| `journal` | log d'audit interne | ✅ | ✅ | admin uniquement | tout membre de l'org | *aucune (immuable)* | *aucune (immuable)* | **Faible** |
| `prestations` | catalogue prestations/tarifs | ✅ | ✅ | tout membre de l'org | admin uniquement | admin uniquement | admin uniquement | **Faible** |
| `parametres_entreprise` | SIRET, TVA, **IBAN/BIC**, mentions légales | ✅ | ✅ | **admin uniquement** (post FE-01, 2026-07-11) | admin uniquement | admin uniquement | admin uniquement | **Faible** (était Moyen avant FE-01) |
| `parametres_entreprise_public` (VUE) | sous-ensemble non sensible (jamais iban/bic) | ✅ (via `WHERE current_org_id()`) | héritée + écriture révoquée explicitement | tout `authenticated`, filtré par org dans la vue | révoqué | révoqué | révoqué | **Faible** |
| `push_subscriptions` | endpoints push navigateur | ✅ | ✅ | soi-même | soi-même | soi-même | soi-même | **Faible** |
| `devices` | appareils, IP, OS/navigateur | ✅ | ✅ | soi-même OU admin | soi-même | soi-même OU admin | soi-même OU admin | **Faible** |
| `document_public_links` | tokens de partage devis/facture | ✅ | ✅ | org du lien | org + vérification croisée `document_id` appartient bien à l'org (SEC-03) | org du lien | *aucune UPDATE* | **Faible-Moyen** — `expires_at` jamais renseigné par le frontend (voir RLS-03) |
| `guide_progress` | progression pédagogique utilisateur | ✅ | ✅ | soi-même | soi-même | soi-même | soi-même | **Faible** (donnée non sensible) |
| `guide_videos` | métadonnées vidéos guide | ✅ (pattern identique) | ✅ | non lu en détail — structure identique à `guide_progress`/`guide_news` | — | — | — | **Faible** (non sensible, non vérifié en détail — voir limites) |
| `guide_news` | actualités in-app | ✅ | ✅ | non lu en détail | — | — | — | **Faible** (non sensible) |
| `subscriptions` | facturation Stripe (statut, `stripe_customer_id`) | colonne ajoutée, **non utilisée par aucune policy ni le code applicatif** | ✅ | `auth.uid() = user_id` (portée utilisateur, pas organisation) | aucune policy `authenticated` (géré par `service_role`/trigger externe) | aucune policy `authenticated` | aucune policy `authenticated` | **Faible pour le cross-org** (portée intentionnellement individuelle) — voir phase 2 SEC2-01 pour le vrai risque (gating non appliqué par RLS) |
| `stripe_webhook_events` | événements webhook Stripe | n/a | ✅ | **aucune policy** (deny-all pour anon/authenticated par conception) | aucune | aucune | aucune | **Nul** (service_role uniquement) |
| `founder_seats` | compteur places fondateur | table créée hors dépôt (intégration Stripe externe) | supposée activée (non vérifiable ici) | lecture publique du compteur (`founder_seats_select_public`, non lu en détail) | **révoqué** pour anon/authenticated depuis FE-01/STRIPE-03 | révoqué | révoqué | **Faible** (était Moyen : `claim_founder_seat()` était appelable par `anon` avant le correctif STRIPE-03) |
| `partner_profiles` | vitrine partenaire (nom public, métier, ville) | ✅ | ✅ | propre org OU `visible_reseau=true` OU relation existante — **ET `is_admin_in_org`** | admin uniquement, propre org | admin uniquement, propre org | *aucune* | **Faible** |
| `partner_connections` | relations inter-organisations | ✅ (x2 : requester/target) | ✅ | les deux orgs concernées — **ET `is_admin_in_org`** | admin, org émettrice=soi, cible valide | admin, l'une des deux orgs (machine à états via trigger) | *aucune* | **Faible** |
| `partner_connection_events` | audit des connexions | via jointure | ✅ | jointure vers connexions — **ET `is_admin_in_org`** | *aucune (trigger `SECURITY DEFINER` uniquement)* | — | — | **Faible** |
| `partner_messages` | messagerie inter-organisations | ✅ | ✅ | membre de la connexion — **ET `is_admin_in_org`** | admin, membre, connexion `accepted` au moment de l'écriture | admin, membre (marquer lu) | *aucune* | **Faible** |
| `partner_intervention_requests` | **adresse, téléphone, nom client, montant, photos partagés** entre 2 orgs | ✅ (x2) | ✅ | org source (accès total, tout statut) OU org cible (si statut ≥ accepted) — **SANS vérification de rôle** | admin, org émettrice=soi, connexion `accepted`, cohérence des champs | admin, l'une des deux orgs (machine à états + RPC dédiée) | *aucune* | **🔴 Moyen-Élevé — voir RLS-01** |
| `partner_intervention_events` | audit des demandes partenaires | via jointure | ✅ | jointure vers `partner_intervention_requests` — **ET `is_admin_in_org`** | *aucune (trigger uniquement)* | — | — | **Faible** |

---

## 3. Constats critiques

### RLS-01 — `partner_intervention_requests` : la restriction "admin uniquement" a été retirée par une migration ultérieure, jamais restaurée

- **Gravité** : Moyenne-Élevée
- **Confiance** : Confirmé (reconstruction chronologique précise des migrations)
- **Fichiers** : `20260708000008_security_phase1_critical_hardening.sql` (SEC-05, ajoute `is_admin_in_org`), `20260714000002_partner_request_status_gating.sql` (retire `is_admin_in_org`), `20260715000008_diag_pir_select_true.sql` (élargit temporairement à `USING(true)`), `20260715000009_fix_pir_update_rpc.sql` (restaure — mais **sans** `is_admin_in_org`)
- **Chronologie précise** :
  1. `20260708000005` crée `pir_select` : `USING (current_org_id() IN (source_organisation_id, target_organisation_id))` — aucune vérification de rôle.
  2. `20260708000008` (SEC-05, même jour, plus tard) corrige explicitement ce point : *"Le réseau partenaires doit rester strictement réservé à l'admin"* → ajoute `is_admin_in_org(current_org_id()) AND (...)`.
  3. `20260714000002` (6 jours plus tard, pour ajouter un masquage par statut) **recrée `pir_select` sans jamais réintégrer `is_admin_in_org`** : `USING (current_org_id() = source_organisation_id OR (current_org_id() = target_organisation_id AND status IN ('accepted','in_progress','completed')))`.
  4. `20260715000008` élargit temporairement (diagnostic) `pir_select` à `USING (true)` — exposition totale, transitoire, en session de debug.
  5. `20260715000009` restaure la forme de l'étape 3 (masquage par statut) — **toujours sans `is_admin_in_org`**. C'est l'état final actuel.
- **Comparaison avec les tables soeurs** : `partner_profiles_select`, `partner_connections_select`, `partner_connection_events_select`, `partner_messages_select` et `pie_select` (partner_intervention_**events**) ont tous conservé leur `is_admin_in_org(...)` de SEC-05 intact — vérifié qu'aucune migration après le 2026-07-08 ne les retouche. **Seul `pir_select` a régressé.**
- **Description** : `partner_intervention_requests` contient un snapshot explicite de données client partagées entre deux entreprises partenaires : `adresse_partagee`, `telephone_client_partage`, `nom_client_partage`, `montant_partage`, `photos_partagees`. Depuis le 14/07/2026, n'importe quel membre authentifié (assistant, intervenant) de l'organisation source peut lire l'intégralité de ces colonnes pour toutes ses demandes envoyées, quel que soit leur statut ; et n'importe quel membre de l'organisation cible peut les lire dès que la demande est acceptée — alors que SEC-05 avait explicitement voulu réserver cela aux admins, précisément parce que le rôle assistant/intervenant ne doit pas voir de données financières/clients de ce niveau.
- **Scénario** : un intervenant de l'organisation A (source) se connecte, ouvre les devtools réseau ou exécute `supabase.from('partner_intervention_requests').select('*')` depuis la console du navigateur (le SDK est déjà chargé et authentifié) → reçoit la liste complète des demandes envoyées par son organisation à des partenaires, avec adresse/téléphone/nom du client final, même si l'UI ne montre normalement cette section qu'aux admins.
- **Impact** : divulgation de données personnelles de clients finaux (RGPD) à des rôles internes qui ne devraient pas y avoir accès, potentiellement des dizaines d'utilisateurs par organisation selon la taille de l'équipe. Reste circonscrit aux deux organisations déjà en relation partenaire acceptée — **pas** une fuite arbitraire cross-tenant vers une organisation tierce sans lien.
- **Recommandation** : réintégrer `is_admin_in_org(current_org_id())` dans la condition `pir_select`, comme pour `pie_select`/`partner_messages_select`/`partner_connections_select`, sans toucher au masquage par statut déjà en place (les deux conditions sont cumulables par `AND`).
- **Statut** : Vérifié par lecture de code (pas de test dynamique contre une base réelle).

---

### RLS-02 — Historique : 11 policies Storage orphelines (créées hors migration) ont permis un accès cross-organisation aux PDF/signatures/photos pendant ~1 mois

- **Gravité** : Informationnel (déjà corrigé) mais révélateur d'un risque de processus
- **Confiance** : Confirmé (documenté par le correctif lui-même)
- **Fichier** : `20260711000002_drop_orphaned_storage_admin_policies.sql`
- **Description** : Ce fichier documente qu'un audit du 10/07/2026 a trouvé 11 policies sur `storage.objects` (`logos_*_admin`, `pdfs_*_admin`, `photos_*_admin/own`, `signatures_*_admin`, et surtout `media_read`/`media_upload` — **sans aucune condition d'organisation ni de propriétaire**) qui coexistaient avec les policies correctement cloisonnées de la Phase 8 (`20260610000030`, 2026-06-10). Postgres combine les policies **permissives par OR** : la présence de ces policies non scopées suffisait, à elle seule, à autoriser un accès cross-organisation aux PDF, signatures et photos, **indépendamment** de la qualité des policies légitimes déjà en place. Ces 11 policies n'apparaissent dans **aucun fichier de migration** du dépôt — elles ont été créées directement depuis le Dashboard Supabase, donc invisibles pour quiconque relit uniquement l'historique git.
- **Impact réel (historique)** : entre le 10/06/2026 (Phase 8) et le 11/07/2026 (correctif), un accès cross-organisation aux fichiers de ces 4 buckets était possible pour tout utilisateur authentifié via `media_read`/`media_upload` (la plus large des 11, sans même de condition de propriétaire).
- **Statut actuel** : corrigé (DROP appliqué), et confirmé qu'aucune migration ultérieure ne recrée ces noms de policy.
- **Risque résiduel** : ce type de dérive (modification directe en production hors migration) n'est pas détectable par cette revue de code — elle ne peut être repérée qu'a posteriori, comme ce fut le cas ici. Recommandation : interdire les modifications de policies via le Dashboard en production, ou à défaut, mettre en place un diff périodique automatisé entre l'état réel de `pg_policies`/`storage.objects` et les migrations versionnées.
- **Statut** : Vérifié (correctif présent et documenté), risque de récidive non mesurable depuis ce dépôt.

---

### RLS-03 — Liens de partage public (`document_public_links`) sans expiration effective

- **Gravité** : Faible-Moyenne
- **Confiance** : Confirmé
- **Fichiers** : `src/lib/hooks/index.ts:1632-1648` (`useCreatePublicLink`), `supabase/migrations/20260618000001_document_public_links.sql`, `supabase/functions/get-public-document/index.ts`
- **Description** : La colonne `expires_at` de `document_public_links` est nullable et l'Edge Function `get-public-document` vérifie bien l'expiration si elle est définie (`if (link.expires_at && new Date(link.expires_at) < new Date())`), mais **`useCreatePublicLink()` ne fournit jamais de valeur pour `expires_at`** lors de la création du lien — tous les liens générés par l'application sont donc permanents. Le token (128 bits, `gen_random_bytes(16)`) n'est pas devinable par force brute, mais un lien transmis par email/SMS et intercepté, archivé dans un historique de navigateur, un log de proxy, ou transféré par erreur reste valide indéfiniment.
- **Élément aggravant** : l'Edge Function sert, avec le document, les paramètres `iban`/`bic` de l'organisation pour une facture (`parametres_entreprise.select('..., iban, bic, ...')`) — un lien de facture ancien, toujours valide, expose donc en permanence les coordonnées bancaires de l'entreprise à quiconque le détient encore.
- **Recommandation** : fixer une expiration par défaut raisonnable (ex. 30-90 jours) côté `useCreatePublicLink()` ou via un `DEFAULT` en base, et/ou proposer une action "révoquer ce lien" visible dans l'UI (la policy `org_delete` existe déjà côté RLS, il ne manque qu'un point d'entrée UI si absent).
- **Statut** : Vérifié.

---

### RLS-04 — `notifications_insert` permet de créer une notification pour n'importe quel autre utilisateur de la même organisation

- **Gravité** : Faible
- **Confiance** : Confirmé
- **Fichier** : `20260610000018_rls_phase2_admin_simple_tables.sql` (policy `notif_insert`)
- **Description** : `WITH CHECK (organisation_id = current_org_id())` — ne vérifie ni l'expéditeur ni le destinataire, volontairement (commentaire : nécessaire pour `notifyAdmins()`/`notifyUser()` appelés côté frontend par les intervenants). Cela signifie que tout utilisateur authentifié de l'organisation peut insérer une notification avec `titre`/`contenu` arbitraires pour n'importe quel `user_id` de la même organisation (y compris un admin), ce qui peut aussi déclencher un push (`trigger_push_on_notification`).
- **Impact** : reste strictement intra-organisation (pas de fuite cross-tenant) ; risque limité à du spam interne ou de l'ingénierie sociale entre collègues (ex. un intervenant faisant croire à une fausse alerte admin).
- **Recommandation** : si ce risque est jugé pertinent, restreindre `notif_insert` aux cas légitimes connus (ex. RPC dédiée `SECURITY DEFINER` au lieu d'un INSERT direct ouvert), sans bloquer les flux `notifyAdmins()`/`notifyUser()` existants.
- **Statut** : Vérifié.

---

### RLS-05 — Buckets Storage : classification et confirmation de l'isolation

- `intervention-photos`, `signatures`, `chat-media`, `pdf-documents` (privés) : isolation par jointure DB (`photos`/`messages`/`interventions` déjà RLS org-scopées) et/ou préfixe de chemin `{orgId}/...` ou `{userId}/...` vérifié dans la policy elle-même (`split_part(name,'/',1)`). Cohérent et vérifié pour chacun (détail en §4 Storage).
- `logos` (public) : accès en lecture libre par conception (branding affiché sur les documents publics/pages de login) — écriture verrouillée à l'admin de l'organisation propriétaire du préfixe de chemin. Risque faible et assumé (juste une image de logo).
- Aucune policy Storage avec `USING (true)` n'a été trouvée dans l'état final (l'unique occurrence de ce type, RLS-02, a été corrigée).

---

## 4. Matrice Storage

| Bucket | Public/Privé | Structure du chemin | Policy | Organisation vérifiée | Risque |
|---|---|---|---|---|---|
| `intervention-photos` | Privé (signed URL 300s) | `{interventionId}/{type}-{ts}.jpg` | SELECT : owner OU jointure `photos.organisation_id = current_org_id()` ; INSERT : jointure `interventions.organisation_id = current_org_id()` ; DELETE : owner ou admin | ✅ (via jointure DB, pas via le chemin) | **Faible** (post RLS-02) |
| `signatures` | Privé (signed URL 300s) | `{orgId}/{docType}-{docId}.png` | SELECT/INSERT/UPDATE/DELETE : `split_part(name,'/',1) = current_org_id()::text` | ✅ (préfixe de chemin vérifié directement) | **Faible** (post RLS-02) |
| `logos` | **Public** (URL publique, pas de signed URL) | `{orgId}/logo.{ext}` | Pas de policy SELECT (lecture libre assumée) ; INSERT/UPDATE/DELETE : admin + préfixe org | N/A en lecture (public par conception) ; ✅ en écriture | **Faible** (donnée non sensible : logo) |
| `chat-media` | Privé (signed URL **7 jours**) | `{userId}/{type}-{ts}.{ext}` | SELECT : owner OU jointure `messages` (expéditeur/destinataire/admin) ; INSERT : préfixe = `auth.uid()` ; DELETE : owner ou admin | ✅ (via jointure `messages`, déjà org-scopée) | **Faible-Moyen** — durée de signed URL longue (7j) augmente la fenêtre d'exposition si l'URL fuite (voir RLS-06) |
| `pdf-documents` | Privé — **dead code**, jamais utilisé (`uploadPdf()` exporté mais jamais appelé, PDFs transmis en base64 par email) | `{orgId}/{ts}-{filename}.pdf` (si activé) | Policies préventives déjà en place (owner/admin + préfixe org) | ✅ (si utilisé un jour) | **Nul actuellement** (bucket inutilisé) |
| `guide-videos` | Privé | `{organisation_id}/{role}/{slug}.webm` | SELECT : authentifié + préfixe = org ; INSERT/UPDATE/DELETE : admin + préfixe = org | ✅ | **Faible** (contenu pédagogique, non sensible) |

### RLS-06 — Durée des signed URLs `chat-media` (7 jours) sensiblement plus longue que les autres buckets

- **Gravité** : Faible
- **Confiance** : Confirmé (durée documentée dans le commentaire de la migration Phase 8)
- **Description** : `intervention-photos`/`signatures` utilisent des signed URLs de 300 secondes (5 minutes), alors que `chat-media` (photos/messages vocaux échangés en messagerie) utilise 7 jours. Une URL signée qui fuite (partagée par erreur, présente dans un log de proxy/CDN, capturée par un outil d'analytics tiers si jamais utilisé) reste exploitable toute cette durée sans re-authentification.
- **Recommandation** : évaluer si 7 jours est réellement nécessaire pour l'usage (relecture d'anciens messages) ou si une régénération à la demande avec un TTL plus court serait acceptable.
- **Statut** : Vérifié (lecture du code de la migration) ; non testé en conditions réelles.

---

## 5. Fonctions `SECURITY DEFINER` recensées — évaluation individuelle

| Fonction | Bypass RLS | Revalidation interne | Évaluation |
|---|---|---|---|
| `current_org_id`, `is_same_org`, `is_admin_in_org`, `is_intervenant_in_org`, `is_assistant_in_org`, `can_manage_operations` | Oui (lecture `profiles`) | Dérivent toujours de `auth.uid()`, jamais d'un paramètre client | Sûres |
| `handle_new_user()` (trigger `auth.users`) | Oui | Whitelist stricte du rôle (`intervenant`/`assistant` sinon `intervenant`) ; **depuis 20260709000001, ne crée plus de profil du tout si `organisation_id` absent/invalide des métadonnées — ne retombe plus jamais sur l'organisation `kaytek-inter` par défaut** (correctif du risque historique de rattachement accidentel à l'organisation de production) | Sûre, correctement durcie |
| `protect_profile_sensitive_fields()` (trigger `profiles`) | Oui | Bloque explicitement la modification de `role`/`actif`/`organisation_id`/`commission_pct`/`can_create_documents`/`can_bypass_validation`/`type_intervenant` par un non-admin ; laisse passer si `auth.uid() IS NULL` (service_role) | Sûre — répond directement au scénario 9 |
| `get_internal_push_secret()` | Oui (lecture Vault) | `REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT ... TO service_role` uniquement | Sûre (SEC-06) |
| `trigger_push_on_notification()` | Oui (appel HTTP sortant) | Utilise le secret Vault + la clé anon publique (intentionnellement non secrète) | Sûre |
| `provision_subscriber_organisation()` / `seed_default_prestations_on_org_create()` | Oui | Court-circuite si déjà provisionné ; ne touche jamais un profil existant ; slug unique par `user_id` | Sûre |
| `search_partner_profiles()` | Oui | N'expose jamais email/téléphone/slug/plan ; recherche par email restreinte aux admins actifs ; ne retourne jamais le profil de l'appelant lui-même dans les branches email/code | Sûre |
| `respond_to_partner_intervention_request()` | Oui | Revalide identité, rôle admin, organisation cible, statut `pending`, motif de refus obligatoire ; masque les colonnes confidentielles si refus | Sûre |
| `get_partner_requests_preview()` | Oui | Restreint à `target_organisation_id = current_org_id()` et statut `pending`/`refused`, masque les colonnes selon `share_description`/`share_montant` | Sûre — mais **n'est pas le problème** ; le problème est l'accès direct à la table via `pir_select` (RLS-01), qui contourne cette RPC pensée pour limiter l'exposition |
| `claim_founder_seat()` | Oui | **Historiquement appelable par `anon` et `authenticated` sans aucune vérification d'identité ni de souscription Stripe réelle** — corrigé le 2026-07-11 (`REVOKE EXECUTE ... FROM anon, authenticated`), restreint à `service_role` uniquement désormais | Sûre depuis le correctif (STRIPE-03) ; note : casse volontairement l'appel actuel du site externe kaytekinter.fr tant qu'il n'est pas mis à jour pour utiliser une clé service_role — dépendance externe non vérifiable depuis ce dépôt |

Aucune fonction `SECURITY DEFINER` acceptant un `organisation_id` ou un `user_id` arbitraire du client sans le revalider contre `auth.uid()`/`current_org_id()` n'a été trouvée dans le périmètre lu.

---

## 6. Scénarios évalués

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Modifier `organisation_id` dans une requête | **Bloqué** | Tous les `WITH CHECK` des tables métier imposent `organisation_id = current_org_id()`, jamais la valeur envoyée par le client |
| 2 | Lire un devis d'une autre organisation | **Bloqué** | `devis_select` : `is_same_org(organisation_id)` obligatoire |
| 3 | Modifier une facture d'une autre organisation | **Bloqué** | `factures_update` : `is_same_org` + `is_admin_in_org`, org re-dérivée serveur |
| 4 | Télécharger une photo d'une autre organisation | **Bloqué** | `intervention_photos_select` : jointure vers `photos.organisation_id = current_org_id()` |
| 5 | Voir les utilisateurs d'une autre organisation | **Bloqué** | `profiles_select` : `is_same_org(organisation_id)` uniquement |
| 6 | Accéder aux commissions d'une autre organisation | **Bloqué** | `commissions_select` : `is_same_org` + rôle |
| 7 | Appeler une RPC avec un identifiant externe | **Bloqué dans les cas vérifiés** | Toutes les RPC lues re-dérivent `current_org_id()`/`auth.uid()` en interne ; aucune n'accepte d'org/uid client brut sans revalidation |
| 8 | Créer une ligne dans une autre organisation | **Bloqué** | Mêmes `WITH CHECK` que le scénario 1 |
| 9 | Modifier son propre rôle | **Bloqué (double protection)** | Policy `profiles_update` (org+soi/admin) **et** trigger `protect_profile_sensitive_fields` qui lève une exception explicite si un non-admin tente de changer `role` |
| 10 | Lire les messages d'une autre organisation | **Bloqué** (messagerie interne) / **Limité aux 2 organisations partenaires liées** (messagerie partenaire, admin uniquement) | `messages_select` : `is_same_org` ; `partner_messages_select` : `is_connection_member` + `is_admin_in_org` |

**Nuance importante** : le scénario le plus proche d'un résultat positif dans cette liste est indirect — ce n'est pas une lecture *cross-tenant arbitraire*, mais la lecture par un **rôle non-admin** de données **inter-organisations déjà en relation** via `partner_intervention_requests` (RLS-01), qui n'était pas explicitement dans la liste des 10 scénarios mais relève directement du même principe (contrôle de rôle au niveau RLS).

---

## 7. Éléments non vérifiables dans cette phase

- **Aucune requête n'a été exécutée contre la base réelle** : toutes les conclusions viennent de la lecture des fichiers de migration, en reconstituant l'état final policy par policy. Il est possible qu'un changement appliqué directement en production (Dashboard Supabase) et jamais capturé dans une migration existe et ne soit pas visible ici — RLS-02 montre que ce cas s'est déjà produit une fois.
- `guide_videos` et `guide_news` : RLS confirmée activée et 4 policies chacune, mais le contenu exact des conditions `USING`/`WITH CHECK` n'a pas été lu en détail (priorité basse, contenu non sensible — vidéos/actus pédagogiques internes).
- `founder_seats` : table créée hors dépôt par l'intégration Stripe externe (comme `subscriptions`/`stripe_webhook_events` avant leur documentation a posteriori) — seules les `REVOKE` sont visibles dans les migrations, la définition complète des policies (notamment `founder_seats_select_public`) n'a pas pu être lue.
- Statut réel des 11 policies orphelines (RLS-02) : confirmé supprimées par migration, mais impossible de vérifier depuis ce dépôt qu'elles n'ont pas été recréées depuis hors version control.
- Comportement réel de Postgres/Supabase Realtime vis-à-vis des policies (`messages`, `partner_messages` avec `REPLICA IDENTITY FULL`) : les commentaires des migrations affirment leur compatibilité avec le filtrage RLS, non testé dynamiquement ici.
- Tests automatisés `tests/multi-tenant/01-isolation.spec.ts` et `02-isolation-create.spec.ts` (repérés en phase 1) : non exécutés dans cette phase (règle : aucune commande de test/build) — ils couvrent probablement une partie de ces scénarios en conditions réelles et pourraient confirmer ou nuancer ces constats.
- Edge Functions autres que `get-public-document` (`envoyer-email`, `inviter-intervenant`, `send-push`, `send-reminders`, `send-telegram`, `supprimer-utilisateur`) : hors périmètre strict de cette phase, réservées à la phase 4.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
