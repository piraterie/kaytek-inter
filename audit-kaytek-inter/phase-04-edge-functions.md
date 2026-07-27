# Phase 4 — Edge Functions et backend

Date de l'analyse : 2026-07-21
Périmètre : les 7 Edge Functions de `supabase/functions/` (`envoyer-email`, `inviter-intervenant`, `get-public-document`, `send-push`, `send-reminders`, `send-telegram`, `supprimer-utilisateur`) + `_shared/validateEntreprise.ts`, croisées avec les migrations pertinentes (secret Vault SEC-06, RPC appelées). Méthode : lecture intégrale du code de chaque fonction. Aucune fonction appelée, aucun test dynamique, aucune modification. `get-public-document` a déjà été analysée en détail en phase 3 (RLS-03) sous l'angle isolation multi-tenant ; elle est reprise ici sous l'angle backend/Edge Function uniquement, sans répéter ce constat.

Aucun webhook Stripe, aucune tâche planifiée `pg_cron` active, et aucune fonction d'export n'existent dans ce dépôt — confirmé par lecture exhaustive des 7 fonctions et grep sur l'ensemble des migrations (cf. §5 et phases 1/3 : l'intégration Stripe est externe, hors dépôt).

---

## Tableau de synthèse

| Fonction | JWT | Organisation | Rôle | Validation | Idempotence | Risque | Recommandation |
|---|---|---|---|---|---|---|---|
| `envoyer-email` | Requis (Bearer, vérifié via `auth.getUser()`) | Vérifiée : `document.organisation_id` comparé à celle de l'appelant (jamais confiance au client) | admin OU (`can_create_documents` ET `can_bypass_validation`) | Bonne (champs requis, appartenance du document, Reply-To bloquant) | Non (chaque appel = envoi réel) | **Faible-Moyen** | Ajouter une limitation de débit par organisation/utilisateur |
| `inviter-intervenant` | Requis | Vérifiée (org dérivée serveur ; refus explicite si profil existant dans une autre org) | admin strict, whitelist rôle invitable (`intervenant`/`assistant`, jamais `admin`) | Champs requis ; `commission_pct` non borné | Partielle (upsert profil idempotent, mais email/lien renvoyés à chaque appel) | **Faible** | Retirer les logs `[DBG]` (PII), borner `commission_pct`, limiter le débit d'invitations |
| `get-public-document` | Non requis (public par design, contrôle par token) | Vérifiée (double contrôle token↔org, document↔org — SEC-03) | N/A (public) | Bonne | Oui (lecture seule) | **Faible** (voir phase 3, RLS-03 pour le détail liens permanents) | Cf. phase 3 |
| `send-push` | Requis (JWT) OU secret interne Vault (trigger DB) | Vérifiée pour le chemin JWT (destinataire même org) | Aucun contrôle de rôle explicite — cohérent avec RLS-04 (notifications ouvertes intra-org) | `user_id` requis ; titre/contenu non validés (longueur/contenu libre) | Non (envoi réel à chaque appel) | **Faible-Moyen** | Réduire la verbosité des logs (titre/contenu en clair), ajouter un rate-limit par `user_id` |
| `send-reminders` | Requis (JWT admin) | Vérifiée et strictement scopée, réservation atomique anti-course | admin strict | Excellente (anti-doublon par colonnes `*_envoye_at` + claim atomique) | **Oui**, conçue explicitement pour ça | **Faible pour la sécurité / Moyen pour la fiabilité fonctionnelle** | Activer un réel déclenchement planifié (voir FN-04) |
| `send-telegram` | Requis (JWT) OU secret littéral `service_role` (interne) | Vérifiée (cross-org bloqué pour le mode utilisateur) | admin requis uniquement pour cibler un `chat_id` direct ; sinon tout membre de l'org peut cibler un `user_id` de sa propre org | `message` requis ; bon garde-fou anti relais ouvert | Non (envoi réel) | **Faible** | RAS notable |
| `supprimer-utilisateur` | Requis (JWT admin) | Vérifiée (cross-org explicitement refusé, 403) | admin strict | `userId` requis, appartenance vérifiée | Non testée (2e appel échouerait sur utilisateur déjà supprimé) | **Faible-Moyen** | Empêcher la suppression de son propre compte ou du dernier admin actif de l'organisation |

