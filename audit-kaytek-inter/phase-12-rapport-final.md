# Phase 12 — Rapport final consolidé — Kaytek Inter

Date : 2026-07-22
Périmètre : consolidation des phases 1 à 11 (`audit-kaytek-inter/phase-01-cartographie.md` → `phase-11-rgpd-observabilite.md`). Aucune nouvelle analyse de code n'a été menée, sauf vérification ciblée d'une contradiction de référencement entre phases (identifiants **DB-04** utilisés de façon incohérente entre le rapport de la phase 5 et ses citations dans les phases 6, 7 et 9 — corrigé ici, voir note en §4). Ce document est la synthèse exécutive et technique destinée à trancher la décision de commercialisation ; il ne remplace pas la lecture des 11 rapports détaillés pour l'implémentation des correctifs.

*Rappel transversal valable pour tout ce rapport : il s'agit d'un audit technique, pas d'un avis juridique définitif (notamment sur les points RGPD et de conformité comptable).*

---

## 1. Résumé exécutif

### L'application est-elle prête pour la commercialisation ?

**Non, pas en l'état.** L'architecture de fond est saine (isolation multi-tenant par RLS globalement bien conçue, secrets correctement gérés, aucune injection trouvée, discipline de migration au-dessus de la moyenne), mais **6 anomalies bloquantes** empêchent une commercialisation responsable immédiate — deux bugs de calcul qui atteignent des documents envoyés aux clients finaux, un mécanisme de blocage d'abonnement contournable, une régression de sécurité confirmée sur le réseau partenaires, et un dispositif de test dont la suite la plus critique peut être ignorée sans que personne ne s'en aperçoive.

### Niveau de risque global

**Moyen-Élevé.** Aucune preuve d'une fuite de données actuellement exploitée entre deux entreprises clientes non liées (l'isolation cœur de métier — clients, devis, factures, interventions, profils — est correctement forcée côté serveur). Le risque se concentre sur : la fiabilité financière des documents produits (TVA, commissions), la solidité du modèle économique (abonnement contournable), une fuite de données circonscrite au réseau partenaires, et l'absence de garde-fous de test empêchant la récidive.

### Risques principaux

1. Un devis avec une remise commerciale usuelle (>9-17 % selon le taux de TVA) affiche un **montant de TVA négatif**, jusque sur le PDF envoyé au client et la facture qui en découle (**FONC-01**).
2. Le blocage d'accès pour abonnement expiré/annulé est **entièrement côté interface** — aucune policy RLS ne l'applique, l'accès aux données reste total via un appel API direct (**SEC2-01**).
3. Un intervenant/assistant peut lire les données clients partagées entre organisations partenaires, en contradiction avec un correctif de sécurité antérieur qui avait explicitement fermé cet accès (**RLS-01**, régression confirmée).
4. La numérotation des devis/factures/interventions est un **compteur global partagé entre toutes les entreprises** de la plateforme, non conforme aux exigences françaises de numérotation comptable continue par entité émettrice (**DB-02**).
5. Le tableau de bord et la page Commissions affichent **deux montants différents** pour la même donnée dès qu'un coût de matériel est confirmé (**FONC-02**).
6. La suite de tests d'isolation multi-tenant — la garantie commerciale n°1 d'un SaaS multi-tenant — est **désactivée par défaut** si une variable d'environnement optionnelle n'est pas renseignée (**TEST-01**).

### Points forts

- Isolation multi-tenant correctement forcée côté serveur sur toutes les tables métier cœur : aucun `WITH CHECK`/`USING` ne fait confiance à un `organisation_id` fourni par le client, tout est re-dérivé du JWT via des fonctions `SECURITY DEFINER`.
- Aucune injection SQL trouvée, aucun `dangerouslySetInnerHTML`, aucun secret d'infrastructure trouvé en clair dans le code ou les logs.
- Historique de durcissement de sécurité réel et documenté (SEC-01 à SEC-06, FE-01, STRIPE-03, RLS-02) — l'équipe a déjà mené plusieurs cycles d'audit et de correction avant celui-ci.
- Signatures de build Android et secrets Stripe/Supabase correctement externalisés hors du dépôt.
- Discipline de migration SQL au-dessus de la moyenne (vérifications post-migration systématiques, commentaires explicatifs).

### Conditions avant commercialisation

Les 6 anomalies bloquantes ci-dessus doivent être corrigées et vérifiées par un test de non-régression dédié (voir Plan de correction, Phase A) avant toute ouverture commerciale à de nouvelles entreprises clientes. Un cycle de re-test ciblé (pas un audit complet) est recommandé après correction.

---

## 2. Scores sur 100

