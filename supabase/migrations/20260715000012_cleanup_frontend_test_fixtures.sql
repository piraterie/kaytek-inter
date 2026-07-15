-- Nettoyage des lignes de test créées pour valider le câblage
-- frontend (usePartnerInterventionRequests / RPC de réponse / masquage
-- UI en temps réel) — accepter, refuser, doublon accidentel de test.
DELETE FROM public.partner_intervention_requests
WHERE id IN (
  '9f0e9056-d847-41d6-a2c6-957158ba01d3',
  '78375837-410c-4020-97bb-cfea378786cb',
  '563b0007-be7c-4860-80eb-521b2cc42843'
);
