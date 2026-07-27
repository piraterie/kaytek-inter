# Phase 2 — Guide de configuration Google Cloud (OAuth réel)

Ce guide couvre uniquement la configuration côté **Google Cloud** et les
**variables serveur Supabase** nécessaires à la Phase 2 (connexion OAuth).
Il ne couvre pas la Phase 3 (appels réels aux APIs Google Ads / Business
Profile pour récupérer des données).

Projet Google Cloud existant (fourni par l'utilisateur) :
- Nom : `kaytek`
- ID : `kaytek-1726611913099`
- Application OAuth en mode **Test**, audience **Externe**
- Utilisateur test ajouté : `castryludovic@gmail.com`
- Scopes déjà configurés dans Google Auth Platform : `openid`,
  `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
  `.../auth/business.manage`, `.../auth/adwords`

---

## 1. APIs à activer

Dans Google Cloud Console → **APIs & Services → Library**, activer pour le
projet `kaytek-1726611913099` :
- **Google Ads API** (nécessaire même pour la seule connexion OAuth — Google
  la demande à l'activation du scope `adwords`).
- **My Business Business Information API** et/ou **Business Profile
  Performance API** (selon la version d'API retenue pour la Phase 3 —
  non strictement requis pour la Phase 2, qui ne fait qu'obtenir les
  tokens, mais recommandé de les activer maintenant pour éviter un
  aller-retour).
- **People API** ou l'endpoint OpenID Connect standard (`openid`,
  `userinfo.email`, `userinfo.profile`) — utilisé uniquement pour
  afficher l'e-mail du compte connecté, pas d'activation d'API séparée
  nécessaire (l'endpoint `openidconnect.googleapis.com` est disponible
  par défaut avec ces scopes).

## 2. Écran de consentement OAuth (déjà en place, à vérifier)

- **Audience : Externe** — déjà configuré.
- **Mode : Test** — déjà configuré. Tant que l'app reste en mode Test,
  seuls les utilisateurs listés comme testeurs peuvent se connecter (max
  100), et le refresh_token émis a une durée de vie limitée à 7 jours
  glissants sauf publication de l'app.
- **Utilisateurs test** : `castryludovic@gmail.com` déjà ajouté. Ajouter
  ici tout autre compte Google qui doit pouvoir tester la connexion
  (chaque administrateur Kaytek qui testera la Phase 2 doit être dans
  cette liste tant que l'app n'est pas publiée/vérifiée).
- **Scopes déclarés** : `openid`, `userinfo.email`, `userinfo.profile`,
  `business.manage`, `adwords` — déjà configurés, ne pas en ajouter
  d'autres pour la Phase 2.

## 3. Création du Client OAuth Web

Google Cloud Console → **APIs & Services → Identifiants → Créer des
identifiants → ID client OAuth** :
- **Type d'application** : Web application
- **Nom** : ex. `Kaytek Inter — Edge Functions OAuth`
- **URI de redirection autorisées** (ajouter les DEUX — local ET
  production, elles ne se gênent pas) :
  - `http://127.0.0.1:54321/functions/v1/google-oauth-callback`
  - `https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/google-oauth-callback`
- **Origines JavaScript autorisées** : non nécessaires ici (le flux est
  entièrement piloté serveur, aucun appel OAuth client-side).

⚠️ **Ne pas créer ce Client tant que vous n'avez pas vous-même confirmé ces
deux URI** — c'est exactement le rôle de cette étape. Une fois créé, Google
affiche le **Client ID** et le **Client Secret** une seule fois de façon
visible en clair (récupérables ensuite depuis la console, mais autant les
copier immédiatement dans un gestionnaire de secrets).

## 4. Variables serveur à définir (Supabase Edge Functions)

**Jamais dans Git, jamais dans le frontend.** Définies exclusivement via :
```bash
supabase secrets set GOOGLE_OAUTH_CLIENT_ID=<valeur>
supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET=<valeur>
supabase secrets set GOOGLE_OAUTH_REDIRECT_URI=<valeur selon l'environnement>
supabase secrets set GOOGLE_OAUTH_STATE_SECRET=<valeur aléatoire, ex. openssl rand -base64 32>
supabase secrets set GOOGLE_ADS_DEVELOPER_TOKEN=<valeur>
supabase secrets set GOOGLE_OAUTH_FRONTEND_SUCCESS_URL=<URL frontend>
supabase secrets set GOOGLE_OAUTH_FRONTEND_ERROR_URL=<URL frontend>
```
Voir `supabase/functions/.env.example` (non versionné, comme
`.env.test.example` — noms de variables et commentaires uniquement) pour
le détail de chaque variable.

`GOOGLE_ADS_DEVELOPER_TOKEN` : demande séparée dans le
[Google Ads API Center](https://ads.google.com/aw/apicenter) du compte
manager (MCC) Kaytek — niveau **Basic Access** suffisant pour démarrer
(quotas limités), **Standard Access** nécessaire avant un usage en
production à plusieurs organisations. Non utilisé par le code de la
Phase 2 elle-même (préparé pour la Phase 3).

## 5. Procédure de test (Phase 2, local)

1. `supabase secrets set ...` avec les valeurs ci-dessus, `GOOGLE_OAUTH_REDIRECT_URI` = l'URI **locale**.
2. Démarrer le stack local (`supabase start` si pas déjà fait) et servir les fonctions (`supabase functions serve`).
3. Se connecter à l'app locale avec un compte **admin actif**, aller sur `/parametres/integrations`.
4. Cliquer « Connecter Google Ads » (ou Business Profile) → redirection vers Google → se connecter avec `castryludovic@gmail.com` (ou un autre testeur ajouté) → accepter le consentement.
5. Vérifier la redirection retour vers `/parametres/integrations?google_status=success&provider=...`, le statut passe à « Connecté ».
6. Vérifier en base (local uniquement) qu'aucune colonne `access_token`/`refresh_token` en clair n'existe — uniquement des `*_secret_id`.

## 6. Procédure de révocation / déconnexion

- Depuis l'app : bouton « Déconnecter » sur `/parametres/integrations` (admin uniquement) → appelle `google-oauth-disconnect`, qui tente une révocation côté Google puis supprime les secrets Vault locaux.
- Manuellement côté Google (si nécessaire, ex. compte compromis) : [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → révoquer l'accès de l'application Kaytek directement depuis le compte Google concerné — la prochaine tentative d'utilisation du token stocké échouera et la connexion Kaytek passera automatiquement en statut `expired` au prochain contrôle (`google-oauth-status`).

## 7. Passage futur en production OAuth (au-delà de la Phase 2)

- Tant que l'app reste en **mode Test**, seuls les comptes listés comme
  testeurs peuvent se connecter — inutilisable par de vrais clients
  Kaytek.
- Passer en production nécessite la **vérification Google** de l'écran de
  consentement (obligatoire pour les scopes sensibles/restreints
  `adwords` et `business.manage`) : domaine vérifié (Search Console),
  politique de confidentialité publique accessible, page d'accueil de
  l'app, et pour les scopes **restreints** (`business.manage` en fait
  partie) une **évaluation de sécurité CASA** peut être exigée par Google
  — délai typique de plusieurs semaines, à anticiper largement avant toute
  commercialisation du module.
- `GOOGLE_ADS_DEVELOPER_TOKEN` doit passer de Basic à Standard Access
  avant tout usage réel multi-organisations (Phase 3).

## 8. Ce que je n'ai PAS fait (attend votre action)

- Aucun Client ID/Secret OAuth créé.
- Aucun secret `supabase secrets set` exécuté.
- Aucune Edge Function déployée (`supabase functions deploy`).
- Aucune demande de vérification Google déposée.
