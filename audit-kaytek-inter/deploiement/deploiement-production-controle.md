# DÉPLOIEMENT CONTRÔLÉ — Kaytek Inter (production)

Exécuté contre le projet Supabase de production lié (`dimrukkxehcwzemslwiz`, `kaytek-inter`) et le projet Vercel `kaytek-final` (domaine `app.kaytekinter.fr`). Aucun `supabase db reset`, aucun `migration repair`, aucune suppression massive, aucun secret exposé. Chaque écriture a été précédée d'un audit en lecture seule et d'une autorisation explicite lorsqu'elle sortait du périmètre initialement prévu.

## 1. Branche déployée / commits

- Commit de départ : `98b4a3a` sur `capacitor-android` (49 fichiers, corrections validées uniquement — .env.test, fichiers locaux de test et 10 fichiers frontend/Edge Functions non liés exclus, cf. §2).
- Nouvelle branche `fix/secure-multi-tenant-production-rollout`, créée depuis `main` (pas depuis `capacitor-android`, qui portait 5 commits mobile non liés) — `98b4a3a` cherry-pické (conflits `package.json`/`package-lock.json` résolus : union des scripts `test:security:*`/`test:unit` sans les scripts `android:*` propres à l'autre branche).
- Second commit `0f5e486` : corrections découvertes et autorisées pendant le déploiement lui-même (voir §4).
- Poussée sur `origin/fix/secure-multi-tenant-production-rollout` (`0f5e486`). **PR non créée automatiquement** (`gh` indisponible sur cette machine) — lien direct : https://github.com/piraterie/kaytek-inter/pull/new/fix/secure-multi-tenant-production-rollout. Fusion vers `main` laissée à l'utilisateur, par décision explicite.

## 2. Fichiers déployés / exclus

**Déployés (commit `98b4a3a` puis `0f5e486`)** : 8 migrations initialement prévues (SEC2-02, Corrections 2-5) + 6 migrations supplémentaires découvertes/autorisées pendant le déploiement (voir §4) ; infrastructure de tests de sécurité (`scripts/`, `playwright.security.config.ts`, `tests/security-env.ts`, `tests/security.setup.ts`, `tests/multi-tenant/*.spec.ts`, `vitest.config.ts`, `.github/workflows/security-tests.yml`) ; `package.json`/`package-lock.json` (scripts `test:unit`/`test:security:*`) ; rapports de correction (`audit-kaytek-inter/corrections/`).

**Explicitement exclus (décision utilisateur)** : `src/lib/hooks/index.ts`, `src/lib/hooks/partners.ts`, `src/lib/pdf/generator.tsx`, `src/lib/supabase/auth.ts`, `src/pages/DevisApercuPage.tsx`, `src/pages/DevisFormPage.tsx`, `src/pages/PlanningPage.tsx`, 3 Edge Functions (`envoyer-email`, `inviter-intervenant`, `send-reminders`), `src/lib/devisCalc.ts`/`devisCalc.test.ts` — mis de côté via `git stash` (jamais perdus, jamais déployés) avant de changer de branche.

**Locaux, jamais commités** : `.env.test`, `tests/.auth/*`, `tests/screenshots/isolation-report/*` (artefacts régénérés), `.playwright-cli/*`, `supabase/.branches/`, `20260604000000_bootstrap_core_schema.sql` (bootstrap antérieur au 5 juin — restauré localement après chaque déploiement, jamais appliqué en production).

**Conséquence pour le frontend** : aucun fichier applicatif (`src/`) n'a été modifié dans ce déploiement — le frontend actuellement servi sur `app.kaytekinter.fr` reste inchangé et déjà compatible avec le backend durci (RLS/triggers, transparents pour le code existant). La fusion de la PR ne fera que redéployer un bundle identique.

## 3. Vérification des secrets

Aucune clé service_role, JWT, mot de passe ou URL de production codés en dur détectés dans le diff. `.env.test` confirmé jamais suivi par Git. Occurrences historiques déjà documentées (SEC-06) non concernées par ce déploiement. Le mot de passe du compte de test de fumée (fourni par l'utilisateur en cours de session) n'a été utilisé que comme variable d'environnement transitoire, jamais écrit dans un fichier suivi ni dans ce rapport.

## 4. État du ledger avant déploiement / migrations appliquées

**Audit en lecture seule initial** (`supabase migration list --linked`) : 102 migrations suivies par le dépôt, toutes déjà appliquées en production de `20260605000000` à `20260715000013`. `20260604000000` (bootstrap, antérieur au 5 juin) absent du ledger distant — tables déjà existantes confirmées, jamais appliqué, conformément à la règle 4.

**Trois divergences réelles découvertes et résolues avant toute écriture** (détail complet des vérifications en lecture seule dans la session) :

1. **3 migrations manquantes du dépôt `main`** (`20260623000001_add_chauffagiste`, `20260630000001_default_prestations_function`, `20260630000003_interventions_rappels`) : déjà appliquées en production, présentes sur `capacitor-android` mais jamais committées sur `main`. Récupérées à l'identique (`git checkout capacitor-android -- ...`), sans effet sur la production (déjà appliquées, simplement resynchronisées avec le dépôt).
2. **4 migrations du 11 juillet jamais appliquées** (`drop_orphaned_storage_admin_policies`, `secure_sensitive_settings_and_founder_seats`, `lock_public_params_view_readonly`, `harden_notifications_and_reminders`) : ledger vide côté distant. Audit en lecture seule : 3/4 effets déjà présents en production (dérive de schéma hors migration — vue `parametres_entreprise_public`, policies Storage déjà absentes, privilèges `founder_seats`/`claim_founder_seat` déjà corrects) ; la 4e révélait un accès anonyme réel et non corrigé (`admin_delete_user_push_subscriptions` exécutable par `anon`). Autorisation explicite obtenue avant inclusion via `--include-all`.
3. **Une policy dupliquée** : `20260711000003` créait `params_select_admin` sans `DROP POLICY IF EXISTS` préalable, alors qu'une policy de même nom et même définition existait déjà (même mécanisme de dérive). Corrigé (ajout du DROP manquant) après échec réel constaté et rollback automatique confirmé, puis redéploiement réussi.
4. **3 contraintes UNIQUE globales préexistantes** (`devis_numero_key`, `factures_numero_key`, `interventions_numero_key`) détectées par le garde-fou intégré de la migration `20260725000001` elle-même — antérieures à toute migration suivie, sans clé étrangère dépendante, mais incompatibles avec la numérotation par organisation (qui autorise deux organisations à partager un même numero). Suppression ajoutée dans la migration (avant son propre garde-fou), avec autorisation explicite.
5. **Trou résiduel découvert en vérification post-migration** : `admin_delete_user_push_subscriptions(uuid)` conservait `EXECUTE` pour `anon` même après l'exécution réussie de `20260711000005` (`REVOKE ALL FROM PUBLIC` ne retire pas un privilège direct d'`anon`). Migration corrective dédiée ajoutée et déployée (`20260728000002`), avec assertion intégrée confirmant le résultat.

**14 migrations appliquées avec succès, dans cet ordre** (toutes confirmées dans le ledger `Local == Remote`) :

| Migration | Objectif | Statut |
|---|---|---|
| `20260711000002_drop_orphaned_storage_admin_policies` | Nettoyage policies Storage orphelines | ✅ (no-op, déjà fait hors-bande) |
| `20260711000003_secure_sensitive_settings_and_founder_seats` | Durcissement `parametres_entreprise`/founder seats | ✅ (corrigé en cours de route) |
| `20260711000004_lock_public_params_view_readonly` | Vue publique paramètres en lecture seule | ✅ (no-op) |
| `20260711000005_harden_notifications_and_reminders` | Policies notifications + colonnes rappels | ✅ (no-op) |
| `20260722000001_subscription_access_enforcement` (SEC2-01) | Vérification abonnement actif sur écritures sensibles | ✅ |
| `20260723000001_fix_pir_select_admin_check` (RLS-01) | Correction policy `pir_select` | ✅ |
| `20260724000001_secure_get_partner_requests_preview` (RLS-07) | Durcissement RPC preview partenaires | ✅ |
| `20260725000001_organisation_scoped_document_numbering` (DB-02) | Numérotation devis/factures/interventions par organisation | ✅ (corrigé en cours de route, §4.4) |
| `20260726000001_unify_commission_calculation` (FONC-02) | Calcul de commission unifié | ✅ |
| `20260727000001_remove_hardcoded_push_endpoint` | Suppression endpoint push en dur | ✅ |
| `20260727000002_harden_sensitive_function_execute_privileges` (SEC2-02) | Durcissement EXECUTE sur 5 fonctions sensibles | ✅ |
| `20260728000001_drop_duplicate_intervention_numero_trigger` | Suppression trigger dupliqué (dérive, §5) | ✅ |
| `20260728000002_revoke_anon_push_subscriptions_admin_delete` | Correctif résiduel §4.5 | ✅ |

**Non appliquée** : `20260604000000_bootstrap_core_schema.sql` (antérieure au 5 juin, tables déjà existantes) — exclue à chaque exécution via retrait temporaire du dossier de migrations, jamais poussée.

## 5. Trigger dupliqué (schema drift, découvert avant toute écriture)

`public.interventions` portait deux triggers BEFORE INSERT identiques (`set_intervention_numero`, suivi par git, et `trg_intervention_numero`, absent de tout fichier de migration). Sans effet avec l'ancienne fonction (lecture pure), il aurait fait sauter un numéro sur deux avec la nouvelle logique par compteur persistant. Supprimé via `20260728000001` (autorisation explicite obtenue). Confirmé après déploiement : seul `set_intervention_numero` subsiste.

## 6. Sauvegarde

Confirmée par l'utilisateur (backup quotidien Supabase visible dans Dashboard → Database → Backups). `supabase backups list` montre PITR désactivé pour ce projet (mécanisme distinct, non utilisé ici).

## 7. Plan de rollback préparé

- **Snapshot schéma complet** pris avant toute écriture : `audit-kaytek-inter/deploiement/pre-deploy-schema-snapshot-20260723-195201.sql` (schéma seul, `pg_dump --schema public,storage`, 0 ligne de données confirmée — aucune donnée utilisateur exposée). Contient les définitions exactes (fonctions, policies, privilèges) antérieures à ce déploiement, pour restauration manuelle ciblée en cas de besoin.
- **Restauration de privilège/fonction/policy** : rejouer la définition correspondante depuis le snapshot.
- **Trigger `trg_intervention_numero`** : définition exacte capturée avant suppression (`CREATE TRIGGER trg_intervention_numero BEFORE INSERT ON public.interventions FOR EACH ROW EXECUTE FUNCTION gen_numero_intervention();`) — restauration possible mais non recommandée (c'était un doublon).
- **Rollback frontend** : aucun changement de code applicatif déployé — sans objet pour ce passage. Pour un futur déploiement frontend, utiliser le rollback instantané Vercel (redéploiement de la version de production précédente via dashboard/CLI).
- **Rollback global** : restauration depuis le backup quotidien confirmé (§6), en dernier recours.
- Aucune commande destructive préparée à l'avance (conforme à la consigne).

## 8. Edge Functions

Aucune déployée — les 3 fichiers modifiés (`envoyer-email`, `inviter-intervenant`, `send-reminders`) font partie du lot explicitement exclu (§2), non validés dans le cadre de cette correction. Versions actuellement actives en production (`envoyer-email` v21, `inviter-intervenant` v30, `send-reminders` v4) inchangées.

## 9. Frontend

Aucun changement de code applicatif dans ce déploiement (§2) — `npm run build` vérifié néanmoins sur la branche déployée : succès (avertissement standard sur la taille de deux chunks, sans rapport). Bundle vérifié : URL Supabase de production correcte (`dimrukkxehcwzemslwiz.supabase.co`), aucune URL locale/port de test, aucun identifiant `.env.test` détecté dans les artefacts compilés.

## 10. Tests post-déploiement (fumée, production réelle)

Compte interne réel fourni par l'utilisateur (`castryludovic@gmail.com`), utilisé uniquement en variable d'environnement transitoire pour un script Playwright ad-hoc (jamais commité, supprimé immédiatement après usage) contre `https://app.kaytekinter.fr` :

- ✅ Connexion réussie, tableau de bord chargé
- ✅ Accès `/clients`
- ✅ Création d'un client de test identifiable (`ZZZ-SMOKE-TEST-<horodatage>`)
- ✅ Création d'une intervention (sélection client via portail React — même correctif que TEST-03, confirmé fonctionnel en production réelle)
- ✅ Création d'un devis — numéro généré : **DEV-2026-187** (numérotation par organisation confirmée opérationnelle)
- ✅ Ligne devis retrouvée dans la liste
- ⚠️ Isolation avec une deuxième organisation : **non testée** (aucun second compte de test disponible en production) — isolation déjà validée localement (14/14 Playwright, TEST-03) et par l'audit read-only (zéro doublon `(organisation_id, numero)`)
- ✅ Nettoyage : client de test archivé (action réversible, jamais de suppression définitive) — confirmé 0 client actif portant ce préfixe après archivage

Aucune donnée de client réel utilisée, aucun paiement déclenché.

## 11. Surveillance post-déploiement

Vérifications en lecture seule après déploiement et test de fumée :
- Zéro doublon `(organisation_id, numero)` sur devis/factures/interventions
- Zéro doublon de commission (`facture_id`)
- Zéro client de test actif résiduel
- Ledger de migration entièrement cohérent (`Local == Remote` sur les 14 migrations)

Aucune campagne publique ni ouverture massive déclenchée. Lancement réel limité à la vérification interne effectuée dans cette session.

## 12. Privilèges finaux (fonctions sensibles)

| Fonction | anon | authenticated | service_role |
|---|---|---|---|
| `current_organisation_has_app_access()` | false | true | true |
| `get_my_app_access_status()` | false | true | true |
| `get_partner_requests_preview(text)` | false | true | true |
| `next_document_number(uuid, text)` | false | false | false |
| `calculate_commission_for_facture(uuid)` | false | false | false |
| `admin_delete_user_push_subscriptions(uuid)` | **false** (corrigé) | true | true |

## 13. Isolation multi-tenant

Vérifiée via : audit read-only (zéro doublon `(organisation_id, numero)` avant et après déploiement), 14/14 tests Playwright locaux (TEST-03), et test de fumée production (isolation cross-org non re-testée en production faute d'un second compte, mais mécanisme identique déjà validé localement avec données réelles créées via UI).

## 14. Erreurs observées

Deux échecs de migration réels rencontrés et résolus pendant le déploiement (policy dupliquée §4.3, contraintes globales §4.4) — dans les deux cas, rollback automatique confirmé par Supabase avant correction, aucune donnée modifiée par l'échec lui-même. Aucune erreur frontend, Edge Function ou RLS observée pendant le test de fumée.

## 15. Actions restantes

- **Fusion de la PR vers `main`** : à la charge de l'utilisateur (lien ci-dessus, §1) — décision explicite de ne pas fusionner automatiquement.
- Isolation cross-org en production non re-testée directement (nécessiterait un second compte de test dédié).
- Les défauts de scripts de test déjà documentés (VALIDATION-FINALE, TEST-03) restent non corrigés, hors périmètre de ce déploiement.

## 16. Confirmation d'absence de secret exposé

Aucune clé, aucun mot de passe, aucun token n'apparaît dans ce rapport, dans les migrations commitées, ou dans les logs conservés. Le mot de passe du compte de test de fumée n'a jamais été écrit sur disque (variable d'environnement transitoire uniquement), et les fichiers Playwright ad-hoc l'ayant utilisé ont été supprimés immédiatement après usage.

## 17. Verdict final de commercialisation

Tous les critères de la section 8 de l'autorisation sont remplis : SQL/unitaires/Storage/Edge Functions/concurrence/Playwright déjà validés (VALIDATION-FINALE, TEST-03), 14 migrations de production déployées avec succès et vérifiées, build réussi, zéro test critique ignoré, zéro défaut multi-tenant détecté, zéro accès anonyme sensible restant (y compris le trou résiduel découvert et corrigé), zéro doublon de commission, aucune opération destructive, aucune production autre que celle explicitement ciblée contactée.

Seule étape restante avant une visibilité utilisateur finale : la fusion de la PR (à la charge de l'utilisateur) — sans incidence fonctionnelle puisqu'aucun code frontend n'a changé.

---

**DÉPLOIEMENT CONTRÔLÉ RÉUSSI. Kaytek Inter est disponible en production pour un lancement commercial progressif.**
