# Phase 11 — RGPD, logs et observabilité

*Cet audit est technique et ne constitue pas un avis juridique définitif.*

Date de l'analyse : 2026-07-21
Méthode : lecture de `src/pages/ConfidentialitePage.tsx` (politique de confidentialité affichée aux utilisateurs) et `DeleteAccountPage.tsx`, croisement systématique avec les constats déjà établis dans les phases 1 à 10 (schéma de données, Edge Functions, logs, tests) sans les répéter en détail. Recherche ciblée sur la présence de code de suivi d'erreurs/monitoring, sur les mécanismes de purge/rétention automatisée, et sur le contenu réel du dossier `backup/` versionné (pour vérifier s'il contient des données personnelles réelles ou uniquement du code/schéma).

---

## Résumé

L'écart le plus significatif de cette phase est **entre ce que la politique de confidentialité promet aux utilisateurs et ce que le code implémente réellement** : une durée de conservation de 12 mois est annoncée pour les "logs d'activité", mais **aucun mécanisme de purge automatique n'existe** (et le journal d'audit lui-même n'est jamais alimenté par aucun code trouvé dans ce dépôt, cf. §1.7). La politique liste Supabase comme hébergeur mais **ne mentionne ni Brevo (envoi d'emails) ni Stripe (paiement)** comme destinataires/sous-traitants, alors que les deux traitent des données personnelles réelles (adresses email, contenu de messages, données de facturation) d'après les phases 4 et 7. Par ailleurs, **aucun outil de suivi d'erreurs, de monitoring ou d'alerting n'existe** dans ce dépôt — la seule observabilité disponible est celle, non structurée, des logs bruts de la console navigateur et du Dashboard Supabase.

Point rassurant vérifié : le dossier `backup/backup-2026-06-10/` versionné dans git (déjà signalé phase 1 comme un doublon de code à nettoyer) **ne contient aucune donnée personnelle réelle** — uniquement du code source, du schéma SQL (DDL) et des fichiers Markdown descriptifs, pas de dump de données clients/utilisateurs.

---

## 1. RGPD technique

### 1.1 Inventaire des données personnelles par catégorie

| Catégorie | Table/emplacement | Données personnelles concernées | Base légale probable (non tranchée juridiquement) |
|---|---|---|---|
| Utilisateurs (comptes internes) | `profiles` | email, nom, prénom, téléphone, rôle, `commission_pct`, `telegram_chat_id` | Exécution du contrat de travail/mandat |
| Clients finaux | `clients` | nom, prénom, raison sociale, téléphone, email, adresse d'intervention, adresse de facturation, notes internes | Exécution du contrat de prestation |
| Photos | Storage `intervention-photos` + table `photos` | photos de chantier, potentiellement identifiantes (lieux, plaques, personnes visibles accidentellement) | Exécution du contrat / preuve d'intervention |
| Signatures | Storage `signatures` + `devis.signature_client`/`signature_url` | signature manuscrite numérisée du client, nom du signataire (`signe_par`) | Consentement contractuel (acceptation devis) |
| Messages | `messages` | contenu textuel, fichiers/vocaux (`media_url`), horodatage lecture | Fonctionnement du service (coordination interne) |
| Vocaux | Storage `chat-media` | enregistrements audio (voix, donc donnée biométrique au sens large selon interprétation, à qualifier juridiquement) | Fonctionnement du service |
| Documents (devis/factures) | `devis`, `factures`, `document_public_links` | données de facturation du client, montants, coordonnées bancaires de l'entreprise (IBAN/BIC, cf. phase 3) | Obligation légale (facturation) + contrat |
| Journal d'audit | `journal` | `user_id`, `user_nom`, description d'action, `old_value`/`new_value` (JSON, potentiellement des données personnelles en clair selon la table concernée) | Intérêt légitime (sécurité/traçabilité) |
| Appareils | `devices` | `nom_appareil`, navigateur, OS, `adresse_ip` (colonne existante mais **jamais alimentée**, cf. §1.9) | Sécurité (limitation d'appareils) |
| Données Stripe | `subscriptions` (documentée a posteriori, cf. phase 7) | `email`, `stripe_customer_id`, `stripe_subscription_id`, plan | Exécution du contrat d'abonnement |
| Données Brevo | Aucune table locale — transmises à l'API Brevo à chaque envoi (`envoyer-email`, `inviter-intervenant`, cf. phase 4) | adresse email destinataire, contenu HTML de l'email, pièce jointe PDF (devis/facture) | Exécution du contrat |
| Notifications | `notifications`, `push_subscriptions` | titre/contenu de notification (peut contenir nom de client, adresse d'intervention), endpoint push (identifiant d'appareil) | Fonctionnement du service |

### 1.2 Adresses IP

- Colonne `devices.adresse_ip` existe dans le schéma depuis la toute première migration (`20260605000006_devices_security.sql`) et figure dans le type TypeScript `DeviceRecord` (`src/lib/devices.ts`), mais **aucun code — ni frontend, ni Edge Function — ne l'alimente jamais** (`registerDevice()` n'inclut pas ce champ dans son payload d'insertion, confirmé par relecture). La colonne reste donc systématiquement `NULL` en pratique. Pas un risque de fuite (rien n'est collecté), mais un exemple de fonctionnalité de sécurité présumée (capture d'IP pour audit/détection d'anomalie) jamais réellement implémentée.
- Aucune autre capture d'adresse IP applicative n'a été trouvée (les IP des requêtes existent nécessairement au niveau infrastructure — logs Vercel/Supabase — mais ne sont pas gérées par le code de ce dépôt).

