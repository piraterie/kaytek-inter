-- Nettoyage de la ligne de test créée pour valider le masquage par
-- statut (pending → raw masqué / preview non-confidentielle,
-- refused → idem, accepted → accès complet — les trois vérifiés).
DELETE FROM public.partner_intervention_requests
WHERE id = '1fcbba0c-1922-4214-a329-a0e2302183c8';
