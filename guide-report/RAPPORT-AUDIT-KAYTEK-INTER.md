# RAPPORT D'AUDIT — KAYTEK INTER
**Date :** 16 juin 2026  
**Auditeur :** Playwright CLI (audit manuel assisté)  
**Périmètre :** Application complète — Admin + Intervenant  
**Méthode :** Test fonctionnel en conditions réelles (sessions Supabase actives)

---

## SCORE GLOBAL : 7.1 / 10

| Dimension | Note | Commentaire |
|---|---|---|
| Fonctionnalités Admin | 8/10 | Workflow complet, quelques bugs mineurs |
| Fonctionnalités Intervenant | 9/10 | Propre, fluide, très bon |
| Design / UI | 8/10 | Cohérent, dark mode soigné |
| Responsive mobile (360px) | 6/10 | Sidebar bloque sur navigation directe |
| Responsive tablette (768px) | 7/10 | Fonctionnel, banner tronquée |
| Messagerie | 6/10 | Compose bar invisible au chargement côté admin |
| Fiabilité BDD | 6/10 | 2 tables manquantes / erreurs API persistantes |
| Qualité UX | 7/10 | Quelques confusions UX, messages dev exposés |

---

## ÉTAT GÉNÉRAL

**Niveau de maturité : MVP+**  
L'application est fonctionnelle sur les parcours principaux. Les workflows Admin (créer intervention → devis → facture → commission) et Intervenant (accepter → démarrer → compte-rendu → messagerie) fonctionnent de bout en bout. Le design est professionnel et cohérent.

**Vendable en l'état ?** Oui, avec précautions — les bugs critiques (table notifications manquante, compose bar cachée) doivent être corrigés avant démo commerciale.

---

## BUGS CRITIQUES (priorité 1 — bloquer avant démo)

### BUG-01 — Table `notifications` manquante en base de données
- **Page :** Toutes (appel en arrière-plan)
- **Rôle :** Admin + Intervenant
- **Description :** La table `notifications` n'existe pas dans la base Supabase. Chaque chargement de page génère une erreur 404 dans la console. L'icône cloche 🔔 ne fonctionne pas.
- **Screenshot :** Console errors à chaque page
- **Sévérité :** CRITIQUE — erreur visible en console, fonctionnalité notifications complètement inactive
- **Correction :** Créer la table `notifications` dans Supabase avec le bon schéma, ou supprimer les appels si la fonctionnalité n'est pas encore implémentée

---

### BUG-02 — `parametres_entreprise` retourne 406 en persistance
- **Page :** Toutes (appel en arrière-plan)
- **Rôle :** Admin
- **Description :** Erreur 406 persistante sur la table `parametres_entreprise`. Les paramètres entreprise ne se chargent pas correctement.
- **Symptôme visible :** Bandeau orange permanent "Paramètres entreprise incomplets — manquants : Raison sociale, Email entreprise, Téléphone, Adresse" sur toutes les pages admin.
- **Impact :** Envoi de devis/factures bloqué tant que les paramètres ne sont pas renseignés. UX dégradée avec le bandeau permanent.
- **Sévérité :** CRITIQUE — bloque l'envoi de documents et pollue l'interface
- **Correction :** Vérifier la politique RLS sur `parametres_entreprise`, créer l'enregistrement par défaut à la création d'organisation

---

### BUG-03 — Messagerie Admin : zone de saisie invisible au chargement
- **Page :** `/messagerie`
- **Rôle :** Admin
- **Screenshot :** `audit/56-messagerie-admin-1280.png`, `audit/57-messagerie-compose-bug.png`
- **Description :** Quand le bandeau "Paramètres entreprise incomplets" est affiché, la zone de saisie des messages est poussée hors de l'écran visible. L'admin ne peut pas envoyer de message sans faire défiler la page.
- **Cause probable :** Le layout de la messagerie utilise `height: 100vh` ou un calcul fixe qui ne tient pas compte de la hauteur du bandeau d'avertissement.
- **Sévérité :** CRITIQUE — fonctionnalité principale inutilisable sans scroll non intuitif
- **Correction :** Adapter le calcul de hauteur de la zone messages avec `calc(100vh - [hauteur topbar] - [hauteur banner])` ou utiliser `flex: 1` + `min-height: 0` sur le conteneur messages

---

### BUG-04 — Mobile 360px : sidebar reste ouverte sur navigation directe par URL
- **Page :** Toutes
- **Rôle :** Admin + Intervenant
- **Screenshot :** `audit/50-resp-360-detail.png`, `audit/51-resp-360-sidebar-issue.png`
- **Description :** Quand un lien direct vers une page est ouvert sur mobile (360px), la sidebar reste ouverte et bloque l'intégralité du contenu. La sidebar intercepte tous les événements de clic, rendant la page complètement inaccessible. Seule la navigation via les liens de la sidebar permet de la fermer.
- **Sévérité :** CRITIQUE sur mobile — la page est inaccessible si accédée directement
- **Correction :** Sur mobile, initialiser `sidebarOpen = false` au chargement de page, ou détecter la taille de viewport et forcer la fermeture de la sidebar si `window.innerWidth < 768`

