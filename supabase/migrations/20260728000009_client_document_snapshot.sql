-- Correction affichage adresse client (devis/factures) — ajout d'un
-- instantané ("snapshot") des coordonnées du client au moment de
-- l'émission d'un devis ou d'une facture.
--
-- Pourquoi : jusqu'ici, devis/factures ne stockaient que client_id (FK) —
-- aucune copie des coordonnées n'était conservée. Toute lecture (aperçu,
-- PDF, e-mail) devait donc re-résoudre le client via jointure, avec des
-- select() incomplets selon les écrans (certains omettaient purement et
-- simplement les colonnes d'adresse). Conséquence structurelle : (a)
-- l'adresse pouvait ne jamais s'afficher selon l'écran utilisé, (b) un
-- document déjà émis n'avait AUCUNE garantie de conserver les coordonnées
-- telles qu'elles étaient au moment de l'émission — une modification
-- ultérieure de la fiche client aurait changé rétroactivement tous ses
-- documents historiques.
--
-- Additif uniquement : colonne nullable, aucune donnée existante
-- modifiée, aucune colonne supprimée, rétrocompatible (un document sans
-- snapshot retombe sur la jointure client existante — voir
-- src/lib/clientIdentity.ts, resolveClientIdentity()).
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS client_snapshot jsonb;
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS client_snapshot jsonb;

COMMENT ON COLUMN public.devis.client_snapshot IS
  'Coordonnées du client figées au moment de la création du devis (nom/société, adresse, contact) — structure ClientDocumentIdentity (src/lib/clientIdentity.ts). NULL pour les devis créés avant cette migration : repli sur la jointure clients.';
COMMENT ON COLUMN public.factures.client_snapshot IS
  'Coordonnées du client figées au moment de la création de la facture (reprises du devis source lors d''une conversion) — structure ClientDocumentIdentity (src/lib/clientIdentity.ts). NULL pour les factures créées avant cette migration : repli sur la jointure clients.';
