# Phase 6 — Audit fonctionnel

Date de l'analyse : 2026-07-21
Méthode : lecture du code (pages `src/pages/*.tsx`, logique métier centralisée dans `src/lib/hooks/index.ts` et `src/lib/hooks/partners.ts`), recensement des titres de tests Playwright existants (`tests/e2e`, `tests/multi-tenant`, `tests/responsive`, `tests/beta`) pour établir la couverture. Aucun test n'a été exécuté (l'énoncé autorisait des tests non destructifs déjà configurés, mais aucune exécution n'était nécessaire pour établir les constats ci-dessous à partir du code et de l'inventaire des specs). Aucune correction appliquée. Cette phase recoupe les phases précédentes sans répéter leurs constats (référencés par leur identifiant : SEC2-xx, RLS-xx, DB-xx, FN-xx).

---

## Résumé

Deux anomalies fonctionnelles concrètes et à fort impact utilisateur ont été identifiées :

1. **Un devis avec une remise supérieure à ~9-17 % (selon le taux de TVA) produit un montant de TVA négatif**, aussi bien à l'écran que sur le PDF envoyé au client — bug de calcul reproductible à coup sûr, non couvert par les tests existants.
2. **Le widget "Commissions à payer" du tableau de bord et la page Commissions elle-même affichent deux montants différents** pour la même donnée dès qu'un coût de matériel est confirmé sur une intervention — deux chemins de calcul distincts (trigger DB historique vs recalcul frontend) coexistent sans être réconciliés.

Le reste de l'application est globalement bien structuré (archivage plutôt que suppression physique pour clients/interventions, garde-fous applicatifs sur la suppression avec données liées, protections de rôle cohérentes), mais plusieurs parcours (Planning, Commissions, Partenaires) n'ont aucune couverture de test automatisée.

---

## Utilisateurs

- **Statut** : Fonctionnel, avec des angles morts déjà identifiés en phases 4-5.
- **Fichiers** : `src/pages/UsersPage.tsx`, `src/lib/supabase/auth.ts` (`inviterIntervenant`, `supprimerUtilisateur`), `src/lib/devices.ts`, `supabase/functions/inviter-intervenant`, `supabase/functions/supprimer-utilisateur`.
- **Parcours couverts** : création/invitation (email Brevo + lien Supabase Auth), activation (`ActivationPage`), désactivation (`toggleActive` → `actif: false`), changement de rôle et de commission (`useUpdateProfile`), suppression (confirmation puis `supprimerUtilisateur`), gestion des appareils (liste, révocation individuelle, reset complet).
- **Erreurs / cas limites** :
  - `handleDelete` (`UsersPage.tsx:101-112`) ne vérifie ni que la cible n'est pas l'appelant lui-même, ni qu'elle n'est pas le dernier admin actif — cf. **FN-04** (phase 4). En cas d'échec (très probable pour tout utilisateur ayant une activité, cf. **DB-01** phase 5 : FK sans `ON DELETE` vers `profiles`), l'erreur Postgres brute (ex. violation de contrainte `interventions_intervenant_id_fkey`) remonte telle quelle dans le toast d'erreur (`add(error, 'error')`), incompréhensible pour un admin.
  - `toggleActive` désactive un compte (`actif = false`) mais, comme établi en phase 2 (**SEC2-03**), rien ne déconnecte immédiatement une session déjà active de l'utilisateur désactivé — celui-ci garde l'usage de l'app jusqu'à expiration naturelle de sa session ou nouvelle vérification serveur.
  - Aucune limite ni confirmation supplémentaire sur le changement de rôle d'un utilisateur existant depuis `UsersPage` au-delà de la whitelist déjà en RLS (`is_admin_in_org`) — cohérent avec les policies vues en phase 3.
