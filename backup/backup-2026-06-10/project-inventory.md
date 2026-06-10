# Inventaire du projet Kaytek Inter
**Date de sauvegarde :** 2026-06-10  
**Version :** post-migration multi-tenant (Étapes 1–7)

---

## Pages (`src/pages/`)

| Fichier | Route | Rôle | Accès |
|---|---|---|---|
| `LoginPage.tsx` | `/login` | Authentification | Public |
| `ResetPasswordPage.tsx` | `/reset-password` | Réinitialisation mot de passe | Public |
| `DashboardPage.tsx` | `/` | Tableau de bord | Admin + Intervenant |
| `InterventionsPage.tsx` | `/interventions` | Liste des interventions | Admin + Intervenant |
| `InterventionDetailPage.tsx` | `/interventions/:id` | Détail intervention + photos + messages | Admin + Intervenant |
| `ClientsPage.tsx` | `/clients` | Liste des clients | Admin |
| `ClientDetailPage.tsx` | `/clients/:id` | Détail client | Admin |
| `DevisPage.tsx` | `/devis` | Liste des devis | Admin |
| `DevisFormPage.tsx` | `/devis/:id` | Création / édition devis | Admin |
| `DevisApercuPage.tsx` | `/devis/:id/apercu` | Aperçu PDF devis + signature | Admin + Lien public |
| `FacturesPage.tsx` | `/factures` | Liste des factures | Admin |
| `CommissionsPage.tsx` | `/commissions` | Commissions intervenants | Admin + Intervenant |
| `MessagingPage.tsx` | `/messagerie` | Messagerie privée | Admin + Intervenant |
| `UsersPage.tsx` | `/utilisateurs` | Gestion des utilisateurs | Admin |
| `CataloguePage.tsx` | `/catalogue` | Catalogue prestations | Admin |
| `JournalPage.tsx` | `/journal` | Journal d'activité | Admin |
| `ParamsPage.tsx` | `/parametres` | Paramètres entreprise | Admin |

---

## Composants (`src/components/`)

| Fichier | Rôle |
|---|---|
| `layout/AppLayout.tsx` | Layout principal (sidebar, navigation, header) |
| `ConfirmModal.tsx` | Modale de confirmation générique |
| `CustomSelect.tsx` | Select stylisé réutilisable |
| `DocSheet.tsx` | Feuille de document (PDF preview) |
| `EmailDevisModal.tsx` | Modale envoi email devis |
| `Lightbox.tsx` | Visionneuse photos plein écran |
| `SignatureModal.tsx` | Canvas de signature manuscrite |

---

## Hooks (`src/lib/hooks/index.ts`)

| Hook | Table cible | Type |
|---|---|---|
| `useDashboard` | multi-tables | Query |
| `useProfiles` / `useIntervenants` | profiles | Query |
| `useCreateClient` / `useUpdateClient` / `useDeleteClients` | clients | Mutation |
| `useCreateIntervention` / `useUpdateIntervention` / `useDeleteInterventions` | interventions | Mutation |
| `useUploadPhoto` | photos | Mutation |
| `useCreateDevis` / `useUpdateDevis` / `useDeleteDevis` | devis | Mutation |
| `useDevisToFacture` | factures | Mutation |
| `useCreateFacture` / `useUpdateFacture` | factures | Mutation |
| `useCommissions` / `useUpdateCommission` | commissions | Query + Mutation |
| `useConversations` / `useMessages` / `useSendMessage` / `useUnreadCount` | messages | Query + Mutation |
| `usePushSubscription` | push_subscriptions | Mutation |
| `useMarkCommissionReceived` | commission_receipts | Mutation |
| `useParametres` / `useUpdateParametres` | parametres_entreprise | Query + Mutation |
| `usePrestations` / `useCreatePrestation` / `useUpdatePrestation` | prestations | Query + Mutation |
| `useJournal` | journal | Query |

---

## Stores Zustand (`src/lib/store.ts`)

| Store | Données |
|---|---|
| `useAuthStore` | `user: Profile \| null`, `loading`, `error`, `isAdmin()` |
| `useUIStore` | `theme`, `sidebarOpen` — persisté localStorage |
| `useParamsStore` | `params: ParametresEntreprise \| null` |
| `useToastStore` | File de toasts (succès, erreur, info, warning) |

---

## Services Supabase (`src/lib/supabase/`)

| Fichier | Rôle |
|---|---|
| `client.ts` | Instance Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) |
| `auth.ts` | signIn, signOut, resetPassword, envoyerEmail, supprimerUtilisateur, inviterIntervenant |
| `storage.ts` | uploadPhoto (bucket `photos`), supprimerPhoto |

---

## Services divers

| Fichier | Rôle |
|---|---|
| `src/lib/pdf/generator.tsx` | Génération PDF devis/facture via @react-pdf/renderer |
| `src/lib/biometric.ts` | Authentification biométrique WebAuthn |
| `src/lib/devices.ts` | Enregistrement / limite appareils |
| `src/lib/themes.ts` | Thèmes clair/sombre |

---

## Edge Functions (`supabase/functions/`)

| Fonction | Déclencheur | Rôle |
|---|---|---|
| `inviter-intervenant` | Appel manuel admin | Invitation intervenant via Brevo, création profil |
| `envoyer-email` | Appel manuel admin | Envoi email devis/facture via Brevo |
| `supprimer-utilisateur` | Appel manuel admin | Suppression compte auth + profil |
| `send-push` | Trigger DB notifications | Envoi push web (Web Push API) |
| `send-telegram` | Trigger DB notifications | Envoi notification Telegram |

---

## Buckets Storage Supabase

| Bucket | Contenu | Accès |
|---|---|---|
| `photos` | Photos interventions (avant/après/autre) | Authentifié |
| `signatures` | Signatures devis (PNG base64) | Authentifié |
| `avatars` | Avatars profils | Authentifié |

---

## Routes frontend (`src/App.tsx`)

```
/login                    → LoginPage (public)
/reset-password           → ResetPasswordPage (public)
/                         → DashboardPage (protégé)
/interventions            → InterventionsPage
/interventions/:id        → InterventionDetailPage
/clients                  → ClientsPage
/clients/:id              → ClientDetailPage
/devis                    → DevisPage
/devis/nouveau            → DevisFormPage
/devis/:id                → DevisFormPage
/devis/:id/apercu         → DevisApercuPage
/factures                 → FacturesPage
/commissions              → CommissionsPage
/messagerie               → MessagingPage
/utilisateurs             → UsersPage (admin)
/catalogue                → CataloguePage (admin)
/journal                  → JournalPage (admin)
/parametres               → ParamsPage (admin)
```

---

## Configuration

| Fichier | Rôle |
|---|---|
| `vite.config.ts` | Build Vite + plugin PWA (vite-plugin-pwa) |
| `vercel.json` | Rewrite SPA (`/*` → `/index.html`) |
| `tsconfig.json` | TypeScript strict, path alias `@/` → `src/` |
| `package.json` | Dépendances principales : React 18, Supabase JS 2, TanStack Query, Zustand, @react-pdf/renderer |
