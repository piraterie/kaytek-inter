-- ================================================================
-- MIGRATION : autoriser tous les métiers dans devis et interventions
-- Date       : 2026-07-07
-- Problème   : devis_activite_check et interventions_type_check
--              n'autorisent que ('serrurerie', 'vitrerie'), alors que
--              prestations_categorie_check autorise déjà aussi
--              plomberie, electricite, chauffagiste. Ces deux
--              contraintes ne sont définies dans aucune migration
--              versionnée antérieure (créées hors du dossier
--              supabase/migrations/, avant sa mise en place).
-- Vérifié    : aucune autre contrainte en base ne référence ces
--              valeurs (recherche exhaustive sur pg_constraint).
--              Données existantes : devis.activite et
--              interventions.type ne contiennent que 'serrurerie'
--              (et NULL) — aucun risque de violation.
-- Portée     : uniquement devis.activite et interventions.type.
--              Aucune policy RLS, aucune permission modifiée.
-- ================================================================

ALTER TABLE public.devis DROP CONSTRAINT IF EXISTS devis_activite_check;
ALTER TABLE public.devis ADD CONSTRAINT devis_activite_check
  CHECK (
    activite = ANY (
      ARRAY[
        'serrurerie',
        'vitrerie',
        'plomberie',
        'electricite',
        'chauffagiste'
      ]::text[]
    )
  );

ALTER TABLE public.interventions DROP CONSTRAINT IF EXISTS interventions_type_check;
ALTER TABLE public.interventions ADD CONSTRAINT interventions_type_check
  CHECK (
    type = ANY (
      ARRAY[
        'serrurerie',
        'vitrerie',
        'plomberie',
        'electricite',
        'chauffagiste'
      ]::text[]
    )
  );

-- ================================================================
-- VÉRIFICATION — résultat attendu : 2 lignes, chacune listant les
--                5 métiers dans sa définition
-- ================================================================
SELECT conname, conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname IN ('devis_activite_check', 'interventions_type_check');
