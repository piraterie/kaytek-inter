-- ================================================================
-- MIGRATION : Échéanciers de paiement — logique métier centralisée
-- Date       : 2026-07-30
-- Objectif   : Un point d'entrée unique et transactionnel pour créer
--              un échéancier (create_echeancier), une seule fonction
--              qui recalcule montants/statuts à chaque paiement
--              (recalc_echeance_et_echeancier), et la bascule
--              automatique en_retard -> impaye après délai configurable.
--              Évite d'avoir cette logique dupliquée/divergente entre
--              pages (section 17 du cahier des charges).
-- Portée     : Additif. Ne touche à aucune table existante (devis.statut
--              n'est jamais modifié ici, pour ne pas casser la
--              transformation devis -> facture existante).
-- ================================================================

-- ── Cohérence organisation/client entre echeancier et devis ────────
CREATE OR REPLACE FUNCTION public.validate_echeancier_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
BEGIN
  SELECT organisation_id, client_id, statut, total_ttc INTO d
  FROM public.devis WHERE id = NEW.devis_id;

  IF d IS NULL THEN
    RAISE EXCEPTION 'Devis % introuvable', NEW.devis_id;
  END IF;
  IF d.organisation_id <> NEW.organisation_id THEN
    RAISE EXCEPTION 'organisation_id incohérent entre échéancier et devis';
  END IF;
  IF d.client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'client_id incohérent entre échéancier et devis';
  END IF;
  IF d.statut IN ('refuse', 'expire') THEN
    RAISE EXCEPTION 'Impossible de créer un échéancier sur un devis refusé ou expiré';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS echeanciers_validate_coherence ON public.echeanciers;
CREATE TRIGGER echeanciers_validate_coherence
  BEFORE INSERT OR UPDATE ON public.echeanciers
  FOR EACH ROW EXECUTE FUNCTION public.validate_echeancier_coherence();

-- ── Cohérence echeance <-> echeancier parent ────────────────────
CREATE OR REPLACE FUNCTION public.validate_echeance_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT organisation_id, devis_id, client_id, nombre_echeances INTO s
  FROM public.echeanciers WHERE id = NEW.echeancier_id;

  IF s IS NULL THEN
    RAISE EXCEPTION 'Échéancier % introuvable', NEW.echeancier_id;
  END IF;
  IF s.organisation_id <> NEW.organisation_id
     OR s.devis_id <> NEW.devis_id
     OR s.client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'echeance incohérente avec son échéancier parent';
  END IF;
  IF NEW.numero_ordre > s.nombre_echeances THEN
    RAISE EXCEPTION 'numero_ordre (%) dépasse nombre_echeances (%) de l''échéancier', NEW.numero_ordre, s.nombre_echeances;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS echeances_validate_coherence ON public.echeances;
CREATE TRIGGER echeances_validate_coherence
  BEFORE INSERT OR UPDATE ON public.echeances
  FOR EACH ROW EXECUTE FUNCTION public.validate_echeance_coherence();

