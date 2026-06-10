-- Ajoute la colonne modele_id sur la table devis
-- Permet de stocker le modèle PDF sélectionné lors de la création du devis

ALTER TABLE public.devis
  ADD COLUMN IF NOT EXISTS modele_id integer NOT NULL DEFAULT 0;
