-- ================================================================
-- MIGRATION : Correction 5 — FONC-02 : source unique de vérité pour
--             le calcul des commissions
-- Date       : 2026-07-26
-- ================================================================
-- Contexte (voir audit-kaytek-inter/corrections/correction-05-
-- commissions.md pour l'analyse complète) :
--
-- Deux mécanismes de calcul de commission coexistaient, mathématiquement
-- opposés sur le sens de commission_pct :
--   1. auto_commission() (trigger interventions.statut → 'termine') :
--      commission_admin = TTC × pct/100 ; part_intervenant = TTC − commission_admin
--      → traite pct comme le taux de L'ENTREPRISE, ignore le matériel.
--   2. useCommissionsData() (frontend, recalcul à la volée sur les
--      factures payées) : commission_intervenant = (TTC − matériel) × pct/100
--      → traite pct comme le taux de L'INTERVENANT (confirmé : la page
--      Commissions labellise ce montant "Ma commission"), déduit le
--      matériel confirmé.
--
-- Décision validée : commission_pct représente le taux de l'INTERVENANT.
-- La commission définitive est désormais calculée et FIGÉE côté serveur
-- au moment où une facture passe à statut_paiement = 'payee', jamais
-- recalculée dynamiquement à l'affichage, jamais avec le taux courant
-- du profil au-delà de la création initiale.
--
-- Portée de cette migration :
--   1. Colonnes additives NULLABLES sur commissions (aucune ligne
--      historique modifiée, formule_version reste NULL pour elles).
--   2. Contraintes CHECK conditionnelles, actives UNIQUEMENT pour
--      formule_version = 2 — aucune ligne historique n'est invalidée.
--   3. Index UNIQUE partiel (facture_id, intervenant_id) WHERE
--      facture_id IS NOT NULL — précédé d'un audit bloquant des doublons.
--   4. Fonction centrale calculate_commission_for_facture(uuid),
--      SECURITY DEFINER, jamais exposée à authenticated/anon.
--   5. Suppression du SEUL trigger obsolète (trg_auto_commission sur
--      interventions) — la fonction auto_commission() elle-même est
--      CONSERVÉE (non supprimée) pour faciliter un rollback.
--   6. Nouveau trigger sur factures (transition vers 'payee' uniquement).
--   7. Nouveau trigger de recalcul sur interventions (cout_pieces /
--      materiel_confirme), limité aux commissions formule_version = 2
--      non finalisées.
--   8. Trigger d'immutabilité des champs financiers d'une commission
--      finalisée (statut='paye' OU commission_receipts.recue=true).
--   9. Durcissement de commissions_insert : plus aucun INSERT direct
--      pour authenticated, quel que soit le rôle — la création ne
--      passe plus que par la fonction SECURITY DEFINER ci-dessus.
--      commissions_select/update/delete et TOUTES les policies de
--      commission_receipts restent INCHANGÉES.
--
-- AUCUNE ligne historique de commissions/commission_receipts/factures/
-- interventions/profiles n'est modifiée par cette migration. AUCUN
-- recalcul rétroactif n'est déclenché.
--
-- Hors périmètre (documenté séparément dans le rapport de correction,
-- FONC-04) : annulation de facture après création d'une commission,
-- réaffectation d'intervention après création d'une commission — non
-- traités ici, aucun comportement automatique inventé.
-- ================================================================


-- ================================================================
-- 1. PRÉCONTRÔLES DE SCHÉMA ET AUDIT DES DOUBLONS
-- ================================================================
DO $$
DECLARE
  v_dupes int;