### 1.3 Durée de conservation — écart entre la politique affichée et le code

- **RGPD-01 — Rétention de 12 mois des "logs d'activité" annoncée mais non implémentée**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé
  - **Fichiers** : `src/pages/ConfidentialitePage.tsx:314` (*"Logs d'activité : conservés 12 mois"*), absence totale de mécanisme de purge dans `supabase/migrations/` et dans le code applicatif.
  - **Description** : la politique de confidentialité affichée aux utilisateurs annonce une conservation de 12 mois pour les logs d'activité (à comprendre comme la table `journal`, seul journal applicatif de ce type identifié). **Aucune tâche planifiée, trigger ou script de purge automatique n'existe** pour appliquer cette limite — cohérent avec l'absence générale de tâche planifiée déjà constatée en phase 4 (**FN-03**, `pg_cron` jamais activé) et en phase 5 (aucune contrainte de rétention sur `journal`). Sans purge automatique, les entrées, si elles existaient, s'accumuleraient indéfiniment au-delà de la promesse contractuelle/politique affichée.
  - **Aggravation** : recherche exhaustive dans `src/` — **aucun code n'insère jamais de ligne dans `journal`** (seule la policy RLS `journal_insert` autorisant l'écriture a été trouvée, jamais un appel `.from('journal').insert(...)` depuis l'application). Soit la table est alimentée par un mécanisme non versionné (créé hors migration, comme cela s'est déjà produit pour les policies Storage orphelines identifiées en phase 3, RLS-02), soit elle n'est en réalité jamais peuplée par le flux normal de l'application — dans les deux cas, un point à clarifier en priorité car il touche à la fois l'observabilité (§3) et la conformité de la politique affichée.
  - **Recommandation** : clarifier le mécanisme réel d'alimentation de `journal` (audit du Dashboard Supabase pour trouver un éventuel trigger non versionné), puis implémenter une purge automatique à 12 mois cohérente avec la politique affichée (ex. `pg_cron` quotidien, `DELETE FROM journal WHERE created_at < now() - interval '12 months'`).
  - **Statut** : Vérifié pour l'absence de purge et l'absence de code d'écriture applicatif ; non vérifié si un mécanisme d'écriture existe hors dépôt (Dashboard Supabase).