-- ── Recalcul centralisé montant/statut d'une échéance + cascade ────
-- Unique source de vérité pour les montants payés/restants et les
-- statuts dérivés. Appelée par le trigger sur `paiements` ; peut aussi
-- être appelée manuellement (ex: après une correction) via
-- SELECT public.recalc_echeance_et_echeancier('<echeance_id>');
CREATE OR REPLACE FUNCTION public.recalc_echeance_et_echeancier(p_echeance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ech RECORD;
  v_total_paye numeric;
  v_nouveau_statut text;
  v_echeancier_id uuid;
BEGIN
  SELECT * INTO ech FROM public.echeances WHERE id = p_echeance_id FOR UPDATE;
  IF ech IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(montant), 0) INTO v_total_paye
  FROM public.paiements
  WHERE echeance_id = p_echeance_id AND deleted_at IS NULL;

  IF ech.annule_le IS NOT NULL THEN
    v_nouveau_statut := 'annule';
  ELSIF v_total_paye >= ech.montant_ttc - 0.01 THEN
    v_nouveau_statut := 'paye';
  ELSIF v_total_paye > 0 THEN
    v_nouveau_statut := 'paiement_partiel';
  ELSIF ech.statut = 'impaye' THEN
    -- Statut manuel/automatique "Impayée" : ne pas revenir en arrière
    -- tant qu'aucun paiement n'est reçu (reste 'impaye' jusqu'à action explicite).
    v_nouveau_statut := 'impaye';
  ELSIF ech.statut IN ('brouillon', 'a_facturer') THEN
    -- Pas encore activée par une facture : le paiement trigger ne fait
    -- ici que remettre les montants à jour, le statut reste piloté par
    -- l'app (génération de facture) / Phase 2.
    v_nouveau_statut := ech.statut;
  ELSIF ech.date_prevue < CURRENT_DATE THEN
    v_nouveau_statut := 'en_retard';
  ELSE
    v_nouveau_statut := 'en_attente_paiement';
  END IF;

  UPDATE public.echeances
  SET montant_paye    = v_total_paye,
      montant_restant = GREATEST(ech.montant_ttc - v_total_paye, 0),
      statut          = v_nouveau_statut,
      paye_le         = CASE WHEN v_nouveau_statut = 'paye' AND ech.paye_le IS NULL THEN now() ELSE ech.paye_le END
  WHERE id = p_echeance_id;

  v_echeancier_id := ech.echeancier_id;

  -- Cascade : recalcule les totaux + statut global de l'échéancier parent.
  UPDATE public.echeanciers e
  SET montant_paye    = agg.total_paye,
      montant_restant = GREATEST(e.montant_ttc - agg.total_paye, 0),
      statut = CASE
        WHEN agg.n_actives = 0                       THEN 'annule'
        WHEN agg.n_payees  = agg.n_actives            THEN 'paye'
        WHEN agg.n_impayees > 0                       THEN 'impaye'
        WHEN agg.n_en_retard > 0                      THEN 'en_retard'
        WHEN agg.n_payees > 0 OR agg.n_partielles > 0 THEN 'paiement_partiel'
        WHEN agg.n_attente > 0                        THEN 'en_attente_paiement'
        WHEN agg.n_facture > 0                        THEN 'facture'
        WHEN agg.n_a_facturer > 0                     THEN 'a_facturer'
        ELSE 'brouillon'
      END
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE statut <> 'annule')        AS n_actives,
      COUNT(*) FILTER (WHERE statut = 'paye')            AS n_payees,
      COUNT(*) FILTER (WHERE statut = 'impaye')           AS n_impayees,
      COUNT(*) FILTER (WHERE statut = 'en_retard')        AS n_en_retard,
      COUNT(*) FILTER (WHERE statut = 'paiement_partiel') AS n_partielles,
      COUNT(*) FILTER (WHERE statut = 'en_attente_paiement') AS n_attente,
      COUNT(*) FILTER (WHERE statut = 'facture')          AS n_facture,
      COUNT(*) FILTER (WHERE statut = 'a_facturer')       AS n_a_facturer,
      COALESCE(SUM(montant_paye), 0)                      AS total_paye
    FROM public.echeances
    WHERE echeancier_id = v_echeancier_id
  ) agg
  WHERE e.id = v_echeancier_id;
END;
$$;

