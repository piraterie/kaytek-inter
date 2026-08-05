-- ================================================================
-- MIGRATION : Factures d'acompte / intermédiaire / solde — colonnes
-- Date       : 2026-07-30
-- Objectif   : Permettre de générer une facture directement liée à une
--              échéance (acompte, intermédiaire, solde), en réutilisant
--              la table `factures` et sa numérotation existantes
--              (gen_numero_facture() n'est pas touchée). Distingue le
--              type de facture pour l'affichage PDF et les futurs avoirs.
-- Portée     : Additif uniquement (ADD COLUMN IF NOT EXISTS). Toutes les
--              factures existantes deviennent 'classique' par défaut —
--              aucun comportement existant n'est modifié.
-- ================================================================

ALTER TABLE public.factures
  ADD COLUMN IF NOT EXISTS type_facture text NOT NULL DEFAULT 'classique'
    CHECK (type_facture IN ('classique', 'acompte', 'intermediaire', 'solde', 'avoir')),
  ADD COLUMN IF NOT EXISTS echeance_id uuid REFERENCES public.echeances(id),
  ADD COLUMN IF NOT EXISTS facture_origine_id uuid REFERENCES public.factures(id);

CREATE INDEX IF NOT EXISTS factures_echeance_id_idx ON public.factures (echeance_id);
CREATE INDEX IF NOT EXISTS factures_facture_origine_id_idx ON public.factures (facture_origine_id);

-- ── RPC atomique : générer la facture d'une échéance ────────────
-- Réutilise le trigger set_facture_numero / gen_numero_facture() déjà en
-- place (SECURITY DEFINER, verrou pg_advisory_xact_lock) : cette fonction
-- ne fait qu'un INSERT INTO factures standard, la numérotation reste
-- entièrement gérée par le trigger existant, inchangé.
-- SECURITY INVOKER (par défaut) : s'exécute avec les droits de
-- l'appelant, les policies RLS factures_insert / echeances_update
-- s'appliquent normalement.
CREATE OR REPLACE FUNCTION public.generate_facture_echeance(p_echeance_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  ech RECORD;
  sched RECORD;
  d RECORD;
  v_type text;
  v_facture_id uuid;
  v_nouveau_statut text;
BEGIN
  SELECT * INTO ech FROM public.echeances WHERE id = p_echeance_id;
  IF ech IS NULL THEN
    RAISE EXCEPTION 'Échéance % introuvable', p_echeance_id;
  END IF;
  IF ech.statut <> 'a_facturer' THEN
    RAISE EXCEPTION 'Cette échéance n''est pas au statut "à facturer" (statut actuel : %)', ech.statut;
  END IF;
  IF ech.facture_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cette échéance a déjà une facture liée';
  END IF;

  SELECT * INTO sched FROM public.echeanciers WHERE id = ech.echeancier_id;
  SELECT * INTO d FROM public.devis WHERE id = ech.devis_id;

  v_type := CASE
    WHEN sched.nombre_echeances = 1 THEN 'classique'
    WHEN ech.numero_ordre = 1 THEN 'acompte'
    WHEN ech.numero_ordre = sched.nombre_echeances THEN 'solde'
    ELSE 'intermediaire'
  END;

  INSERT INTO public.factures (
    devis_id, client_id, organisation_id, echeance_id, type_facture,
    montant_ht, tva_montant, montant_ttc, statut_paiement, date_echeance, created_by
  ) VALUES (
    ech.devis_id, ech.client_id, ech.organisation_id, ech.id, v_type,
    ech.montant_ht, ech.tva_montant, ech.montant_ttc, 'impayee', ech.date_prevue, auth.uid()
  )
  RETURNING id INTO v_facture_id;

  v_nouveau_statut := CASE WHEN ech.date_prevue < CURRENT_DATE THEN 'en_retard' ELSE 'en_attente_paiement' END;

  UPDATE public.echeances
  SET facture_id = v_facture_id, statut = v_nouveau_statut
  WHERE id = p_echeance_id;

  PERFORM public.recalc_echeance_et_echeancier(p_echeance_id);

  INSERT INTO public.journal_echeancier (organisation_id, echeancier_id, echeance_id, action, donnees_apres, created_by)
  VALUES (ech.organisation_id, ech.echeancier_id, ech.id, 'facture_generee', jsonb_build_object('facture_id', v_facture_id, 'type_facture', v_type), auth.uid());

  RETURN v_facture_id;
END;
$$;

-- ================================================================
-- VÉRIFICATIONS
-- ================================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name='factures' AND column_name IN ('type_facture','echeance_id','facture_origine_id');
-- SELECT proname FROM pg_proc WHERE proname = 'generate_facture_echeance';