- **Risque** : Moyen (verrouillage opérationnel possible en cas de suppression malencontreuse, cf. FN-04/DB-01 ; expérience utilisateur dégradée par les messages d'erreur bruts).
- **Tests manquants** : aucun test Playwright ne couvre la suppression d'un utilisateur ayant une activité (devis/interventions liés), l'auto-suppression d'un admin, ni la tentative de suppression du dernier admin. Le test existant "suppression utilise ConfirmModal (pas window.confirm)" ne vérifie que l'UI de confirmation, pas le résultat métier.

---

## Clients

- **Statut** : Fonctionnel, absence de détection de doublons.
- **Fichiers** : `src/pages/ClientsPage.tsx`, `src/pages/ClientDetailPage.tsx`, `useClients`/`useCreateClient`/`useUpdateClient`/`useArchiveClient`/`useDeleteClientSafe` (`src/lib/hooks/index.ts:182-304`).
- **Parcours couverts** : création, modification, recherche (`ilike` sur nom/email/téléphone), archivage (au lieu de suppression directe), suppression "sécurisée" (`useDeleteClientSafe` vérifie l'absence de devis/factures/interventions liés avant d'autoriser un `DELETE` réel, sinon impose l'archivage), suppression groupée des clients déjà archivés.
- **Erreurs / cas limites** :
  - **Aucune détection de doublon** n'existe à la création d'un client (ni côté `useCreateClient`, ni dans `ClientsPage`/`ClientDetailPage`) — deux clients avec le même nom, téléphone ou email peuvent être créés sans avertissement. La seule détection de doublon trouvée dans tout le code (`useFindClientByPhone`, `src/lib/hooks/partners.ts:453-465`) est réservée au flux d'import d'une demande d'intervention partenaire, et se limite à une égalité exacte de téléphone (un numéro mal saisi ou un client sans téléphone ne serait pas détecté).
  - Recherche par `ilike` non normalisée (pas de retrait d'espaces/accents) — deux saisies légèrement différentes du même numéro de téléphone (espaces, points) ne matcheraient pas.
  - Le filtre archive/non-archive est appliqué **côté client** après récupération de tous les clients (`useClients`, ligne 190-194) plutôt que dans la requête Supabase — fonctionnellement correct mais transfère toute la table `clients` de l'organisation au navigateur à chaque chargement, même si seule une sous-partie (actifs ou archivés) est affichée ; point à surveiller en phase 9 (performances) pour les organisations à fort volume de clients.
- **Risque** : Faible-Moyen (doublons de fiches client possibles, pollution progressive des données, pas de perte de données).
- **Tests manquants** : aucun test ne couvre la création d'un client en doublon (comportement actuel : silencieusement autorisé), ni le comportement d'archivage/restauration.

---

## Devis

- **Statut** : ⚠️ **Bug de calcul confirmé** sur la combinaison remise + TVA.
- **Fichiers** : `src/pages/DevisFormPage.tsx`, `src/pages/DevisApercuPage.tsx`, `src/lib/pdf/generator.tsx`, `src/components/SignatureModal.tsx`, `useCreateDevis`/`useUpdateDevis`/`useDuplicateDevis`/`useDevisToFacture` (`src/lib/hooks/index.ts:610-774`).
- **FONC-01 — Montant de TVA négatif avec une remise significative**
  - **Gravité** : Élevée
  - **Confiance** : Confirmé (calcul rejoué manuellement)
  - **Fichier** : `src/pages/DevisFormPage.tsx:122-125`
  - **Description** : le total de chaque ligne est calculé TTC (HT × (1+TVA)), puis la remise est appliquée en pourcentage sur la **somme des TTC** (`remise = tot.ttc * remise_pct/100`), et le montant de TVA final est recalculé par différence : `tva = totalFinal - tot.ht` où `totalFinal = tot.ttc - remise`. Le HT stocké (`tot.ht`) n'est lui **jamais réduit** par la remise. Mathématiquement, dès que la remise dépasse `1 - 1/(1+tauxTVA)`, le `totalFinal` devient inférieur au HT non remisé, et la TVA calculée devient **négative**.
  - **Scénario reproductible** : devis à 10 % de TVA, 1000 € HT / 1100 € TTC. Une remise de 20 % donne `remise = 220`, `totalFinal = 880`, `tva = 880 - 1000 = -120 €`. Pour une TVA à 10 %, toute remise > 9,1 % déclenche ce cas ; pour une TVA à 20 %, le seuil est ~16,7 %.
  - **Propagation** : ce montant de TVA négatif est stocké tel quel dans `devis.tva_montant`, affiché sur l'écran de récapitulatif, rendu sur le PDF (`src/lib/pdf/generator.tsx:157-174`, composant `Totals`, sans aucun garde-fou), et **recopié tel quel** dans la facture lors de la transformation devis → facture (`useDevisToFacture`, `facturePayload.tva_montant: devis.tva_montant`) — donc également visible sur la facture finale envoyée/imprimée.
  - **Impact** : document commercial et fiscal incohérent envoyé au client final (mention "TVA : -120,00 €"), risque d'image et de non-conformité de facturation dès qu'une remise commerciale usuelle (10-20 %, très courante en serrurerie/dépannage) est appliquée.
  - **Recommandation** : appliquer la remise proportionnellement au HT et à la TVA (remise sur le HT, puis recalcul de la TVA sur le HT net), ou au minimum plafonner `tva` à 0 (`Math.max(0, tva)`) en attendant une refonte du calcul, et valider par un test automatisé couvrant plusieurs taux de remise/TVA.
  - **Statut** : Vérifié par relecture directe de la formule ; non exécuté dans un navigateur réel (règle de la phase : pas de correction, et aucun test dynamique n'était nécessaire pour confirmer un calcul arithmétique).
- **Autres parcours** :
  - **Prestations** : ajout depuis le catalogue (préremplissage prix/TVA) ou ligne manuelle — fonctionnel, recalcul correct ligne par ligne (`calc()`, `total_ht = quantite*prix_ht`, `total_ttc = total_ht*(1+tva_pct/100)`, arrondis à 2 décimales par ligne).
  - **Signature** : `SignatureModal` + passage `statut → 'accepte'` + horodatage — fonctionnel ; l'écran distingue bien devis déjà signé (`isSigned`) pour désactiver une re-signature accidentelle.
  - **PDF** : généré côté client (`@react-pdf/renderer`), mis en cache (`pdfCache`, invalidé explicitement quand une signature est ajoutée — `useUpdateDevis` ligne 653) — bonne pratique pour éviter un PDF signé périmé.
  - **Duplication** (`useDuplicateDevis`) : copie propre des champs pertinents, remet `statut: 'brouillon'` et une nouvelle échéance à 30 jours — cohérent.
  - **Transformation en facture** (`useDevisToFacture`) : vérifie qu'aucune facture n'existe déjà pour ce devis (évite la double-facturation), retry automatique sur conflit de numéro (`23505`, jusqu'à 3 tentatives) — bonne robustesse vis-à-vis de la numérotation concurrente (cf. **DB-02**, phase 5).
  - **Statuts** : `brouillon → en_attente_validation/envoyé → accepte/refuse/expire` — aucune validation serveur de la légalité d'une transition au-delà de ce que la policy RLS autorise déjà par rôle (cf. phase 3) ; l'UI ne propose que des transitions cohérentes mais un appel API direct pourrait forcer un statut incohérent (ex. repasser un devis "accepté" en "brouillon").
- **Risque** : Élevé (FONC-01) / Faible pour le reste.
- **Tests manquants** : le test existant "03 — Créer devis avec prestation (200€ HT → 240€ TTC)" ne couvre qu'un cas **sans remise** — aucun test ne couvre la combinaison remise + TVA, alors que c'est exactement la combinaison qui révèle FONC-01. Aucun test sur la duplication de devis, ni sur la transformation devis→facture en cas de double clic/appel concurrent.

---

## Factures

- **Statut** : Fonctionnel, hérite du bug FONC-01 par transformation.
- **Fichiers** : `src/pages/FacturesPage.tsx`, `useCreateFacture`/`useUpdateFacture`/`useDeleteFacture`/`useDeleteAllFactures` (`src/lib/hooks/index.ts:1009-1096`).
- **Parcours couverts** : création directe (intervenants avec `can_create_documents`) ou via transformation d'un devis, validation par un admin si le créateur n'a pas `can_bypass_validation` (statut `en_attente_validation` → `impayee`/`annulee`), enregistrement du paiement (mode + date), suppression (simple et groupée), retard de paiement calculé côté client (`date_echeance < now() && statut !== 'payee'`).
- **Erreurs / cas limites** :
  - Hérite de **FONC-01** pour toute facture issue d'un devis remisé.
  - `useUpdateFacture`/`useDeleteFacture` vérifient qu'au moins une ligne a été affectée (`if (!updated || updated.length === 0) throw ...`) — bon réflexe défensif face à un refus RLS silencieux (cf. le même pattern déjà vu pour `journal`/`clients`).
  - Aucune contrainte applicative n'empêche `acompte_recu > montant_ttc` (saisie manuelle non bornée) — cohérent avec l'absence de contrainte DB correspondante (**DB-04**, phase 5).
  - Suppression d'une facture déjà payée : possible côté UI (bouton de suppression visible indépendamment du statut dans le code lu), sans confirmation renforcée différente d'une facture impayée — à vérifier si c'est le comportement voulu (perte d'un justificatif de paiement).
- **Risque** : Moyen (propagation de FONC-01), Faible pour le reste.
- **Tests manquants** : aucun test ne couvre le calcul du retard de paiement, la saisie d'un acompte supérieur au montant total, ni la suppression d'une facture déjà payée.

---

## Interventions

- **Statut** : Fonctionnel.
- **Fichiers** : `src/pages/InterventionsPage.tsx`, `src/pages/InterventionDetailPage.tsx`, `useCreateIntervention`/`useUpdateIntervention`/`useDeleteIntervention`/`checkInterventionLinks`/`useUploadPhoto` (`src/lib/hooks/index.ts:371-583`).
- **Parcours couverts** : création (admin/assistant), affectation d'un intervenant (avec notifications ciblées : intervenant assigné + admins si créée/assignée par un assistant), changement de statut (`en_attente→accepte/refuse→en_cours→termine→facture`, plus `annule`), upload photos (avant/après/autre), compte-rendu (`saveCR`), confirmation du matériel utilisé (avec **reset automatique de la confirmation si le coût est modifié après coup** — bon garde-fou), accès restreint par rôle (intervenant : ses interventions assignées uniquement ; assistant : `can_manage_operations`).
- **Erreurs / cas limites** :
  - `updateStatut()` (`InterventionDetailPage.tsx:76-79`) transmet directement le statut choisi sans validation de la légalité de la transition — seule la RLS (organisation + rôle) protège l'écriture, aucune règle de séquence n'est vérifiée côté serveur (cohérent avec l'absence de machine à états trouvée en phase 5 pour cette table, à la différence de `partner_connections`/`partner_intervention_requests` qui, elles, ont un trigger dédié).
  - `checkInterventionLinks()` (ligne 546-561) existe pour avertir avant une suppression physique (comptage devis/factures/commissions/reçus/messages liés), mais `useDeleteIntervention()` lui-même ne l'appelle pas automatiquement — la vérification dépend de son intégration correcte côté UI avant confirmation ; si un flux d'appel l'oublie, l'utilisateur reçoit directement l'erreur de contrainte de clé étrangère brute de Postgres (même famille de problème que **DB-01**).
  - Notifications (`notifyUser`/`notifyAdmins`) systématiquement en `.catch(() => {})` ou try/catch silencieux — un échec d'envoi de notification (Telegram/push) ne bloque jamais l'action métier (bon choix), mais reste invisible à l'utilisateur si ça échoue systématiquement (pas de log ni de remontée visible en cas de mauvaise configuration Telegram, par exemple).
- **Risque** : Faible-Moyen.
- **Tests manquants** : aucun test ne couvre un changement de statut "illégal" (ex. `termine → en_attente`), ni la suppression d'une intervention ayant des devis/factures liés.

---

## Planning

- **Statut** : Fonctionnel pour l'affichage, absence de détection de chevauchement.
- **Fichiers** : `src/pages/PlanningPage.tsx` (FullCalendar).
- **Parcours couverts** : vues mois/semaine/jour/liste (FullCalendar standard), création/modification de RDV depuis le planning, filtres, adaptation mobile (toolbar réorganisée en 3 lignes), vérification des rappels (cf. **FN-03**, phase 4).
- **Erreurs / cas limites** :
  - **Aucune détection de chevauchement/double réservation** trouvée : ni `eventOverlap`/`selectOverlap` configurés sur `FullCalendar`, ni vérification applicative empêchant d'assigner un même intervenant à deux interventions se chevauchant dans le temps. Un admin peut planifier deux RDV simultanés pour le même intervenant sans avertissement.
  - Les rappels automatiques (24h/2h/30min) ne se déclenchent que si un admin ouvre la page (**FN-03**, déjà détaillé phase 4) — repris ici car directement observable depuis ce parcours fonctionnel : un planning "à jour" en apparence peut en réalité ne jamais avoir déclenché ses rappels si personne n'a ouvert `/planning` dans la fenêtre concernée.
- **Risque** : Moyen (double réservation d'un intervenant possible, aucune fonctionnalité ne l'empêche ni ne la signale).
- **Tests manquants** : seul un test générique "page planning accessible" existe — aucun test ne couvre la création d'un RDV, la détection (inexistante) de chevauchement, ni le déclenchement des rappels.

---

## Messagerie

- **Statut** : Fonctionnel.
- **Fichiers** : `src/pages/MessagingPage.tsx`, `useMessages`/`useSendMessage`/`useDeleteMessage`/`useConversations`/`useUnreadCount` (`src/lib/hooks/index.ts:1264-1564`).
- **Parcours couverts** : conversations (liste triée non-lus d'abord puis par date), texte, photo/audio (upload vers le bucket `chat-media`, URLs signées régénérées à la lecture), marquage lu automatique à l'ouverture, suppression d'un message (+ suppression du média associé dans Storage), notifications (Telegram en priorité, fallback push), badge non-lus en temps réel (Realtime `postgres_changes`).
- **Erreurs / cas limites** :
  - **Restriction de qui peut écrire à qui appliquée uniquement côté frontend** (`useSendMessage`, lignes 1320-1326 : intervenant → admin seulement, assistant → admin+intervenants) — comme déjà noté phase 3, la policy RLS `messages_insert` ne vérifie que l'appartenance à l'organisation du destinataire, jamais cette règle de paire de rôles. Un appel direct à l'API pourrait donc laisser un intervenant écrire à un autre intervenant, en contournement de la règle métier affichée.
  - Signed URLs `chat-media` à 604 800 secondes (7 jours) — cf. **RLS-06** (phase 3), repris ici car directement visible dans le code de ce parcours (`useMessages`, ligne 1287).
  - `useConversations` ne considère que les 300 messages les plus récents de l'utilisateur (tous contacts confondus) pour construire les aperçus/compteurs — pour un utilisateur très actif avec de nombreux contacts, un contact peu actif pourrait ne pas afficher son dernier message si celui-ci sort de cette fenêtre de 300 (cas limite mineur, pas de perte de données, juste un aperçu potentiellement manquant).
- **Risque** : Faible-Moyen (contournement de règle métier possible uniquement via appel API direct, pas via l'UI normale).
- **Tests manquants** : le test existant "envoyer un message texte" ne couvre pas les photos/audio, ni la règle de restriction par rôle (intervenant ne peut écrire qu'à l'admin) au niveau backend — seul le comportement UI est probable d'être couvert.

---

## Commissions

- **Statut** : ⚠️ **Incohérence de calcul confirmée entre deux écrans de l'application.**
- **Fichiers** : `src/pages/CommissionsPage.tsx`, `src/pages/DashboardPage.tsx`, `useCommissions`/`useCommissionsData`/`useUpdateCommission`/`useUpdateInterventionMateriel`/`useMarkCommissionReceived` (`src/lib/hooks/index.ts:1098-1237`), trigger DB `auto_commission()` (cf. phase 5).
- **FONC-02 — Le montant de commission affiché diffère entre le tableau de bord et la page Commissions**
  - **Gravité** : Élevée
  - **Confiance** : Confirmé (deux chemins de calcul distincts identifiés dans le code)
  - **Description** : il existe **deux mécanismes de calcul de commission totalement indépendants** :
    1. **Chemin historique (DB)** : le trigger `auto_commission()` (phase 5) insère une ligne dans la table `commissions` quand `interventions.statut` passe à `'termine'`, avec `commission_admin = ROUND(montant_ttc * pct / 100, 2)` — **sans jamais déduire le coût du matériel** (`cout_pieces`). C'est ce chemin qui alimente `useCommissions()` (`src/lib/hooks/index.ts:1099-1112`), **utilisé uniquement par `DashboardPage.tsx:27`** pour le widget "Commissions à payer" (`c.commission_admin`, ligne 164).
    2. **Chemin recalculé (frontend)** : `useCommissionsData()` (`src/lib/hooks/index.ts:1124-1218`), utilisé exclusivement par `CommissionsPage.tsx`, recalcule entièrement la commission à la volée à partir des **factures payées** jointes à l'intervention, en déduisant explicitement le coût du matériel si confirmé : `base = montant_ttc - cout_pieces` (si `materiel_confirme`), puis `commission_intervenant = base * pct / 100`.
    - **`useUpdateCommission()`** (marquer une ligne de la table `commissions` comme payée) n'est appelée **nulle part** dans le code applicatif (vérifié par recherche exhaustive) — la table `commissions` et son trigger semblent être un mécanisme devenu obsolète pour l'usage courant, remplacé par `useCommissionsData()` + `commission_receipts` (le "reçu" étant désormais suivi séparément via `useMarkCommissionReceived()`), **mais sans avoir été retiré du Dashboard**.
  - **Scénario reproductible** : dès qu'une intervention a un coût de matériel confirmé (`materiel_confirme = true`, `cout_pieces > 0`), le montant affiché sur `/dashboard` ("Commissions à payer", basé sur `commission_admin` brut) sera **supérieur** au montant réellement dû calculé et affiché sur `/commissions` (qui déduit le matériel). Un admin consultant les deux écrans verra deux chiffres différents pour ce qui devrait être la même donnée.
  - **Cas limite additionnel** : le trigger `auto_commission()` se déclenche sur le passage de l'intervention à `'termine'`, indépendamment de l'existence ou du paiement effectif d'une facture — une intervention marquée "terminée" sans facture payée générerait donc une ligne dans `commissions` (visible au Dashboard), alors que `useCommissionsData()` (basé sur les factures **payées**) ne l'inclurait pas tant qu'aucun paiement n'est enregistré. Inversement, une facture payée dont l'intervention liée n'a jamais été marquée "terminée" (ou dont le déclenchement du trigger aurait échoué) n'apparaîtrait jamais dans le widget Dashboard mais apparaîtrait bien sur `/commissions`.
  - **Impact** : confusion directe pour l'utilisateur final (chiffre de trésorerie/commission incohérent selon l'écran consulté), risque de décision business basée sur la mauvaise valeur.
  - **Recommandation** : unifier sur un seul chemin de calcul — idéalement faire calculer `useDashboard()` à partir de la même logique que `useCommissionsData()` (ou exposer cette dernière comme source unique de vérité), et statuer explicitement sur le devenir de la table `commissions`/du trigger `auto_commission()`/de `useUpdateCommission()` (les retirer si réellement obsolètes, ou les remettre en cohérence si un usage futur est prévu).
  - **Statut** : Vérifié par lecture croisée du code (`DashboardPage.tsx`, `CommissionsPage.tsx`, `hooks/index.ts`, migration `auto_commission()` phase 5) ; écart non mesuré en conditions réelles (pas d'accès à une base de données peuplée).
- **Autres parcours** :
  - **Filtres** : par intervenant (admin) ou implicite sur soi-même (intervenant) — fonctionnel.
  - **Arrondis** : `Math.round(x * 100) / 100` appliqué de façon cohérente dans `useCommissionsData()` — correct.
  - **Export** : aucun export dédié aux commissions trouvé dans les pages lues (l'export Excel général, cf. phase 1/9, n'a pas été vérifié spécifiquement pour les commissions dans cette phase).
  - **Droits** : `commissions_select`/`cr_select` RLS déjà vérifiées phase 3 (admin voit tout, intervenant voit les siennes) — cohérent avec ce qui est affiché ici.
- **Risque** : Élevé (FONC-02).
- **Tests manquants** : **aucun test Playwright ne couvre la page Commissions ni le calcul de commission** — absent de la liste complète des titres de tests recensés dans le dépôt. C'est le parcours fonctionnel le moins testé de l'application au regard de son impact financier direct.

---

## Partenaires

- **Statut** : Fonctionnel, bien protégé par la RLS à l'exception de la régression déjà identifiée.
- **Fichiers** : `src/pages/PartenairesPage.tsx`, `src/lib/hooks/partners.ts` (498 lignes).
- **Parcours couverts** : recherche d'un partenaire (`search_partner_profiles`, par code exact / email exact admin / recherche floue opt-in), invitation (`useSendPartnerRequest`), acceptation/refus (machine à états trigger + RPC `respond_to_partner_intervention_request` pour la variante "demande d'intervention"), visibilité opt-in (`visible_reseau`), masquage des données confidentielles tant qu'une demande n'est pas acceptée (aperçu contrôlé via `get_partner_requests_preview`, sans adresse/téléphone/nom client/photos), messagerie inter-organisations dédiée, historique d'événements.
- **Erreurs / cas limites** :
  - **Hérite de RLS-01** (phase 3) : la policy `pir_select` n'impose plus de vérification de rôle admin — un intervenant/assistant de l'organisation source pourrait lire directement (hors UI, via API) les données clients partagées de ses propres demandes envoyées, quel que soit leur statut. Le code frontend (`usePartnerInterventionRequests`) affirme explicitement dans ses commentaires que ce masquage est "vérifié côté DB" pour la dimension statut (ce qui est vrai) mais ne traite pas la dimension rôle (qui a régressé).
  - `useFindClientByPhone` (import d'une demande partenaire vers un client local) ne fait qu'une égalité exacte de téléphone dans l'organisation cible — cohérent avec le constat "Clients > doublons" ci-dessus : un client déjà existant sous une orthographe/numéro légèrement différent ne serait pas retrouvé, menant potentiellement à la création d'un doublon lors de l'import.
  - Aucune limite trouvée sur le nombre de demandes/invitations qu'une organisation peut envoyer (pas de rate-limiting applicatif), cohérent avec le constat général d'absence de limitation de débit déjà relevé en phase 4 pour d'autres flux (email).
- **Risque** : Moyen (hérite de RLS-01), Faible pour le reste.
- **Tests manquants** : **aucun test Playwright ne couvre le module Partenaires** (absent de la liste complète des titres recensés) — invitation, acceptation/refus, masquage par statut, et messagerie inter-organisations n'ont aucune couverture automatisée, alors que c'est l'un des modules avec la logique métier la plus complexe (machine à états, RPC dédiées, masquage conditionnel de colonnes).

---

## Synthèse des tests manquants les plus significatifs

| Parcours | Test le plus critique manquant |
|---|---|
| Devis | Remise + TVA combinées (aurait révélé FONC-01) |
| Commissions | Toute couverture — module entièrement non testé malgré FONC-02 |
| Partenaires | Toute couverture — module entièrement non testé |
| Planning | Chevauchement/double réservation d'un intervenant |
| Utilisateurs | Suppression d'un compte ayant une activité liée (devis/interventions) |
| Interventions | Transition de statut invalide / suppression avec données liées |
| Messagerie | Restriction d'envoi par paire de rôles au niveau backend (pas juste UI) |

---

## Éléments non vérifiables dans cette phase

- Comportement réel en conditions de production (aucune donnée réelle, aucun test dynamique exécuté).
- Ampleur réelle de l'écart Dashboard/CommissionsPage (FONC-02) sans jeu de données réel comportant des coûts de matériel confirmés.
- Export Excel appliqué spécifiquement aux commissions — non localisé dans le périmètre de fichiers lus pour cette phase (à couvrir en phase 9, performances/qualité du code, si pertinent).
- Comportement exact de `DevisApercuPage.tsx` (page d'aperçu dédiée, distincte de `DevisFormPage.tsx`) — non lue en détail dans cette phase, présumée cohérente avec `generator.tsx` (mêmes valeurs stockées affichées).
- Couverture précise des tests `tests/beta/*` (comptes bêta-testeurs) — titres recensés mais contenu non détaillé.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