---

## BUGS IMPORTANTS (priorité 2 — corriger avant lancement)

### BUG-05 — Label "HT" incorrect dans le formulaire de prestation
- **Page :** Création d'intervention → section prestations
- **Rôle :** Admin
- **Description :** Dans le formulaire d'ajout de prestation, un champ est labellisé "HT" mais affiche le montant TTC (avec TVA 20% incluse). Le calcul de TVA est effectué correctement mais le label induit en erreur.
- **Sévérité :** IMPORTANTE — confusion comptable potentielle pour les clients
- **Correction :** Vérifier la logique de calcul et corriger le label pour afficher "TTC" si le montant inclut la TVA

---

### BUG-06 — Message développeur exposé dans le Guide (admin et intervenant)
- **Page :** `/guide` et `/guide/intervenant`
- **Rôle :** Admin + Intervenant
- **Screenshot :** `audit/44-guide-intervenant.png`
- **Description :** Les sections vidéo du Guide affichent : "Vidéo bientôt disponible — Cette vidéo sera disponible après le premier enregistrement Playwright."
- **Sévérité :** IMPORTANTE — message de développement interne exposé aux utilisateurs finaux
- **Correction :** Remplacer par "Vidéo bientôt disponible" sans mention de Playwright

---

### BUG-07 — Badge sidebar ne se met pas à jour après création d'intervention
- **Page :** Dashboard → création intervention
- **Rôle :** Admin
- **Description :** Après création d'une intervention via le formulaire, le badge numérique sur "Interventions" dans la sidebar ne s'incrémente pas immédiatement. Le badge garde son ancienne valeur jusqu'au rechargement de la page.
- **Sévérité :** IMPORTANTE — feedback utilisateur manquant
- **Correction :** Invalider le cache React Query sur la clé `interventions` après création réussie

---

### BUG-08 — Bouton "Tout supprimer" trop visible sur Devis et Factures
- **Page :** `/devis`, `/factures`
- **Rôle :** Admin
- **Description :** Le bouton "Tout supprimer" est affiché de manière très visible dans l'interface principale, au même niveau visuel que les actions normales. Une suppression accidentelle de toutes les données serait catastrophique.
- **Sévérité :** IMPORTANTE — risque de perte de données en production
- **Correction :** Déplacer dans un menu "Actions avancées", masquer derrière une confirmation en deux étapes, ou supprimer en production

---

## BUGS MINEURS (priorité 3 — corriger avant v1.0)

### BUG-09 — Planning vide malgré interventions "planifiées"
- **Page :** `/planning`
- **Rôle :** Admin + Intervenant
- **Screenshot :** `audit/42-planning-intervenant.png`
- **Description :** Le compteur indique "4 interventions planifiées" mais le calendrier est vide. Les interventions n'ont pas de date assignée, donc elles n'apparaissent pas sur le calendrier.
- **Sévérité :** MINEURE — comportement cohérent mais confusant
- **Correction :** Soit renommer "planifiées" en "sans date" pour les interventions sans créneau, soit obliger la saisie d'une date à la création

---

### BUG-10 — Formulaires sans labels accessibles (aria-label)
- **Page :** Formulaires création client, intervention, prestation
- **Rôle :** Admin
- **Description :** Les champs de formulaire sont identifiables uniquement par leur position (index 0, 1, 2...), sans `id`, `name` ou `aria-label`. Cela rend les formulaires inaccessibles aux lecteurs d'écran et difficiles à tester.
- **Sévérité :** MINEURE (accessibilité)
- **Correction :** Ajouter `htmlFor` sur les `<label>` et `id` correspondants sur les `<input>`

---

### BUG-11 — Aperçu devis brouillon sans actions visibles
- **Page :** `/devis` → aperçu PDF brouillon
- **Rôle :** Admin
- **Description :** L'aperçu du devis en statut "brouillon" ne montre pas clairement les boutons d'action (envoyer, confirmer) dans la fenêtre d'aperçu.
- **Sévérité :** MINEURE — UX sous-optimale

---

### BUG-12 — Banner "Paramètres entreprise" : bouton tronqué à 768px
- **Page :** Toutes (admin)
- **Rôle :** Admin
- **Screenshot :** `audit/58-resp-768-dashboard.png`
- **Description :** À 768px, le bandeau d'avertissement "Paramètres entreprise incomplets" est tronqué en haut et le bouton "Ouvrir les Paramètres →" n'est pas visible.
- **Sévérité :** MINEURE

