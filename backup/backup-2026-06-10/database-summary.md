# Résumé base de données — Kaytek Inter
**Date :** 2026-06-10 | **Projet :** `dimrukkxehcwzemslwiz`

---

## Tables (15)

| Table | Colonnes clés | organisation_id | Notes |
|---|---|---|---|
| `organisations` | id, slug, nom, plan, actif | — | Table racine multi-tenant |
| `profiles` | id, role, nom, prenom, email, commission_pct, actif | ✅ NOT NULL | FK → organisations |
| `clients` | id, type, nom, prenom, telephone, email, archive | ✅ NOT NULL | FK → organisations |
| `prestations` | id, nom, categorie, prix_conseille, tva_pct, actif | ✗ | Catalogue global |
| `interventions` | id, numero, client_id, intervenant_id, statut, montant_ttc | ✅ NOT NULL | FK → organisations |
| `devis` | id, numero, client_id, statut, lignes (jsonb), total_ttc | ✅ NOT NULL | FK → organisations |
| `factures` | id, numero, devis_id, statut_paiement, montant_ttc | ✅ NOT NULL | FK → organisations |
| `commissions` | id, intervention_id, intervenant_id, part_intervenant, commission_admin | ✅ NOT NULL | FK → organisations |
| `photos` | id, intervention_id, url, storage_path, type | ✗ | Liée intervention |
| `messages` | id, expediteur_id, destinataire_id, contenu, type, media_url | ✗ | Messagerie privée |
| `notifications` | id, user_id, titre, type, lue, skip_push | ✗ | Push + in-app |
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth | ✗ | Web Push |
| `devices` | id, user_id, device_id, name | ✗ | Limite appareils |
| `parametres_entreprise` | id, raison_sociale, siret, iban, tva_defaut | ✗ | Config globale |
| `journal` | id, user_id, action, table_name, record_id | ✗ | Audit log |
| `commission_receipts` | facture_id, intervenant_id, recue | ✗ | Accusés réception |

---

## Clés étrangères critiques

| Table | Colonne | → Table cible | ON DELETE |
|---|---|---|---|
| `profiles` | `id` | `auth.users(id)` | CASCADE |
| `profiles` | `organisation_id` | `organisations(id)` | RESTRICT |
| `clients` | `organisation_id` | `organisations(id)` | RESTRICT |
| `interventions` | `organisation_id` | `organisations(id)` | RESTRICT |
| `interventions` | `client_id` | `clients(id)` | — |
| `interventions` | `intervenant_id` | `profiles(id)` | — |
| `devis` | `organisation_id` | `organisations(id)` | RESTRICT |
| `factures` | `organisation_id` | `organisations(id)` | RESTRICT |
| `commissions` | `organisation_id` | `organisations(id)` | RESTRICT |
| `commissions` | `intervention_id` | `interventions(id)` | — |
| `photos` | `intervention_id` | `interventions(id)` | CASCADE |

---

## Index multi-tenant

| Index | Table | Colonne |
|---|---|---|
| `idx_profiles_organisation_id` | `profiles` | `organisation_id` |
| `idx_clients_organisation_id` | `clients` | `organisation_id` |
| `idx_interventions_organisation_id` | `interventions` | `organisation_id` |
| `idx_devis_organisation_id` | `devis` | `organisation_id` |
| `idx_factures_organisation_id` | `factures` | `organisation_id` |
| `idx_commissions_organisation_id` | `commissions` | `organisation_id` |

---

## Triggers (5)

| Trigger | Table | Timing | Fonction |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` |
| `trg_auto_commission` | `interventions` | AFTER UPDATE | `auto_commission()` |
| `set_intervention_numero` | `interventions` | BEFORE INSERT | `generate_intervention_numero()` |
| `set_devis_numero` | `devis` | BEFORE INSERT | `generate_devis_numero()` |
| `set_facture_numero` | `factures` | BEFORE INSERT | `generate_facture_numero()` |

---

## Fonctions SQL (6)

| Fonction | Type | SECURITY | Rôle |
|---|---|---|---|
| `handle_new_user()` | TRIGGER | DEFINER | Crée profil à la création d'un auth user |
| `auto_commission()` | TRIGGER | DEFINER | Crée commission quand intervention → 'termine' |
| `generate_intervention_numero()` | TRIGGER | DEFINER | Génère INT-YYYY-NNN (advisory lock) |
| `generate_devis_numero()` | TRIGGER | DEFINER | Génère DEV-YYYY-NNN (advisory lock) |
| `generate_facture_numero()` | TRIGGER | DEFINER | Génère FAC-YYYY-NNN (advisory lock) |
| `is_admin()` | STABLE | DEFINER | Helper RLS — vérifie role = 'admin' |

---

## Policies RLS (26)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organisations` | scope org | — | — | — |
| `profiles` | tous auth | — | self ou admin | admin |
| `clients` | admin | admin | admin | admin |
| `interventions` | admin + propre | admin | admin + propre | admin |
| `devis` | admin | admin | admin | admin |
| `factures` | admin | admin | admin | admin |
| `commissions` | admin + propre | admin | admin | admin |
| `photos` | admin + propre via intervention | tout auth | — | admin + owner |
| `messages` | propre conv | propre | propre | — |
| `prestations` | tout auth | admin | admin | admin |
| `parametres_entreprise` | admin | admin | admin | admin |
| `journal` | admin | tout auth | — | — |

---

## Migrations appliquées (15 fichiers)

| Fichier | Contenu |
|---|---|
| `20260605000000` | push_subscriptions |
| `20260605000001` | remove_push_trigger |
| `20260605000002` | push_sub_update_policy |
| `20260605000004` | rls_role_policies (toutes les tables) |
| `20260605000005` | intervenant_autonome (can_create_documents, can_bypass_validation) |
| `20260605000006` | devices_security |
| `20260605000007` | cout_pieces (materiel_payeur, materiel_confirme) |
| `20260606000001` | devis_modele_id |
| `20260606000002` | activities_archive_catalogue + prestations seed |
| `20260610000001` | CREATE TABLE organisations + seed kaytek-inter |
| `20260610000002` | profiles.organisation_id + backfill + NOT NULL + FK |
| `20260610000003` | clients.organisation_id + backfill + NOT NULL + FK |
| `20260610000004` | interventions.organisation_id + backfill + NOT NULL + FK |
| `20260610000005` | devis.organisation_id + backfill + NOT NULL + FK |
| `20260610000006` | factures.organisation_id + backfill + NOT NULL + FK |

**Appliqués manuellement (hors migrations) :**
- `commissions.organisation_id` + backfill + NOT NULL + FK + index
- `handle_new_user()` — ajout organisation_id
- `auto_commission()` — ajout organisation_id
