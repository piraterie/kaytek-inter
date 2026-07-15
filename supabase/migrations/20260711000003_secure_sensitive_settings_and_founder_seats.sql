-- ================================================================
-- MIGRATION : Phase 2 audit sécurité — FE-01 + STRIPE-03
-- Date      : 2026-07-11
-- ================================================================

-- ----------------------------------------------------------------
-- FE-01 : cloisonner IBAN/BIC aux admins uniquement
-- ----------------------------------------------------------------
-- Contexte : parametres_entreprise.select('*') était accessible à tout
-- membre de l'organisation (is_same_org seul, aucun contrôle de rôle),
-- et chargé côté client dès la connexion pour tous les rôles (App.tsx),
-- exposant iban/bic à assistant/intervenant.
--
-- Décision produit (validée) : SIRET, numéro TVA, RC Pro et assurance
-- décennale restent publics (membres de l'org) — ce sont des mentions
-- légalement obligatoires sur tout devis/facture y compris ceux créés
-- par un intervenant habilité (can_create_documents), et SIRET/TVA sont
-- des données de registre public (INSEE), pas des secrets. Seuls IBAN
-- et BIC (risque réel de fraude au virement) passent en admin-only.
--
-- SELECT complet (incluant iban/bic) : admin uniquement.
DROP POLICY IF EXISTS "params_select" ON public.parametres_entreprise;
CREATE POLICY "params_select_admin" ON public.parametres_entreprise
  FOR SELECT USING (is_same_org(organisation_id) AND is_admin_in_org(organisation_id));

-- INSERT/UPDATE déjà admin-only (params_insert/params_update, migration
-- 20260605000004) — inchangés.

-- Vue publique : uniquement les colonnes non sensibles, nécessaires à
-- l'UI générale (nav, branding), aux mentions légales du PDF et au
-- check REQUIRED_PARAMS — jamais iban/bic. La vue s'exécute avec les
-- privilèges de son propriétaire (contourne la RLS admin-only de la
-- table de base par design — c'est le mécanisme standard Postgres pour
-- exposer un sous-ensemble de colonnes d'une table restreinte), et
-- réimplémente elle-même le cloisonnement par organisation via son
-- propre WHERE sur current_org_id().
CREATE OR REPLACE VIEW public.parametres_entreprise_public AS
SELECT
  id, organisation_id, raison_sociale, logo_url, telephone, email, site_web,
  adresse, code_postal, ville, siret, numero_tva, rc_pro, assurance_decennale,
  tva_defaut, couleur_principale, couleur_secondaire, cgv, mentions_legales,
  signature_dirigeant_url, modele_pdf_defaut,
  email_envoi_devis, email_relance_facture, email_paiement_recu,
  email_new_intervention, email_commission,
  delai_relance_1, delai_relance_2, updated_at
FROM public.parametres_entreprise
WHERE organisation_id = current_org_id();

GRANT SELECT ON public.parametres_entreprise_public TO authenticated;

-- ----------------------------------------------------------------
-- STRIPE-03 : sécuriser claim_founder_seat()
-- ----------------------------------------------------------------
-- Contexte : SECURITY DEFINER, exécutable par anon ET authenticated,
-- incrémente founder_seats.taken sans aucune vérification d'identité
-- ni de souscription Stripe réelle — n'importe qui pouvait épuiser le
-- compteur public de places fondateur sans jamais payer.
--
-- Décision validée : retirer l'exécution à anon et authenticated ;
-- seul service_role (donc un futur appel depuis le webhook Stripe
-- externe, ou une Edge Function de ce projet) pourra encore l'appeler.
-- Casse volontairement l'appel actuel du site externe kaytekinter.fr
-- (Netlify, create-trial-account) tant qu'il n'est pas mis à jour pour
-- utiliser la clé service_role — voir rapport de session pour le détail
-- de la correction externe nécessaire.
REVOKE EXECUTE ON FUNCTION public.claim_founder_seat() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_founder_seat() FROM authenticated;

-- Défense en profondeur : founder_seats a des GRANTs table-level bruts
-- vers anon/authenticated pour INSERT/UPDATE/DELETE/TRUNCATE (dérive de
-- configuration, jamais exploitable en pratique tant que RLS reste
-- activée avec la seule policy SELECT existante — aucune policy
-- INSERT/UPDATE/DELETE n'existe donc RLS bloque déjà par défaut) —
-- retirés par hygiène pour ne plus dépendre uniquement de la RLS.
-- La lecture publique du compteur (founder_seats_select_public) est
-- volontairement inchangée : l'affichage "places restantes" doit
-- continuer de fonctionner pour un visiteur anonyme.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.founder_seats FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.founder_seats FROM authenticated;
