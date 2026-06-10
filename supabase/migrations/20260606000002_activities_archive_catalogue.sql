-- Migration : activités métier étendues, archivage, catalogue prestations
-- 2026-06-06

-- ── 1. Colonnes archive ─────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archive boolean NOT NULL DEFAULT false;

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS archive boolean NOT NULL DEFAULT false;

-- ── 2. Contrainte categorie prestations (ajouter plomberie / electricite) ─
DO $$
DECLARE
  conname text;
BEGIN
  SELECT tc.constraint_name INTO conname
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
  WHERE tc.table_name = 'prestations'
    AND cc.check_clause ILIKE '%categorie%'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.prestations DROP CONSTRAINT IF EXISTS ' || quote_ident(conname);
  END IF;
END $$;

ALTER TABLE public.prestations
  ADD CONSTRAINT prestations_categorie_check
  CHECK (categorie IN ('serrurerie', 'vitrerie', 'plomberie', 'electricite'));

-- ── 3. RLS catalogue : admin peut créer / modifier les prestations ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'prestations' AND policyname = 'prestations_admin_insert'
  ) THEN
    EXECUTE $q$
      CREATE POLICY prestations_admin_insert ON public.prestations
        FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    $q$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'prestations' AND policyname = 'prestations_admin_update'
  ) THEN
    EXECUTE $q$
      CREATE POLICY prestations_admin_update ON public.prestations
        FOR UPDATE TO authenticated
        USING (
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    $q$;
  END IF;
END $$;

-- ── 4. Seeds prestations (insert uniquement si le couple nom+categorie n'existe pas) ─
INSERT INTO public.prestations (nom, categorie, prix_conseille, tva_pct, actif, ordre)
SELECT t.nom, t.categorie, t.prix_conseille::numeric, t.tva_pct::integer, true, t.ordre::integer
FROM (VALUES
  -- Serrurerie
  ('Ouverture porte claquée',        'serrurerie', '150', '10', '1'),
  ('Ouverture porte verrouillée',    'serrurerie', '200', '10', '2'),
  ('Changement de cylindre',         'serrurerie', '120', '10', '3'),
  ('Blindage porte',                 'serrurerie', '800', '10', '4'),
  ('Réparation gâche électrique',    'serrurerie', '180', '10', '5'),
  ('Remplacement serrure 3 points',  'serrurerie', '350', '10', '6'),
  -- Plomberie
  ('Recherche de fuite',             'plomberie',  '150', '10', '1'),
  ('Débouchage canalisation',        'plomberie',  '200', '10', '2'),
  ('Remplacement robinet',           'plomberie',  '180', '10', '3'),
  ('Remplacement siphon',            'plomberie',  '100', '10', '4'),
  ('Réparation chasse d''eau',       'plomberie',  '120', '10', '5'),
  ('Remplacement chauffe-eau',       'plomberie',  '900', '10', '6'),
  -- Électricité
  ('Recherche de panne électrique',  'electricite','150', '10', '1'),
  ('Remplacement disjoncteur',       'electricite','180', '10', '2'),
  ('Remplacement prise',             'electricite', '80', '10', '3'),
  ('Remplacement interrupteur',      'electricite', '80', '10', '4'),
  ('Mise en sécurité tableau',       'electricite','300', '10', '5'),
  ('Installation luminaire',         'electricite','150', '10', '6'),
  -- Vitrerie
  ('Remplacement vitre simple',      'vitrerie',   '200', '10', '1'),
  ('Remplacement double vitrage',    'vitrerie',   '450', '10', '2'),
  ('Mise en sécurité vitrine',       'vitrerie',   '300', '10', '3'),
  ('Pose panneau provisoire',        'vitrerie',   '120', '10', '4'),
  ('Remplacement miroir',            'vitrerie',   '250', '10', '5'),
  ('Réparation fermeture baie vitrée','vitrerie',  '350', '10', '6')
) AS t(nom, categorie, prix_conseille, tva_pct, ordre)
WHERE NOT EXISTS (
  SELECT 1 FROM public.prestations p
  WHERE p.nom = t.nom AND p.categorie = t.categorie
);
