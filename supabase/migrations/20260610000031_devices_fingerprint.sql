-- ================================================================
-- MIGRATION : devices — ajout device_fingerprint
-- Date      : 2026-06-10
-- ----------------------------------------------------------------
-- Problème  : device_id est un UUID stocké uniquement dans localStorage.
--             Quand l'utilisateur vide ses cookies / données du site,
--             localStorage est effacé → nouveau UUID généré → la
--             recherche par device_id échoue → nouveau slot consommé
--             → blocage "Nombre maximal d'appareils atteint".
--
-- Solution  : ajouter une colonne device_fingerprint (texte)
--             calculée côté frontend depuis des caractéristiques
--             stables (type device + navigateur + résolution + langue
--             + CPU). En cas de perte du localStorage, la
--             correspondance se fait sur le fingerprint → même
--             appareil reconnu, device_id mis à jour, slot conservé.
--
-- Impact    : NULL pour les lignes existantes (rétrocompat garantie).
--             Index partiel (WHERE device_fingerprint IS NOT NULL).
--             Aucune policy RLS modifiée.
-- ================================================================

-- Colonne fingerprint (nullable pour rétrocompabilité)
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_fingerprint text;

-- Index pour la recherche par (user_id, fingerprint)
-- Index partiel : exclut les NULL (lignes existantes sans fingerprint)
CREATE INDEX IF NOT EXISTS idx_devices_user_fingerprint
  ON public.devices(user_id, device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;

-- ================================================================
-- VÉRIFICATION
-- ================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'devices'
ORDER BY ordinal_position;
-- Attendu : device_fingerprint text | YES (nullable)

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'devices'
  AND indexname = 'idx_devices_user_fingerprint';
-- Attendu : 1 ligne avec WHERE (device_fingerprint IS NOT NULL)
