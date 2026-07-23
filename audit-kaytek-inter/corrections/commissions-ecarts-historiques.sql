-- ================================================================
-- RAPPORT D'ÉCARTS EN LECTURE SEULE — Correction 5 (FONC-02)
-- ================================================================
-- Compare, pour chaque ligne HISTORIQUE de public.commissions
-- (formule_version IS NULL, produite par l'ancien trigger
-- auto_commission()), le montant réellement stocké à celui que
-- produirait la formule v2 validée (part_intervenant = taux de
-- l'intervenant, matériel confirmé déduit).
--
-- AUCUN UPDATE, AUCUN INSERT, AUCUNE modification de quelque nature
-- que ce soit — SELECT uniquement. À exécuter en lecture seule sur une
-- base réelle (ou de test) pour évaluer l'ampleur des écarts avant de
-- décider d'une éventuelle correction historique séparée (hors
-- périmètre de cette correction).
--
-- Limite connue et assumée : l'ancien trigger ne renseignait jamais
-- commissions.facture_id (toujours NULL sur ces lignes). La "facture
-- potentielle" ci-dessous est reconstituée par une jointure sur
-- intervention_id, qui peut retourner PLUSIEURS factures si une même
-- intervention en a généré plus d'une (voir FACT-02, phase 7/12) — dans
-- ce cas, plusieurs lignes de ce rapport correspondront à la même
-- commission historique, une par facture candidate. Ce rapport ne
-- tranche jamais laquelle est la "bonne" facture — c'est un signal pour
-- investigation manuelle, pas une source de vérité.
-- ================================================================

SELECT
  c.id                        AS commission_id,
  c.intervention_id,
  c.intervenant_id,
  c.organisation_id,
  c.created_at                AS commission_creee_le,
  c.statut                    AS statut_stocke,

  -- Valeurs réellement stockées (ancienne formule : pct traité comme
  -- part entreprise, matériel jamais déduit)
  c.commission_pct            AS taux_stocke,
  c.montant_total_client      AS montant_stocke_source_intervention,
  c.part_intervenant          AS part_intervenant_stockee,
  c.commission_admin          AS commission_admin_stockee,

  -- Facture potentiellement liée (reconstituée, non garantie 1:1 — voir en-tête)
  f.id                        AS facture_potentielle_id,
  f.numero                    AS facture_numero,
  f.montant_ttc               AS facture_montant_ttc,
  f.statut_paiement           AS facture_statut_paiement,

  -- État matériel ACTUEL de l'intervention (peut avoir changé depuis la
  -- création de la commission historique — pas nécessairement l'état au
  -- moment de la clôture)
  i.cout_pieces                AS materiel_cout_actuel,
  i.materiel_confirme          AS materiel_confirme_actuel,

  -- Formule v2 théorique, calculée UNIQUEMENT pour ce rapport, JAMAIS écrite
  GREATEST(0, ROUND(
    COALESCE(f.montant_ttc, 0)
    - (CASE WHEN i.materiel_confirme THEN COALESCE(i.cout_pieces, 0) ELSE 0 END)
  , 2))                                                            AS base_v2_theorique,
  ROUND(
    GREATEST(0, ROUND(
      COALESCE(f.montant_ttc, 0)
      - (CASE WHEN i.materiel_confirme THEN COALESCE(i.cout_pieces, 0) ELSE 0 END)
    , 2)) * c.commission_pct / 100
  , 2)                                                              AS part_intervenant_v2_theorique,

  -- Écart entre le montant historiquement versé/affiché à l'intervenant
  -- et ce que la formule v2 aurait produit avec les données actuelles
  (
    c.part_intervenant
    - ROUND(
        GREATEST(0, ROUND(
          COALESCE(f.montant_ttc, 0)
          - (CASE WHEN i.materiel_confirme THEN COALESCE(i.cout_pieces, 0) ELSE 0 END)
        , 2)) * c.commission_pct / 100
      , 2)
  )                                                                 AS ecart_part_intervenant,

  -- Statut de réception connu (mécanisme séparé, cf. rapport de correction)
  EXISTS (
    SELECT 1 FROM public.commission_receipts cr
    WHERE cr.intervention_id = c.intervention_id AND cr.intervenant_id = c.intervenant_id AND cr.recue = true
  )                                                                 AS deja_marquee_recue

FROM public.commissions c
LEFT JOIN public.factures f ON f.intervention_id = c.intervention_id
LEFT JOIN public.interventions i ON i.id = c.intervention_id
WHERE c.formule_version IS NULL
ORDER BY c.created_at DESC;