---

## Constats détaillés

### FN-01 — Aucune limitation de débit sur `envoyer-email` / `inviter-intervenant`

- **Gravité** : Faible-Moyenne
- **Confiance** : Confirmé
- **Fichiers** : `supabase/functions/envoyer-email/index.ts`, `supabase/functions/inviter-intervenant/index.ts`
- **Description** : Ces deux fonctions envoient un e-mail réel via l'API Brevo à chaque appel, sans aucun compteur, fenêtre de temps ou verrou. Un compte autorisé (admin, ou intervenant avec `can_create_documents`+`can_bypass_validation` pour `envoyer-email`) peut appeler la fonction en boucle.
- **Scénario (répond au scénario 7 demandé)** : un script utilisant un JWT valide (ex. compte compromis, ou un employé malveillant) appelle `envoyer-email` des centaines de fois avec des `to` différents ou identiques → envoi massif via le compte Brevo de l'organisation, risque de dépassement de quota, de blacklistage du domaine d'envoi, ou de nuisance envers des tiers.
- **Impact** : dégradation de la délivrabilité email pour l'organisation concernée (et potentiellement pour d'autres si l'infrastructure Brevo est mutualisée par IP). Aucune fuite de données.
- **Recommandation** : ajouter un compteur simple (table Postgres ou compteur en mémoire par instance Edge Function, mieux : table avec fenêtre glissante) limitant le nombre d'envois par organisation/utilisateur/heure.
- **Statut** : Vérifié (absence de mécanisme confirmée par lecture complète du code).

---

### FN-02 — Logs de debug contenant des données personnelles dans `inviter-intervenant`

