-- Nouvelle ligne de test pour l'investigation pir_update (bypass RLS,
-- exécuté en tant que postgres). Sera nettoyée à la fin de l'investigation.
--
-- Correction MIG-02 (2026-07-2x) — insertion rendue conditionnelle :
-- cette fixture référence un connection_id (partner_connections) qui
-- existait réellement sur la base où cette investigation a eu lieu,
-- mais qui n'est créé par aucune migration de ce dépôt (voir
-- audit-kaytek-inter/corrections/analyse-mig-02-debug-fixtures.md).
-- Sur un bootstrap neuf, ce connection_id n'existe pas : l'INSERT
-- d'origine échouait alors sur une violation de contrainte FK
-- (partner_intervention_requests_connection_id_fkey), bloquant tout
-- `supabase db reset` depuis une base vide.
--
-- Le WHERE EXISTS ci-dessous ne change ni les colonnes, ni les valeurs,
-- ni l'intention d'origine : il fait uniquement en sorte que l'INSERT
-- ne s'exécute QUE si sa connexion de référence existe réellement.
--   · Base neuve (connexion absente) : 0 ligne insérée, aucune erreur —
--     comportement final identique à celui obtenu après le passage de
--     la migration de cleanup 20260715000010 (qui supprime cette même
--     ligne par id) : dans les deux cas, aucune fixture ne subsiste.
--   · Base où la connexion existe déjà réellement (comme au moment de
--     l'investigation d'origine) : comportement strictement inchangé —
--     la ligne est insérée exactement comme avant.
-- Aucune connexion partenaire fictive n'est créée par ce correctif :
-- l'existence du connection_id est uniquement vérifiée, jamais fabriquée.
INSERT INTO public.partner_intervention_requests (
  id, connection_id, source_organisation_id, source_profile_id,
  target_organisation_id, status, type_intervention, urgence, ville,
  share_adresse, adresse_partagee, share_telephone, telephone_client_partage,
  share_nom_client, nom_client_partage, share_description, description_partagee,
  share_montant, montant_partage, share_photos
)
SELECT
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
WHERE EXISTS (
  SELECT 1 FROM public.partner_connections
  WHERE id = '6c6f3cb6-04e0-4947-9225-3ebcff8933a3'
)
ON CONFLICT (id) DO NOTHING;