- Les autres durées annoncées (comptes actifs, documents comptables 10 ans, photos jusqu'à suppression explicite, messages tant que les utilisateurs sont actifs) sont cohérentes avec l'absence générale de purge automatique observée dans tout le projet — aucune de ces catégories n'a de mécanisme d'expiration technique, ce qui est **conforme** à des politiques de type "conservé tant que..." (pas de contradiction), à la différence du cas des logs ci-dessus qui annonce une limite chiffrée précise (12 mois) non appliquée.

### 1.4 Suppression d'un compte

- Processus documenté et cohérent entre `ConfidentialitePage.tsx` et `DeleteAccountPage.tsx` : demande manuelle par email, traitement sous 30 jours (déjà analysé phase 2).
- **Risque technique déjà identifié (phase 5, DB-01)** : la suppression réelle d'un profil ayant une activité (intervention assignée, devis créé, message envoyé, etc.) échouerait probablement avec une erreur de contrainte de clé étrangère (`ON DELETE` non défini sur la plupart des tables métier référençant `profiles`). Ce constat technique **contredit potentiellement l'engagement de traitement sous 30 jours** annoncé dans la politique de confidentialité : si la suppression physique échoue silencieusement ou nécessite une intervention manuelle en base non documentée, le délai de 30 jours peut ne pas être tenable tel quel pour un compte ayant une activité significative.
- **Suppression d'une organisation** : **aucun flux, ni frontend ni Edge Function, ne permet de supprimer une organisation entière** (recherche exhaustive : aucun `DELETE FROM organisations` ni RPC dédiée trouvés). Les FK `organisation_id → organisations(id)` sont systématiquement en `ON DELETE RESTRICT` (phase 5) — une organisation ne peut structurellement pas être supprimée tant qu'elle a des données liées (ce qui est presque toujours le cas). Si un client demande la suppression complète de son organisation (et pas seulement de son compte individuel), **aucun mécanisme technique de ce dépôt ne permet d'y répondre** au-delà d'une intervention manuelle en base de données par un opérateur ayant un accès direct à Supabase.

### 1.5 Export / portabilité des données

- La politique affiche un "Droit à la portabilité" (*"Recevoir vos données dans un format structuré et lisible par machine"*) — mais **aucune fonctionnalité d'export des données personnelles d'un utilisateur ou d'un client n'existe dans l'application** (l'export Excel existant, cf. phases 1/9, exporte des données métier agrégées pour l'organisation — pas un export individuel au format portabilité RGPD pour une personne concernée). Comme pour la suppression, ce droit semble géré uniquement par le canal manuel (email, 30 jours), ce qui est une pratique possible mais non outillée techniquement.

### 1.6 Données orphelines

- Plusieurs commentaires de code font explicitement référence à un nettoyage de "notifications orphelines" *"géré côté DB par un trigger"* (`useDeleteIntervention`, `useDeleteDevis`, `src/lib/hooks/index.ts`) — un mécanisme de nettoyage en cascade existe donc pour les notifications liées à une entité supprimée, cohérent avec la migration `20260713000001_notifications_cascade_cleanup.sql` repérée en phase 1.
- En revanche, **aucun mécanisme équivalent n'a été trouvé pour d'autres données potentiellement orphelines** : un fichier Storage (`intervention-photos`, `signatures`, `chat-media`) dont la ligne DB correspondante (`photos`, `devis.signature_url`, `messages.media_url`) aurait été supprimée resterait indéfiniment dans le bucket, sans job de nettoyage périodique identifié (au-delà de la suppression explicite associée, ex. `useDeleteMessage` qui supprime bien le fichier `chat-media` lié — mais rien d'équivalent systématique pour les photos d'intervention en cas de suppression d'intervention, où seule la ligne DB est cascadée, cf. `photos ON DELETE CASCADE`, sans confirmation que le fichier Storage physique est lui-même supprimé en parallèle).

### 1.7 Sauvegardes

- **Dossier `backup/backup-2026-06-10/` versionné dans git** (déjà signalé phase 1) : **vérifié dans cette phase — ne contient aucune donnée personnelle réelle**, uniquement du code source dupliqué, du schéma SQL (DDL, structure de tables sans lignes de données), et des fichiers Markdown descriptifs (`backup-report.md`, `database-summary.md`, `project-inventory.md`, `restore-guide.md`). Ce n'est donc **pas** un incident de fuite de données personnelles, seulement une redondance de code à nettoyer (déjà couvert phase 1).
- Aucune information sur la politique de sauvegarde réelle de la base Supabase de production (fréquence, durée de rétention des backups automatiques Supabase, chiffrement au repos) n'est présente dans ce dépôt — dépend entièrement de la configuration du projet Supabase (Dashboard), non versionnée.

### 1.8 Accès administrateur

- Un admin d'organisation a accès, par construction du modèle métier, à l'ensemble des données personnelles de son organisation (clients, profils des employés, IBAN/BIC de l'entreprise, photos, messages internes non destinés à lui dans certains cas — cf. `messages_select` policy qui inclut `is_admin_in_org`, phase 3). C'est un accès large mais cohérent avec le rôle d'administrateur d'un outil de gestion d'entreprise ; aucun contrôle supplémentaire (double validation, alerte sur consultation massive) n'existe au-delà de la RLS standard.
- Le journal d'audit, censé tracer ces accès/actions, présente les limites déjà décrites (DB-03 phase 5 : un admin peut modifier/supprimer ce journal ; §1.3/1.6 ci-dessus : mécanisme d'alimentation incertain).

### 1.9 Minimisation des données

- Globalement raisonnable : les champs collectés (nom, coordonnées, adresse d'intervention) sont directement nécessaires à l'activité de dépannage/serrurerie facturée.
- Écarts mineurs : `devices.adresse_ip` collecté par conception mais jamais rempli (§1.2) — champ à retirer si non utilisé, ou à documenter/implémenter s'il est destiné à un usage de sécurité futur ; `clients.notes_internes` (texte libre) pourrait contenir des données sensibles saisies librement par un intervenant/admin sans contrôle de contenu, un risque de minimisation classique des champs "notes libres".

### 1.10 Sous-traitants non mentionnés dans la politique de confidentialité

- **RGPD-02 — Brevo et Stripe ne sont pas cités comme destinataires/sous-traitants dans la politique de confidentialité**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé
  - **Description** : `ConfidentialitePage.tsx` ne cite explicitement que **Supabase** comme prestataire d'hébergement (avec mention RGPD/SOC 2), et affirme : *"Les données ne sont pas revendues, partagées ou transmises à des tiers à des fins commerciales ou publicitaires"* et *"Les messages ne sont ni analysés ni transmis à des tiers."* Or, d'après les phases 4 et 7 : **Brevo** reçoit systématiquement l'adresse email du destinataire, le contenu HTML complet de l'email et la pièce jointe PDF (devis/facture) à chaque envoi (`envoyer-email`, `inviter-intervenant`) ; **Stripe** (ou l'application externe qui l'intègre) traite nécessairement des données de facturation/paiement liées au compte de l'organisation cliente (email, montants, potentiellement des moyens de paiement). Ni l'un ni l'autre n'est nommé dans la section "sous-traitants"/hébergement de la politique.
  - **Nuance** : l'affirmation "transmis à des tiers à des fins commerciales ou publicitaires" reste probablement exacte au sens strict (Brevo/Stripe ne sont pas des tiers publicitaires, ce sont des sous-traitants techniques nécessaires au service) — mais l'absence de mention nominative de ces sous-traitants dans la politique est un écart de transparence au regard des articles 13/14 du RGPD (information sur les destinataires des données), qui va au-delà d'une simple imprécision rédactionnelle puisque des données personnelles réelles (email, contenu de documents facturés) transitent effectivement par ces services.
  - **Recommandation** : compléter la section de la politique de confidentialité listant les sous-traitants (Supabase, Brevo, Stripe, et l'hébergeur frontend Vercel) avec leur rôle respectif, à valider avec un conseil juridique (hors périmètre technique de cet audit).
  - **Statut** : Vérifié par lecture directe de `ConfidentialitePage.tsx` et recoupement avec les phases 4 et 7.

---

## 2. Logs

- **Volume** : 48 occurrences de `console.log` dans `src/` (phase 9), dont une majorité identifiée en phase 2 (**SEC2-11**) sur le flux d'authentification/verrouillage.
- **Données personnelles dans les logs** :
  - `inviter-intervenant` (Edge Function, phase 4, **FN-02**) : logs `[DBG]` incluant email, nom, prénom, rôle, `organisation_id` en clair dans les logs Supabase Edge Functions.
  - `send-push` (Edge Function, phase 4) : logs le titre et le contenu complet de chaque notification (`console.log('[send-push]... titre: "${titre}" | contenu: "${contenu}"...')`) — peut inclure un nom de client ou une adresse d'intervention selon le contenu de la notification.
  - `src/lib/devices.ts`/`hooks/index.ts` : logs d'IDs (`user_id`, `device_id`) et d'erreurs, sans contenu de message ou de document.
  - `LockScreen.tsx` (phase 2) : logue l'email de l'utilisateur lors des tentatives de déverrouillage (`console.log('[LockScreen] tentative mot de passe pour', user.email)`).
- **Tokens/secrets** : **aucun secret d'infrastructure (clé API, mot de passe, token complet) trouvé en clair dans un log applicatif**, confirmé exhaustivement en phase 4 (**FN-02/FN-06**) — seule de la PII (email, nom) apparaît, jamais de secret technique. Rappel distinct (non un "log" au sens strict) : les fichiers `guide/.auth/*.json` (phase 1/2) contiennent bien des jetons de session réels commités dans git — à traiter comme une exposition de secret, déjà signalée.
- **Corps de requêtes** : les Edge Functions loguent des extraits structurés du payload reçu (ex. `send-push` logue `user_id`/`titre`/`contenu`/`lien` du corps de la requête) plutôt que le corps brut intégral — limite un peu l'exposition mais reste des données personnelles en clair dans des logs non chiffrés/non expurgés.
- **Données de facture dans les logs** : aucune occurrence de montant, numéro de facture ou IBAN trouvée dans un `console.log`/`console.error` — les logs identifiés concernent des identifiants et du texte de notification, pas directement des données financières détaillées.
- **Recommandation générale** : retirer les logs de debug `[DBG]` et les logs verbeux de contenu de notification identifiés en phases 2/4, ou les conditionner à un flag d'environnement de développement, en particulier côté Edge Functions dont les logs sont conservés par Supabase indépendamment du cycle de vie applicatif.

---

## 3. Observabilité

### Suivi des erreurs et monitoring

- **RGPD/OBS-01 — Aucun outil de suivi d'erreurs ni de monitoring applicatif**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé
  - **Description** : aucune dépendance de type Sentry, LogRocket, Datadog, ou équivalent n'est présente dans `package.json` (vérifié phases 1 et 9). Aucun code d'instrumentation (`window.onerror`, `ErrorBoundary` avec remontée externe, intercepteur d'erreurs React Query centralisé au-delà des toasts locaux) n'a été trouvé. La seule "observabilité" frontend disponible est :
    - les toasts d'erreur affichés localement à l'utilisateur (`useToastStore`), non persistés ni remontés à l'équipe technique ;
    - les `console.error`/`console.log` visibles uniquement en ouvrant les DevTools d'un navigateur ou (pour les Edge Functions) le Dashboard Supabase.
  - **Impact** : aucune alerte proactive en cas d'erreur récurrente en production (ex. un pic d'échecs de connexion, une Edge Function qui échoue systématiquement, une erreur JavaScript bloquant une page pour tous les utilisateurs d'une organisation) — la détection dépend entièrement d'un signalement utilisateur ou d'une consultation manuelle et périodique des logs Supabase.
  - **Recommandation** : intégrer un outil de suivi d'erreurs frontend (Sentry ou équivalent, avec attention à ne pas y envoyer de PII non nécessaire — cf. §2) et mettre en place une alerte basique sur les taux d'erreur des Edge Functions (les logs Supabase permettent généralement un export/alerting basique déjà disponible côté plateforme, non configuré ici à notre connaissance).
  - **Statut** : Vérifié par absence de dépendance et de code d'instrumentation.

### Erreurs frontend / backend

- Frontend : gérées au cas par cas via `try/catch` + toast (`useToastStore.add(message, 'error')`) dans la quasi-totalité des mutations observées dans les phases précédentes — cohérent et prévisible pour l'utilisateur final, mais sans trace persistante côté équipe technique (cf. ci-dessus).
- Backend (Edge Functions) : `console.error` systématique en cas d'erreur (phase 4), visible uniquement via le Dashboard Supabase — pas d'alerting automatique identifié.

### Erreurs Stripe

- **Non vérifiable** (code externe, cf. phase 7) — la table `stripe_webhook_events` existe (deny-all RLS) et pourrait servir de trace d'audit des événements reçus, mais son alimentation et son exploitation pour la détection d'erreurs dépendent du code externe non présent ici.

### Erreurs e-mail (Brevo)

- `envoyer-email`/`inviter-intervenant` renvoient l'erreur Brevo au frontend (message affiché à l'utilisateur qui a déclenché l'envoi) — pas de re-tentative automatique, pas de file d'attente de retry, pas de traçabilité centralisée des échecs d'envoi au-delà de ce que Brevo lui-même journalise côté tiers (non vérifiable depuis ce dépôt).

### Erreurs push

- `send-push` (phase 4) gère explicitement les codes d'erreur `404`/`410` (souscription expirée → suppression automatique) et loggue les erreurs `401`/`403` (clés VAPID invalides) — la gestion technique est correcte, mais reste uniquement visible dans les logs Supabase, sans alerte proactive si, par exemple, la totalité des envois échouaient soudainement (clé VAPID expirée en production).

### Échecs de rappels

- `send-reminders` (phase 4/10) logue ses erreurs via `console.error` et **continue l'exécution** (`continue` dans la boucle) plutôt que d'interrompre tout le traitement pour une fenêtre en erreur — bon comportement défensif. Mais combiné à l'absence de déclenchement planifié réel (**FN-03**), un échec de rappel n'est de toute façon visible que si un admin consulte les logs après avoir cliqué manuellement sur "Vérifier les rappels" — aucune alerte si la fonctionnalité entière cesse de fonctionner silencieusement.

### Audit trail et traçabilité des actions critiques

- Couvert en détail §1.3/1.6 ci-dessus et **DB-03** (phase 5) : le mécanisme d'alimentation réel de la table `journal` n'a pas pu être confirmé dans le code de ce dépôt, sa garantie d'immuabilité a été affaiblie par une migration ultérieure (admin peut modifier/supprimer), et aucune purge automatique n'applique la rétention de 12 mois annoncée aux utilisateurs.
- Aucune action critique identifiée dans les phases précédentes (changement de rôle, désactivation de compte, suppression d'utilisateur, modification de paramètres sensibles comme l'IBAN) n'a de garantie que le journal capture systématiquement ces événements de façon fiable, en l'absence de triggers `AFTER INSERT/UPDATE/DELETE` dédiés sur les tables sensibles (`profiles`, `parametres_entreprise`) — si le journal dépend d'un appel explicite côté frontend (non confirmé) plutôt que d'un trigger serveur, un appel API direct contournant l'UI (déjà un thème récurrent de cet audit, phases 2-4) ne laisserait aucune trace dans `journal`.

---

## 4. Éléments non vérifiables dans cette phase

- Le mécanisme réel d'alimentation de la table `journal` (trigger non versionné possible, cf. le précédent des policies Storage orphelines en phase 3) — nécessiterait un accès direct au Dashboard Supabase pour lister les triggers réellement actifs en production.
- La politique de sauvegarde réelle de la base Supabase de production (fréquence, chiffrement, durée de rétention) — configuration de plateforme, non versionnée dans ce dépôt.
- Le contenu exact des accords de sous-traitance (DPA) éventuellement signés avec Supabase/Brevo/Stripe — hors périmètre technique et hors accès de cet audit.
- Le comportement réel d'une demande de suppression de compte/organisation traitée manuellement par l'équipe support (processus humain, non observable depuis le code).
- L'existence éventuelle d'un outil de monitoring configuré en dehors de ce dépôt (ex. au niveau de l'infrastructure Vercel/Supabase elle-même, sans dépendance npm associée) — non détectable par la seule lecture du code source.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
