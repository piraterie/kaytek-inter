# Guide de restauration — Kaytek Inter
**Date :** 2026-06-10  
**Projet Supabase :** `dimrukkxehcwzemslwiz`  
**URL prod :** `https://kaytek-inter.vercel.app`

---

## Prérequis

```bash
node >= 18
npm >= 9
supabase CLI (npm install -g supabase)
vercel CLI (npm install -g vercel)
```

---

## 1. Restaurer le code source

```bash
# Depuis la sauvegarde
cp -r backup/backup-2026-06-10/src ./src
cp -r backup/backup-2026-06-10/public ./public
cp -r backup/backup-2026-06-10/supabase ./supabase
cp backup/backup-2026-06-10/package.json .
cp backup/backup-2026-06-10/tsconfig.json .
cp backup/backup-2026-06-10/vite.config.ts .
cp backup/backup-2026-06-10/vercel.json .

# Installer les dépendances
npm install
```

---

## 2. Variables d'environnement

Créer `.env.local` à la racine :

```env
VITE_SUPABASE_URL=https://dimrukkxehcwzemslwiz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key_depuis_supabase_dashboard>
```

Récupérer les clés : Supabase Dashboard → Project Settings → API

---

## 3. Restaurer la base Supabase

### Option A — Rejouer les migrations (recommandé)

```bash
supabase login
supabase link --project-ref dimrukkxehcwzemslwiz

# Appliquer toutes les migrations dans l'ordre
supabase db push
```

### Option B — SQL Editor (si CLI non disponible)

Exécuter les fichiers SQL dans l'ordre dans Supabase → SQL Editor :

```
1. supabase/migrations/20260605000000_push_subscriptions.sql
2. supabase/migrations/20260605000001_remove_push_trigger.sql
3. supabase/migrations/20260605000002_push_sub_update_policy.sql
4. supabase/migrations/20260605000004_rls_role_policies.sql
5. supabase/migrations/20260605000005_intervenant_autonome.sql
6. supabase/migrations/20260605000006_devices_security.sql
7. supabase/migrations/20260605000007_cout_pieces.sql
8. supabase/migrations/20260606000001_devis_modele_id.sql
9. supabase/migrations/20260606000002_activities_archive_catalogue.sql
10. supabase/migrations/20260610000001_create_organisations.sql
11. supabase/migrations/20260610000002_profiles_organisation_id.sql
12. supabase/migrations/20260610000003_clients_organisation_id.sql
13. supabase/migrations/20260610000004_interventions_organisation_id.sql
14. supabase/migrations/20260610000005_devis_organisation_id.sql
15. supabase/migrations/20260610000006_factures_organisation_id.sql
```

### Fonctions SQL hors migrations (à appliquer manuellement)

Ces fonctions existent en production mais ne sont pas dans les fichiers de migration.
Les exécuter dans Supabase SQL Editor après les migrations :

**`handle_new_user`** — Trigger auth.users → profiles
```sql
-- Voir : backup/database-schema.sql section [FONCTIONS]
```

**`auto_commission`** — Trigger interventions → commissions
```sql
-- Voir : backup/database-schema.sql section [FONCTIONS]
```

---

## 4. Déployer les Edge Functions

```bash
supabase functions deploy inviter-intervenant --project-ref dimrukkxehcwzemslwiz
supabase functions deploy envoyer-email       --project-ref dimrukkxehcwzemslwiz
supabase functions deploy supprimer-utilisateur --project-ref dimrukkxehcwzemslwiz
supabase functions deploy send-push           --project-ref dimrukkxehcwzemslwiz
supabase functions deploy send-telegram       --project-ref dimrukkxehcwzemslwiz
```

### Variables d'environnement Edge Functions

À configurer dans Supabase Dashboard → Edge Functions → Secrets :

| Variable | Description |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role |
| `SUPABASE_ANON_KEY` | Clé anon |
| `BREVO_API_KEY` | Clé API Brevo (envoi emails) |
| `EMAIL_FROM` | Expéditeur format `Nom <email@domaine.com>` |

---

## 5. Configurer Storage

Dans Supabase Dashboard → Storage, créer les buckets si absents :

| Bucket | Public | Politique |
|---|---|---|
| `photos` | Non | Authentifié |
| `signatures` | Non | Authentifié |
| `avatars` | Non | Authentifié |

---

## 6. Déployer sur Vercel

```bash
# Option A — CLI
vercel --prod

# Option B — Git push (si repo connecté à Vercel)
git push origin main
```

### Variables d'environnement Vercel

Dans Vercel Dashboard → Project → Settings → Environment Variables :

| Variable | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | `https://dimrukkxehcwzemslwiz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Clé anon Supabase |

---

## 7. Vérifications post-restauration

```bash
# Build local
npm run build
# Attendu : ✓ built in ~6s sans erreur

# Dev local
npm run dev
# Vérifier : connexion, dashboard, création intervention
```

```sql
-- Vérifier les tables multi-tenant
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- Vérifier organisation kaytek-inter
SELECT * FROM public.organisations;

-- Vérifier backfill profiles
SELECT COUNT(*) FROM public.profiles WHERE organisation_id IS NULL;
-- Attendu : 0
```

---

## 8. Ordre de priorité en cas d'incident

1. **Frontend cassé** → `git revert` + `git push` (Vercel redéploie)
2. **Migration ratée** → exécuter le rollback SQL correspondant dans SQL Editor
3. **Edge Function cassée** → redéployer la version précédente depuis le git
4. **Données corrompues** → restaurer depuis le backup Supabase (Dashboard → Backups)
