-- Ajoute updated_at à l'aperçu masqué (tri correct côté frontend,
-- champ non-confidentiel). Fonction déjà SECURITY DEFINER existante,
-- même filtre de colonnes, aucun changement de sécurité.
-- DROP requis : Postgres n'autorise pas CREATE OR REPLACE quand la
-- signature RETURNS TABLE change (nouvelle colonne = nouveau type de ligne).
DROP FUNCTION IF EXISTS public.get_partner_requests_preview(text);

CREATE FUNCTION public.get_partner_requests_preview(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id                    uuid,
  connection_id         uuid,
  source_organisation_id uuid,
  type_intervention     text,
  urgence               boolean,
  date_souhaitee        timestamptz,
  ville                 text,
  description_partagee  text,
  montant_partage       numeric,
  status                text,
  note_refus            text,
  created_at            timestamptz,
  updated_at            timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.connection_id, r.source_organisation_id,
    r.type_intervention, r.urgence, r.date_souhaitee, r.ville,
    CASE WHEN r.share_description THEN r.description_partagee ELSE NULL END,
    CASE WHEN r.share_montant THEN r.montant_partage ELSE NULL END,
    r.status, r.note_refus, r.created_at, r.updated_at
  FROM public.partner_intervention_requests r
  WHERE r.target_organisation_id = public.current_org_id()
    AND r.status = p_status
    AND p_status IN ('pending', 'refused');
$$;

REVOKE ALL ON FUNCTION public.get_partner_requests_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_requests_preview(text) TO authenticated;
