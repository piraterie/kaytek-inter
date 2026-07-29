-- Phase 1 (fondations) — hook manquant pour déclencher le workflow de
-- demande d'avis après l'envoi d'une facture. Mirror exact de
-- public.devis.envoye_le (colonne déjà existante, migration bootstrap) :
-- nullable, sans valeur par défaut, renseignée par le frontend au moment
-- de l'envoi réussi (FacturesPage.tsx, handleEmail()) — pas de trigger,
-- pas de logique métier ici, uniquement la colonne. Aucun changement RLS :
-- toute policy UPDATE déjà en vigueur sur factures s'applique telle quelle
-- à cette nouvelle colonne (RLS Postgres opère par ligne, pas par colonne).
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS envoyee_le timestamptz;

CREATE INDEX IF NOT EXISTS idx_factures_envoyee_le ON public.factures (envoyee_le)
  WHERE envoyee_le IS NOT NULL;
