# Google Ads — pourquoi « Google n'a pas validé cette application » et comment le résoudre

Diagnostic du 2026-08-04, à partir du code réellement déployé (`supabase/functions/_shared/google-oauth.ts`, `google-oauth-start/index.ts`) et de la documentation Google actuelle. Aucune valeur de secret n'a été lue — seuls les **noms** de secrets présents en production ont été vérifiés (`supabase secrets list --project-ref dimrukkxehcwzemslwiz`).

## 1. Configuration OAuth utilisée par Kaytek Inter

- **Un seul client OAuth Google Cloud** (`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, secrets présents en production) est utilisé pour **les deux** produits — Google Ads et Google Business Profile ne sont pas séparés côté Google Cloud, seul le jeu de scopes demandé diffère par flux (`supabase/functions/_shared/google-oauth.ts:61-64`).
- Redirection : `GOOGLE_OAUTH_REDIRECT_URI`, doit être **exactement** `https://dimrukkxehcwzemslwiz.supabase.co/functions/v1/google-oauth-callback` — à vérifier dans Google Cloud Console → APIs & Services → Identifiants → votre client OAuth → « URI de redirection autorisés ». Un seul caractère de différence (http vs https, slash final, sous-domaine) provoque une erreur `redirect_uri_mismatch` distincte du problème actuel.
- Scopes demandés (`google-oauth.ts:52-64`) :
  - Toujours : `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (identité, affichage uniquement)
  - Connexion Google Ads : `https://www.googleapis.com/auth/adwords`
  - Connexion Google Business Profile : `https://www.googleapis.com/auth/business.manage`
  - Les deux jeux de scopes ne sont **jamais combinés** dans une même autorisation — une organisation peut connecter l'un sans l'autre (design volontaire).

## 2. Pourquoi Google affiche « application non validée » — uniquement pour Google Ads

Confirmé via la documentation Google actuelle ([Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)) :

- **`https://www.googleapis.com/auth/adwords` est classé scope « sensible »** par Google. Tant que l'application n'a pas terminé la vérification OAuth de Google pour ce scope précis, **tout** utilisateur qui n'est pas explicitement listé comme « utilisateur de test » voit l'écran « Google n'a pas validé cette application » — et si l'app est en statut de publication **Test** (et non Production), les utilisateurs non listés sont **bloqués sans aucun contournement possible** (message différent : « L'accès a été bloqué »).
- `https://www.googleapis.com/auth/business.manage` ne semble pas soumis à la même exigence de vérification (aucune mention dans les scopes sensibles/restreints trouvée) — ce qui explique pourquoi **la connexion Business Profile fonctionne déjà** avec le même client OAuth, alors que Ads bloque.
- Ce n'est **pas un bug Kaytek Inter** : c'est le comportement attendu de Google tant que la vérification n'est pas complétée pour ce scope.

### Comment distinguer les deux cas (à vérifier dans le navigateur au moment du blocage)

| Ce que vous voyez | Cause | Solution immédiate |
|---|---|---|
| « Cette application n'a pas été validée par Google » **avec un lien « Paramètres avancés »** | App en Production (ou Test + vous êtes un utilisateur de test), scope sensible non vérifié | Cliquez « Paramètres avancés » → « Accéder à Kaytek Inter (dangereux) » pour continuer malgré l'avertissement, en attendant la vérification |
| « L'accès a été bloqué : cette application n'a pas terminé le processus de validation de Google » **sans aucun lien pour continuer** | App en statut **Test**, et votre compte Google n'est **pas** dans la liste des utilisateurs de test | Ajoutez votre compte Google comme utilisateur de test (voir §3) — débloque immédiatement |

## 3. Déblocage immédiat (le temps que la vérification Google soit traitée)

Dans Google Cloud Console → **APIs & Services → Écran de consentement OAuth → Audience** :
1. Vérifiez le statut de publication de l'app (Test ou Production).
2. Si **Test** : section « Utilisateurs de test » → ajoutez l'adresse e-mail du compte Google que vous utilisez pour connecter Google Ads (jusqu'à 100 utilisateurs autorisés en statut Test).
3. Retentez la connexion Google Ads — l'écran d'avertissement apparaîtra encore, mais avec un lien « Paramètres avancés » cliquable cette fois.

Ceci ne dispense pas de la vérification officielle (§4) : les utilisateurs finaux de vos propres clients ne pourront pas être ajoutés un par un indéfiniment, et le bandeau d'avertissement reste visible pour tous tant que la vérification n'est pas complétée.

## 4. Checklist exacte pour demander la validation Google (accès production, scope `adwords`)

À préparer dans Google Cloud Console → **Écran de consentement OAuth** avant de soumettre la demande de vérification :

- [ ] **Nom de l'application** — doit être « Kaytek Inter » (ou un nom cohérent avec la marque publique), identique à ce qui est affiché à l'utilisateur pendant le consentement.
- [ ] **Logo de l'application** — logo réel de Kaytek Inter, pas un logo générique/placeholder.
- [ ] **E-mail d'assistance utilisateur** — une adresse surveillée réellement (pas une boîte inutilisée).
- [ ] **Domaine de l'application (page d'accueil)** — doit pointer vers un site public décrivant réellement Kaytek Inter (ex. `https://kaytekinter.fr` ou équivalent), pas l'URL de l'app elle-même (`app.kaytekinter.fr`) si celle-ci nécessite une connexion pour être vue.
- [ ] **Lien vers la politique de confidentialité** — publique, accessible sans connexion, décrivant précisément l'usage des données Google Ads (quelles données lues, pourquoi, durée de conservation, pas de partage à des tiers). Une page `/confidentialite` existe déjà dans le code (`src/pages/ConfidentialitePage.tsx`) — vérifier qu'elle couvre explicitement les données Google Ads/Business Profile.
- [ ] **Lien vers les conditions d'utilisation** — publique, accessible sans connexion.
- [ ] **Domaines autorisés** — le domaine de production (`kaytekinter.fr` et/ou `app.kaytekinter.fr`) doit être ajouté et **vérifié** via [Google Search Console](https://search.google.com/search-console) (propriété du domaine confirmée, pas juste déclarée).
- [ ] **Justification du scope `adwords`** — texte expliquant précisément l'usage : « Kaytek Inter permet à chaque organisation cliente de connecter son propre compte Google Ads pour afficher ses statistiques de campagnes (impressions, clics, dépenses, conversions) dans un tableau de bord unifié, en lecture seule — aucune campagne n'est créée ou modifiée par l'application. » (reflète exactement `listAccessibleAdsAccounts`, en lecture seule — voir le commentaire d'en-tête de `google-ads-api.ts`).
- [ ] **Vidéo de démonstration** — obligatoire pour les scopes sensibles quand ils ne sont pas triviaux à évaluer par capture d'écran seule. Doit montrer, sans coupure : connexion à Kaytek Inter → clic « Connecter Google Ads » → écran de consentement Google avec les scopes demandés visibles → retour dans Kaytek Inter → sélection du compte → affichage des données. Non tournable avant que la Phase 5 (dashboard Ads) de ce chantier ne soit terminée et déployée.
- [ ] **Confirmation qu'aucune donnée n'est utilisée hors de l'usage déclaré** — cohérent avec l'architecture actuelle (tokens en Vault, jamais transmis au frontend, lecture seule).

