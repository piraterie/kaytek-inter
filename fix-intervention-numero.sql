-- Fix : génération de numéro d'intervention sans doublon
-- À exécuter dans Supabase → SQL Editor

-- 1. Créer une séquence dédiée si elle n'existe pas
CREATE SEQUENCE IF NOT EXISTS intervention_numero_seq START 1;

-- 2. Initialiser la séquence au max actuel pour éviter les conflits
SELECT setval('intervention_numero_seq',
  COALESCE((SELECT MAX(CAST(SPLIT_PART(numero, '-', 3) AS INTEGER))
            FROM interventions
            WHERE numero ~ '^INT-\d{4}-\d+$'), 0) + 1, false);

-- 3. Recréer la fonction de génération de numéro
CREATE OR REPLACE FUNCTION public.generate_intervention_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'INT-' || EXTRACT(YEAR FROM NOW())::TEXT || '-'
               || LPAD(nextval('intervention_numero_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- 4. S'assurer que le trigger est bien en place
DROP TRIGGER IF EXISTS set_intervention_numero ON interventions;
CREATE TRIGGER set_intervention_numero
  BEFORE INSERT ON interventions
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_intervention_numero();
