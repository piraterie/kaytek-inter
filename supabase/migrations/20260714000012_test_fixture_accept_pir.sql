-- Fixture de test (bypass RLS) : bascule la ligne de test en 'accepted'
-- pour valider que pir_select donne alors l'accès complet à la cible.
-- Contourne le bug préexistant pir_update (20260714000010) qui
-- empêche la cible de faire cette transition elle-même via PATCH.
-- refused → accepted n'est pas une transition valide selon le trigger
-- de machine à états (ni refused → pending) : désactivation ponctuelle
-- du trigger pour cette seule ligne de test, réactivé immédiatement.
ALTER TABLE public.partner_intervention_requests DISABLE TRIGGER trg_pir_before_update;
UPDATE public.partner_intervention_requests
SET status = 'accepted'
WHERE id = '1fcbba0c-1922-4214-a329-a0e2302183c8';
ALTER TABLE public.partner_intervention_requests ENABLE TRIGGER trg_pir_before_update;