Délai observé (retours de développeurs tiers, variable) : de quelques jours à plusieurs semaines. Le développeur ne peut pas accélérer ce délai.

## 5. Développer Token Google Ads (blocage distinct, indépendant de la vérification OAuth)

Confirmé absent des secrets de production (`GOOGLE_ADS_DEVELOPER_TOKEN` ne figure pas dans `supabase secrets list`). Même une fois l'écran de consentement débloqué (§3 ou §4), la liste des comptes Google Ads échouera avec le message « L'accès à l'API Google Ads n'est pas encore configuré côté Kaytek » tant que ce secret n'est pas configuré. Ce token s'obtient depuis le [Google Ads API Center](https://ads.google.com/aw/apicenter) d'un compte Google Ads Manager (MCC), niveau d'accès `Basic` suffisant pour démarrer (accès `Standard` recommandé avant mise en production réelle, `Basic` a des quotas plus restreints). Une fois obtenu :
```
supabase secrets set GOOGLE_ADS_DEVELOPER_TOKEN=<votre_token> --project-ref dimrukkxehcwzemslwiz
```
Le code distingue déjà `developer_token_missing` (secret absent — vérifié avant tout appel réseau) de `developer_token_unapproved` (secret présent mais non approuvé/prohibé par Google) — deux messages différents affichés à l'admin (`src/pages/IntegrationsGooglePage.tsx:34-35`).