BEGIN
  -- Doublons (facture_id, intervenant_id) parmi les lignes qui ont déjà
  -- un facture_id renseigné (aucune ligne historique du trigger
  -- auto_commission() n'en a — facture_id y est toujours NULL — donc ce
  -- contrôle ne peut porter que sur d'éventuelles données déjà écrites
  -- hors de ce dépôt).
  SELECT count(*) INTO v_dupes FROM (
    SELECT facture_id, intervenant_id
    FROM public.commissions
    WHERE facture_id IS NOT NULL
    GROUP BY facture_id, intervenant_id
    HAVING count(*) > 1
  ) x;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % doublon(s) (facture_id, intervenant_id) détecté(s) dans commissions — investiguer avant de continuer, aucune donnée modifiée.', v_dupes;
  END IF;

  RAISE NOTICE 'Audit préalable OK : aucun doublon (facture_id, intervenant_id) dans commissions.';
END $$;


-- ================================================================
-- 2. COLONNES ADDITIVES (nullables — aucune ligne historique affectée)
-- ================================================================
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS montant_ttc_source numeric,
  ADD COLUMN IF NOT EXISTS cout_pieces_applique numeric,
  ADD COLUMN IF NOT EXISTS materiel_confirme_applique boolean,
  ADD COLUMN IF NOT EXISTS base_commissionnable numeric,
  ADD COLUMN IF NOT EXISTS formule_version integer;

COMMENT ON COLUMN public.commissions.montant_ttc_source IS
  'Formule v2 uniquement. Copie de factures.montant_ttc au moment du calcul — jamais interventions.montant_ttc (source de la divergence FONC-02).';
COMMENT ON COLUMN public.commissions.cout_pieces_applique IS
  'Formule v2 uniquement. Coût matériel réellement déduit (0 si non confirmé au moment du calcul), figé.';
COMMENT ON COLUMN public.commissions.materiel_confirme_applique IS
  'Formule v2 uniquement. Statut de confirmation du matériel au moment du calcul, figé.';
COMMENT ON COLUMN public.commissions.base_commissionnable IS
  'Formule v2 uniquement. GREATEST(0, montant_ttc_source - cout_pieces_applique), figé.';
COMMENT ON COLUMN public.commissions.formule_version IS
  'NULL = ligne historique (trigger auto_commission(), pct traité comme part entreprise, matériel ignoré). 2 = nouvelle formule (pct = part intervenant, matériel déduit, valeurs figées). Ne jamais rétro-attribuer 2 à une ligne historique.';

-- Convention pour les colonnes préexistantes, conservée sans renommage
-- (décision explicite — un renommage aurait un impact frontend disproportionné) :
--   Pour les lignes formule_version = 2 : part_intervenant = commission réelle
--   de l'intervenant, commission_admin = part réelle de l'entreprise,
--   montant_total_client = montant_ttc_source (copie).
--   Pour les lignes formule_version IS NULL (historiques) : ces mêmes
--   colonnes conservent leur ANCIENNE sémantique (part_intervenant y était
--   en réalité TTC - commission_admin, avec pct traité comme part
--   entreprise) — ne jamais comparer les deux versions sans distinguer
--   formule_version.


-- ================================================================
-- 3. CONTRAINTES CONDITIONNELLES — UNIQUEMENT pour formule_version = 2
-- ================================================================
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_v2_pct_range CHECK (
    formule_version IS DISTINCT FROM 2 OR (commission_pct >= 0 AND commission_pct <= 100)
  ),
  ADD CONSTRAINT commissions_v2_montants_non_negatifs CHECK (
    formule_version IS DISTINCT FROM 2 OR (
      montant_total_client >= 0 AND part_intervenant >= 0 AND commission_admin >= 0
    )
  ),
  ADD CONSTRAINT commissions_v2_champs_requis CHECK (
    formule_version IS DISTINCT FROM 2 OR (
      montant_ttc_source IS NOT NULL
      AND cout_pieces_applique IS NOT NULL
      AND materiel_confirme_applique IS NOT NULL
      AND base_commissionnable IS NOT NULL
    )
  ),
  ADD CONSTRAINT commissions_v2_cout_pieces_non_negatif CHECK (
    formule_version IS DISTINCT FROM 2 OR cout_pieces_applique >= 0
  ),
  ADD CONSTRAINT commissions_v2_base_non_negative CHECK (
    formule_version IS DISTINCT FROM 2 OR base_commissionnable >= 0
  ),
  ADD CONSTRAINT commissions_v2_base_le_ttc CHECK (
    formule_version IS DISTINCT FROM 2 OR base_commissionnable <= montant_ttc_source
  ),
  ADD CONSTRAINT commissions_v2_parts_egalent_base CHECK (
    formule_version IS DISTINCT FROM 2 OR (part_intervenant + commission_admin = base_commissionnable)
  );


