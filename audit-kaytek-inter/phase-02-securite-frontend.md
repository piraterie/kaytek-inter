# Phase 2 — Sécurité frontend et authentification

Date de l'analyse : 2026-07-21
Périmètre : `src/App.tsx`, `src/lib/store.ts`, `src/lib/supabase/{auth,client}.ts`, `src/lib/{biometric,devices,subscription,buildGuard}.ts`, `src/pages/{LoginPage,LockScreen,ActivationPage,ResetPasswordPage,DeleteAccountPage,PublicDocumentPage}.tsx`, `src/components/layout/AppLayout.tsx`, échantillon de pages à paramètre `:id`. Méthode : lecture de code + recoupement avec les migrations RLS pertinentes (pour distinguer restriction frontend vs backend). Aucune exécution, aucune tentative d'attaque réelle, aucune modification.

Ce rapport s'appuie sur `audit-kaytek-inter/phase-01-cartographie.md` sans en répéter le contenu (voir en particulier son constat #7 sur `guide/.auth/*.json`, repris ici sous l'angle authentification).

---

## Résumé

Le modèle d'authentification (Supabase Auth + session JWT persistée) est globalement sain : pas de secret embarqué au-delà des valeurs publiques par conception (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`), aucun `dangerouslySetInnerHTML` ni sink XSS trouvé dans `src/`, formulaires sensibles correctement désactivés pendant soumission (spot-check sur `DevisFormPage`/`LoginPage`). Le point structurel le plus important est **la confirmation, croisée avec les migrations, que plusieurs contrôles critiques n'existent qu'au niveau frontend** : le blocage d'abonnement, la limite d'appareils, et — partiellement — la désactivation de compte. Ces trois éléments sont donc contournables par un client qui n'exécute pas le code React (script, extension, requête directe à l'API Supabase avec un jeton valide).

---

## Constats

### SEC2-01 — Blocage d'abonnement inactif entièrement frontend, non relayé par RLS

- **Gravité** : Élevée
- **Confiance** : Confirmé
- **Fichiers** : `src/App.tsx` (`Guard`, `SubscriptionBlockedScreen`, lignes 79, 126-155), `src/lib/subscription.ts` (`fetchSubscriptionBlocked`), `supabase/migrations/20260711000001_organisation_subscription_status_rpc.sql`
- **Fonction/composant** : `Guard` + RPC `get_my_organisation_subscription_status`
- **Description** : `subscriptionBlocked` est un booléen calculé côté client (RPC en lecture seule) et stocké dans `useAuthStore`. Le composant `Guard` affiche `SubscriptionBlockedScreen` à la place de l'app si ce booléen est vrai, mais **aucune policy RLS ne référence `subscription_status`** — recherche exhaustive dans `supabase/migrations/` : le seul point d'usage de la table `subscriptions` dans une policy/fonction est cette RPC de lecture, jamais dans un `USING`/`WITH CHECK` sur `clients`, `devis`, `factures`, `interventions`, etc.
- **Scénario (correspond au scénario 6 demandé)** : Un utilisateur d'une organisation dont l'abonnement Stripe est `canceled`/`unpaid`/`past_due` reste bloqué à l'écran `SubscriptionBlockedScreen` dans le navigateur, **mais son JWT Supabase reste valide**. En appelant l'API Supabase directement (fetch/curl/Postman avec le token déjà présent dans `localStorage['kaytek-auth']`, ou simplement en modifiant l'état React via les devtools pour ne pas rendre `SubscriptionBlockedScreen`), il continue de lire/écrire normalement toutes les données de son organisation.
- **Impact** : Le gating d'abonnement — fonctionnalité coeur du modèle self-service Stripe (cf. mémoire projet "Stripe self-service gap") — n'empêche pas l'usage réel de l'application pour un abonnement expiré, seulement l'usage via l'UI officielle. Impact business direct (contournement du paiement) plutôt qu'une fuite de données inter-organisation.
- **Recommandation** : Faire porter le blocage par les RLS elles-mêmes (fonction `SECURITY DEFINER` type `organisation_has_active_subscription(org_id)` intégrée aux policies des tables métier, ou vérification côté Edge Function/middleware pour les mutations sensibles), en plus du garde-fou UI actuel qui reste utile pour l'UX.
- **Statut** : Vérifié (absence confirmée par recherche dans les 102 migrations).

---

### SEC2-02 — Limite de 2 appareils appliquée uniquement côté client, avec identifiants auto-déclarés

- **Gravité** : Moyenne
- **Confiance** : Confirmé
- **Fichier** : `src/lib/devices.ts` (`registerDevice`, `getDeviceId`, `getDeviceFingerprint`)
- **Fonction** : `registerDevice()`, appelée uniquement depuis `signIn()` (`src/lib/supabase/auth.ts:48`)
- **Description** : `device_id` et `device_fingerprint` sont générés et envoyés par le navigateur lui-même (`crypto.randomUUID()` + user-agent/écran/langue). Le contrôle de la limite (`MAX_DEVICES = 2`) n'existe que dans cette fonction JS, appelée volontairement par `signIn()` — rien côté Supabase (RLS, trigger, RPC) ne recompte ni ne plafonne les lignes `devices` actives à la connexion.
- **Scénario** : Un utilisateur (ou un script automatisé utilisant `@supabase/supabase-js` ou l'API REST directement avec email/mot de passe) peut se connecter sans jamais appeler `registerDevice`, ou en envoyant systématiquement un `device_id`/`device_fingerprint` déjà connu de l'organisation, contournant ainsi totalement la limite d'appareils. Les admins sont d'ailleurs déjà explicitement exemptés (`isAdmin` param), ce qui montre que la fonctionnalité est traitée comme une règle métier et non comme un contrôle de sécurité strict.
- **Impact** : Contournement d'une fonctionnalité de licence/limitation d'appareils annoncée comme mesure de sécurité aux utilisateurs (message d'erreur "Limite d'appareils atteinte"). N'affecte pas l'isolation multi-tenant.
- **Recommandation** : Si cette limite doit rester une garantie réelle (et pas seulement un confort UX), la faire appliquer côté serveur (Edge Function appelée après `signInWithPassword`, ou hook Supabase Auth) plutôt que par un appel client optionnel.
- **Statut** : Vérifié.

---

### SEC2-03 — Comptes désactivés (`profiles.actif = false`) : aucune vérification au login ni à la restauration de session côté frontend

- **Gravité** : Moyenne
- **Confiance** : Confirmé (frontend) / Plausible (portée exacte de l'effet RLS, à confirmer en phase 3)
- **Fichiers** : `src/lib/supabase/auth.ts` (`signIn`, lignes 22-64), `src/App.tsx` (`initAuth`, lignes 205-290), `src/pages/UsersPage.tsx` (`toggleActive`, ligne 114)
- **Description** : `UsersPage` permet à un admin de "Désactiver" un compte (`actif = false` sur `profiles`). Ni `signIn()` ni `initAuth()` (restauration de session au chargement) ne vérifient `profile.actif` avant d'appeler `setUser(profile)` — un compte désactivé qui connaît encore son mot de passe (le compte Supabase Auth lui-même n'est pas suspendu par cette action) se connecte normalement et obtient un dashboard fonctionnel côté UI.
- **Élément atténuant confirmé côté base** : les fonctions RLS `is_admin()`, `is_intervenant()`, `is_assistant()` (`supabase/migrations/20260610000016_rls_helpers_multitenant.sql:66`, `20260708000007_assistant_role_foundations.sql:101`, `20260708000008_security_phase1_critical_hardening.sql:33`) incluent bien `AND actif = true` — donc les policies qui s'appuient sur ces helpers refusent déjà l'accès aux comptes désactivés. Ce qui n'a **pas** été vérifié dans cette phase (portée = phase 3) : si *toutes* les policies des tables sensibles passent bien par ces helpers, ou si certaines s'appuient uniquement sur `organisation_id`/`auth.uid()` sans re-vérifier `actif`.
- **Scénario (correspond au scénario 4 demandé)** : Un intervenant désactivé se reconnecte avec son mot de passe existant → l'app se charge sans aucun message d'erreur ni redirection, contrairement à l'attente induite par le bouton "Désactiver" côté admin. L'étendue réelle des données ensuite accessibles dépend des policies RLS par table (non exhaustivement vérifiées ici).
- **Impact** : Expérience trompeuse pour l'admin ("désactivé" ne coupe pas visiblement l'accès applicatif) ; risque de données réellement accessibles si une policy métier ne repasse pas par `is_admin()`/`is_intervenant()`/`is_assistant()`.
- **Recommandation** : Ajouter un contrôle explicite `if (!profile.actif) { signOut(); afficher "compte désactivé" }` dans `signIn()` et `initAuth()`, en plus de la vérification RLS déjà existante ; auditer en phase 3 que 100% des policies sensibles repassent par les helpers `is_*()`.
- **Statut** : Vérifié pour la partie frontend ; hypothétique/à confirmer pour la portée exacte de l'impact RLS.

---

### SEC2-04 — Restrictions de rôle sur les routes : garde frontend uniquement, protection réelle à confirmer en phase 3

- **Gravité** : Moyenne (structurel, pas un bug isolé)
- **Confiance** : Confirmé (pour la partie frontend) / dépendance non vérifiée (pour la partie backend)
- **Fichier** : `src/App.tsx` (`Guard`, lignes 44-84 et déclarations de routes 365-393)
- **Description** : Toutes les restrictions par rôle (`adminOnly`, `allowedRoles`, `requireCanCreateDocs`) sont des tests `if` en React qui redirigent vers `/dashboard` — elles ne font que masquer le rendu du composant. `/parametres`, `/utilisateurs`, `/journal`, `/catalogue`, `/partenaires` (admin uniquement), `/factures`, `/commissions`, `/devis` (admin+intervenant), `/clients` (admin+assistant) suivent ce modèle.
- **Scénarios (correspondent aux scénarios 1 et 5 demandés)** :
  1. Un intervenant qui navigue directement vers `/utilisateurs` ou `/parametres` est simplement redirigé vers `/dashboard` par `Guard` — pas de fuite d'UI, comportement correct.
  2. Un utilisateur modifiant `user.role` via les DevTools React ne changerait que l'état en mémoire du montage courant (voir SEC2-12 plus bas pour l'analyse détaillée) : cela peut faire *afficher* des pages autrement masquées, mais toute requête Supabase sous-jacente resterait soumise aux RLS server-side, qui recalculent le rôle depuis `profiles` en base à partir du JWT — donc pas d'accès aux données au-delà de ce que permettent ces policies.
- **Impact** : Aucune fuite de données confirmée par la seule navigation ou la manipulation de l'état frontend — **à condition que chaque table/fonction sensible dispose bien d'une policy RLS équivalente à la restriction visuelle** (ex. RLS sur `factures`/`commissions`/`parametres_entreprise` limitant réellement l'accès aux mêmes rôles que `allowedRoles`/`adminOnly` côté frontend). Cette hypothèse n'est pas vérifiée dans cette phase.
- **Recommandation** : Traiter chaque restriction de rôle frontend comme un signal de ce qui *doit* exister côté RLS, et vérifier systématiquement la correspondance en phase 3 (`factures`, `commissions`, `partenaires`, `utilisateurs`/`profiles`, `parametres_entreprise`, `journal`, `catalogue`/`prestations`).
- **Statut** : Vérifié pour le mécanisme frontend ; la protection backend correspondante est hors périmètre de cette phase (couverte par [phase-03-supabase-rls.md] à venir).

---

### SEC2-05 — Protection anti-brute-force du login uniquement côté client

- **Gravité** : Faible à moyenne
- **Confiance** : Confirmé
- **Fichier** : `src/pages/LoginPage.tsx` (lignes 15-27, 89-116)
- **Description** : Après 5 échecs, un verrou de 15 minutes est posé via `localStorage.setItem('kaytek-login-bf', ...)`. C'est un compteur purement client, revérifié uniquement dans `handleLogin` avant l'appel à `signIn()`.
- **Scénario** : Effacer `localStorage` (ou ouvrir une fenêtre de navigation privée, ou appeler `supabase.auth.signInWithPassword` directement via un script) réinitialise le compteur à zéro à chaque tentative — le blocage affiché à l'utilisateur légitime n'a aucun effet sur un attaquant scriptant les requêtes.
- **Impact** : La seule protection anti-brute-force réelle contre une attaque par script est celle appliquée par Supabase Auth lui-même côté serveur (rate limiting GoTrue par IP/e-mail) — dont la configuration précise n'est pas vérifiable depuis ce dépôt.
- **Recommandation** : Ne pas présenter ce mécanisme comme une protection de sécurité dans la documentation utilisateur ; vérifier/renforcer les paramètres de rate-limiting natifs de Supabase Auth (Dashboard → Authentication → Rate Limits), et envisager un CAPTCHA ou un verrou serveur (Edge Function) si un renforcement est nécessaire.
- **Statut** : Vérifié (mécanisme confirmé purement client) ; efficacité réelle du filet serveur non vérifiable dans ce périmètre.

---

### SEC2-06 — Politique de mot de passe faible (6 caractères minimum, aucune complexité)

- **Gravité** : Faible
- **Confiance** : Confirmé
- **Fichiers** : `src/pages/ActivationPage.tsx:66`, `src/pages/ResetPasswordPage.tsx:35`
- **Description** : `if (password.length < 6)` est la seule validation appliquée avant `supabase.auth.updateUser({ password })`. Aucune exigence de complexité (majuscule/chiffre/symbole) côté frontend.
- **Impact** : Facilite les mots de passe faibles pour des comptes admin/intervenant/assistant, notamment lors de l'activation d'un compte invité.
- **Recommandation** : Relever le minimum (8-12 caractères) et/ou activer la politique de mot de passe de Supabase Auth (paramètre projet, hors dépôt) plutôt que de ne s'appuyer que sur cette validation client contournable (un appel direct à `updateUser` sans passer par le formulaire n'est bloqué que si Supabase applique lui-même une règle équivalente côté serveur).
- **Statut** : Vérifié.

---

### SEC2-07 — Jetons de session réels committés (`guide/.auth/admin.json`, `guide/.auth/intervenant.json`)

- **Gravité** : Faible (compte de test dédié, token d'accès expiré) mais confirmé
- **Confiance** : Confirmé
- **Fichiers** : `guide/.auth/admin.json`, `guide/.auth/intervenant.json` (suivis par git, cf. phase-01 §13 finding 7)
- **Description** : Ces fixtures Playwright contiennent un `access_token` + `refresh_token` Supabase réels pour `admin@kaytek.test` (`access_token` expiré au 2026-06-15 ; statut de révocation du `refresh_token` non vérifiable depuis ce dépôt). À la différence de `tests/.auth/` (correctement exclu par `.gitignore`), `guide/.auth/` a été commité.
- **Scénario** : Toute personne ayant accès à l'historique git du dépôt peut extraire ce `refresh_token` et tenter de l'utiliser pour obtenir un nouvel `access_token` valide sur ce projet Supabase, tant qu'il n'a pas été révoqué côté serveur.
- **Impact** : Limité par le fait qu'il s'agit d'un compte de test dédié (`kaytek.test`), pas d'un compte client réel — mais mauvaise pratique et risque si ce compte a des droits admin sur un environnement partagé (à vérifier).
- **Recommandation** : Révoquer ce refresh token (forcer une déconnexion globale du compte via Supabase Auth Admin API), retirer `guide/.auth/` du suivi git (`git rm --cached` + ajout au `.gitignore`, à l'image de `tests/.auth/`), et envisager une purge d'historique si le dépôt est partagé largement.
- **Statut** : Vérifié.

---

### SEC2-08 — Biométrie native : gate au niveau de l'appareil (PIN/empreinte OS), pas un facteur applicatif indépendant

- **Gravité** : Information (conception assumée, pas une anomalie en soi)
- **Confiance** : Confirmé
- **Fichier** : `src/lib/biometric.ts` (`registerBiometric`, `authenticateWithBiometric`, natif : lignes 61-77, 120-135), option `allowDeviceCredential: true`
- **Description** : Sur Android/iOS (Capacitor), `BiometricAuth.authenticate()` ne fait que déclencher le prompt biométrique/PIN natif du système d'exploitation — la validation ne repose sur aucune clé cryptographique propre à Kaytek. `localStorage['kaytek-biometric-cred'] = 'native'` n'est qu'un indicateur "biométrie activée", pas un secret. `allowDeviceCredential: true` signifie explicitement que le code PIN/schéma de déverrouillage de l'appareil est également accepté.
- **Scénario** : Quiconque peut déverrouiller le téléphone physique (empreinte, visage ou code PIN de l'appareil) peut déverrouiller l'app Kaytek si une session valide existe déjà — équivalent au modèle de la plupart des apps bancaires/grand public.
- **Impact** : Aucun, dans la mesure où c'est le modèle de sécurité assumé (déverrouillage de l'appareil = déverrouillage de l'app). À documenter clairement si ce n'est pas explicite pour les utilisateurs/admins.
- **Recommandation** : Aucune action requise si ce modèle est intentionnel ; sinon, retirer `allowDeviceCredential: true` pour exiger strictement une biométrie (pas de repli PIN).
- **Statut** : Vérifié (comportement du code), jugement de risque informationnel.

---

### SEC2-09 — WebAuthn (biométrie web) : assertion vérifiée uniquement côté client, jamais soumise à un serveur

- **Gravité** : Information
- **Confiance** : Confirmé
- **Fichier** : `src/lib/biometric.ts` (branche web, lignes 79-111 et 137-155)
- **Description** : Le challenge WebAuthn est généré côté client (`crypto.getRandomValues`), et la réussite de `authenticateWithBiometric()` sur le web ne teste que `!!assertion` — aucune signature n'est envoyée à un backend pour vérification cryptographique. Ce n'est donc pas une cérémonie WebAuthn complète (relying-party server-side), seulement un verrou local.
- **Impact réel limité** : Cette étape ne remplace jamais l'authentification Supabase — `handleBiometricLogin`/`triggerBiometric` exigent en plus une session Supabase déjà valide (`supabase.auth.getSession()`), donc contourner l'assertion WebAuthn ne donne accès à aucune donnée qui ne serait pas déjà accessible via la session existante.
- **Recommandation** : Si l'objectif affiché aux utilisateurs est une "authentification par empreinte" au sens fort, envisager une vérification serveur de l'assertion (webauthn relying party) ; sinon, documenter que c'est un verrou de confort équivalent à un code PIN local.
- **Statut** : Vérifié.

---

### SEC2-10 — Session Supabase persistée en `localStorage` (surface d'exfiltration en cas de XSS)

- **Gravité** : Information
- **Confiance** : Confirmé
- **Fichier** : `src/lib/supabase/client.ts` (`persistSession: true`, `storageKey: 'kaytek-auth'`)
- **Description** : Conforme au comportement standard du SDK Supabase pour une SPA (pas de mode "cookie-only" configuré). Le jeton complet (access + refresh token) est donc lisible par tout script JS s'exécutant dans la page.
- **Élément atténuant vérifié** : recherche de `dangerouslySetInnerHTML` dans tout `src/` → aucune occurrence. Pas de sink XSS évident identifié dans le périmètre inspecté (pages d'authentification, layout, document public). Reste non couvert par cette phase : librairies tierces (PDF, Excel, FullCalendar) et le contenu généré dynamiquement dans les autres pages non lues en détail (`CataloguePage`, `MessagingPage`, etc. — à couvrir si une revue XSS plus large est souhaitée).
- **Impact** : Risque standard des SPA Supabase, pas une erreur de configuration spécifique à ce projet.
- **Recommandation** : Aucune action immédiate ; rester vigilant sur tout futur rendu de contenu utilisateur non échappé (messagerie, notes de devis/facture, champs libres partenaires) qui n'a pas été passé en revue exhaustive ici.
- **Statut** : Vérifié pour le périmètre inspecté ; non exhaustif pour l'ensemble du code.

---

### SEC2-11 — Logs `console.*` verbeux sur le flux d'authentification en production

- **Gravité** : Information
- **Confiance** : Confirmé
- **Fichiers** : 66 occurrences de `console.log/error/warn` dans 11 fichiers, dont `src/App.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LockScreen.tsx`, `src/lib/devices.ts`
- **Description** : De nombreux logs exposent le déroulé interne de l'auth (`[Guard] no user → /login`, `[LockScreen] tentative mot de passe pour <email>`, `[App] arrière-plan → verrouillage`, etc.). Aucun mot de passe ni jeton en clair observé dans l'échantillon lu, mais l'email de l'utilisateur et la mécanique interne (timing du verrouillage, chemins de redirection) sont visibles dans la console de n'importe quel navigateur.
- **Impact** : Faible en soi, mais facilite la reconnaissance du fonctionnement interne par un attaquant local (ex. sur un poste partagé) et n'a pas sa place dans un build de production.
- **Recommandation** : Supprimer ou conditionner ces logs à un flag de développement (`import.meta.env.DEV`).
- **Statut** : Vérifié.

---

### SEC2-12 — Modification du rôle dans l'état frontend (Zustand/DevTools) : bypass UI uniquement, pas d'accès data

- **Gravité** : Information (pas une vulnérabilité confirmée)
- **Confiance** : Confirmé (analyse de code) — pas testé en conditions réelles (pas d'attaque tentée, conformément aux règles de la phase)
- **Fichier** : `src/lib/store.ts` (`useAuthStore`, `partialize` ligne 40 — seul `isAppUnlocked` est persisté, pas `user`)
- **Description (répond au scénario 3 demandé)** : Un utilisateur modifiant `user.role` dans le store Zustand en mémoire (React/Redux DevTools) changerait le rendu et le routing de l'onglet courant (ex. faire apparaître des liens de menu admin), mais :
  1. cet état n'est pas persisté (`partialize` ne garde que `isAppUnlocked`) — un rechargement de page restaure le vrai rôle depuis `profiles` ;
  2. surtout, toute requête Supabase qui suit reste évaluée par les policies RLS côté serveur à partir du JWT réel (`auth.uid()`), pas depuis l'état client — donc cette manipulation ne peut PAS élargir l'accès aux données au-delà de ce que les RLS autorisent déjà pour le vrai rôle de l'utilisateur (sous réserve, comme indiqué en SEC2-04, que chaque table sensible ait bien une policy correspondante).
- **Impact** : Nul sur les données, à condition que le raisonnement RLS de SEC2-04 soit confirmé en phase 3.
- **Recommandation** : Aucune action frontend nécessaire ; dépend entièrement de la complétude des RLS (phase 3).
- **Statut** : Vérifié par analyse de code (pas de test dynamique effectué).

---

### SEC2-13 — Pages à paramètre `:id` : aucune vérification de propriété côté frontend, dépendance totale aux RLS

- **Gravité** : Moyenne (structurel) — à requalifier après phase 3
- **Confiance** : Confirmé (mécanisme) / dépendance RLS non vérifiée ici
- **Fichiers** : `src/pages/ClientDetailPage.tsx`, `src/pages/InterventionDetailPage.tsx`, `src/pages/DevisFormPage.tsx`, `src/pages/DevisApercuPage.tsx`, routes `clients/:id`, `interventions/:id`, `devis/:id/editer`, `devis/:id/apercu`, `messagerie/:userId` (`src/App.tsx:370-380`)
- **Description (répond au scénario 2 demandé)** : Chacune de ces pages lit `useParams<{ id }>()` et transmet directement la valeur à une requête `.from(...).eq('id', id)` (ou équivalent) sans aucun contrôle d'appartenance à l'organisation ou au profil courant côté React — le modèle Supabase attend que ce soit la RLS qui filtre. C'est une architecture standard et acceptable pour ce type d'app, **à condition que chaque table exposée par ces pages (`clients`, `interventions`, `devis`, `messages`) ait une policy RLS empêchant la lecture/écriture d'une ligne appartenant à une autre organisation ou (selon le rôle) à un autre profil**.
- **Scénario** : Un assistant modifiant l'`id` dans l'URL `/clients/<autre-id>` obtiendra soit les données du client visé (si la policy RLS l'autorise, ex. client de sa propre organisation), soit une réponse vide/erreur (si la policy le bloque) — le frontend ne fait aucune différence, il affiche ce que Supabase retourne.
- **Impact** : Potentiellement élevé (IDOR inter-organisation) si une policy RLS sur l'une de ces tables est manquante ou trop permissive — non constaté ici, à vérifier explicitement en phase 3 avec des comptes de test de deux organisations différentes (les tests `tests/multi-tenant/*.spec.ts` repérés en phase 1 couvrent partiellement ce point).
- **Recommandation** : Confirmer en phase 3 la présence et la correction d'une policy RLS restrictive sur `clients`, `interventions`, `devis`, `factures`, `messages` pour les opérations SELECT/UPDATE/DELETE par `id` direct.
- **Statut** : Mécanisme vérifié ; conséquence sécurité hypothétique tant que la phase 3 n'a pas confirmé la couverture RLS.

---

## Vérifications ciblées n'ayant rien révélé (à signaler pour ne pas laisser de zone d'ombre)

- **`dangerouslySetInnerHTML` / injection HTML** : aucune occurrence dans `src/`.
- **Redirections ouvertes** : `window.location.href` uniquement utilisé pour des liens `tel:`/`sms:` (valeurs internes, pas de paramètre attaquant-contrôlable menant vers un domaine externe) ; la redirection post-login (`sessionStorage['kaytek-push-redirect']`) est un chemin relatif interne (`location.pathname + search`), pas une URL absolue — pas de potentiel open-redirect identifié.
- **Double soumission** : spot-check sur le formulaire de sauvegarde de devis (`DevisFormPage.tsx`, boutons liés à `create.isPending || update.isPending`) — correctement désactivé pendant la mutation. Non vérifié exhaustivement sur les 24 pages.
- **Secrets frontend / `VITE_*`** : seules des valeurs publiques par conception sont exposées (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_APP_URL`) — cohérent avec le modèle de sécurité Supabase (la clé anon n'est pas un secret, la protection réelle est la RLS).

---

## Éléments non vérifiables dans cette phase

- Configuration réelle du **Site URL / Redirect URLs** dans le dashboard Supabase Auth (mémoire projet signale un historique de "Site URL misconfig" pointant vers un ancien domaine Vercel) — impacte potentiellement `resetPassword()` (`src/lib/supabase/auth.ts:67`, `redirectTo = window.location.origin + '/reset-password'`) et `ActivationPage`. Non vérifiable depuis ce dépôt (accès dashboard requis).
- Paramètres de rate-limiting et de politique de mot de passe réels côté Supabase Auth (SEC2-05, SEC2-06) — configuration projet, hors dépôt.
- Statut de révocation effective du `refresh_token` trouvé dans `guide/.auth/admin.json` (SEC2-07).
- Couverture exhaustive des policies RLS pour SEC2-01, SEC2-03, SEC2-04, SEC2-13 — réservée à la phase 3.
- Revue XSS exhaustive au-delà du périmètre lu (messagerie, catalogue, contenu partenaire, guide) — seul un grep global sur `dangerouslySetInnerHTML` a été fait sur l'ensemble de `src/`.
- Comportement runtime réel (aucun test dynamique/attaque n'a été exécuté, conformément aux règles de la phase — toutes les conclusions viennent de la lecture du code).

---

**Phase terminée. J'attends votre autorisation pour continuer.**
