-- Fixture de test (bypass RLS, exécuté en tant que postgres) pour
-- valider le masquage post-refus de get_partner_requests_preview /
-- pir_select, sans dépendre du flux pir_update (bug préexistant
-- distinct en cours d'investigation séparée — voir 20260714000010).
UPDATE public.partner_intervention_requests
SET status = 'refused', note_refus = 'Test refus — indisponible ce jour'
WHERE id = '1fcbba0c-1922-4214-a329-a0e2302183c8';