---

## FONCTIONNALITÉS VALIDÉES ✓

### Côté Admin
- ✅ **Login / logout** — fonctionne, modal "Connexion rapide" (biométrique) affiché après login
- ✅ **Dashboard** — stats temps réel, interventions récentes, raccourcis
- ✅ **Création client** — formulaire complet, recherche Google Places, validation
- ✅ **Création intervention** — formulaire multi-étapes, sélection client, type, adresse
- ✅ **Ajout prestations** — catalogue, calcul HT/TTC, TVA 20%
- ✅ **Liste interventions** — filtrage par statut, recherche texte, tri
- ✅ **Détail intervention** — onglets Détail/Photos/Compte-rendu/Devis-Facture/Commission/Journal
- ✅ **Création devis** — depuis intervention, PDF généré client-side, statuts brouillon/envoyé/accepté
- ✅ **Création facture** — depuis devis accepté, numérotation automatique
- ✅ **Planning** — calendrier FullCalendar, vues Mois/Semaine/Jour/Liste
- ✅ **Catalogue prestations** — CRUD complet, tarifs HT/TTC
- ✅ **Messagerie Admin-Intervenant** — messages en temps réel, messages automatiques système
- ✅ **Commissions** — tableau récapitulatif par intervenant, taux configurables
- ✅ **Gestion utilisateurs** — liste intervenants, invitation, rôles
- ✅ **Journal d'activité** — log des actions avec timestamps
- ✅ **Guide admin** — sections structurées, progression 0/8
- ✅ **Export Excel** — fonctionnel sur liste interventions

