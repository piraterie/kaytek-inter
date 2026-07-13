-- Nettoyage de la ligne de test créée pour l'investigation du bug
-- pir_update (20260715000002), maintenant résolue par 20260715000009.
DELETE FROM public.partner_intervention_requests
WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