| Domaine | Score | Justification synthétique |
|---|---|---|
| Sécurité | **62** | Fondations RLS solides, secrets bien gérés, mais gating d'abonnement contournable (SEC2-01), régression RLS-01, mots de passe faibles, jetons de session commités |
| Multi-tenant | **70** | Isolation cœur de métier vérifiée solide par relecture de code ; pénalisé par la régression RLS-01 (accès inter-rôle sur données partenaires) et la numérotation non scopée par organisation (DB-02) |
| Stabilité (fonctionnel) | **52** | Deux bugs de calcul confirmés et reproductibles atteignant des documents réels (FONC-01, FONC-02) ; reste de l'application fonctionnellement cohérent |
| Base de données | **60** | Types corrects, index organisation_id complets, mais FK sans `ON DELETE` (DB-01), numérotation globale (DB-02), audit trail altérable (DB-03), index de jointure manquants (DB-04), absence de contraintes de cohérence financière (DB-05) |
| Qualité du code | **55** | Pas de linter configuré, 278 usages de `any`, 4 dépendances mortes dont une avec vulnérabilité haute, mais aucun `@ts-ignore`, pas de TODO oublié, organisation globalement lisible |
| Performances | **50** | Aucune pagination sur les listes métier principales (risque réel à volume élevé par organisation), bundles PDF/Excel très lourds précachés intégralement ; code-splitting par route et cache React Query bien réglés |
| Tests | **42** | Bonne couverture e2e fonctionnelle de surface, mais zéro test unitaire, suite d'isolation multi-tenant désactivable par défaut, zéro test RLS direct, Edge Functions, PWA, Stripe ou Android réel |
| Facturation | **48** | Numérotation non conforme (DB-02), bug de TVA négative (FONC-01), condition de course sur la transformation devis→facture (FACT-02), fonctionnalité d'acompte non exploitable (FACT-01) |
| Stripe | **55** | Ce qui est vérifiable dans ce dépôt (RPC, trigger de provisioning, verrou anti double-provisioning, correctif `claim_founder_seat`) est solide ; le point le plus important — l'application réelle du blocage — est contournable (SEC2-01), et l'essentiel du traitement (webhook, Checkout, portail) est hors dépôt donc non audité |
| PWA et Android | **58** | Configuration PWA/Android globalement soignée (manifeste, purge de cache versionnée, signing externalisé), mais file d'attente hors ligne non câblée (PWA-01) et permission microphone Android manquante (Android-01) |
| Maintenabilité | **52** | Fichier de hooks unique de 1 671 lignes, plusieurs pages 800-950 lignes, duplication de patterns, absence de `supabase/config.toml`, mais nommage cohérent et pas de dette technique explicitement signalée (TODO) |
| Préparation production | **47** | Combine l'ensemble : bugs fonctionnels non détectés faute de tests, aucun monitoring/alerting, écarts entre politique de confidentialité et implémentation réelle, dispositif de test contournable |

*Ces scores reflètent un jugement d'audit qualitatif à partir des constats des 11 phases précédentes, pas une mesure automatisée normée.*

---

## 3. Anomalies bloquantes

Anomalies empêchant raisonnablement une commercialisation en l'état, avant correction et re-test :

| ID | Anomalie | Pourquoi c'est bloquant |
|---|---|---|
| **FONC-01** | Montant de TVA négatif sur un devis/facture avec remise significative, visible sur le PDF envoyé au client | Document commercial et fiscal incorrect livré à un vrai client dès le premier usage d'une remise usuelle (10-20 %) |
| **DB-02** | Numérotation des devis/factures/interventions partagée globalement entre toutes les organisations, non scopée par entreprise | Non-conformité potentielle à l'exigence française de numérotation comptable continue par entité émettrice, dès la première entreprise cliente facturant réellement |
| **SEC2-01** | Le blocage d'accès pour abonnement expiré/annulé n'est appliqué qu'au niveau interface, jamais par la RLS | Le modèle économique payant est techniquement contournable par quiconque n'utilise pas l'interface officielle avec un JWT déjà valide |
| **RLS-01** | Régression RLS : un intervenant/assistant non-admin peut lire les données clients partagées via le réseau partenaires | Exposition confirmée de données personnelles de clients finaux à des rôles qui ne devraient pas y avoir accès, en contradiction avec un correctif de sécurité déjà appliqué puis défait |
| **FONC-02** | Le tableau de bord et la page Commissions calculent et affichent deux montants différents pour la même commission | Risque direct de litige financier avec les intervenants (rémunération), confiance dans les chiffres de l'application compromise |
| **TEST-01** | La suite de tests d'isolation multi-tenant est ignorée par défaut (variable d'environnement documentée comme "optionnelle") | Rien n'empêche techniquement qu'une régression future du type RLS-01 soit déployée sans qu'aucun test ne l'intercepte |

---

## 4. Tableau consolidé

*Note de correction de référencement* : dans les phases 6, 7 et 9, l'absence de contrainte `CHECK` garantissant la cohérence financière (`HT + TVA = TTC`) sur `devis`/`factures` a été citée par erreur sous l'identifiant **DB-04** (qui désigne en réalité, dans le rapport de la phase 5, l'absence d'index sur les colonnes de jointure RLS). Ce rapport final corrige l'identifiant de ce constat en **DB-05** ; DB-04 conserve son sens original (index manquants).