- **Gravité** : Faible
- **Confiance** : Confirmé
- **Fichier** : `supabase/functions/inviter-intervenant/index.ts` (lignes 91, 93, 110, 112, 126, 132, 140, 143)
- **Description** : De nombreux `console.log('[DBG] ...')` écrivent en clair, dans les logs Supabase Edge Functions, le payload complet des opérations `profiles.update`/`profiles.upsert` (email, nom, prénom, rôle, `organisation_id`, `commission_pct`) ainsi que les détails d'erreurs Postgres (`message`, `code`, `details`, `hint`).
- **Impact** : les logs Edge Function sont accessibles depuis le Dashboard Supabase par les personnes ayant accès au projet — pas d'exposition publique, mais cela concentre des données personnelles (PII) dans un système de logs qui n'est généralement pas conçu pour être un entrepôt de données personnelles (rétention, RGPD). **Aucun secret technique (clé API, token, mot de passe) n'a été trouvé loggé en clair** — uniquement des PII utilisateur.
- **Recommandation** : retirer ces logs `[DBG]` (visiblement des restes de débogage) avant toute mise en production, ou au minimum les réduire à des identifiants non-PII (ex. `profile.id` seul plutôt que email/nom/prénom complets).
- **Statut** : Vérifié — répond au scénario 10 demandé (aucun secret d'infrastructure trouvé, mais de la PII oui).

---

### FN-03 — `send-reminders` : aucune tâche planifiée active, dépend d'une action humaine

- **Gravité** : Moyenne (fiabilité fonctionnelle, pas sécurité)
- **Confiance** : Confirmé
- **Fichiers** : `supabase/functions/send-reminders/index.ts` (commentaire d'en-tête : *"Déclenchement : bouton admin depuis la page Planning... Le déclenchement pg_cron / secret interne multi-organisation est traité séparément plus tard — non activé ici"*), `supabase/migrations/20260630000003_interventions_rappels.sql` (bloc `pg_cron` commenté, *"optionnel — ignoré si pg_cron non activé"*, message final : *"pg_cron : configurer manuellement si souhaité"*), `src/pages/PlanningPage.tsx:425-444` (`checkRappels` appelée uniquement au montage de la page — `useEffect(() => { if (isAdmin) checkRappels(true) }, [isAdmin])` — et via un bouton manuel)
- **Description** : la fonctionnalité "rappels automatiques avant intervention" (24h/2h/30min) ne se déclenche **que** lorsqu'un administrateur ouvre la page `/planning` (vérification silencieuse à l'ouverture) ou clique explicitement sur le bouton "Vérifier les rappels". Il n'existe **aucun** déclenchement serveur périodique (`pg_cron`) actif dans les migrations — le bloc SQL correspondant est présent mais explicitement commenté comme optionnel et jamais activé.
- **Scénario** : si aucun admin n'ouvre l'application entre le moment où une intervention entre dans une fenêtre de rappel (ex. 30 minutes avant) et l'heure de l'intervention, ni l'intervenant assigné ni les admins ne reçoivent de rappel — la fonctionnalité fonctionne, mais seulement par effet de bord d'une navigation humaine, pas comme un vrai service de rappel automatique.
- **Impact** : risque fonctionnel/métier (client non prévenu, intervenant non rappelé), pas un risque de sécurité ou de fuite de données. Le mécanisme d'idempotence/anti-doublon interne est lui-même excellent (réservation atomique) — le problème est uniquement l'absence de déclencheur fiable.
- **Recommandation** : activer un véritable déclenchement planifié — soit `pg_cron` + `pg_net` côté Supabase (le SQL est déjà écrit et prêt, juste commenté), soit un cron externe (Vercel Cron, GitHub Actions, ou tout autre orchestrateur) appelant l'Edge Function toutes les 5-10 minutes avec une authentification adaptée (actuellement la fonction n'accepte qu'un JWT utilisateur admin interactif — un vrai cron nécessiterait le chemin service_role/secret interne mentionné comme "à traiter séparément" dans le commentaire du fichier).
- **Statut** : Vérifié.

---

### FN-04 — `supprimer-utilisateur` : pas de garde-fou contre l'auto-suppression ou la suppression du dernier admin

- **Gravité** : Faible-Moyenne
- **Confiance** : Confirmé
- **Fichier** : `supabase/functions/supprimer-utilisateur/index.ts`
- **Description** : la fonction vérifie que l'appelant est admin et que la cible appartient à la même organisation, mais ne vérifie jamais si `userId === (l'appelant lui-même)` ni s'il s'agit du dernier profil `role='admin' AND actif=true` de l'organisation.
- **Scénario** : un admin (par erreur, ou via un compte compromis) supprime son propre compte ou celui du dernier autre admin de l'organisation → plus personne ne peut administrer l'organisation (utilisateurs, paramètres, catalogue), sans mécanisme de récupération applicatif (nécessiterait une intervention manuelle en base).
- **Impact** : verrouillage opérationnel d'une organisation entière, pas de fuite de données.
- **Recommandation** : ajouter une vérification explicite refusant la suppression de son propre compte et/ou du dernier admin actif de l'organisation (`COUNT(*) FROM profiles WHERE organisation_id=... AND role='admin' AND actif=true` doit rester ≥ 1 après suppression, en excluant l'appelant si pertinent).
- **Statut** : Vérifié.

---

### FN-05 — CORS `Access-Control-Allow-Origin: '*'` sur les 7 fonctions

- **Gravité** : Information
- **Confiance** : Confirmé
- **Description** : toutes les fonctions autorisent explicitement n'importe quelle origine. Comme l'authentification repose sur un header `Authorization: Bearer <JWT>` (jamais un cookie), un site tiers ne peut pas "profiter" automatiquement d'une session existante via CORS seul — il lui faudrait déjà posséder le JWT (ex. via un XSS ailleurs dans l'app, cf. phase 2). Le CORS ouvert supprime néanmoins une couche de défense en profondeur.
- **Recommandation** : restreindre `Access-Control-Allow-Origin` aux origines connues de l'application (domaine Vercel de production, `localhost` en dev) plutôt que `*`.
- **Statut** : Vérifié.

---

### FN-06 — Messages d'erreur transmis tels quels au client

- **Gravité** : Information
- **Confiance** : Confirmé
- **Description (répond au scénario 9 demandé)** : plusieurs fonctions renvoient directement `error.message`/`data.message` issus de Supabase (ex. `generateLink`) ou de l'API Brevo au client (`return respond({ error: linkErr.message })`, `return json({ error: data.message || 'Erreur Brevo' })`). Aucun message observé ne révèle de secret (clé, token) ni de structure de base de données exploitable, mais ce sont des messages d'erreur bruts d'un tiers, non maîtrisés par l'équipe.
- **Recommandation** : envisager un message générique côté client pour les erreurs externes (Brevo/Supabase Auth admin), en gardant le détail uniquement dans les logs serveur.
- **Statut** : Vérifié pour les fonctions lues ; pas de fuite de secret constatée.

---

## Scénarios évalués

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Appel d'une fonction sans JWT | **Bloqué** (sauf `get-public-document`, public par conception, et les chemins internes dédiés de `send-push`/`send-telegram`) | Toutes les fonctions à JWT obligatoire retournent 401/403 si `Authorization` absent ou invalide |
| 2 | Appel avec le JWT d'une autre organisation | **Bloqué** dans tous les cas vérifiés | `envoyer-email` (comparaison `document.organisation_id`), `inviter-intervenant` (refus si profil existant dans une autre org), `send-push`/`send-telegram` (comparaison org appelant/cible), `supprimer-utilisateur` (403 explicite "Suppression cross-organisation non autorisée") |
| 3 | Appel par un intervenant à une fonction admin | **Bloqué** | `inviter-intervenant`, `send-reminders`, `supprimer-utilisateur` : `role !== 'admin'` → 401/403 |
| 4 | Répétition de la même requête | **Dépend de la fonction** — `send-reminders` : protégé par conception (claim atomique, ré-appel = no-op sur les lignes déjà traitées) ; `envoyer-email`/`inviter-intervenant`/`send-push`/`send-telegram` : aucune protection, chaque appel ré-exécute l'action réelle (ré-envoi) ; `supprimer-utilisateur` : 2e appel échoue simplement (utilisateur déjà supprimé) |
| 5 | Rejeu d'un webhook | **Non applicable / non vérifiable** — aucun webhook Stripe (ni aucun autre) n'existe dans ce dépôt ; l'intégration Stripe est externe (cf. phases 1 et 3) |
| 6 | Modification d'un montant envoyé au backend | **Non applicable à ce périmètre** — aucune des 7 fonctions ne traite de montants financiers (devis/factures passent par le frontend + RLS, pas par une Edge Function) ; seul `commission_pct` (`inviter-intervenant`) est un champ numérique accepté sans borne — voir tableau de synthèse |
| 7 | Envoi massif d'e-mails | **Possible** — voir FN-01, aucune limitation de débit |
| 8 | Injection de paramètres | **Aucune injection SQL trouvée** (toutes les requêtes passent par le client `@supabase/supabase-js` paramétré, jamais de concaténation SQL brute) ; le contenu des notifications/messages Telegram est transmis tel quel aux API tierces sans neutralisation de formatage, risque mineur et non exploité (pas de `parse_mode` Telegram utilisé) |
| 9 | Récupération de données via un message d'erreur | **Partiellement** — voir FN-06, messages d'erreur tiers (Brevo/Supabase Auth) transmis bruts, sans fuite de secret constatée |
| 10 | Exposition d'un secret dans les logs | **PII trouvée, aucun secret d'infrastructure trouvé** — voir FN-02 (email/nom/prénom en clair) et `send-push` (titre/contenu de notification en clair) ; `BREVO_API_KEY`, `TELEGRAM_BOT_TOKEN`, `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ne sont jamais loggés en valeur dans les 7 fonctions lues (seule leur présence/longueur est loguée pour VAPID, ce qui est une bonne pratique) |

