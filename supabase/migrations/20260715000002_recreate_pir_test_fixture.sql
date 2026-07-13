-- Nouvelle ligne de test pour l'investigation pir_update (bypass RLS,
-- exécuté en tant que postgres). Sera nettoyée à la fin de l'investigation.
INSERT INTO public.partner_intervention_requests (
  id, connection_id, source_organisation_id, source_profile_id,
  target_organisation_id, status, type_intervention, urgence, ville,
  share_adresse, adresse_partagee, share_telephone, telephone_client_partage,
  share_nom_client, nom_client_partage, share_description, description_partagee,
  share_montant, montant_partage, share_photos
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '6c6f3cb6-04e0-4947-9225-3ebcff8933a3',
  '10b3a27e-19a4-4ed5-a150-10bb3d0a8ab6',
  '59e65e97-326d-484d-911d-fb0c72212cb6',
  'ff6cf5ec-7156-43bb-bc83-979b0d64d82e',
  'pending', 'serrurerie', false, 'Paris',
  true, '42 rue Confidentielle, 75001 Paris',
  true, '0699887766',
  true, 'CONFIDENTIEL Dupont',
  true, 'Porte claquée, client bloqué dehors',
  true, 90, false
)
ON CONFLICT (id) DO NOTHING;
