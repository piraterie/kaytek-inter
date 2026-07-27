# Phase 9 — Performances et qualité du code

Date de l'analyse : 2026-07-21
Méthode : commandes non destructives exécutées — `npm run typecheck` (tsc --noEmit), `npm run build` (analyse de la taille réelle des bundles générés dans `dist/`), `npm audit` (audit des dépendances contre la base d'avisories npm), `npm outdated` — plus recherche exhaustive par `grep` (`any`, `@ts-ignore`, `console.log`, `TODO`/`FIXME`, usages de dépendances). Aucune dépendance mise à jour, aucun fichier modifié. **Aucun script `lint` n'existe dans `package.json`** — il n'y a donc aucun ESLint/linter configuré pour ce projet, constat en soi (voir §2).

---

## Résumé

Le typecheck révèle une vraie erreur TypeScript non détectée jusqu'ici (le build Vite ne fait pas de vérification de types, donc rien ne l'empêche d'arriver en production). `npm audit` révèle une dépendance (`xlsx`) portant une vulnérabilité haute sans correctif disponible, **alors qu'elle n'est utilisée nulle part dans le code** — confirmé à la fois par recherche de code et par la taille du chunk généré (1 octet). Trois autres dépendances déclarées (`signature_pad`, `react-hook-form`, `zod`) sont également mortes. Côté performance, le constat le plus significatif est l'**absence totale de pagination sur les listes métier principales** (clients, interventions, devis, factures, commissions) — chaque page charge l'intégralité des lignes de l'organisation en une seule requête, sans limite ni scroll infini, ce qui deviendra un problème réel pour toute organisation à fort volume documentaire, indépendamment du nombre total d'entreprises sur la plateforme.

---

## 1. Performances

### Bundle et code splitting

- **Lazy loading** : confirmé effectif au niveau des routes — `src/App.tsx` charge chaque page via `lazy(() => import('@/pages/...'))` (26 pages), ce qui se traduit bien en chunks séparés dans le build réel (`DevisFormPage-*.js`, `InterventionsPage-*.js`, etc., chacun individuellement listé ci-dessous).
- **Taille réelle des chunks** (mesurée via `npm run build`, 96 fichiers précachés, 3 686,57 KiB au total) :

| Chunk | Taille (min) | Taille (gzip) |
|---|---|---|
| `pdf-*.js` (`@react-pdf/renderer`) | **1 310,59 kB** | 434,34 kB |
| `exceljs-*.js` | **938,38 kB** | 270,94 kB |
| `PlanningPage-*.js` (FullCalendar inclus) | 286,27 kB | 83,34 kB |
| `supabase-*.js` | 211,18 kB | 54,56 kB |
| `vendor-*.js` (react/react-dom/react-router) | 163,65 kB | 53,39 kB |
| `index-*.js` (entrée principale) | 141,69 kB | 38,15 kB |
| `query-*.js` (@tanstack/react-query) | 42,20 kB | 12,77 kB |
| `xlsx-*.js` | **1 octet** | — |

- **PERF-01 — Le service worker précache l'intégralité des chunks (~3,6 Mo) dès le premier chargement, y compris les plus lourds**
  - **Gravité** : Faible-Moyenne
  - **Confiance** : Confirmé (sortie du build : `PWA v0.20.5 / precache 96 entries (3686.57 KiB)`)
  - **Description** : le code-splitting par route réduit bien le JavaScript *exécuté* au premier rendu (une page comme `LoginPage` n'exécute pas `pdf.js`), mais `vite-plugin-pwa` en mode `generateSW` avec `globPatterns: ['**/*.{js,css,...}']` (cf. phase 8) précache **tous** les chunks générés dès l'installation du service worker — y compris les 1,3 Mo de `pdf-*.js` et les 938 Ko de `exceljs-*.js`, que l'utilisateur n'a peut-être jamais besoin de charger (ex. un intervenant qui ne génère jamais d'export Excel). Sur un réseau mobile limité (contexte Android intervenant terrain, cf. phase 8), cela représente un coût de données et de batterie en arrière-plan peu visible pour l'utilisateur.
  - **Recommandation** : exclure les chunks volumineux et peu fréquemment utilisés (`pdf-*.js`, `exceljs-*.js`) du précache Workbox (`globIgnores`) et les laisser en cache "à la demande" (runtime caching `CacheFirst` déclenché seulement au premier usage réel), ou évaluer une alternative plus légère à `@react-pdf/renderer`/`exceljs` si la taille devient un problème mesuré.
  - **Statut** : Vérifié par la sortie du build réel.

### Requêtes Supabase, pagination et listes longues

- **PERF-02 — Aucune pagination sur les listes métier principales**
  - **Gravité** : Élevée (à l'échelle du volume documentaire, pas du nombre d'entreprises)
  - **Confiance** : Confirmé
  - **Fichiers** : `useClients`, `useInterventions`, `useDevis`, `useFactures`, `useCommissions`, `useCommissionsData`, `useAllPrestations` (`src/lib/hooks/index.ts`)
  - **Description** : recherche exhaustive de `.limit(`/`.range(` dans `src/lib/hooks/index.ts` — seules 3 requêtes en possèdent (`useMyNotifications` : 50, `useConversations` : 300 messages, `useJournal` : 200). **Aucune des requêtes sur `clients`, `interventions`, `devis`, `factures`, `commissions` ne limite le nombre de lignes retournées** : chaque page (`ClientsPage`, `InterventionsPage`, `DevisPage`, `FacturesPage`, `CommissionsPage`) charge la totalité des lignes de la table pour l'organisation (et le rôle) de l'utilisateur, en une seule requête, sans scroll infini ni pagination côté serveur. Le filtrage archive/statut est ensuite appliqué **côté client** en JavaScript (déjà noté phase 6 pour `useClients`/`useInterventions`).
  - **Impact selon le volume** :
    - **10 entreprises** : sans impact perceptible (chaque organisation reste petite).
    - **100 à 1 000 entreprises** : toujours sans impact direct par ce seul facteur — le volume par organisation individuelle est ce qui compte, pas le nombre total d'entreprises sur la plateforme (la RLS isole déjà chaque requête à une seule organisation).
    - **Plusieurs centaines de milliers de documents** *pour une même organisation* (cas plausible pour un gros client après plusieurs années d'usage) : chaque ouverture de `/clients`, `/interventions`, `/devis` ou `/factures` télécharge et rend **l'intégralité** de l'historique de cette organisation — temps de chargement dégradé, consommation mémoire navigateur importante (aggravée par l'absence de virtualisation de liste, cf. PERF-03), risque de dépassement de la limite de ligne PostgREST par défaut (1000 lignes) qui **tronquerait silencieusement** les résultats sans erreur visible passé ce seuil.
    - **Plusieurs millions de messages/notifications** : `messages` (messagerie) et `notifications` ont des limites explicites (300/50) — moins exposés, mais `useConversations` recalcule les compteurs non-lus/aperçus sur seulement les 300 messages les plus récents tous contacts confondus (déjà noté phase 6 comme cas limite mineur) ; à un tel volume, cette fenêtre de 300 devient rapidement insuffisante pour un utilisateur très actif.
  - **Recommandation** : introduire une pagination réelle (curseur ou `range()`) sur `clients`, `interventions`, `devis`, `factures`, `commissions`, avec un filtrage/tri côté serveur plutôt que côté client (le filtrage archive actuel récupère déjà toutes les lignes avant de les filtrer en JS).
  - **Statut** : Vérifié par recherche exhaustive dans le code.

- **PERF-03 — Aucune virtualisation de liste**
  - **Gravité** : Moyenne (aggrave PERF-02)
  - **Confiance** : Confirmé (aucune bibliothèque de virtualisation — `react-window`, `react-virtual`, etc. — dans `package.json` ; rendu de type `.map()` classique observé dans les pages listées en phase 6)
  - **Impact** : combiné à PERF-02, le rendu DOM d'une liste de plusieurs milliers d'éléments (clients, interventions) sans fenêtrage se traduit par un ralentissement de l'interface (scroll, interactions) proportionnel au nombre total de lignes, pas au nombre visible à l'écran.

- **N+1** : non trouvé de façon significative — les requêtes de liste utilisent systématiquement des jointures Supabase embarquées en une seule requête (`select('*, client:clients(...), intervenant:profiles(...)')`), plutôt qu'une requête par ligne. Seul point mineur relevé : `notifyAdmins()` (`src/lib/hooks/index.ts:788-809`) boucle sur chaque admin de l'organisation et exécute un `INSERT` séparé par admin (au lieu d'un seul `INSERT` multi-lignes) — impact négligeable vu le nombre typiquement faible d'admins par organisation, mais un pattern à corriger si le nombre d'admins par org devait significativement augmenter.

### Cache React Query, invalidations, Zustand, re-renders

- Configuration globale saine : `staleTime: 2 min`, `retry: 1`, `refetchOnWindowFocus: false` (`src/main.tsx`) — limite les requêtes redondantes par défaut.
- Invalidations ciblées et cohérentes dans l'ensemble des mutations observées (`qc.invalidateQueries({ queryKey: [...] })` avec des clés précises plutôt qu'un `invalidateQueries()` global systématique) — bonne pratique, évite des re-fetch en cascade non nécessaires.
- Zustand : plusieurs composants déstructurent le store entier sans sélecteur (`const { user, authInitializing, error, isAppUnlocked, subscriptionBlocked } = useAuthStore()` dans `Guard`, `src/App.tsx`) plutôt que d'utiliser un sélecteur par champ (`useAuthStore(s => s.user)`, pattern pourtant utilisé ailleurs, ex. `AppLayout.tsx`) — provoque un re-render du composant à chaque changement de n'importe quel champ du store, pas seulement ceux utilisés. Impact réel négligeable à l'échelle actuelle de l'état stocké (peu de champs, peu de mises à jour), mais incohérence de pattern entre fichiers.

### PDF, Excel, planning, messagerie, recherches, index SQL, Edge Functions

- **PDF/Excel** : cf. PERF-01 — génération et export corrects fonctionnellement (déjà couvert phases 6/7), mais poids de bundle très élevé pour ces deux fonctionnalités.
- **Planning** : chunk dédié de 286 Ko (FullCalendar) — raisonnable pour la bibliothèque, mais toujours précaché intégralement (cf. PERF-01) même pour un rôle qui n'accède jamais au planning.
- **Messagerie** : cf. `useConversations` (fenêtre de 300 messages, déjà notée) et signed URLs régénérées toutes les 4 minutes pour les photos (`useSignedPhotos`, `src/lib/hooks/index.ts:1654-1671`) — poll côté client raisonnable pour la fraîcheur des URLs signées, sans charge serveur excessive (une requête Storage groupée par lot de chemins, pas par photo individuelle).
- **Recherches** : `ilike` sur `clients`/`interventions` (`.or('nom.ilike.%x%,...)`) — fonctionne sans index dédié pour de petits volumes, mais un `ILIKE '%...%'` avec joker en tête de motif ne peut **jamais** utiliser un index B-tree standard (recherche systématiquement en séquentiel) ; à un volume important par organisation, cette recherche deviendra lente. Une extension `pg_trgm` + index GIN serait nécessaire pour rester performant à grande échelle — non présente dans les migrations analysées (phase 5).
- **Index SQL** : déjà traité en détail phase 5 (**DB-04**, absence d'index sur les colonnes de jointure `client_id`/`intervenant_id` utilisées par les policies RLS) — non répété ici.
- **Edge Functions** : aucune limitation de débit trouvée (déjà noté phase 4, **FN-01**) — sous forte charge (envoi massif d'emails, par exemple), aucun mécanisme de protection ou de mise en file d'attente asynchrone ; chaque appel s'exécute de façon synchrone et bloquante pour l'appelant.

### Synthèse par ordre de grandeur (tel que demandé)

| Échelle | Facteur limitant principal |
|---|---|
| 10 entreprises | Aucun problème identifié à ce volume. |
| 100 entreprises | Idem — chaque organisation reste isolée par la RLS, le nombre total d'organisations n'affecte pas directement la charge d'une requête individuelle (à l'exception du verrou global de numérotation, **DB-02** phase 5, qui sérialise la création de devis/factures/interventions **entre toutes les organisations**, un point de contention qui grandit avec le nombre total d'organisations actives simultanément). |
| 1 000 entreprises | Le verrou global de numérotation (DB-02) devient le facteur limitant le plus probable si de nombreuses organisations créent des documents simultanément — un goulot d'étranglement à l'échelle de la plateforme entière, pas par organisation. |
| Centaines de milliers de documents (par organisation) | **PERF-02/PERF-03** — listes non paginées et non virtualisées : dégradation directe et proportionnelle au volume pour l'organisation concernée. |
| Millions de messages/notifications | Fenêtres déjà limitées (50/200/300 lignes) protègent en partie, mais `useConversations` (300 messages tous contacts confondus) deviendrait insuffisant pour un compte très actif à ce volume. |

---

## 2. Qualité du code

### Outillage

- **QUAL-01 — Aucun linter configuré**
  - **Gravité** : Faible-Moyenne (facteur aggravant pour les autres constats de cette section)
  - **Confiance** : Confirmé
  - **Description** : `package.json` ne définit aucun script `lint`, et aucune configuration ESLint (`.eslintrc*`, `eslint.config.*`) n'a été trouvée à la racine du projet. Aucune règle automatisée ne détecte donc les imports inutilisés, variables non utilisées, `any` implicites, ou incohérences de style avant qu'un changement n'atteigne la branche principale.
  - **Recommandation** : ajouter à minima ESLint avec le preset `@typescript-eslint` + `eslint-plugin-react-hooks`, et l'intégrer comme étape de vérification (script npm + CI si applicable).

### TypeScript

- **`npm run typecheck` (`tsc --noEmit`) révèle une erreur réelle** : `src/pages/DevisFormPage.tsx(170,42): error TS2339: Property 'adresse_intervention' does not exist on type '{ nom: string; prenom?: string; telephone?: string; email?: string; }'`. Le code s'exécute quand même en pratique (Vite ne type-check pas au build, seul `tsc --noEmit` le fait, et rien n'indique que ce script soit exécuté en CI) — `displayClient?.adresse_intervention` (ligne 170) accède à un champ absent du type inféré pour `clientFromIntervention`, ce qui signifie que le préremplissage de l'adresse du RDV (`openRdvModal`) pourrait silencieusement échouer (`undefined`) dans le cas où `displayClient` provient de cette branche plutôt que de la liste `clients` complète.
- **`@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`** : **aucune occurrence trouvée** dans `src/` — point positif, aucune suppression d'erreur explicite masquée.
- **Usage de `any`** : **278 occurrences** de `: any`, `<any>` ou `as any` dans `src/` — volume élevé pour une base de ~14 000 lignes, cohérent avec un typage globalement permissif observé dans les hooks (`src/lib/hooks/index.ts` utilise `any` de façon récurrente pour les payloads Supabase, ex. `mutationFn: async (data: any) => ...` dans `useCreateDevis`). Cela réduit la capacité de TypeScript à détecter des erreurs comme celle trouvée ci-dessus ailleurs dans le code.

### Duplication

- Pattern d'archivage dupliqué presque à l'identique entre `useArchiveClient` et `useArchiveIntervention` (`src/lib/hooks/index.ts:219-256` et `395-430`) — même structure (`onMutate` optimiste, filtrage par `showArchived`, rollback `onError`, invalidation `onSettled`), différant seulement par le nom de la table et de la query key. Candidat naturel à une factorisation (`useArchiveEntity(table, queryKey)` générique), non bloquant mais un exemple clair de duplication mentionné explicitement par la demande d'audit.
- `notifyAdmins()`/`notifyUser()` (lignes 788-827) partagent une logique quasi identique (Telegram puis fallback notification in-app) — factorisable en une fonction commune paramétrée par la liste de destinataires.

### Composants et hooks trop longs

| Fichier | Lignes | Nature |
|---|---|---|
| `src/lib/hooks/index.ts` | 1 671 | Toute la logique métier (dashboard, clients, prestations, interventions, devis, factures, commissions, messages, notifications, journal, liens publics) dans un seul fichier — candidat à un découpage par domaine (`hooks/clients.ts`, `hooks/devis.ts`, etc., à l'image de `hooks/partners.ts` déjà séparé). |
| `src/pages/DevisFormPage.tsx` | 946 | Formulaire + calculs + modales (client, prestation manuelle, RDV) + signature dans un seul composant. |
| `src/pages/InterventionsPage.tsx` | 891 | Liste + filtres + modales de création dans un seul composant. |
| `src/pages/FacturesPage.tsx` | 821 | Idem. |
| `src/pages/MessagingPage.tsx` | 783 | Conversation + enregistrement vocal + upload photo dans un seul composant. |
| `src/pages/DevisPage.tsx` | 783 | — |
| `src/components/layout/AppLayout.tsx` | 801 | Navigation + profil + appareils + timer d'inactivité + notifications dans un seul composant (déjà repéré phase 1). |

Aucun de ces fichiers n'est bloquant fonctionnellement, mais leur taille rend la revue de code et les tests unitaires ciblés plus difficiles ; un découpage par sous-composant/hook serait bénéfique en particulier pour `hooks/index.ts` (1 671 lignes est significatif pour un unique fichier de hooks).

### Code mort, TODO/FIXME, logs

- **TODO/FIXME** : aucune occurrence trouvée dans `src/` — soit une base de code inhabituellement "propre" à cet égard, soit d'anciens TODO ont été systématiquement résolus/retirés (non vérifiable de façon certaine).
- **`console.log`** : 48 occurrences dans `src/` (dont une bonne partie déjà signalée phase 2, **SEC2-11**, sur le flux d'authentification) — confirmé ici comme un pattern répandu dans l'ensemble du code, pas isolé à l'auth (ex. `[archive-client]`, `[archive-intervention]`, `[commissions]`, `[notif]` — logs de debug visiblement laissés en place après le développement des fonctionnalités correspondantes).
- **Code mort confirmé** (recoupement avec les phases précédentes) : `useUpdateCommission()` jamais appelé (phase 6, FONC-02), `addToQueue()` jamais appelé (phase 8, PWA-01), bucket `pdf-documents` jamais utilisé (phase 3/5), fonctions SQL orphelines déjà nettoyées (phase 5).

### Dépendances inutilisées, obsolètes et vulnérables

- **QUAL-02 — Quatre dépendances déclarées ne sont utilisées nulle part dans le code**
  - **Gravité** : Faible pour `signature_pad`/`react-hook-form`/`zod` ; **Élevée pour `xlsx`** (cf. ci-dessous)
  - **Confiance** : Confirmé (recherche exhaustive d'imports + confirmation par la taille des chunks du build réel)
  - **`signature_pad`** : zéro référence dans `src/` — la signature est en réalité implémentée par un canvas HTML fait main (`SignatureModal.tsx`, gestion manuelle des événements souris/tactile), sans jamais importer la bibliothèque du même nom pourtant déclarée en dépendance.
  - **`react-hook-form`** et **`zod`** : zéro référence dans `src/` — tous les formulaires observés dans ce projet (login, devis, clients, paramètres, etc.) sont gérés manuellement via `useState`, sans ces bibliothèques.
  - **`xlsx`** : zéro référence dans `src/` — confirmé également par le build réel, qui produit un chunk `xlsx-*.js` de **1 octet** (aucun module réel n'y est inclus). L'export Excel fonctionne exclusivement via `exceljs` (import dynamique confirmé dans `src/lib/exportPremium.ts:163`).
  - **Recommandation** : retirer ces 4 dépendances de `package.json` (aucun impact fonctionnel attendu, confirmé par l'absence totale de référence) — allège `node_modules`, `package-lock.json`, et la surface d'audit de sécurité.

- **QUAL-03 — `xlsx` porte une vulnérabilité haute sans correctif disponible, alors qu'il est totalement inutilisé**
  - **Gravité** : Élevée (par la nature de la vulnérabilité), mais **risque réel actuellement nul** puisque le code n'est jamais exécuté
  - **Confiance** : Confirmé (`npm audit`)
  - **Description** : `npm audit` rapporte pour `xlsx` : *"Prototype Pollution in sheetJS"* et *"SheetJS Regular Expression Denial of Service (ReDoS)"*, sévérité haute, **"No fix available"** (le paquet public `xlsx` sur npm n'est plus corrigé par son éditeur pour ces failles connues). Comme confirmé en QUAL-02, ce paquet n'est importé nulle part — la vulnérabilité est donc dormante, mais elle réapparaîtrait immédiatement comme un risque réel si une future fonctionnalité venait à l'utiliser sans que quiconque ne s'en souvienne.
  - **Recommandation** : retirer `xlsx` (résout QUAL-02 et QUAL-03 simultanément).

- **Autres vulnérabilités `npm audit`** (dépendances de développement/transitives) :
  - `brace-expansion` (haute, DoS par expansion exponentielle `{}`) — transitif via `archiver-utils`/`readdir-glob`/`rimraf`/`zip-stream` (chaîne de dépendances d'`exceljs`) — **corrigeable via `npm audit fix`** sans changement cassant.
  - `uuid` (modérée, dépassement de tampon) — transitif via `exceljs` — le correctif proposé (`npm audit fix --force`) impliquerait de **rétrograder `exceljs` vers 3.4.0** (changement cassant), à évaluer avant application.
  - Aucune vulnérabilité rapportée sur les dépendances directement liées à la sécurité de l'application (Supabase, React, Zustand, React Query).

- **Dépendances notablement en retard** (`npm outdated`, sans lien avec une vulnérabilité connue) : Vite (5.4 → 8.1, 3 versions majeures), TypeScript (5.9 → 7.0, 2 versions majeures), React/React DOM (18.3 → 19.2), React Router (6.30 → 7.18), `@react-pdf/renderer` (3.4 → 4.5), Zustand (4.5 → 5.0), `date-fns` (3.6 → 4.4). Aucune mise à jour effectuée conformément à la consigne de cette phase — signalé pour planification future, en tenant compte des changements cassants probables sur des sauts de version majeure.

### Incohérences de nommage, logique métier dans les composants, types SQL non synchronisés

- **Nommage** : globalement cohérent (français pour les noms de domaine métier — `devis`, `facture`, `intervention` —, anglais pour les termes techniques — `Page`, `Modal`, hooks `use*`) ; quelques incohérences mineures déjà relevées phase 5 (`tva_pct` en `integer` sur certaines tables, `numeric` sur d'autres pour un concept identique).
- **Logique métier dans les composants** : présente de façon significative — les calculs de remise/TVA (phase 6/7, **FONC-01**) et de commission (**FONC-02**) sont directement implémentés dans `DevisFormPage.tsx` et `useCommissionsData()` plutôt que dans des fonctions pures testables isolément ; c'est en partie ce qui a permis au bug FONC-01 de passer inaperçu (aucun test unitaire possible sans instancier le composant complet).
- **Types SQL non synchronisés** : l'erreur TypeScript trouvée ci-dessus (`adresse_intervention`) en est un exemple concret — un type frontend (probablement dérivé manuellement plutôt que généré depuis le schéma Supabase réel) ne correspond pas exactement aux données réellement manipulées. Plus largement, aucune génération automatique de types depuis le schéma Supabase (`supabase gen types typescript`) n'a été trouvée dans les scripts npm — les types de `src/types/index.ts` sont maintenus manuellement, ce qui explique structurellement ce genre de dérive.

---

## 3. Éléments non vérifiables dans cette phase

- Impact réel en production des points de performance (PERF-01/02/03) — analyse basée sur le code et un build local, pas sur une mesure en conditions réelles (pas d'accès à une organisation avec un volume de données important).
- Impact réel du retard de version de certaines dépendances (Vite, TypeScript, React) — non testé (aucune mise à jour effectuée, conformément à la consigne).
- Couverture exhaustive de la duplication de code au-delà des exemples cités (une revue automatisée par un outil dédié, type `jscpd`, n'a pas été lancée — non disponible/non installé dans ce projet).
- Détection exhaustive des imports strictement inutilisés à l'intérieur des fichiers (au-delà des dépendances npm entières vérifiées ci-dessus) — nécessiterait un lint configuré (absent, cf. QUAL-01) ou un outil dédié non installé dans ce projet.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