| ID | Gravité | Domaine | Problème | Preuve | Impact | Priorité | Effort |
|---|---|---|---|---|---|---|---|
| FONC-01 | Élevée | Facturation | Remise appliquée sur le TTC puis TVA recalculée par différence → TVA négative si remise > ~9-17% | `DevisFormPage.tsx:122-125` ; phase 6/7 | Document client incorrect, risque fiscal/image | P0 | S |
| FONC-02 | Élevée | Commissions | Deux chemins de calcul de commission non réconciliés (trigger DB `auto_commission` vs recalcul frontend `useCommissionsData`) | `DashboardPage.tsx:27,164` vs `hooks/index.ts:1124-1218` ; phase 6 | Montants différents affichés, litige possible avec intervenants | P0 | M |
| SEC2-01 | Élevée | Sécurité/Stripe | Blocage d'abonnement expiré non appliqué par la RLS, seulement par l'UI | `App.tsx` `Guard`/`SubscriptionBlockedScreen` ; `subscription.ts` ; phase 2/3/7 | Contournement du modèle payant via appel API direct | P0 | M |
| RLS-01 | Moyenne-Élevée | Multi-tenant/RLS | Régression : `pir_select` (partner_intervention_requests) a perdu son contrôle `is_admin_in_org` le 2026-07-14, jamais restauré | Migrations `20260708000008` → `20260714000002` → `20260715000009` ; phase 3 | Données clients partagées lisibles par rôles non-admin | P0 | S |
| DB-02 | Élevée | Base de données/Facturation | Numérotation devis/factures/interventions calculée par `MAX()+1` global, non scopé par `organisation_id` | `gen_numero_facture()`, `generate_devis_numero()`, `gen_numero_intervention()` ; phase 5/7/9/10 | Non-conformité comptable potentielle, contention à l'échelle plateforme | P0 | M |
| TEST-01 | Élevée | Tests | Suite d'isolation multi-tenant désactivée si `TEST_ADMIN_B_EMAIL` absent, documentée "optionnelle" | `tests/multi-tenant/*.spec.ts`, `.env.test.example` ; phase 10 | Régressions de sécurité multi-tenant non détectées | P0 | S |
| FACT-02 | Moyenne | Facturation | Condition de course (check-then-act) sur la transformation devis→facture, pas de contrainte `UNIQUE(devis_id)` | `useDevisToFacture`, `hooks/index.ts:734-741` ; phase 7 | Double facturation possible d'un même devis | P1 | S |
| DB-01 / FN-04 | Moyenne | Base de données/Edge Functions | FK vers `profiles(id)` sans `ON DELETE` sur les tables métier historiques + aucun garde-fou anti auto-suppression/dernier admin dans `supprimer-utilisateur` | Schéma de référence ; `supabase/functions/supprimer-utilisateur` ; phase 4/5 | Suppression d'un utilisateur actif échoue probablement (erreur brute) ou peut verrouiller une organisation | P1 | M |
| DB-03 | Moyenne | Base de données/RGPD | Un admin peut modifier/supprimer n'importe quelle colonne du journal d'audit (`journal_update`/`journal_delete` sans restriction de colonne) | `20260610000018` vs `20260611000001` ; phase 5/11 | Perte de valeur probante du journal en cas d'incident | P1 | S |
| DB-05 | Moyenne | Base de données/Facturation | Aucune contrainte `CHECK` ne garantit `montant_ht + tva_montant = montant_ttc` sur `devis`/`factures` | Schéma `devis`/`factures` ; phase 5 §3 (corrigé de DB-04) | Incohérence financière possible sans blocage serveur | P1 | S |
| DB-04 | Moyenne | Base de données/Performances | Colonnes FK (`client_id`, `intervenant_id`, etc.) utilisées par les policies RLS sans index dédié | Recherche exhaustive `CREATE INDEX` ; phase 5/9 | Dégradation de performance à volume élevé par organisation | P1/P2 | S |
| PERF-02 | Élevée (à volume) | Performances | Aucune pagination sur `clients`/`interventions`/`devis`/`factures`/`commissions` | `hooks/index.ts` ; phase 9 | Chargement complet de la table à chaque page, non tenable à fort volume par organisation | P1 | M |
| PWA-01 | Moyenne | PWA/Mobile | File d'attente hors ligne jamais alimentée (`addToQueue` jamais appelé) malgré une bannière promettant la synchronisation | `src/lib/offline/*`, `OfflineBanner.tsx` ; phase 8/10 | Actions perdues silencieusement en zone mal couverte, promesse UI non tenue | P1 | M |
| Android-01 | Moyenne | Android | Permission `RECORD_AUDIO` absente alors que l'enregistrement vocal est implémenté (`getUserMedia`) | `AndroidManifest.xml` vs `MessagingPage.tsx:314-339` ; phase 8 | Messages vocaux probablement non fonctionnels sur l'APK | P1 | S |
| QUAL-03 | Élevée (dormant) | Qualité/Dépendances | `xlsx` porte une vulnérabilité haute sans correctif, alors qu'il n'est jamais importé | `npm audit` ; build réel (chunk 1 octet) ; phase 9 | Risque nul tant qu'inutilisé, redevient réel si un jour utilisé sans le savoir | P1 | S |
| RGPD-01 | Moyenne | RGPD | Rétention de "12 mois" des logs d'activité annoncée mais aucune purge automatique, et aucun code ne semble alimenter la table `journal` | `ConfidentialitePage.tsx:314` ; phase 11 | Écart entre politique affichée et réalité technique | P1 | S |
| RGPD-02 | Moyenne | RGPD | Brevo et Stripe non mentionnés comme sous-traitants dans la politique de confidentialité | `ConfidentialitePage.tsx` vs phases 4/7 | Écart de transparence RGPD (art. 13/14) | P1 | S |
| OBS-01 | Moyenne | Observabilité | Aucun outil de suivi d'erreurs ni de monitoring applicatif | Absence de dépendance ; phase 11 | Détection d'incident dépendante d'un signalement utilisateur | P1 | M |
| TEST-02 | Moyenne | Tests | Les tests d'isolation multi-tenant vérifient l'UI (DOM), jamais l'API/RLS directement | `tests/multi-tenant/*.spec.ts` ; phase 10 | Ne détecterait pas un contournement par appel API direct (type RLS-01) | P1 | M |
| FN-03 | Moyenne | Edge Functions | Aucune tâche planifiée réelle pour les rappels — dépend d'une ouverture manuelle de `/planning` | `send-reminders`, bloc `pg_cron` commenté ; phase 4/6 | Fonctionnalité "rappel automatique" non fiable en pratique | P1 | S |
| SEC2-02 | Faible-Moyenne | Sécurité | Limite d'appareils (2) appliquée uniquement côté client, identifiants auto-déclarés | `devices.ts` ; phase 2/10 | Contournement possible de la limite annoncée aux utilisateurs | P2 | M |
| SEC2-03 | Moyenne | Sécurité | Compte désactivé (`actif=false`) non vérifié au login/restauration de session côté frontend | `auth.ts`, `App.tsx` ; phase 2 | Accès UI conservé pour un compte désactivé (portée réelle limitée par des helpers RLS `actif=true`) | P1 | S |
| SEC2-05 | Faible-Moyenne | Sécurité | Brute-force login protégé uniquement côté client (`localStorage`) | `LoginPage.tsx` ; phase 2 | Protection contournable par script direct | P2 | S |
| SEC2-06 | Faible | Sécurité | Politique de mot de passe faible (6 caractères, aucune complexité) | `ActivationPage.tsx`, `ResetPasswordPage.tsx` ; phase 2 | Comptes à mot de passe faible facilités | P2 | S |
| SEC2-07 | Faible | Sécurité | Jetons de session réels commités dans `guide/.auth/*.json` | Phase 1/2 | Compte de test, risque limité mais mauvaise pratique | P1 | S |
| RLS-03 | Faible-Moyenne | Multi-tenant/RLS | Liens de partage public (`document_public_links`) sans expiration effective | `useCreatePublicLink` ; phase 3 | Lien de facture (avec IBAN/BIC) valide indéfiniment si non révoqué manuellement | P2 | S |
| RLS-04 | Faible | Multi-tenant/RLS | `notifications_insert` permet de créer une notification pour n'importe quel membre de la même organisation | Policy `notif_insert` ; phase 3 | Spam/ingénierie sociale intra-organisation, jamais cross-tenant | P2 | S |
| RLS-06 | Faible | Multi-tenant/RLS | Signed URLs `chat-media` valides 7 jours (vs 300s ailleurs) | Migration Storage Phase 8 ; phase 3 | Fenêtre d'exposition plus longue si l'URL fuite | P2 | S |
| FACT-01 | Faible | Facturation | Statuts `acompte`/`partiel` définis en base mais aucune UI ne permet de les utiliser | `FacturesPage.tsx` ; phase 7 | Fonctionnalité incomplète, pas un risque | P2 | S |
| FN-01 | Faible-Moyenne | Edge Functions | Aucune limitation de débit sur `envoyer-email`/`inviter-intervenant` | Phase 4 | Envoi massif possible par un compte déjà autorisé | P2 | M |
| FN-02 | Faible | Edge Functions | Logs `[DBG]` avec PII (email, nom) dans `inviter-intervenant` | Phase 4 | PII en clair dans les logs Supabase, pas de secret technique | P2 | S |
| PERF-01 | Faible-Moyenne | Performances/PWA | Service worker précache l'intégralité des chunks (~3,6 Mo) dès l'installation | `vite.config.ts` ; phase 8/9 | Coût data/batterie mobile pour des fonctionnalités jamais utilisées | P2 | M |
| PERF-03 | Moyenne | Performances | Aucune virtualisation de liste | Phase 9 | Aggrave PERF-02 à volume élevé | P2 | M |
| QUAL-01 | Faible-Moyenne | Qualité du code | Aucun linter (ESLint) configuré | `package.json` ; phase 9 | Pas de détection automatisée des erreurs de style/qualité | P1 | S |
| QUAL-02 | Faible | Qualité du code | 4 dépendances mortes (`signature_pad`, `react-hook-form`, `zod`, `xlsx`) | Recherche exhaustive + build ; phase 9 | Poids et surface d'audit inutiles | P2 | S |
| PWA-02 | Faible | PWA/Mobile | "Changer de compte" (LockScreen) ne déclenche pas `signOut()` | `LockScreen.tsx` ; phase 8 | Session précédente reste active en arrière-plan jusqu'à connexion du nouvel utilisateur | P2 | S |
| Hygiène dépôt | Faible | Divers | Fichiers dupliqués versionnés (racine, `kaytek-final/`, `backup/`), archives ZIP (~51 Mo), 26 migrations diag/test | Phase 1 | Confusion, poids du dépôt, pas un risque applicatif direct (backup vérifié sans données personnelles réelles, phase 11) | P2 | M |

