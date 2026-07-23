-- ================================================================
-- MIGRATION : seed_default_prestations
-- Date       : 2026-06-30
-- Objectif   :
--   · Crée la fonction seed_default_prestations(p_org_id) qui insère
--     toutes les prestations par défaut pour une organisation donnée
--     (sans doublons, par nom + catégorie + org).
--   · L'applique à toutes les organisations existantes.
--   · Crée un trigger pour les nouvelles organisations.
--   · SECURITY DEFINER : bypasse la RLS pour les appels système
--     (trigger) ; vérifie le rôle admin pour les appels RPC frontend.
-- ================================================================

-- ── 1. Fonction principale ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_prestations(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  -- Vérifie le rôle admin si l'appel vient d'un utilisateur connecté
  -- (auth.uid() IS NULL = appel depuis trigger ou migration)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_in_org(p_org_id) THEN
    RAISE EXCEPTION 'Accès refusé : rôle admin requis';
  END IF;

  INSERT INTO public.prestations (nom, categorie, prix_conseille, tva_pct, actif, ordre, organisation_id)
  SELECT
    d.nom,
    d.categorie,
    d.prix_conseille::numeric,
    d.tva_pct::integer,
    true,
    d.ordre::integer,
    p_org_id
  FROM (VALUES
    -- ── Serrurerie ────────────────────────────────────────────────
    ('Ouverture porte claquée',           'serrurerie',  '150', '10', '1'),
    ('Ouverture porte verrouillée',       'serrurerie',  '200', '10', '2'),
    ('Changement de cylindre',            'serrurerie',  '120', '10', '3'),
    ('Blindage porte',                    'serrurerie',  '800', '10', '4'),
    ('Réparation gâche électrique',       'serrurerie',  '180', '10', '5'),
    ('Remplacement serrure 3 points',     'serrurerie',  '350', '10', '6'),
    -- ── Plomberie ─────────────────────────────────────────────────
    ('Recherche de fuite',                'plomberie',   '150', '10', '1'),
    ('Débouchage canalisation',           'plomberie',   '200', '10', '2'),
    ('Remplacement robinet',              'plomberie',   '180', '10', '3'),
    ('Remplacement siphon',               'plomberie',   '100', '10', '4'),
    ('Réparation chasse d''eau',          'plomberie',   '120', '10', '5'),
    ('Remplacement chauffe-eau',          'plomberie',   '900', '10', '6'),
    -- ── Électricité ───────────────────────────────────────────────
    ('Recherche de panne électrique',     'electricite', '150', '10', '1'),
    ('Remplacement disjoncteur',          'electricite', '180', '10', '2'),
    ('Remplacement prise',                'electricite',  '80', '10', '3'),
    ('Remplacement interrupteur',         'electricite',  '80', '10', '4'),
    ('Mise en sécurité tableau',          'electricite', '300', '10', '5'),
    ('Installation luminaire',            'electricite', '150', '10', '6'),
    -- ── Vitrerie ──────────────────────────────────────────────────
    ('Remplacement vitre simple',         'vitrerie',    '200', '10', '1'),
    ('Remplacement double vitrage',       'vitrerie',    '450', '10', '2'),
    ('Mise en sécurité vitrine',          'vitrerie',    '300', '10', '3'),
    ('Pose panneau provisoire',           'vitrerie',    '120', '10', '4'),
    ('Remplacement miroir',               'vitrerie',    '250', '10', '5'),
    ('Réparation fermeture baie vitrée',  'vitrerie',    '350', '10', '6'),
    -- ── Chauffagiste ──────────────────────────────────────────────
    ('Dépannage chaudière',               'chauffagiste','120', '10', '1'),
    ('Entretien chaudière',               'chauffagiste','100', '10', '2'),
    ('Remplacement thermostat',           'chauffagiste','140', '10', '3'),
    ('Purge radiateur',                   'chauffagiste', '80', '10', '4'),
    ('Réparation radiateur',              'chauffagiste','130', '10', '5'),
    ('Recherche panne chauffage',         'chauffagiste','120', '10', '6'),
    ('Remplacement circulateur',          'chauffagiste','220', '10', '7'),
    ('Désembouage circuit chauffage',     'chauffagiste','350', '10', '8'),
    ('Remplacement robinet thermostatique','chauffagiste', '90', '10', '9'),
    ('Mise en service chauffage',         'chauffagiste','150', '10', '10')
  ) AS d(nom, categorie, prix_conseille, tva_pct, ordre)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prestations p
    WHERE p.nom             = d.nom
      AND p.categorie       = d.categorie
      AND p.organisation_id = p_org_id
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- Permission : tout utilisateur authentifié peut appeler la fonction
-- (le corps vérifie lui-même que le caller est admin)
GRANT EXECUTE ON FUNCTION public.seed_default_prestations(uuid) TO authenticated;

-- ── 2. Appliquer à toutes les organisations existantes ────────────
DO $$
DECLARE
  org record;
  n integer;
BEGIN
  FOR org IN SELECT id FROM public.organisations LOOP
    n := public.seed_default_prestations(org.id);
    RAISE NOTICE 'org % → % prestation(s) insérée(s)', org.id, n;
  END LOOP;
END $$;

-- ── 3. Trigger : auto-seed pour les nouvelles organisations ───────
CREATE OR REPLACE FUNCTION public.seed_default_prestations_on_org_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_prestations(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_prestations_on_org_create ON public.organisations;

CREATE TRIGGER trg_seed_prestations_on_org_create
  AFTER INSERT ON public.organisations
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_prestations_on_org_create();