-- ================================================================
-- 4. INDEX UNIQUE PARTIEL — idempotence (une commission par facture/intervenant)
-- ================================================================
CREATE UNIQUE INDEX IF NOT EXISTS commissions_facture_intervenant_unique
  ON public.commissions (facture_id, intervenant_id)
  WHERE facture_id IS NOT NULL;


-- ================================================================
-- 5. FONCTION CENTRALE : calculate_commission_for_facture(uuid)
-- ================================================================
-- Ne reçoit aucun montant, taux, coût matériel ni organisation_id du
-- frontend — uniquement l'identifiant de la facture. Tout le reste est
-- dérivé côté serveur depuis factures/interventions/profiles.
--
-- Distinction volontaire (documentée dans le rapport de correction) :
--   · facture.intervention_id IS NULL → cas légitime et courant (facture
--     "non attribuée", déjà comptée comme telle par useCommissionsData
--     aujourd'hui) → PAS une erreur, retour silencieux sans commission.
--   · facture.intervention_id IS NOT NULL mais l'intervention n'existe
--     pas, ou existe sans intervenant_id assigné → anomalie de données
--     réelle (une facture ne devrait jamais référencer une intervention
--     non attribuée) → échec explicite (RAISE EXCEPTION), conformément
--     à l'exigence "échouer si la facture n'a pas d'intervention ou
--     d'intervenant EXPLOITABLE" — un lien explicite mais inexploitable
--     est une anomalie, l'absence de lien ne l'est pas.
CREATE OR REPLACE FUNCTION public.calculate_commission_for_facture(p_facture_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facture      public.factures;
  v_intervention public.interventions;
  v_existing     public.commissions;
  v_ttc          numeric;
  v_cout         numeric;
  v_confirme     boolean;
  v_base         numeric;
  v_pct          numeric;
  v_part         numeric;
  v_admin_part   numeric;
BEGIN
  SELECT * INTO v_facture FROM public.factures WHERE id = p_facture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: facture introuvable (%)', p_facture_id;
  END IF;

  IF v_facture.statut_paiement <> 'payee' THEN
    RETURN; -- garde défensive : ne calcule jamais pour une facture non payée
  END IF;

  IF v_facture.intervention_id IS NULL THEN
    RETURN; -- facture non attribuée : cas légitime, pas une erreur (voir en-tête)
  END IF;

  SELECT * INTO v_intervention FROM public.interventions WHERE id = v_facture.intervention_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: intervention liée introuvable pour la facture % (intervention_id=%)', p_facture_id, v_facture.intervention_id;
  END IF;

  IF v_intervention.intervenant_id IS NULL THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: intervention % liée à la facture % n''a aucun intervenant assigné', v_intervention.id, p_facture_id;
  END IF;

  -- Ligne existante éventuelle pour ce couple (facture, intervenant) —
  -- ne matche JAMAIS une ligne historique (formule_version IS NULL),
  -- puisque ces dernières ont toujours facture_id NULL par construction
  -- (l'ancien trigger ne le renseignait jamais). Garde explicite
  -- supplémentaire ci-dessous par défense en profondeur.
  SELECT * INTO v_existing
  FROM public.commissions
  WHERE facture_id = p_facture_id AND intervenant_id = v_intervention.intervenant_id;

  IF FOUND AND v_existing.formule_version IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: ligne commissions % inattendue (formule_version différente de 2) pour facture %', v_existing.id, p_facture_id;
  END IF;

  IF FOUND THEN
    -- Ne recalcule jamais une commission finalisée.
    IF v_existing.statut = 'paye'
       OR EXISTS (
         SELECT 1 FROM public.commission_receipts cr
         WHERE cr.facture_id = p_facture_id AND cr.intervenant_id = v_intervention.intervenant_id AND cr.recue = true
       )
    THEN
      RETURN;
    END IF;
    -- Recalcul autorisé : taux déjà figé CONSERVÉ, jamais relu depuis profiles.
    v_pct := v_existing.commission_pct;
  ELSE
    -- Création initiale : taux courant du profil, figé désormais.
    SELECT commission_pct INTO v_pct FROM public.profiles WHERE id = v_intervention.intervenant_id;
    v_pct := COALESCE(v_pct, 30);
  END IF;

  IF v_pct < 0 OR v_pct > 100 THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: taux de commission invalide (%) pour le profil %', v_pct, v_intervention.intervenant_id;
  END IF;

  v_ttc := COALESCE(v_facture.montant_ttc, 0);
  IF v_ttc < 0 THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: montant_ttc négatif sur la facture %', p_facture_id;
  END IF;

  v_confirme := COALESCE(v_intervention.materiel_confirme, false);
  v_cout := CASE WHEN v_confirme THEN COALESCE(v_intervention.cout_pieces, 0) ELSE 0 END;
  IF v_cout < 0 THEN
    RAISE EXCEPTION 'calculate_commission_for_facture: cout_pieces négatif sur l''intervention %', v_intervention.id;
  END IF;

  v_base        := GREATEST(0, ROUND(v_ttc - v_cout, 2));
  v_part        := ROUND(v_base * v_pct / 100, 2);
  v_admin_part  := v_base - v_part; -- dérivé par soustraction — garantit l'identité au centime

  -- INSERT ... ON CONFLICT ... DO UPDATE : garantit l'idempotence même en
  -- cas de double déclenchement concurrent (deux transitions vers 'payee'
  -- quasi simultanées, ou rejeu) — la contrainte UNIQUE (§4) fait foi.
  -- commission_pct N'EST JAMAIS dans la clause DO UPDATE SET : même si
  -- EXCLUDED.commission_pct portait une valeur différente (profil modifié
  -- entre deux tentatives concurrentes), le taux déjà écrit reste figé.
  -- La clause WHERE du DO UPDATE réaffirme qu'une ligne finalisée ou
  -- historique n'est jamais réécrite, même par une exécution concurrente.
  INSERT INTO public.commissions (
    intervention_id, facture_id, intervenant_id, organisation_id,
    montant_total_client, commission_pct, part_intervenant, commission_admin,
    statut, montant_ttc_source, cout_pieces_applique, materiel_confirme_applique,
    base_commissionnable, formule_version
  ) VALUES (
    v_intervention.id, p_facture_id, v_intervention.intervenant_id, v_facture.organisation_id,
    v_ttc, v_pct, v_part, v_admin_part,
    'a_payer', v_ttc, v_cout, v_confirme,
    v_base, 2
  )
  ON CONFLICT (facture_id, intervenant_id) WHERE facture_id IS NOT NULL
  DO UPDATE SET
    montant_total_client       = EXCLUDED.montant_total_client,
    montant_ttc_source         = EXCLUDED.montant_ttc_source,
    cout_pieces_applique       = EXCLUDED.cout_pieces_applique,
    materiel_confirme_applique = EXCLUDED.materiel_confirme_applique,
    base_commissionnable       = EXCLUDED.base_commissionnable,
    part_intervenant           = EXCLUDED.part_intervenant,
    commission_admin           = EXCLUDED.commission_admin,
    updated_at                 = now()
  WHERE commissions.formule_version = 2
    AND commissions.statut <> 'paye'
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_receipts cr2
      WHERE cr2.facture_id = commissions.facture_id AND cr2.intervenant_id = commissions.intervenant_id AND cr2.recue = true
    );
END;
$$;

ALTER FUNCTION public.calculate_commission_for_facture(uuid) OWNER TO postgres;

-- Correction SEC2-02 (analyse : audit-kaytek-inter/corrections/
-- analyse-sec2-02-function-privileges.md) : l'image Postgres locale de
-- Supabase accorde un EXECUTE direct par défaut à anon/authenticated/
-- service_role sur toute nouvelle fonction créée par postgres — un
-- "REVOKE ALL FROM PUBLIC" seul ne retire jamais ce droit direct
-- (confirmé empiriquement, deux entrées ACL indépendantes). Appelée
-- EXCLUSIVEMENT via les triggers ci-dessous (chaîne SECURITY DEFINER
-- postgres → SECURITY DEFINER postgres) — confirmé empiriquement qu'un
-- tel appel ne nécessite AUCUN droit EXECUTE direct pour le rôle ayant
-- initié la transaction. Les REVOKE explicites ci-dessous ferment le
-- seul écart réel : un appel RPC direct fournissant librement un
-- facture_id arbitraire, sans passer par la transition de statut réelle.
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.calculate_commission_for_facture(uuid) FROM service_role;
-- Aucun GRANT à anon, authenticated, ni service_role : appelée
-- uniquement par les triggers ci-dessous (SECURITY DEFINER, propriétaire
-- postgres).


-- ================================================================
-- 6. SUPPRESSION DU TRIGGER OBSOLÈTE (fonction auto_commission CONSERVÉE)
-- ================================================================
DROP TRIGGER IF EXISTS trg_auto_commission ON public.interventions;
-- auto_commission() n'est PAS supprimée (facilite un rollback exact) —
-- elle devient simplement une fonction orpheline, sans trigger l'appelant.


-- ================================================================
-- 7. NOUVEAU TRIGGER SUR factures — déclenchement au paiement
-- ================================================================
CREATE OR REPLACE FUNCTION public.trigger_calculate_commission_on_facture_payee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.statut_paiement = 'payee'
     AND (TG_OP = 'INSERT' OR OLD.statut_paiement IS DISTINCT FROM 'payee')
  THEN
    PERFORM public.calculate_commission_for_facture(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_calculate_commission_on_facture_payee() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_calculate_commission_on_facture_payee ON public.factures;
CREATE TRIGGER trg_calculate_commission_on_facture_payee
  AFTER INSERT OR UPDATE ON public.factures
  FOR EACH ROW EXECUTE FUNCTION public.trigger_calculate_commission_on_facture_payee();
-- Condition OLD.statut_paiement IS DISTINCT FROM 'payee' : ne se
-- déclenche que sur la TRANSITION vers 'payee', jamais sur un UPDATE
-- ultérieur d'une facture déjà payée (ex. modification de notes).


-- ================================================================
-- 8. RECALCUL SUR CONFIRMATION/MODIFICATION DU MATÉRIEL
-- ================================================================
-- materiel_payeur est explicitement EXCLU de la condition de
-- déclenchement : vérifié dans la formule validée (§ formule métier),
-- cette colonne n'intervient dans aucun calcul (seuls cout_pieces et
-- materiel_confirme influencent base_commissionnable) — l'inclure
-- déclencherait des recalculs inutiles sans jamais changer un montant.
CREATE OR REPLACE FUNCTION public.trigger_recalculate_commission_on_materiel_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facture_id uuid;
BEGIN
  IF NEW.cout_pieces IS DISTINCT FROM OLD.cout_pieces
     OR NEW.materiel_confirme IS DISTINCT FROM OLD.materiel_confirme
  THEN
    FOR v_facture_id IN
      SELECT f.id FROM public.factures f
      WHERE f.intervention_id = NEW.id AND f.statut_paiement = 'payee'
    LOOP
      PERFORM public.calculate_commission_for_facture(v_facture_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_recalculate_commission_on_materiel_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_recalculate_commission_on_materiel_change ON public.interventions;
CREATE TRIGGER trg_recalculate_commission_on_materiel_change
  AFTER UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_recalculate_commission_on_materiel_change();
-- Ne recalcule que via calculate_commission_for_facture(), qui applique
-- déjà toutes les gardes nécessaires : commission non finalisée
-- uniquement, formule_version = 2 uniquement (une ligne historique n'a
-- jamais de facture_id renseigné, donc n'est jamais retrouvée ici),
-- taux figé conservé.


-- ================================================================
-- 9. IMMUTABILITÉ DES CHAMPS FINANCIERS D'UNE COMMISSION FINALISÉE
-- ================================================================
CREATE OR REPLACE FUNCTION public.protect_finalized_commission_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_finalized boolean;
BEGIN
  v_was_finalized := (
    OLD.statut = 'paye'
    OR EXISTS (
      SELECT 1 FROM public.commission_receipts cr
      WHERE cr.facture_id = OLD.facture_id AND cr.intervenant_id = OLD.intervenant_id AND cr.recue = true
    )
  );

  IF v_was_finalized THEN
    IF NEW.montant_total_client        IS DISTINCT FROM OLD.montant_total_client
       OR NEW.commission_pct           IS DISTINCT FROM OLD.commission_pct
       OR NEW.part_intervenant         IS DISTINCT FROM OLD.part_intervenant
       OR NEW.commission_admin         IS DISTINCT FROM OLD.commission_admin
       OR NEW.montant_ttc_source       IS DISTINCT FROM OLD.montant_ttc_source
       OR NEW.cout_pieces_applique     IS DISTINCT FROM OLD.cout_pieces_applique
       OR NEW.materiel_confirme_applique IS DISTINCT FROM OLD.materiel_confirme_applique
       OR NEW.base_commissionnable     IS DISTINCT FROM OLD.base_commissionnable
       OR NEW.formule_version          IS DISTINCT FROM OLD.formule_version
       OR NEW.facture_id               IS DISTINCT FROM OLD.facture_id
       OR NEW.intervention_id          IS DISTINCT FROM OLD.intervention_id
       OR NEW.intervenant_id           IS DISTINCT FROM OLD.intervenant_id
       OR NEW.organisation_id          IS DISTINCT FROM OLD.organisation_id
    THEN
      RAISE EXCEPTION 'Commission finalisée (statut=paye ou reçu confirmé) : les champs financiers ne peuvent plus être modifiés';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_finalized_commission_fields() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_protect_finalized_commission ON public.commissions;
CREATE TRIGGER trg_protect_finalized_commission
  BEFORE UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_commission_fields();
-- Ne bloque jamais la lecture, ni les transitions de statut elles-mêmes
-- (statut/paye_le absents de la liste protégée) — uniquement les 13
-- champs financiers/structurels une fois la ligne finalisée. Ne bloque
-- jamais calculate_commission_for_facture() elle-même : sa clause
-- WHERE (statut<>'paye' AND NOT EXISTS recue) l'empêche déjà de tenter
-- d'écrire sur une ligne finalisée.


-- ================================================================
-- 10. DURCISSEMENT DE commissions_insert
-- ================================================================
-- Référence actuelle (Correction 2, SEC-01) :
--   WITH CHECK (organisation_id = current_org_id() AND (is_admin_in_org(...)
--   OR (is_intervenant_in_org(...) AND intervenant_id = auth.uid()))
--   AND current_organisation_has_app_access())
-- Permettait à un intervenant d'insérer une ligne de commission pour
-- lui-même SANS AUCUNE vérification des montants — c'est exactement le
-- risque que cette correction élimine. La création passe désormais
-- EXCLUSIVEMENT par calculate_commission_for_facture() (SECURITY
-- DEFINER, bypass RLS) — plus aucun INSERT direct n'est nécessaire ni
-- autorisé pour authenticated, quel que soit le rôle.
-- commissions_select/update/delete et TOUTES les policies de
-- commission_receipts (cr_select/cr_insert/cr_update/cr_delete) restent
-- STRICTEMENT INCHANGÉES.
DROP POLICY IF EXISTS "commissions_insert" ON public.commissions;
CREATE POLICY "commissions_insert" ON public.commissions
  FOR INSERT
  WITH CHECK (false);


-- ================================================================
-- 11. ASSERTIONS STATIQUES (schéma uniquement)
-- ================================================================
DO $$
DECLARE
  v_count int;
  v_triggerdef text;
BEGIN
  -- 11.1 — Trigger obsolète bien détaché d'interventions ; fonction conservée.
  SELECT count(*) INTO v_count
  FROM information_schema.triggers
  WHERE event_object_schema = 'public' AND event_object_table = 'interventions'
    AND trigger_name = 'trg_auto_commission';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Assertion échouée : trg_auto_commission encore attaché à interventions';
  END IF;
  SELECT count(*) INTO v_count FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'auto_commission';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : auto_commission() devrait toujours exister (conservée pour rollback), trouvé %', v_count;
  END IF;

  -- 11.2 — Nouveaux triggers présents et attachés aux bonnes tables.
  --
  -- Correction TEST5-01 (analyse : audit-kaytek-inter/corrections/
  -- correction-test5-01-trigger-assertion.md) : trg_calculate_commission_
  -- on_facture_payee est UN SEUL trigger physique couvrant deux
  -- événements (AFTER INSERT OR UPDATE, voir sa création ci-dessus,
  -- inchangée). information_schema.triggers (vue SQL standard, sans
  -- notion de clause OR entre événements) expose une ligne PAR TYPE
  -- D'ÉVÉNEMENT pour un même trigger physique — un COUNT(*) sur cette
  -- vue rapportait donc 2 pour ce seul trigger réel, faisant échouer à
  -- tort une assertion qui attendait 1. Confirmé empiriquement (conteneur
  -- Postgres jetable isolé, reproduisant exactement CREATE TRIGGER ...
  -- AFTER INSERT OR UPDATE ...) : pg_trigger (catalogue physique) ne
  -- souffre pas de cet artefact — une ligne exacte par trigger réellement
  -- défini, quel que soit le nombre d'événements couverts par une seule
  -- clause CREATE TRIGGER. Ce n'était pas un doublon réel de trigger :
  -- ni la fonction de commission, ni le trigger, ni ses événements
  -- INSERT/UPDATE ne sont modifiés par cette correction — seule la
  -- source de comptage de l'assertion change.
  SELECT count(*) INTO v_count FROM pg_trigger
  WHERE tgrelid = 'public.factures'::regclass
    AND tgname = 'trg_calculate_commission_on_facture_payee'
    AND NOT tgisinternal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : trigger facture payée manquant ou dupliqué (trouvé % trigger(s) physique(s) via pg_trigger)', v_count;
  END IF;

  -- Vérifie la définition physique complète du trigger unique retrouvé
  -- ci-dessus : doit rester AFTER INSERT OR UPDATE sur public.factures,
  -- appelant bien la fonction de calcul de commission attendue — garde-
  -- fou contre une régression qui réduirait silencieusement le trigger à
  -- un seul événement ou le rattacherait à la mauvaise table/fonction.
  SELECT pg_get_triggerdef(t.oid) INTO v_triggerdef
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.factures'::regclass
    AND t.tgname = 'trg_calculate_commission_on_facture_payee'
    AND NOT t.tgisinternal;
  IF v_triggerdef IS NULL
     OR v_triggerdef NOT LIKE '%AFTER%'
     OR v_triggerdef NOT LIKE '%INSERT%'
     OR v_triggerdef NOT LIKE '%UPDATE%'
     OR v_triggerdef NOT LIKE '%ON public.factures%'
     OR v_triggerdef NOT LIKE '%trigger_calculate_commission_on_facture_payee%'
  THEN
    RAISE EXCEPTION 'Assertion échouée : définition du trigger facture payée inattendue (%)', v_triggerdef;
  END IF;
  SELECT count(*) INTO v_count FROM information_schema.triggers
  WHERE event_object_schema = 'public' AND event_object_table = 'interventions'
    AND trigger_name = 'trg_recalculate_commission_on_materiel_change';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : trigger recalcul matériel manquant (trouvé %)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM information_schema.triggers
  WHERE event_object_schema = 'public' AND event_object_table = 'commissions'
    AND trigger_name = 'trg_protect_finalized_commission';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : trigger immutabilité manquant (trouvé %)', v_count;
  END IF;

  -- 11.3 — Fonction centrale : SECURITY DEFINER, search_path, aucun EXECUTE anon/authenticated.
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'calculate_commission_for_facture'
    AND prosecdef = true
    AND proconfig IS NOT NULL
    AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : calculate_commission_for_facture doit être unique, SECURITY DEFINER, avec search_path fixé (trouvé %)', v_count;
  END IF;
  IF has_function_privilege('anon', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : calculate_commission_for_facture ne doit être exécutable ni par anon ni par authenticated';
  END IF;
  -- Correction SEC2-02 : service_role vérifié explicitement aussi (jamais
  -- supposé) — aucun appel direct identifié nulle part dans le dépôt.
  IF has_function_privilege('service_role', 'public.calculate_commission_for_facture(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : calculate_commission_for_facture ne doit être exécutable ni par service_role (aucun appel direct identifié)';
  END IF;

  -- 11.4 — Index unique partiel présent.
  SELECT count(*) INTO v_count FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'commissions' AND indexname = 'commissions_facture_intervenant_unique';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : index unique commissions_facture_intervenant_unique manquant';
  END IF;

  -- 11.5 — Les 7 contraintes v2 sont présentes.
  SELECT count(*) INTO v_count FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'commissions' AND t.relnamespace = 'public'::regnamespace
    AND c.conname IN (
      'commissions_v2_pct_range', 'commissions_v2_montants_non_negatifs',
      'commissions_v2_champs_requis', 'commissions_v2_cout_pieces_non_negatif',
      'commissions_v2_base_non_negative', 'commissions_v2_base_le_ttc',
      'commissions_v2_parts_egalent_base'
    );
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'Assertion échouée : 7 contraintes v2 attendues sur commissions, trouvé %', v_count;
  END IF;

  -- 11.6 — Nouvelles colonnes présentes.
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'commissions'
    AND column_name IN ('montant_ttc_source', 'cout_pieces_applique', 'materiel_confirme_applique', 'base_commissionnable', 'formule_version');
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'Assertion échouée : 5 colonnes v2 attendues sur commissions, trouvé %', v_count;
  END IF;

  -- 11.7 — commissions_insert désormais WITH CHECK (false).
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'commissions' AND policyname = 'commissions_insert'
    AND with_check = 'false';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : commissions_insert devrait être WITH CHECK (false)';
  END IF;

  -- 11.8 — commissions_select/update/delete et commission_receipts inchangées
  -- (comptage global — pas de policy manquante ou ajoutée par erreur).
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commissions';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Assertion échouée : 4 policies attendues sur commissions (select/insert/update/delete), trouvé %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commission_receipts';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Assertion échouée : 4 policies attendues sur commission_receipts (inchangées), trouvé %', v_count;
  END IF;

  RAISE NOTICE 'Correction 5 (FONC-02) : toutes les assertions statiques ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname LIKE 'commissions_v2_%';

SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND trigger_name IN (
    'trg_calculate_commission_on_facture_payee',
    'trg_recalculate_commission_on_materiel_change',
    'trg_protect_finalized_commission'
  );
