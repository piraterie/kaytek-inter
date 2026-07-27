# Phase 8 — PWA, mobile et Android

Date de l'analyse : 2026-07-21
Méthode : lecture de `vite.config.ts`, `public/push-sw.js`, `src/lib/offline/{queue,sync}.ts`, `src/components/OfflineBanner.tsx`, `src/hooks/useOnlineStatus.ts`, `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `android/app/src/main/java/.../MainActivity.java`, `android/app/src/main/res/xml/*`. Recoupement avec les phases 1 et 2 (session, verrouillage, biométrie déjà analysés en détail — repris ici uniquement sous l'angle PWA/mobile/Android spécifique, sans répéter le détail). Aucune build Android lancée, aucun test exécuté sur appareil physique, aucune modification.

---

## Résumé

Deux constats nouveaux et concrets ressortent de cette phase :

1. **Le système de file d'attente hors ligne est entièrement câblé côté infrastructure (queue localStorage, synchronisation au retour réseau, bannière dédiée) mais n'est appelé par aucune mutation applicative réelle** — `addToQueue()` n'est invoqué nulle part dans le code. La bannière "Mode hors ligne — les modifications seront synchronisées à la reconnexion" fait donc une promesse que l'application ne tient pas : toute action effectuée hors ligne échoue simplement, elle n'est jamais mise en file pour rejeu automatique.
2. **La permission Android `RECORD_AUDIO` est absente du manifeste**, alors que la messagerie (`MessagingPage.tsx`) implémente l'enregistrement de messages vocaux via `getUserMedia({ audio: true })` — fonctionnalité très probablement non fonctionnelle (ou générant une erreur de permission) sur l'application Android packagée, alors qu'elle fonctionne côté web.

Le reste de la configuration PWA/Android est globalement soigné : précache limité aux seuls assets statiques (pas de mise en cache de données sensibles), secrets de signature Android correctement externalisés hors du dépôt, purge automatique du cache/service worker à chaque changement de version.

---

## 1. PWA

### Manifeste

- **Fichier** : `vite.config.ts` (plugin `VitePWA`, `strategies: 'generateSW'`).
- Nom/icônes/couleurs correctement définis (`name: 'Kaytek Inter'`, icônes 192/512 standard + variantes `maskable`), `display: 'standalone'`, `orientation: 'portrait'`, `start_url: '/'` — remplit les critères d'installabilité standard (Chrome/Edge "Ajouter à l'écran d'accueil").
- **Cas limite** : `orientation: 'portrait'` est imposé au niveau du manifeste — sur tablette, les vues tableaux (factures, interventions) et le planning (FullCalendar) pourraient bénéficier d'un mode paysage, qui n'est pas proposé nativement via le PWA installé (reste possible dans un onglet navigateur classique, qui n'est pas contraint par le manifeste).

### Service worker et stratégie de cache

- **Fichier** : `vite.config.ts` (workbox `generateSW`), `public/push-sw.js` (`importScripts`, gestion push).
- `globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}']` — **seuls les assets statiques du build sont précachés**. Aucune configuration `runtimeCaching` n'a été trouvée : le service worker **n'intercepte pas** les appels réseau vers l'API Supabase (`*.supabase.co`). C'est un point positif net pour la sécurité : aucune donnée métier (devis, clients, factures, session) ne transite ni ne persiste dans le Cache Storage du service worker — répond directement au point demandé "cache des données sensibles" : **absent, par construction**.
- `push-sw.js` gère uniquement les événements `push` et `notificationclick` (affichage de notification, navigation `postMessage`/`openWindow`) — pas de logique de cache propre, cohérent avec son rôle d'add-on importé par le SW principal généré par Workbox.

### Mise à jour de l'application

- **Fichier** : `src/lib/buildGuard.ts` (détaillé phase 2, repris ici sous l'angle PWA).
- Mécanisme dédié (`ensureFreshBuild()`, appelé au tout début de `main.tsx`) : compare `APP_BUILD_VERSION` à une valeur stockée en `localStorage`, et si elle a changé, désinscrit tous les service workers, vide tous les caches, puis force un rechargement une seule fois. Complète le `registerType: 'autoUpdate'` de Workbox (qui gère normalement la mise à jour du SW lui-même) par un filet de sécurité applicatif — bonne pratique pour éviter qu'une version d'app perimée reste figée sur un ancien bundle, particulièrement utile dans le contexte d'une WebView Android qui ne se recharge pas aussi naturellement qu'un onglet de navigateur.
- **Scénario 10 (mise à jour de l'app avec ancien cache)** : couvert par ce mécanisme — voir section Scénarios.

### Fonctionnement hors ligne et erreurs réseau

- **FICHIER CENTRAL — PWA-01 : file d'attente hors ligne non connectée à l'application réelle**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé
  - **Fichiers** : `src/lib/offline/queue.ts`, `src/lib/offline/sync.ts`, `src/components/OfflineBanner.tsx`, `src/hooks/useOnlineStatus.ts`
  - **Description** : l'infrastructure est complète et cohérente — `addToQueue()`/`getQueue()`/`removeFromQueue()`/`incrementRetry()` (queue persistée en `localStorage`), `syncQueue()` (rejoue la file au retour réseau, avec 3 tentatives max avant abandon), `OfflineBanner` (affiche l'état et déclenche la synchronisation). **Recherche exhaustive dans tout `src/` : `addToQueue(` n'est appelé nulle part** en dehors de sa propre définition — aucune page, aucun hook de mutation (`useUpdateIntervention`, `useCreateDevis`, etc.) ne l'invoque en cas d'échec réseau.
  - **Conséquence** : la bannière annonce "Mode hors ligne — les modifications seront synchronisées à la reconnexion" (`OfflineBanner.tsx:52`), mais **aucune modification n'est en réalité mise en file** — une tentative de changement de statut d'intervention, de sauvegarde de compte-rendu, etc. pendant une coupure réseau échoue simplement avec l'erreur de la mutation React Query (toast d'erreur générique), sans jamais être rejouée automatiquement.
  - **Impact** : promesse fonctionnelle non tenue, potentiellement trompeuse pour un intervenant sur le terrain (zone mal couverte) qui croit son action enregistrée alors qu'elle a échoué silencieusement côté réseau (le texte de la bannière suggère une sécurité qui n'existe pas).
  - **Recommandation** : soit compléter l'intégration (appeler `addToQueue()` dans les `onError` des mutations critiques concernées, typiquement le changement de statut d'intervention et l'upload de compte-rendu terrain), soit ajuster le message de la bannière pour ne pas promettre une synchronisation automatique qui n'a pas lieu.
  - **Statut** : Vérifié par recherche exhaustive (`addToQueue(` : une seule occurrence, sa propre définition).

### Installation

- Critères PWA standards remplis (manifeste + service worker + icônes) — l'installation elle-même (prompt `beforeinstallprompt`, bouton dédié) n'a pas été localisée dans le code lu ; l'installation dépend probablement du comportement natif du navigateur plutôt que d'un flux applicatif personnalisé (non trouvé dans les fichiers inspectés).

### Notifications push

- Déjà détaillé côté backend en phase 4 (`send-push`) et côté frontend (`usePushSubscription`, phase 2/6). Élément propre à cette phase : **aucun `google-services.json` n'est présent dans `android/`**, et `build.gradle` le gère explicitement en conditionnel (*"google-services.json not found, google-services plugin not applied. Push Notifications won't work"*, commentaire du fichier lui-même). L'app Android s'appuie donc uniquement sur l'API Web Push standard (`PushManager`) exposée par la WebView Capacitor, **sans intégration FCM native** — fonctionnellement possible sur les WebView Android récentes (Chromium), mais moins fiable qu'une intégration FCM native pour la livraison en arrière-plan/app tuée (pas de garantie de réveil système équivalente à un vrai push natif).

### Permissions et persistance de session

- Permissions navigateur (`Notification.requestPermission()`, `getUserMedia`) demandées au moment de l'usage — comportement standard.
- Persistance de session : déjà couverte en détail phase 2 (session Supabase en `localStorage`, `isAppUnlocked` persisté séparément) — repris ici uniquement pour noter que le mécanisme est **identique en PWA web et en Android** (même `localStorage`, même clé `kaytek-auth`), donc les mêmes garanties et limites s'appliquent aux deux.

---

## 2. Mobile (responsive)

- **Statut global** : bien traité, corroboré par une suite de tests dédiée (`tests/responsive/01-viewports.spec.ts`, viewports 360/390/430/768/1280 — cf. phase 1/6).
- **Formulaires / clavier** : `capacitor.config.ts` configure `Keyboard: { resize: 'body', resizeOnFullScreen: true }` — bon réglage pour éviter qu'un clavier virtuel ne recouvre un champ de saisie actif sur Android.
- **Boutons / double-clic** : cf. phases 2 et 6 — pattern `disabled={mutation.isPending}` appliqué de façon cohérente sur les boutons d'action observés (devis, transformation en facture, duplication, partage) ; protège le simple double-tap tactile de la même manière qu'un double-clic souris.
- **Upload photo / appareil photo** : `<input type="file" accept="image/*" capture="environment" />` (`MessagingPage.tsx:688`, et pattern équivalent pour les photos d'intervention) — déclenche nativement l'appareil photo arrière sur mobile/Android ; permission `CAMERA` correctement déclarée dans le manifeste Android.
- **Microphone / messages vocaux** — voir **PWA/Android-02** ci-dessous (section Android), le problème étant spécifiquement une absence de permission Android, pas un défaut de l'implémentation web elle-même (qui gère proprement les cas `NotFoundError`/microphone indisponible, `MessagingPage.tsx:339`).
- **Signature** : `SignatureModal` (canvas tactile, `signature_pad`) — fonctionnel sur mobile par construction (bibliothèque conçue pour le tactile), cohérent avec les tests dédiés ("signer en dessinant sur le canvas").
- **PDF** : généré côté client (`@react-pdf/renderer`), téléchargement déclenché depuis le navigateur/WebView — comportement de téléchargement de fichier en Capacitor Android dépend du gestionnaire de téléchargement du système ; non testé dynamiquement dans cette phase.
- **Planning** : FullCalendar en vue "liste" recommandée sur petit écran (déjà noté phase 6, cf. toolbar mobile réorganisée en 3 lignes, `PlanningPage.tsx:566`) — pas de chevauchement/conflit détecté dans l'UI mobile (cohérent avec l'absence générale de détection de chevauchement notée phase 6, pas spécifique au mobile).
- **Menus / tableaux** : pattern observé de bascule tableau (desktop) → cartes (mobile) sur plusieurs pages (Devis, Factures — cf. tests "page devis — tableau ou cartes adaptatifs") ; sidebar remplacée par un menu accordéon sur mobile (`AppLayout.tsx`, cf. tests guide "mobile 390px — accordion à la place de la sidebar").

---

## 3. Android

### Package et configuration

- `applicationId`/`namespace` : `com.kaytekinter.app` — cohérent entre `capacitor.config.ts` et `build.gradle`.
- `minifyEnabled false` en configuration `release` : les règles ProGuard sont référencées (`proguardFiles`) mais **non appliquées** puisque la minification/obfuscation est désactivée. Impact limité dans une app Capacitor (l'essentiel de la logique métier est en JavaScript dans `dist/`, pas dans le code Java/Kotlin natif que ProGuard obfusquerait) — à noter néanmoins comme un écart entre configuration présente et configuration réellement active.

### Permissions

- Déclarées : `INTERNET`, `CAMERA`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `WRITE_EXTERNAL_STORAGE` (maxSdk 28), `VIBRATE`.
- **Android-01 — Permission `RECORD_AUDIO` manquante alors que l'enregistrement vocal est implémenté**
  - **Gravité** : Moyenne
  - **Confiance** : Confirmé (absence vérifiée dans `AndroidManifest.xml`, usage confirmé dans `MessagingPage.tsx:314-339` via `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`)
  - **Impact** : la fonctionnalité de message vocal de la messagerie, fonctionnelle côté web (où le navigateur gère lui-même la permission microphone), est très probablement cassée ou immédiatement rejetée par une erreur de permission sur l'application Android empaquetée — le WebView Capacitor ne peut accorder l'accès microphone à `getUserMedia` sans que l'app hôte déclare et obtienne `android.permission.RECORD_AUDIO`.
  - **Recommandation** : ajouter `<uses-permission android:name="android.permission.RECORD_AUDIO" />` à `AndroidManifest.xml`, puis valider sur un appareil/émulateur réel que l'enregistrement vocal fonctionne effectivement dans l'APK.
  - **Statut** : Vérifié par lecture croisée du manifeste et du code source ; **non testé sur appareil physique** (aucune build Android lancée dans cette phase).
- `allowBackup="true"` (attribut par défaut, non explicitement désactivé) sans `android:fullBackupContent`/`dataExtractionRules` personnalisé pour exclure les données WebView sensibles : le mécanisme de sauvegarde automatique Android (Auto Backup, vers le compte Google de l'appareil) peut inclure les données de stockage local de la WebView — dont potentiellement le `localStorage` contenant la session Supabase (`kaytek-auth`, cf. phase 2 SEC2-10) — dans la sauvegarde cloud du téléphone. C'est un comportement par défaut d'Android (pas une erreur de configuration active), mais représente une surface d'exposition supplémentaire pour un jeton de session, non neutralisée ici par une règle d'exclusion explicite.
- Pas de permission `POST_NOTIFICATIONS` explicite trouvée (requise depuis Android 13/API 33 pour les notifications) — si `targetSdkVersion` (défini dans `variables.gradle`, non lu dans cette phase) cible API 33+, Capacitor/Web Notifications API devrait normalement gérer cette demande de permission au runtime ; non vérifié explicitement ici (fichier `variables.gradle` non consulté).

### WebView / wrapper utilisé

- Capacitor 8 (`BridgeActivity` standard, `MainActivity.java` minimal, aucune surcharge personnalisée) — wrapper WebView générique sans logique native additionnelle, cohérent avec une architecture 100 % web packagée.

### Sécurité réseau

- Aucun `network_security_config.xml` personnalisé trouvé, ni attribut `android:networkSecurityConfig` sur `<application>` — l'app s'appuie sur le comportement par défaut d'Android (trafic non chiffré bloqué par défaut pour les apps ciblant l'API 28+), et `capacitor.config.ts` force `androidScheme: 'https'`. Aucun `usesCleartextTraffic="true"` trouvé. Configuration réseau saine par absence de dérogation.

### Stockage local

- Identique à la PWA web (`localStorage` pour session/préférences, cf. phase 2) — mêmes constats, pas de mécanisme de stockage natif chiffré (`EncryptedSharedPreferences`/Keystore Android) utilisé pour la session, malgré la disponibilité de ce type d'API sur la plateforme. Cf. **allowBackup** ci-dessus pour l'implication supplémentaire côté Android.

### Biométrie et écran de verrouillage

- Déjà détaillé en profondeur phase 2 (**SEC2-08**) : sur Android, la biométrie délègue entièrement au prompt système (`BiometricAuth.authenticate()`, avec `allowDeviceCredential: true` acceptant aussi le code/schéma de l'appareil) — pas de garantie cryptographique propre à l'app, comportement assumé et cohérent avec la plupart des apps grand public. Non répété en détail ici.

### Cycle de vie, arrière-plan, reprise de session

- Déjà détaillé phase 2 : `App.tsx` verrouille l'app (`setAppUnlocked(false)`) au passage en arrière-plan (`CapApp.addListener('appStateChange', ...)`), et force également un verrouillage à froid au démarrage natif (indépendamment de la valeur persistée), pour couvrir le cas d'un kill de process par l'OS sans transition par l'arrière-plan. Bonne robustesse pour ce cas précis (cf. mémoire projet : correctif dédié "preserve Supabase session across Android process kill, fix double-prompt on first login").
- Timer d'inactivité de 30 minutes (`AppLayout.tsx`) s'applique identiquement sur Android.

### Deep links et liens externes

- **Aucun deep link natif configuré** : le seul `<intent-filter>` présent dans `AndroidManifest.xml` est celui, standard, de lancement (`MAIN`/`LAUNCHER`) — aucun schéma d'URL personnalisé (`kaytekinter://`) ni App Links (`https://app.kaytekinter.fr/...` avec `autoVerify`) déclaré. La navigation depuis une notification push est gérée **entièrement au niveau web** (`push-sw.js` → `clients.openWindow`/`postMessage`, cf. section PWA), ce qui fonctionne pour ce cas d'usage précis mais signifie qu'un lien externe (ex. partagé par SMS/email vers `app.kaytekinter.fr/...`) ouvrirait le navigateur système plutôt que l'app Android installée, faute d'App Links configurés.
- Liens externes (`tel:`, `sms:`, `mailto:`) : gérés via `window.location.href` (cf. phase 2), fonctionnent nativement dans une WebView Capacitor comme dans un navigateur.

### Appareil photo, microphone, fichiers

- Appareil photo : permission déclarée + `FileProvider` configuré (`file_paths.xml`) — chemin standard Capacitor, cohérent.
- Microphone : permission manquante — voir **Android-01**.
- Fichiers : `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (Android 13+) et `READ/WRITE_EXTERNAL_STORAGE` avec `maxSdkVersion` appropriés pour les versions antérieures — déclaration correcte et à jour vis-à-vis des évolutions récentes du modèle de permissions Android (scoped storage).

### Versionnement

- `versionCode 10` / `versionName "1.0.9"` (cohérent avec le commit `18fbf69 chore(android): version 1.0.9 (versionCode 10)` vu dans l'historique git) — incrémenté correctement à chaque build de test interne, bonne discipline.

### Signature de build (sans révéler les secrets)

- `build.gradle` lit `keystore.properties` (fichier non commité, confirmé absent de `git ls-files` et listé dans `.gitignore` avec `*.jks`/`*.keystore`) pour `storeFile`/`storePassword`/`keyAlias`/`keyPassword` — **aucun secret de signature n'est présent dans le dépôt**, mécanisme correctement externalisé. Aucune valeur de mot de passe ni de keystore n'a été lue ni n'est reproduite ici.

---

## 4. Scénarios évalués

| # | Scénario | Résultat |
|---|---|---|
| 1 | Réouverture après mise en arrière-plan | L'app se reverrouille (`isAppUnlocked = false`) au passage en arrière-plan (listener `appStateChange`) — à la réouverture, `Guard` redirige vers `/lock` ; comportement voulu et cohérent (cf. phase 2). |
| 2 | Session expirée avec écran encore affiché | Le déverrouillage (mot de passe ou biométrie) revérifie explicitement une session Supabase valide côté client (`supabase.auth.getSession()`) avant d'autoriser l'accès (`LockScreen.tsx`, phase 2) — si la session a expiré entre-temps, l'utilisateur est renvoyé vers la saisie du mot de passe plutôt que déverrouillé silencieusement. Comportement correct pour ce cas précis ; la détection d'expiration **pendant** une session déjà déverrouillée et affichée dépend du comportement natif de `autoRefreshToken: true` du SDK Supabase (rafraîchissement automatique), non testé dynamiquement ici. |
| 3 | Biométrie contournée | Cf. **SEC2-08/09** (phase 2) : sur Android, la biométrie est un verrou de niveau appareil (`allowDeviceCredential: true` accepte aussi le code PIN de l'appareil) — pas un contournement au sens d'une faille, mais un modèle de sécurité assumé équivalent à "qui déverrouille le téléphone déverrouille l'app". Aucun contournement logiciel identifié au-delà de ce modèle documenté. |
| 4 | Changement de compte | **PWA/And-03** — le bouton "Changer de compte" de `LockScreen.tsx` (`onClick={() => nav('/login')}`) navigue directement vers `/login` **sans appeler `supabase.auth.signOut()` ni vider le cache React Query**. La session du premier utilisateur reste donc active en arrière-plan tant qu'un second utilisateur ne s'est pas authentifié avec succès (ce qui remplace alors la session dans `localStorage`). Risque limité (pas de fuite de données tant que le second utilisateur ne se connecte pas réellement), mais le flux n'effectue pas de déconnexion propre du premier compte — à la différence de `handleSignOut` (AppLayout) qui, lui, appelle bien `signOut()`. |
| 5 | Cache contenant les données de l'ancien compte | Le cache React Query est explicitement vidé (`qc.clear()`) sur l'événement `SIGNED_OUT` (`App.tsx`, phase 2) — donc après une déconnexion **explicite**, pas de résidu. Cependant, le scénario 4 ci-dessus (changement de compte sans `signOut()` explicite) ne déclenche pas `SIGNED_OUT` et ne vide donc pas ce cache avant qu'un nouvel utilisateur se connecte — la plupart des requêtes étant clés par `user?.id` (cf. phase 6), un nouvel utilisateur déclenche normalement un re-fetch plutôt que d'afficher les données de l'ancien, mais ce n'est pas garanti pour l'intégralité des requêtes (non auditées exhaustivement à cet égard). |
| 6 | Mode hors ligne | Détecté (`navigator.onLine`, bannière dédiée) mais **aucune mise en file d'attente réelle des actions** — voir **PWA-01**. L'utilisateur est informé qu'il est hors ligne, mais pas protégé contre la perte de son action. |
| 7 | Double envoi après reconnexion | Sans file d'attente fonctionnelle (PWA-01), ce scénario ne se pose pas de la façon prévue (rien n'est rejoué automatiquement) — le risque se déplace plutôt vers un double-clic manuel de l'utilisateur au retour du réseau, protégé par les gardes `disabled={isPending}` déjà en place (phase 2/6) pour l'usage normal (un seul onglet/session). |
| 8 | Perte de réseau pendant une facture | Sans file d'attente câblée, une perte réseau pendant la création/modification d'une facture se traduit par un échec de mutation React Query classique (toast d'erreur) — pas de corruption de données côté serveur (l'écriture Supabase est atomique, elle échoue ou réussit intégralement), mais pas de récupération automatique non plus. |
| 9 | Upload interrompu | Non instrumenté spécifiquement dans le code lu (pas de mécanisme de reprise d'upload par morceaux/chunks pour les photos ou signatures) — un upload interrompu (photo d'intervention, signature) échouerait et devrait être retenté manuellement par l'utilisateur ; cohérent avec l'absence générale de file d'attente hors ligne. |
| 10 | Mise à jour de l'app avec ancien cache | Couvert par `buildGuard.ts` (`ensureFreshBuild()`) : purge des service workers et caches puis rechargement au changement de version — mécanisme dédié et fonctionnel pour ce cas précis (cf. section PWA "Mise à jour"). |

---

## 5. Éléments non vérifiables dans cette phase

- Comportement réel sur appareil Android physique ou émulateur (aucune build lancée, aucun test dynamique — conformément aux règles de la phase, aucune commande de build/déploiement n'a été exécutée).
- Contenu de `android/variables.gradle` (`minSdkVersion`/`targetSdkVersion` exacts) — non consulté dans cette phase, pertinent pour confirmer le comportement des permissions runtime (ex. `POST_NOTIFICATIONS` sur Android 13+).
- Comportement effectif du téléchargement de PDF et de la reprise d'upload interrompu sur l'APK réel.
- Fiabilité réelle de la livraison push en arrière-plan/app tuée sans intégration FCM native (`google-services.json` absent) — évaluation faite sur la base de la configuration, pas d'un test de livraison réel.
- Contenu exact de la sauvegarde Android déclenchée par `allowBackup="true"` (dépend aussi de la version d'Android et des réglages du compte Google de l'utilisateur final) — signalé comme surface de risque plausible, pas confirmé par un test de restauration réel.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
