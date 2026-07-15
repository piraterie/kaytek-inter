-- ================================================================
-- MIGRATION : durcir seed_default_prestations (authentification requise)
-- Date       : 2026-07-07
-- Problème   : la garde admin ne s'appliquait que si auth.uid() IS NOT
--              NULL ("IF auth.uid() IS NOT NULL AND NOT
--              is_admin_in_org(p_org_id) THEN RAISE EXCEPTION").
--              Un appel avec la clé anonyme (sans session, auth.uid()
--              NULL) contournait donc totalement le contrôle admin.
-- Correction : refuse immédiatement tout appel sans session
--              authentifiée, puis conserve la vérification admin
--              existante inchangée.
-- Inchangé   : liste des 34 prestations par défaut, dédoublonnage
--              (WHERE NOT EXISTS), valeur de retour (nombre de lignes
--              insérées). Seule la garde en tête de fonction change.
-- Portée     : uniquement cette fonction. Aucune autre fonction,
--              table ou policy modifiée.
-- ================================================================

CREATE OR REPLACE FUNCTION public.seed_default_prestations(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF NOT public.is_admin_in_org(p_org_id) THEN
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

-- ================================================================
-- VÉRIFICATION — résultat attendu : prosecdef = true, définition
--                contenant "Authentification requise"
-- ================================================================
SELECT proname, prosecdef, pg_get_functiondef(oid) ILIKE '%Authentification requise%' AS has_auth_guard
FROM pg_proc
WHERE proname = 'seed_default_prestations';
