-- ================================================================
-- MIGRATION : Phase 2 audit sécurité — durcissement FE-01 (suite)
-- Date      : 2026-07-11
-- ================================================================
-- La vue parametres_entreprise_public créée dans la migration
-- précédente a hérité des GRANTs par défaut PostgreSQL (INSERT/UPDATE/
-- DELETE/TRUNCATE vers anon/authenticated) qu'aucun `GRANT SELECT`
-- explicite ne retire automatiquement. Comme la vue ne fait référence
-- qu'à une seule table sans agrégation, Postgres peut la considérer
-- "automatiquement updatable" — une écriture au travers de la vue
-- s'exécuterait alors avec les privilèges de son propriétaire,
-- contournant la RLS admin-only désormais posée sur la table de base
-- parametres_entreprise. On retire explicitement tout droit d'écriture
-- sur la vue : elle doit rester strictement en lecture pour anon et
-- authenticated.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parametres_entreprise_public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parametres_entreprise_public FROM authenticated;