-- ── Trigger : tout changement sur paiements déclenche le recalcul ──
CREATE OR REPLACE FUNCTION public.paiements_trigger_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.echeance_id IS NOT NULL THEN
      PERFORM public.recalc_echeance_et_echeancier(OLD.echeance_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.echeance_id IS NOT NULL THEN
    PERFORM public.recalc_echeance_et_echeancier(NEW.echeance_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.echeance_id IS NOT NULL AND OLD.echeance_id IS DISTINCT FROM NEW.echeance_id THEN
    PERFORM public.recalc_echeance_et_echeancier(OLD.echeance_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paiements_recalc ON public.paiements;
CREATE TRIGGER paiements_recalc
  AFTER INSERT OR UPDATE OF montant, echeance_id, deleted_at OR DELETE ON public.paiements
  FOR EACH ROW EXECUTE FUNCTION public.paiements_trigger_recalc();

-- ── RPC atomique : création d'un échéancier complet ─────────────
-- Point d'entrée unique côté frontend pour créer un échéancier + ses
-- échéances en une seule transaction. SECURITY INVOKER (par défaut) :
-- s'exécute avec les droits de l'appelant, donc les policies RLS
-- echeanciers_insert / echeances_insert s'appliquent normalement.
-- p_echeances : jsonb array de
--   {numero_ordre, libelle, pourcentage, montant_ht, tva_montant,
--    montant_ttc, date_prevue, rappel_actif, rappel_client_email}
CREATE OR REPLACE FUNCTION public.create_echeancier(
  p_devis_id uuid,
  p_nombre_echeances integer,
  p_mode_repartition text,
  p_echeances jsonb,
  p_note_interne text DEFAULT NULL,
  p_note_visible_client boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  d RECORD;
  v_echeancier_id uuid;
  item jsonb;
  v_sum_pct numeric := 0;
  v_sum_ttc numeric := 0;
  v_prev_date date := NULL;
  v_prev_ordre integer := 0;
  v_seen_ordres integer[] := ARRAY[]::integer[];
BEGIN
  IF p_nombre_echeances < 1 OR p_nombre_echeances > 4 THEN
    RAISE EXCEPTION 'Le nombre d''échéances doit être entre 1 et 4';
  END IF;
  IF jsonb_array_length(p_echeances) <> p_nombre_echeances THEN
    RAISE EXCEPTION 'Le nombre d''échéances fournies (%) ne correspond pas à nombre_echeances (%)',
      jsonb_array_length(p_echeances), p_nombre_echeances;
  END IF;

  SELECT id, organisation_id, client_id, statut, total_ht, tva_montant, total_ttc
  INTO d
  FROM public.devis WHERE id = p_devis_id;

  IF d IS NULL THEN
    RAISE EXCEPTION 'Devis % introuvable', p_devis_id;
  END IF;
  IF d.statut IN ('refuse', 'expire') THEN
    RAISE EXCEPTION 'Impossible de créer un échéancier sur un devis refusé ou expiré';
  END IF;
  IF EXISTS (SELECT 1 FROM public.echeanciers WHERE devis_id = p_devis_id AND annule_le IS NULL) THEN
    RAISE EXCEPTION 'Un échéancier actif existe déjà pour ce devis';
  END IF;

  -- Validation ligne par ligne : montants/pourcentages positifs, dates
  -- présentes et chronologiquement cohérentes avec numero_ordre, pas de
  -- doublon d'ordre.
  FOR item IN SELECT * FROM jsonb_array_elements(p_echeances)
  LOOP
    IF (item->>'numero_ordre') IS NULL OR (item->>'montant_ttc') IS NULL OR (item->>'date_prevue') IS NULL THEN
      RAISE EXCEPTION 'Chaque échéance doit avoir numero_ordre, montant_ttc et date_prevue';
    END IF;
    IF (item->>'montant_ht')::numeric < 0 OR (item->>'tva_montant')::numeric < 0 OR (item->>'montant_ttc')::numeric < 0 THEN
      RAISE EXCEPTION 'Les montants ne peuvent pas être négatifs';
    END IF;
    IF (item->>'pourcentage')::numeric < 0 OR (item->>'pourcentage')::numeric > 100 THEN
      RAISE EXCEPTION 'Le pourcentage doit être entre 0 et 100';
    END IF;
    IF (item->>'numero_ordre')::integer = ANY (v_seen_ordres) THEN
      RAISE EXCEPTION 'numero_ordre en double : %', item->>'numero_ordre';
    END IF;
    v_seen_ordres := array_append(v_seen_ordres, (item->>'numero_ordre')::integer);

    IF (item->>'numero_ordre')::integer < v_prev_ordre THEN
      RAISE EXCEPTION 'Les échéances doivent être fournies dans l''ordre croissant de numero_ordre';
    END IF;
    IF v_prev_date IS NOT NULL AND (item->>'date_prevue')::date < v_prev_date THEN
      RAISE EXCEPTION 'Ordre chronologique incohérent : l''échéance % précède la précédente', item->>'numero_ordre';
    END IF;
    v_prev_date := (item->>'date_prevue')::date;
    v_prev_ordre := (item->>'numero_ordre')::integer;

    v_sum_pct := v_sum_pct + (item->>'pourcentage')::numeric;
    v_sum_ttc := v_sum_ttc + (item->>'montant_ttc')::numeric;
  END LOOP;

  IF abs(v_sum_pct - 100) > 0.01 THEN
    RAISE EXCEPTION 'La somme des pourcentages (%) doit être égale à 100', v_sum_pct;
  END IF;
  IF abs(v_sum_ttc - d.total_ttc) > 0.01 THEN
    RAISE EXCEPTION 'La somme des échéances (%) doit être égale au montant TTC du devis (%)', v_sum_ttc, d.total_ttc;
  END IF;

  INSERT INTO public.echeanciers (
    organisation_id, devis_id, client_id, montant_ht, tva_montant, montant_ttc,
    montant_restant, nombre_echeances, mode_repartition, statut,
    note_interne, note_visible_client, created_by
  ) VALUES (
    d.organisation_id, d.id, d.client_id, d.total_ht, d.tva_montant, d.total_ttc,
    d.total_ttc, p_nombre_echeances, p_mode_repartition, 'a_facturer',
    p_note_interne, p_note_visible_client, auth.uid()
  )
  RETURNING id INTO v_echeancier_id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_echeances)
  LOOP
    INSERT INTO public.echeances (
      organisation_id, echeancier_id, devis_id, client_id, numero_ordre, libelle,
      pourcentage, montant_ht, tva_montant, montant_ttc, date_prevue,
      montant_restant, statut, rappel_actif, rappel_client_email
    ) VALUES (
      d.organisation_id, v_echeancier_id, d.id, d.client_id,
      (item->>'numero_ordre')::integer,
      COALESCE(item->>'libelle', 'Échéance ' || (item->>'numero_ordre')),
      (item->>'pourcentage')::numeric,
      (item->>'montant_ht')::numeric,
      (item->>'tva_montant')::numeric,
      (item->>'montant_ttc')::numeric,
      (item->>'date_prevue')::date,
      (item->>'montant_ttc')::numeric,
      'a_facturer',
      COALESCE((item->>'rappel_actif')::boolean, true),
      COALESCE((item->>'rappel_client_email')::boolean, true)
    );
  END LOOP;

  INSERT INTO public.journal_echeancier (organisation_id, echeancier_id, action, donnees_apres, created_by)
  VALUES (d.organisation_id, v_echeancier_id, 'creation', jsonb_build_object('nombre_echeances', p_nombre_echeances, 'montant_ttc', d.total_ttc), auth.uid());

  RETURN v_echeancier_id;
END;
$$;

-- ── Bascule automatique En retard -> Impayée après délai configurable ──
-- SECURITY DEFINER, exécution restreinte à service_role (appel prévu
-- depuis une edge function planifiée, cf. Phase 4 — pas de pg_cron actif
-- sur ce projet à ce jour, cf. audit send-reminders). Peut aussi être
-- invoquée manuellement par un admin via une action dédiée plus tard.
CREATE OR REPLACE FUNCTION public.auto_expire_impayes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH cible AS (
    SELECT ec.id
    FROM public.echeances ec
    JOIN public.parametres_entreprise pe ON pe.organisation_id = ec.organisation_id
    WHERE ec.statut = 'en_retard'
      AND ec.date_prevue < CURRENT_DATE - pe.delai_impaye_jours
  )
  UPDATE public.echeances
  SET statut = 'impaye'
  WHERE id IN (SELECT id FROM cible);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Cascade sur les échéanciers concernés.
  PERFORM public.recalc_echeance_et_echeancier(id)
  FROM public.echeances
  WHERE statut = 'impaye'
    AND updated_at > now() - interval '1 minute';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_expire_impayes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_expire_impayes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_expire_impayes() TO service_role;

-- ================================================================
-- VÉRIFICATIONS
-- ================================================================
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('create_echeancier','recalc_echeance_et_echeancier','auto_expire_impayes',
--    'validate_echeancier_coherence','validate_echeance_coherence');
