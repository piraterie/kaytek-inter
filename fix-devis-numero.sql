-- Fix : génération de numéro de devis sans doublon
-- À exécuter dans Supabase → SQL Editor → Run

-- 1. Créer la séquence dédiée si elle n'existe pas
CREATE SEQUENCE IF NOT EXISTS devis_numero_seq START 1;

-- 2. Synchroniser la séquence sur le dernier numéro existant
SELECT setval('devis_numero_seq',
  COALESCE(
    (SELECT MAX(
        CASE
          WHEN numero ~ '^\d+$' THEN CAST(numero AS INTEGER)
          WHEN numero ~ '-\d+$' THEN CAST(SPLIT_PART(numero, '-', LENGTH(numero) - LENGTH(REPLACE(numero, '-', '')) + 1) AS INTEGER)
          ELSE 0
        END
      )
     FROM devis
    ), 0
  ) + 1,
  false
);

-- 3. Créer/remplacer la fonction trigger
CREATE OR REPLACE FUNCTION public.generate_devis_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := 'DEV-' || EXTRACT(YEAR FROM NOW())::TEXT || '-'
               || LPAD(nextval('devis_numero_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- 4. (Re)créer le trigger
DROP TRIGGER IF EXISTS set_devis_numero ON devis;
CREATE TRIGGER set_devis_numero
  BEFORE INSERT ON devis
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_devis_numero();

-- 5. Vérification
SELECT 'Séquence actuelle' AS info, last_value FROM devis_numero_seq;