*(Constats informationnels sans action requise — SEC2-04, SEC2-08 à SEC2-13, RLS-02/05, FN-05/06, QUAL — nomenclature, etc. — non repris ligne à ligne ici ; se référer aux rapports de phase respectifs.)*

---

## 5. Matrice des rôles

| Fonctionnalité | Admin | Assistant | Intervenant | Frontend | Backend (RPC/Edge) | RLS | Risque |
|---|---|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ (vue adaptée) | ✅ (vue adaptée) | Guard : tous rôles | — | Requêtes scopées par rôle | Faible — cohérent |
| Clients | ✅ | ✅ | ❌ (route bloquée) mais visible via intervention/devis liés | `Guard allowedRoles=['admin','assistant']` | — | `can_manage_operations` OU créateur OU lié via intervention/devis | Faible — cohérent |
| Devis | ✅ | ❌ | ✅ (les siens) | `Guard allowedRoles=['admin','intervenant']` | — | admin OU (intervenant, créateur/assigné) — assistant explicitement exclu (SEC-01) | Faible |
| Factures | ✅ | ❌ | ✅ (les siennes, lecture) | idem | — | admin OU (intervenant, créateur/assigné) | Faible |
| Interventions | ✅ | ✅ | ✅ (les siennes) | Pas de restriction de route (scopée en interne) | — | `can_manage_operations` OU intervenant assigné | Faible |
| Planning | ✅ | ✅ (implicite) | ✅ (implicite) | Pas de restriction de route | Bouton rappels admin-only en interne | N/A (vue sur interventions) | Faible |
| Messagerie | ✅ (tous contacts) | ✅ (admin + intervenants) | ✅ (admin uniquement) | Restriction de paire de rôles **frontend uniquement** (`useSendMessage`) | — | `messages_insert` ne vérifie que l'organisation du destinataire, pas la paire de rôles | **Moyen** — contournable par API directe, reste intra-organisation |
| Commissions | ✅ (toutes) | ❌ | ✅ (les siennes) | `Guard allowedRoles=['admin','intervenant']` | — | admin OU (intervenant, assigné) — assistant exclu (SEC-01) | Faible |
| Catalogue (prestations) | ✅ | ❌ | ❌ (lecture via devis) | `Guard adminOnly` | — | SELECT tout membre org, écriture admin | Faible |
| Utilisateurs | ✅ | ❌ | ❌ | `Guard adminOnly` | `inviter-intervenant`/`supprimer-utilisateur` : admin vérifié serveur | admin uniquement | Faible |
| Paramètres | ✅ | ❌ | ❌ | `Guard adminOnly` | — | IBAN/BIC admin-only (FE-01) ; SIRET/TVA lisibles par tous (vue publique) | Faible |
| Journal | ✅ (lecture + modif/suppr) | ❌ | ❌ | `Guard adminOnly` | — | `journal_select`/`update`/`delete` admin ; `journal_insert` ouvert à tout membre (mécanisme d'alimentation réel incertain, cf. DB-03/RGPD-01) | **Moyen** — intégrité de l'audit trail |
| Partenaires — vitrine/connexions/messagerie | ✅ | ❌ | ❌ | `Guard adminOnly` | RPC `search_partner_profiles`/`respond_to_partner_intervention_request` correctement gardées admin | `is_admin_in_org` présent | Faible |
| Partenaires — demandes d'intervention (`partner_intervention_requests`) | ✅ | ❌ (route) mais **lecture directe possible via API** | ❌ (route) mais **lecture directe possible via API** | `Guard adminOnly` | — | **`pir_select` sans `is_admin_in_org`** (RLS-01) | **Élevé — régression confirmée** |
| Abonnement / accès organisation | Bloqué à l'écran si expiré | idem | idem | `SubscriptionBlockedScreen` | RPC lecture seule | **Aucune policy ne vérifie le statut d'abonnement** (SEC2-01) | **Élevé** — contournable par API directe pour tous les rôles |

---

## 6. Matrice RLS

*Synthèse de la matrice complète de la phase 3 (28 tables + vue) — colonnes condensées ; "Isolation vérifiée" = organisation_id re-dérivé serveur et non contournable par les scénarios testés en phase 3.*

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | Isolation vérifiée | Risque |
|---|---|---|---|---|---|---|---|
| `organisations` | ✅ | propre org | — | — | — | ✅ (placeholder initial corrigé le jour même) | Faible |
| `profiles` | ✅ | même org | org forcée | soi/admin + trigger anti-élévation | admin | ✅ | Faible |
| `clients` | ✅ | can_manage_operations/créateur/lié | can_manage_operations ou intervenant | admin/assistant | admin | ✅ | Faible |
| `interventions` | ✅ | can_manage_operations/assigné | idem | idem + assigné | admin | ✅ | Faible |
| `devis` | ✅ | admin/intervenant(créateur/assigné) | idem | idem, statuts non finaux | admin | ✅ | Faible |
| `factures` | ✅ | admin/intervenant(créateur/assigné) | idem | admin uniquement | admin | ✅ | Faible |
| `commissions` | ✅ | admin/intervenant concerné | idem | admin | admin | ✅ | Faible |
| `commission_receipts` | ✅ | admin/intervenant concerné | idem | idem | admin | ✅ | Faible |
| `photos` | ✅ | can_manage_operations/assigné (jointure) | org + intervention liée | *(aucune)* | admin/auteur | ✅ | Faible |
| `messages` | ✅ | expéditeur/destinataire/admin | expéditeur=soi, org forcée | destinataire/admin | *(aucune)* | ✅ (org) / ⚠️ paire de rôles non vérifiée | Moyen |
| `notifications` | ✅ | soi-même | **tout membre org, pour n'importe quel destinataire** | soi-même | soi-même | ✅ (org) / ⚠️ spoofing intra-org (RLS-04) | Faible-Moyen |
| `journal` | ✅ | admin | tout membre org | **admin, sans restriction de colonne (DB-03)** | admin | ✅ (org) | Moyen (intégrité) |
| `prestations` | ✅ | tout membre org | admin | admin | admin | ✅ | Faible |
| `parametres_entreprise` | ✅ | **admin uniquement** (IBAN/BIC, post FE-01) | admin | admin | admin | ✅ | Faible |
| `parametres_entreprise_public` (vue) | héritée | tout membre org (colonnes non sensibles) | révoqué | révoqué | révoqué | ✅ | Faible |
| `push_subscriptions` | ✅ | soi-même | soi-même | soi-même | soi-même | ✅ | Faible |
| `devices` | ✅ | soi/admin | soi-même | soi/admin | soi/admin | ✅ | Faible |
| `document_public_links` | ✅ | org du lien | org + vérif croisée document (SEC-03) | *(aucune)* | org du lien | ✅ | Faible-Moyen (pas d'expiration, RLS-03) |
| `guide_progress` | ✅ | soi-même | soi-même | soi-même | soi-même | ✅ | Faible |
| `guide_videos`/`guide_news` | ✅ | org (non détaillé) | admin | admin | admin | Non vérifié en détail | Faible |
| `subscriptions` | ✅ | `auth.uid()=user_id` | service_role seul | service_role seul | — | N/A (portée individuelle) | **Voir SEC2-01 pour l'enforcement réel** |
| `stripe_webhook_events` | ✅ | deny-all | service_role seul | — | — | ✅ | Nul |
| `founder_seats` | Externe, non vérifiable en détail | lecture publique du compteur | révoqué (anon/authenticated) | révoqué | — | Partiel | Faible (post STRIPE-03) |
| `partner_profiles` | ✅ | org/visible/relation + **is_admin_in_org** | admin | admin | *(aucune)* | ✅ | Faible |
| `partner_connections` | ✅ | 2 orgs + **is_admin_in_org** | admin | admin (machine à états) | *(aucune)* | ✅ | Faible |
| `partner_connection_events` | ✅ | jointure + **is_admin_in_org** | trigger uniquement | — | — | ✅ | Faible |
| `partner_messages` | ✅ | membre + **is_admin_in_org** | admin + connexion acceptée | admin (marquer lu) | *(aucune)* | ✅ | Faible |
| **`partner_intervention_requests`** | ✅ | **org source (tout statut) OU org cible (si accepté) — SANS `is_admin_in_org`** | admin, connexion acceptée, cross-checks | admin (machine à états + RPC dédiée) | *(aucune)* | ⚠️ **Régression confirmée (RLS-01)** | **Élevé** |
| `partner_intervention_events` | ✅ | jointure + **is_admin_in_org** | trigger uniquement | — | — | ✅ | Faible |

---

## 7. Matrice Edge Functions

| Fonction | JWT | Organisation | Rôle | Validation | Idempotence | Risque |
|---|---|---|---|---|---|---|
| `envoyer-email` | Requis | Vérifiée (document.organisation_id == appelant) | admin ou (can_create_documents+can_bypass_validation) | Bonne, Reply-To bloquant | Non | Faible-Moyen (FN-01, pas de rate-limit) |
| `inviter-intervenant` | Requis | Vérifiée, org dérivée serveur | admin strict, whitelist rôle | Champs requis, `commission_pct` non borné | Partielle (upsert profil, email renvoyé à chaque appel) | Faible (FN-02, logs PII) |
| `get-public-document` | Non requis (public par token) | Vérifiée (double contrôle SEC-03) | N/A | Bonne | Oui (lecture) | Faible (RLS-03, liens permanents) |
| `send-push` | Requis (JWT) ou secret Vault interne | Vérifiée (chemin JWT) | Aucun contrôle de rôle (cohérent RLS-04) | user_id requis, contenu libre | Non | Faible-Moyen (logs verbeux, pas de rate-limit) |
| `send-reminders` | Requis (JWT admin) | Vérifiée, strictement scopée | Admin strict | Excellente (anti-doublon atomique) | **Oui** | Faible techniquement / Moyen fonctionnellement (FN-03, pas de cron réel) |
| `send-telegram` | Requis (JWT) ou secret service_role | Vérifiée (cross-org bloqué) | Admin requis pour chat_id direct | message requis, anti relais ouvert | Non | Faible |
| `supprimer-utilisateur` | Requis (JWT admin) | Vérifiée, cross-org refusé | Admin strict | userId requis | Non testée | Faible-Moyen (FN-04/DB-01, pas de garde-fou auto/dernier admin) |

---

## 8. Tests critiques manquants — P0/P1/P2

*(Synthèse de la phase 10, sans répétition intégrale — voir `phase-10-tests-production.md` pour le détail complet)*

### P0

1. Isolation multi-tenant activée par défaut en CI, échec bruyant si les comptes de test ne sont pas configurés (**TEST-01**).
2. Tests RLS directs par API (hors UI) sur `clients`, `devis`, `factures`, `interventions`, `profiles`, `commissions` — cross-organisation ET cross-rôle.
3. Non-régression dédiée sur `partner_intervention_requests` (**RLS-01**).
4. Numérotation sous concurrence, avec vérification du scoping par organisation (**DB-02**).
5. Transformation devis → facture sous concurrence (**FACT-02**).
6. Comptes désactivés : vérifier qu'un compte `actif=false` ne peut ni se reconnecter ni accéder aux données.
7. Abonnement expiré : vérifier qu'un appel API direct est bloqué, pas seulement l'écran (**SEC2-01**).
8. Storage : un utilisateur d'une organisation ne doit pas accéder à un fichier (photo/signature) d'une autre organisation.

### P1

1. Calcul devis avec remise + TVA combinées (**FONC-01**).
2. Cohérence Dashboard vs page Commissions (**FONC-02**).
3. Limitation d'appareils (3ᵉ appareil refusé/rotation).
4. Déclenchement effectif des rappels planifiés (**FN-03**).
5. Edge Functions : isolation organisation/rôle pour chacune des 7 fonctions.
6. Suppression d'utilisateur avec données liées — échec propre, pas d'erreur Postgres brute (**DB-01**/**FN-04**).
7. Webhooks Stripe (rejeu, désordre, idempotence) — dès que le code sera accessible à l'audit.
8. Mode hors ligne réel (mise en file + rejeu) (**PWA-01**).

### P2

1. Android — biométrie/verrouillage (remplacer le boilerplate Capacitor).
2. Détection de doublon client (si ajoutée).
3. Chevauchement de planning (si ajouté).
4. Performance/pagination à volume simulé important (**PERF-02**).
5. Accessibilité clavier/lecteur d'écran.

---

## 9. Plan de correction

### Phase A — Avant commercialisation

| # | Objectif | Anomalie liée | Fichiers concernés | Risque de régression | Validation nécessaire | Effort |
|---|---|---|---|---|---|---|
| A1 | Corriger le calcul de remise pour ne jamais produire de TVA négative (remise appliquée proportionnellement au HT, ou plancher à 0 en attendant) | FONC-01 | `src/pages/DevisFormPage.tsx:122-125`, `src/lib/pdf/generator.tsx` | Faible si la formule est isolée dans une fonction pure testée ; vérifier l'affichage des devis/factures existants déjà enregistrés avec une TVA négative | Test unitaire multi-taux/multi-remise + relecture visuelle d'un devis remisé | S-M |
| A2 | Réconcilier le calcul de commission (Dashboard vs page Commissions) sur une seule source de vérité | FONC-02 | `src/pages/DashboardPage.tsx`, `src/pages/CommissionsPage.tsx`, `hooks/index.ts` (`useCommissions`, `useCommissionsData`, `useUpdateCommission`, trigger `auto_commission`) | Moyen — décider explicitement du sort de la table `commissions`/du trigger avant de les retirer | Comparaison des deux montants sur un jeu de données avec coût matériel confirmé | M |
| A3 | Faire appliquer le blocage d'abonnement par la RLS (pas seulement l'UI) | SEC2-01 | Policies RLS des tables métier (`clients`, `devis`, `factures`, `interventions`, etc.), ou fonction `SECURITY DEFINER` dédiée | Élevé — risque de bloquer par erreur des organisations `kaytek-inter`/pré-Stripe sans abonnement lié ; suivre la même logique "fail-open si aucune ligne subscriptions" déjà en place côté RPC | Test explicite : org avec abonnement `canceled`/`unpaid` doit être bloquée en RLS ; org sans ligne `subscriptions` doit rester accessible | M-L |
| A4 | Réintégrer `is_admin_in_org()` dans la policy `pir_select` | RLS-01 | Migration SQL dédiée sur `partner_intervention_requests` | Faible — pattern déjà appliqué et stable sur les tables sœurs (`partner_messages`, etc.) | Test : intervenant/assistant ne peut plus lire `partner_intervention_requests` en direct | S |
| A5 | Scoper la numérotation des devis/factures/interventions par organisation | DB-02 | `gen_numero_facture()`, `generate_devis_numero()`, `gen_numero_intervention()` | Moyen — vérifier l'absence de doublon avec les numéros déjà attribués globalement avant le correctif | Test de création concurrente sur 2+ organisations simultanément, vérification reset annuel par organisation | M |
| A6 | Rendre `TEST_ADMIN_B_EMAIL` obligatoire en CI (échec bruyant, pas `skip`), provisionner un compte "Organisation B" permanent | TEST-01 | `tests/multi-tenant/*.spec.ts`, `.env.test.example`, configuration CI | Faible | Exécution de la suite en CI avec échec confirmé si la variable est absente | S |

### Phase B — Stabilisation

| # | Objectif | Anomalie liée | Fichiers concernés | Risque de régression | Validation nécessaire | Effort |
|---|---|---|---|---|---|---|
| B1 | Ajouter une contrainte `UNIQUE(devis_id)` sur `factures` | FACT-02 | Migration SQL `factures` | Faible | Test de double transformation simultanée | S |
| B2 | Ajouter des contraintes `CHECK` de cohérence financière (tolérance d'arrondi) | DB-05 | Migration SQL `devis`/`factures` | Moyen — vérifier que les lignes existantes ne violent pas la contrainte avant activation | Test d'insertion avec montants incohérents (doit échouer) | M |
| B3 | Définir `ON DELETE SET NULL`/`CASCADE` explicite sur les FK historiques vers `profiles`, gérer l'erreur `23503` proprement côté `supprimer-utilisateur` | DB-01/FN-04 | Migration SQL, `supabase/functions/supprimer-utilisateur/index.ts`, `UsersPage.tsx` | Moyen — décision produit à trancher table par table (conserver l'historique vs anonymiser) | Test de suppression d'un compte ayant une activité réelle | M-L |
| B4 | Ajouter un trigger `BEFORE UPDATE` restreignant `journal_update` au seul champ `description` | DB-03 | Migration SQL `journal` | Faible | Test : tentative de modification d'une autre colonne doit échouer | S |
| B5 | Câbler réellement la file d'attente hors ligne dans les mutations critiques (statut intervention, compte-rendu) | PWA-01 | `hooks/index.ts`, `src/lib/offline/queue.ts` | Moyen — tester en conditions de coupure réseau réelle | Test manuel/Playwright simulant une coupure réseau | M |
| B6 | Ajouter la permission `RECORD_AUDIO` et valider l'enregistrement vocal sur build Android réelle | Android-01 | `android/app/src/main/AndroidManifest.xml` | Faible | Test manuel sur appareil/émulateur Android | S |
| B7 | Retirer les dépendances mortes (`signature_pad`, `react-hook-form`, `zod`, `xlsx`) | QUAL-02/QUAL-03 | `package.json` | Faible (confirmé inutilisées) | `npm run build` + `npm run typecheck` après retrait | S |
| B8 | Introduire un linter (ESLint + `@typescript-eslint` + `eslint-plugin-react-hooks`) | QUAL-01 | Nouvelle config + `package.json` | Faible à l'introduction, effort de nettoyage ensuite | Premier run sur la base existante, triage des signalements | M |
| B9 | Activer un vrai déclenchement planifié pour les rappels (`pg_cron` ou cron externe) | FN-03 | Migration `20260630000003` (bloc commenté), Edge Function `send-reminders` | Moyen — nécessite un chemin d'authentification service_role/secret interne dédié | Vérification que les rappels partent sans ouverture manuelle de `/planning` | M |
| B10 | Introduire un outil de suivi d'erreurs frontend/backend | OBS-01 | Nouvelle intégration (ex. Sentry), attention à la PII envoyée | Faible | Vérifier la remontée d'une erreur provoquée volontairement en environnement de test | M |

### Phase C — Montée en charge

| # | Objectif | Anomalie liée | Fichiers concernés | Risque de régression | Validation nécessaire | Effort |
|---|---|---|---|---|---|---|
| C1 | Introduire une pagination réelle sur `clients`/`interventions`/`devis`/`factures`/`commissions` | PERF-02 | `hooks/index.ts`, pages associées | Moyen — impacte le filtrage archive/statut actuellement fait côté client | Test de charge simulée avec volume important par organisation | L |
| C2 | Ajouter les index manquants sur les colonnes FK utilisées par les policies RLS | DB-04 | Migration SQL | Faible | `EXPLAIN ANALYZE` avant/après sur les requêtes RLS concernées | S |
| C3 | Virtualiser les listes longues | PERF-03 | Pages listant clients/interventions/devis/factures | Moyen — changement de structure de rendu | Test de scroll/interaction sur un jeu de données volumineux | M |
| C4 | Exclure les chunks lourds (PDF/Excel) du précache Workbox, charger à la demande | PERF-01 | `vite.config.ts` | Faible | Vérifier que le PDF/Excel fonctionne toujours après première visite de la page correspondante | S |
| C5 | Découper `hooks/index.ts` par domaine métier | Maintenabilité | `src/lib/hooks/index.ts` → plusieurs fichiers | Moyen — purement structurel, risque de régression d'import | `npm run typecheck` + `npm run build` après découpage | M |
| C6 | Versionner `supabase/config.toml` | Préparation production | Nouveau fichier | Faible | Comparaison avec la configuration réelle du Dashboard Supabase | S |
| C7 | Compléter la politique de confidentialité (sous-traitants Brevo/Stripe/Vercel) | RGPD-02 | `ConfidentialitePage.tsx` | Faible (rédactionnel, à valider juridiquement) | Relecture juridique | S |
| C8 | Mettre en place une purge automatique conforme à la rétention annoncée (12 mois pour le journal) | RGPD-01 | Migration SQL + clarification du mécanisme d'alimentation réel de `journal` | Moyen — dépend de la clarification préalable du mécanisme d'écriture | Vérification qu'une entrée de plus de 12 mois est bien purgée | M |

*Effort : S = quelques heures à 1 jour, M = plusieurs jours, L = plusieurs semaines / refonte partielle.*

---

## 10. Verdict

**1. Peut-on commercialiser immédiatement ?**
Non. Six anomalies bloquantes (§3) doivent être corrigées et vérifiées avant une ouverture commerciale responsable, en particulier les deux bugs de calcul qui atteignent déjà des documents réels (TVA, commissions) et le contournement possible du blocage d'abonnement.

**2. Une entreprise peut-elle voir les données d'une autre ?**
Pas de façon arbitraire entre deux organisations sans lien — l'isolation cœur de métier (clients, devis, factures, interventions, profils) est correctement forcée côté serveur et vérifiée par relecture de code sur l'ensemble des tables. **Exception confirmée** : au sein du réseau partenaires, un intervenant/assistant non-admin peut aujourd'hui lire les données clients partagées entre deux organisations déjà connectées (RLS-01) — une régression, pas une conception d'origine, à corriger avant commercialisation.

**3. Les rôles sont-ils fiables ?**
Globalement oui pour le périmètre cœur de métier (devis, factures, commissions, clients, catalogue, utilisateurs, paramètres, journal) — les restrictions frontend correspondent à des policies RLS équivalentes. Deux réserves : la restriction de paire de rôles en messagerie (intervenant → admin uniquement) n'est appliquée que côté frontend, et l'accès aux demandes d'intervention partenaires n'est plus filtré par rôle côté base (RLS-01).

**4. Les factures sont-elles fiables ?**
Non, en l'état, sur deux points précis et corrigibles : le calcul peut produire une TVA négative avec une remise usuelle (FONC-01), et la numérotation n'est pas propre à chaque entreprise (DB-02). Le reste du cycle de facturation (statuts, transformation depuis un devis, droits d'accès) est structurellement sain.

**5. Stripe peut-il être contourné ?**
Le blocage d'accès pour abonnement inactif, oui — c'est un contournement confirmé (SEC2-01), applicable à tous les rôles, via un appel API direct plutôt que l'interface officielle. Le reste de l'intégration Stripe (Checkout, webhook, portail) est hors de ce dépôt et n'a pas pu être audité ; ce qui est vérifiable ici (RPC de statut, provisioning, verrous anti-doublon) est correctement conçu.

**6. Les fichiers sont-ils protégés ?**
Oui dans l'ensemble — les policies Storage vérifiées (photos, signatures, logos, chat-media, PDF) isolent correctement par organisation ou par jointure DB, et un historique de policies orphelines cross-organisation a déjà été détecté et corrigé (RLS-02). Deux réserves mineures : les liens de partage public de documents n'expirent jamais par défaut (RLS-03), et les URLs signées de la messagerie restent valides 7 jours (RLS-06).

**7. Android est-il sécurisé ?**
Raisonnablement, avec deux défauts fonctionnels plutôt que des failles de sécurité à proprement parler : l'enregistrement vocal est probablement cassé (permission microphone manquante, Android-01), et la sauvegarde automatique Android n'exclut pas explicitement les données de session de la WebView. Le modèle de sécurité (biométrie = déverrouillage de l'appareil, secrets de signature externalisés, réseau HTTPS forcé) est cohérent et assumé.

**8. Les cinq corrections prioritaires**
1. Corriger le calcul TVA/remise pour ne jamais produire de montant négatif (FONC-01).
2. Faire appliquer le blocage d'abonnement par la RLS, pas seulement par l'interface (SEC2-01).
3. Réintégrer le contrôle de rôle admin sur `partner_intervention_requests` (RLS-01).
4. Scoper la numérotation des devis/factures/interventions par organisation (DB-02).
5. Rendre obligatoire (et non silencieusement ignorable) la suite de tests d'isolation multi-tenant (TEST-01), en complément d'un correctif du calcul de commission (FONC-02) qui devrait suivre immédiatement après ces cinq priorités.

---

*Fin du rapport consolidé. Les 11 rapports de phase (`phase-01-cartographie.md` à `phase-11-rgpd-observabilite.md`) restent la référence de détail pour l'implémentation de chaque correctif.*