### Côté Intervenant
- ✅ **Dashboard** — stats personnelles (interventions aujourd'hui, gains, à recevoir, messages non lus)
- ✅ **Liste interventions** — vue carte, filtrage par statut, actions contextuelles
- ✅ **Accepter/Refuser intervention** — workflow "en attente → accepté → en cours → terminé" complet
- ✅ **Démarrer intervention** — transition statut en cours
- ✅ **Photos** — onglet dédié, upload avec compression auto (max 15 MB), catégories Avant/Après
- ✅ **Compte-rendu** — texte travail réalisé, matériel, temps, montant TTC, pièces achetées
- ✅ **Calcul commission temps réel** — aperçu de la répartition (CA / base commissionnable / commission) affiché pendant la saisie
- ✅ **Onglet Commission** — détail : CA TTC, base commissionnable, pourcentage, commission calculée
- ✅ **Onglet Devis/Facture** — message de garde si intervention pas encore terminée
- ✅ **Messagerie** — envoi/réception de messages, messages système automatiques
- ✅ **Planning** — calendrier personnel
- ✅ **Commissions** — vue personnelle des commissions (vide si aucune facture payée)
- ✅ **Guide Intervenant** — sections : Connexion, Réception, Accepter, Gérer statuts, Photos, Signature client, Clôturer

---

## RÉSULTATS RESPONSIVE

### 360px (Mobile Android)
| Élément | État | Note |
|---|---|---|
| Dashboard | ✅ Bon | Cards empilées, lecture fluide |
| Navigation sidebar | ⚠️ Partiel | Auto-close uniquement sur navigation par lien |
| Navigation directe par URL | ❌ Bug critique | Sidebar bloque le contenu |
| Liste interventions | ✅ Bon | Cards mobiles optimisées |
| Filtres de statut | ✅ Bon | Scroll horizontal fonctionnel |
| Bottom "≡ Menu" | ✅ Bon | Accessible en bas d'écran |

### 768px (Tablette)
| Élément | État | Note |
|---|---|---|
| Sidebar | ✅ Bon | Toujours visible, non-overlay |
| Dashboard | ✅ Bon | Stats en colonne, table visible |
| Banner "Paramètres incomplets" | ⚠️ Partiel | Tronquée, bouton CTA invisible |
| Interventions | ✅ Bon | Cards bien proportionnées |
| Bottom bar | ✅ Présent | "+ Nouveau" et "≡ Menu" visibles |

### 1280px (Desktop standard)
| Élément | État | Note |
|---|---|---|
| Dashboard | ✅ Excellent | Grille 4 colonnes, stats + table |
| Toutes les pages | ✅ Bon | Layout desktop optimisé |
| Messagerie compose | ❌ Bug | Invisible si bandeau warning affiché |

---

## OBSERVATIONS DESIGN / UX

### Points forts
- ✅ Dark mode cohérent, palette de couleurs professionnelle
- ✅ Icons Lucide React bien utilisées, uniformes
- ✅ Statuts colorés : en attente (jaune), en cours (bleu), terminé (vert), refusé (rouge)
- ✅ Empty states explicatifs (ex: "Aucune commission — Les commissions apparaissent lorsqu'une facture est payée")
- ✅ Tooltips et messages d'aide contextuels dans les formulaires
- ✅ Badges numériques sur la sidebar pour les items en attente
- ✅ Calcul de commission en temps réel pendant la saisie du compte-rendu — excellent
- ✅ Messages système automatiques dans la messagerie (acceptation, démarrage)

### Points faibles
- ⚠️ Bandeau orange "Paramètres incomplets" permanent, envahissant et non dismissable
- ⚠️ Bouton "Tout supprimer" affiché de manière trop accessible
- ⚠️ Tabs de la page intervention détail : pas de scroll indicator visible sur desktop (uniquement couper sur mobile)
- ⚠️ Formulaire création intervention : pas de validation visuelle des champs obligatoires avant soumission
- ⚠️ Noms clients en test "TEST-WORKFLOW PW-..." peu lisibles dans les listes

---

## PLAN DE CORRECTION PRIORISÉ

### Phase 1 — Avant démo (urgence max)
1. **BUG-01** — Créer table `notifications` ou supprimer appels API → 30 min
2. **BUG-03** — Corriger layout messagerie admin (compose bar) → 1h
3. **BUG-04** — Fermer sidebar au chargement sur mobile → 15 min
4. **BUG-06** — Supprimer mention "Playwright" dans le Guide → 5 min

### Phase 2 — Avant lancement (qualité prod)
5. **BUG-02** — Corriger 406 `parametres_entreprise`, initialiser les paramètres par défaut → 2h
6. **BUG-05** — Corriger label HT/TTC dans formulaire prestation → 15 min
7. **BUG-07** — Invalider cache React Query après création intervention → 30 min
8. **BUG-08** — Sécuriser/masquer "Tout supprimer" → 30 min

### Phase 3 — v1.0 qualité
9. **BUG-09** — Clarifier statut interventions sans date dans le planning → 1h
10. **BUG-10** — Ajouter aria-labels sur formulaires → 2h
11. **BUG-11** — Améliorer aperçu devis brouillon → 1h
12. **BUG-12** — Corriger banner responsive 768px → 30 min

---

## DÉTAIL DES CAPTURES D'ÉCRAN

| Fichier | Contenu |
|---|---|
| `01-dashboard.png` | Dashboard admin (desktop) |
| `30-intervenant-detail.png` | Détail intervention côté intervenant |
| `32-intervention-acceptee.png` | Après acceptation d'une intervention |
| `33-intervention-demarree.png` | Après démarrage (statut "en cours") |
| `34-photos-tab.png` | Onglet Photos vide |
| `35-compte-rendu-tab.png` | Onglet Compte-rendu |
| `37-compte-rendu-saved.png` | Compte-rendu rempli avec aperçu commission |
| `38-commission-tab.png` | Onglet Commission (30% = 54€) |
| `40-messagerie-intervenant.png` | Messagerie côté intervenant |
| `41-messagerie-sent.png` | Message envoyé par l'intervenant |
| `42-planning-intervenant.png` | Planning vide malgré "4 interventions planifiées" |
| `44-guide-intervenant.png` | Guide intervenant (bug message Playwright visible) |
| `45-dashboard-intervenant.png` | Dashboard intervenant complet |
| `46-resp-360-dashboard.png` | Dashboard 360px (sidebar ouverte au chargement) |
| `47-resp-360-after-nav.png` | Dashboard 360px après navigation (correct) |
| `49-resp-360-interventions.png` | Liste interventions 360px (excellent) |
| `51-resp-360-sidebar-issue.png` | Bug sidebar 360px sur navigation directe |
| `54-resp-360-detail-correct.png` | Détail intervention 360px via navigation (correct) |
| `56-messagerie-admin-1280.png` | Messagerie admin 1280px (compose bar coupée) |
| `57-messagerie-compose-bug.png` | Compose bar visible après scroll |
| `58-resp-768-dashboard.png` | Dashboard admin 768px (banner tronquée) |
| `59-resp-768-interventions.png` | Liste interventions 768px (excellent) |

---

## CONCLUSION

Kaytek Inter est une application SaaS de gestion d'interventions serrurerie/vitrerie à un niveau de maturité MVP+ solide. Le cœur métier (création d'intervention → devis → facture → commission) fonctionne de bout en bout. L'interface intervenant est particulièrement réussie — intuitive, mobile-first, avec le calcul de commission en temps réel.

Les 4 bugs critiques identifiés (notifications manquantes, messagerie admin inaccessible, sidebar mobile bloquante, message Playwright exposé) sont tous corrigeables en moins d'une journée de travail. Une fois ces corrections effectuées, l'application est prête pour une démonstration commerciale et pour l'onboarding des premiers clients bêta.

**Recommandation finale : corriger Phase 1, puis lancer les bêta serruriers.**

---

*Rapport généré le 16 juin 2026 — Audit Playwright manuel complet*
