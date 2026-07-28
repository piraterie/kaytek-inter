// src/lib/email/contract.ts
//
// Réexport du contrat CANONIQUE — la seule définition de
// EnvoyerEmailPayloadSchema (et de tout ce qui en dépend) vit dans
// supabase/functions/_shared/emailContract.ts, importée ici via un chemin
// relatif direct. Ce fichier n'ajoute ni ne redéfinit rien : il existe
// uniquement pour que le code frontend continue d'importer via l'alias
// habituel (`@/lib/email/contract`), sans dupliquer une seule ligne de
// logique de validation.
//
// Voir supabase/functions/_shared/emailContract.ts pour la documentation
// complète (pourquoi un seul fichier partagé, comment "zod" se résout de
// façon identique en Deno via deno.json, historique des incidents).
export * from '../../../supabase/functions/_shared/emailContract.ts'
