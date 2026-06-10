-- Ajout du coût des pièces achetées par l'intervenant sur une intervention
-- Ces pièces sont déduites de la part nette de l'intervenant

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS cout_pieces numeric DEFAULT 0;