---

## 5. Fonctions recherchées explicitement — récapitulatif

| Fonction demandée | Trouvée | Où |
|---|---|---|
| Envoi d'e-mails | ✅ | `envoyer-email` (Brevo) |
| Invitation d'un intervenant | ✅ | `inviter-intervenant` (génère profil + lien Supabase Auth + email Brevo) |
| Création d'utilisateurs | ✅ (via `inviter-intervenant` + trigger `handle_new_user()`, cf. phase 3) | pas de fonction dédiée séparée |
| Rappels | ✅ | `send-reminders` (voir FN-03 pour la limite : pas de vrai déclenchement planifié) |
| Notifications push | ✅ | `send-push` (Web Push/VAPID) |
| Stripe | ❌ | Aucune fonction Stripe dans ce dépôt — webhook/checkout gérés par l'app externe (kaytekinter.fr, Netlify), confirmé phases 1 et 3 |
| Webhooks | ❌ | Idem — la table `stripe_webhook_events` existe côté DB (deny-all RLS) mais aucun code de traitement de webhook n'est présent ici |
| Abonnements | Partiel | Géré uniquement côté DB (RPC `get_my_organisation_subscription_status`, triggers de provisioning — cf. phase 3), aucune Edge Function dédiée dans ce dépôt |
| Suppression de compte | ✅ | `supprimer-utilisateur` |
| Exports | ❌ | Aucune Edge Function d'export — l'export Excel (`exceljs`/`xlsx`, repéré en phase 1) est généré **côté client** dans le navigateur, pas via une fonction serveur |
| Génération de liens | ✅ | `get-public-document` (lecture) + `useCreatePublicLink()` côté frontend (écriture directe via RLS, pas de fonction dédiée) — cf. phase 3 RLS-03 |
| Tâches planifiées | ⚠️ | Aucune tâche `pg_cron` active trouvée — seul un bloc SQL commenté existe pour `send-reminders` (voir FN-03) |

