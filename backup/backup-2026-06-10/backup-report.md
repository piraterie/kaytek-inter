# Rapport de sauvegarde — Kaytek Inter
**Date :** 2026-06-10  
**Heure :** Session de migration multi-tenant  
**Projet Supabase :** `dimrukkxehcwzemslwiz`  
**URL production :** `https://kaytek-inter.vercel.app`  
**Commit git :** `4f90f4d` — feat: add organisation_id to core create hooks

---

## Fichiers sauvegardés

| Dossier / Fichier | Fichiers | Contenu |
|---|---|---|
| `src/` | 37 | Pages, composants, hooks, stores, services |
| `public/` | 4 | Icônes PWA, push-sw.js, manifest |
| `supabase/` | 29 | Migrations (15), Edge Functions (5), config |
| `package.json` | 1 | Dépendances npm |
| `package-lock.json` | 1 | Lockfile npm |
| `tsconfig.json` | 1 | Configuration TypeScript |
| `vite.config.ts` | 1 | Configuration Vite + PWA |
| `vercel.json` | 1 | Configuration Vercel (SPA rewrite) |
| `.env.example` | 1 | Template variables d'environnement |
| **TOTAL** | **76** | |

---

## Documentation générée

| Fichier | Contenu |
|---|---|
| `database-schema.sql` | Schéma SQL complet (tables, FK, index, triggers, fonctions, policies, seed) |
| `database-summary.md` | Résumé tabulaire : 15 tables, 5 triggers, 6 fonctions, 26 policies, 15 migrations |
| `project-inventory.md` | Pages, composants, hooks, stores, Edge Functions, buckets, routes |
| `restore-guide.md` | Guide de restauration étape par étape |
| `.env.example` | Template variables d'environnement documentées |
| `backup-report.md` | Ce fichier |

---

## État de la base au moment de la sauvegarde

### Tables : 15
`organisations`, `profiles`, `clients`, `prestations`, `interventions`, `devis`, `factures`, `commissions`, `photos`, `messages`, `notifications`, `push_subscriptions`, `devices`, `parametres_entreprise`, `journal`, `commission_receipts`

### Tables avec organisation_id (NOT NULL) : 6
`profiles`, `clients`, `interventions`, `devis`, `factures`, `commissions`

### Fonctions SQL : 6
`handle_new_user`, `auto_commission`, `generate_intervention_numero`, `generate_devis_numero`, `generate_facture_numero`, `is_admin`

### Triggers : 5
`on_auth_user_created`, `trg_auto_commission`, `set_intervention_numero`, `set_devis_numero`, `set_facture_numero`

### Policies RLS : 26
Toutes les tables métier couvertes

### Migrations appliquées : 15
Dont 6 migrations multi-tenant (Étapes 1–6 via fichiers + Étape 7 commissions manuelle)

---

## État de la migration multi-tenant

| Étape | Table | Statut |
|---|---|---|
| 1 | `organisations` — CREATE TABLE | ✅ Appliqué |
| 2 | `profiles.organisation_id` | ✅ Appliqué |
| 3 | `clients.organisation_id` | ✅ Appliqué |
| 4 | `interventions.organisation_id` | ✅ Appliqué |
| 5 | `devis.organisation_id` | ✅ Appliqué |
| 6 | `factures.organisation_id` | ✅ Appliqué |
| 7 | `commissions.organisation_id` | ✅ Appliqué (manuel) |
| — | `handle_new_user()` patché | ✅ Appliqué |
| — | `auto_commission()` patché | ✅ Appliqué |
| — | Hooks frontend (5 INSERTs) | ✅ Appliqué + déployé |

---

## Données de production au moment de la sauvegarde

- **Organisation :** `kaytek-inter` (id: `2378ca5c-c200-4a1f-9f62-d67b558ae83d`)
- **Profils backfillés :** 4 (Ludovic Kaytek, Mirabelle Hello, Test Test1, Test Test2)
- **Aucune donnée supprimée** — migration non destructive