---

## 6. Éléments non vérifiables dans cette phase

- **Réglage `verify_jwt` par fonction** : aucun fichier `supabase/config.toml` n'existe dans ce dépôt pour documenter si la vérification JWT de la plateforme (couche Supabase, avant même que le code de la fonction s'exécute) est activée ou désactivée par fonction — chaque fonction réimplémente de toute façon sa propre vérification applicative, mais le réglage plateforme lui-même n'est pas visible depuis le code.
- **Quotas/rate-limiting réels côté Brevo, Telegram, VAPID/FCM** : ces protections externes (si elles existent) ne sont pas vérifiables depuis ce dépôt.
- **Comportement réel en production** : aucune fonction n'a été appelée ; toutes les conclusions viennent de la lecture statique du code TypeScript/Deno.
- **Rétention réelle des logs Supabase Edge Functions** (durée, accès) : configuration de projet, non vérifiable depuis ce dépôt — pertinent pour évaluer la gravité réelle de FN-02.
- **Existence d'un cron externe** (Vercel Cron, GitHub Actions, service tiers) qui appellerait `send-reminders` en dehors de ce dépôt : non trouvée dans `vercel.json` ni dans les fichiers de configuration lus, mais une intégration purement externe (comme pour Stripe) ne serait pas nécessairement visible ici.
- **Edge Functions de l'application commerciale externe** (kaytekinter.fr, Netlify) : hors périmètre de ce dépôt, non auditées.

---

**Phase terminée. J'attends votre autorisation pour continuer.**
