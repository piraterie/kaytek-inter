-- ================================================================
-- MIGRATION : Correction 4 — DB-02 : numérotation des devis,
--             factures et interventions scopée par organisation
-- Date       : 2026-07-25
-- ================================================================
-- Contexte (voir audit-kaytek-inter/corrections/correction-04-
-- numerotation-organisations.md pour l'analyse complète) :
--
-- generate_devis_numero(), gen_numero_facture(), gen_numero_
-- intervention() calculaient jusqu'ici un MAX(numero)+1 GLOBAL
-- (toutes organisations confondues), sérialisé par un
-- pg_advisory_xact_lock par table (pas par organisation), et ne
-- généraient un numéro que si NEW.numero était vide — un numéro
-- explicite non vide fourni par l'appelant était accepté tel quel,
-- SANS AUCUNE contrainte UNIQUE en base pour le rattraper.
--
-- Cette migration :
--   1. Vérifie qu'aucune contrainte/index UNIQUE global inattendu
--      n'existe déjà sur numero seul (créé hors dépôt).
--   2. Audite les doublons (organisation_id, numero) déjà présents
--      — interrompt la migration si le moindre doublon existe,
--      SANS modifier aucune donnée.
--   3. Crée public.document_counters (compteur par organisation,
--      type de document, année).
--   4. Active RLS dessus, sans aucune policy pour authenticated —
--      seule une fonction SECURITY DEFINER peut la lire/écrire.
--   5. Initialise les compteurs à partir des numéros historiques
--      conformes (lecture seule, aucune ligne devis/factures/
--      interventions modifiée), avec vérification qu'aucune
--      organisation sans compteur initial ne risque de générer un
--      numéro déjà utilisé pour l'année en cours.
--   6. Crée next_document_number(organisation_id, document_type) —
--      atomique via INSERT ... ON CONFLICT ... DO UPDATE ...
--      RETURNING, jamais MAX()+1.
--   7. Révoque tout accès public/authenticated à cette fonction —
--      elle n'est appelée qu'en interne par les triggers.
--   8. Remplace UNIQUEMENT le corps des trois fonctions trigger
--      existantes (mêmes noms, mêmes triggers, aucune suppression) :
--      NEW.numero est désormais TOUJOURS écrasé par le numéro
--      généré côté serveur, quel que soit ce que l'appelant a
--      fourni (vide, rempli, valide, falsifié).
--   9. Ajoute UNIQUE(organisation_id, numero) sur les 3 tables —
--      filet de sécurité final.
--  10. Assertions statiques (schéma uniquement).
--
-- Hypothèse explicite (déjà en vigueur pour les migrations des
-- Corrections 2/3/3 bis de cette même session) : ce fichier est
-- appliqué comme une seule transaction par l'outil de migration
-- (comportement standard `supabase db push`/`migration up`) — toute
-- exception levée par les blocs DO ci-dessous annule l'intégralité
-- des opérations précédentes de ce même fichier, y compris la
-- création de document_counters. Aucune donnée métier n'est donc
-- jamais modifiée en cas d'échec d'une vérification.
--
-- Volontairement PAS dans cette migration :
--   · Aucun DROP SEQUENCE (devis_numero_seq potentiellement
--     orpheline, créée hors dépôt — non vérifiable, non touchée).
--   · Aucune correction de DB-07 (numero modifiable après création
--     par un admin via UPDATE direct — anomalie distincte,
--     documentée séparément dans le rapport de correction).
--   · Aucune modification frontend (tous les points de création
--     recensés omettent déjà numero avant insertion).
-- ================================================================


-- ================================================================
-- 1. VÉRIFICATIONS PRÉALABLES DE SCHÉMA
-- ================================================================
-- Détecte toute contrainte/index UNIQUE portant sur numero SEUL
-- (donc global, pas composite) sur devis/factures/interventions,
-- qui aurait pu être créé hors dépôt (même dérive que RLS-02 —
-- policies Storage orphelines, phase 3). Si un tel objet existe,
-- il empêcherait deux organisations d'utiliser légitimement le même
-- numéro : la migration s'arrête, sans avoir rien modifié, pour un
-- audit manuel — elle ne tente jamais de le supprimer en devinant
-- son nom.
DO $$
DECLARE
  v_bad record;
  v_found boolean := false;
BEGIN
  FOR v_bad IN
    SELECT t.relname AS table_name, c.conname AS constraint_name, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace
      AND t.relname IN ('devis', 'factures', 'interventions')
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(numero)%'
  LOOP
    v_found := true;
    RAISE WARNING 'Contrainte UNIQUE globale inattendue % sur %: %', v_bad.constraint_name, v_bad.table_name, v_bad.definition;
  END LOOP;

  FOR v_bad IN
    SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(i.oid) AS definition
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relnamespace = 'public'::regnamespace
      AND t.relname IN ('devis', 'factures', 'interventions')
      AND x.indisunique
      AND pg_get_indexdef(i.oid) LIKE '%(numero)%'
  LOOP
    v_found := true;
    RAISE WARNING 'Index UNIQUE global inattendu % sur %: %', v_bad.index_name, v_bad.table_name, v_bad.definition;
  END LOOP;

  IF v_found THEN
    RAISE EXCEPTION 'Migration interrompue : contrainte/index UNIQUE global sur numero détecté (voir WARNING ci-dessus) — audit manuel requis avant tout déploiement, aucune donnée modifiée.';
  END IF;

  RAISE NOTICE 'Vérification préalable OK : aucune contrainte/index UNIQUE global sur numero seul.';
END $$;


-- ================================================================
-- 2. AUDIT BLOQUANT DES DOUBLONS HISTORIQUES (organisation_id, numero)
-- ================================================================
-- Lecture seule. Un doublon existant interromprait de toute façon
-- l'ajout de la contrainte composite en fin de migration (§9) — cette
-- vérification anticipée donne un diagnostic clair immédiatement,
-- avant même de créer document_counters, plutôt qu'un échec cryptique
-- après plusieurs étapes.
DO $$
DECLARE
  v_dupes_devis int;
  v_dupes_factures int;
  v_dupes_interventions int;
BEGIN
  SELECT count(*) INTO v_dupes_devis FROM (
    SELECT organisation_id, numero FROM public.devis GROUP BY organisation_id, numero HAVING count(*) > 1
  ) x;
  SELECT count(*) INTO v_dupes_factures FROM (
    SELECT organisation_id, numero FROM public.factures GROUP BY organisation_id, numero HAVING count(*) > 1
  ) x;
  SELECT count(*) INTO v_dupes_interventions FROM (
    SELECT organisation_id, numero FROM public.interventions GROUP BY organisation_id, numero HAVING count(*) > 1
  ) x;

  IF v_dupes_devis > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % doublon(s) (organisation_id, numero) détecté(s) sur devis — investiguer avant de continuer, aucune donnée modifiée.', v_dupes_devis;
  END IF;
  IF v_dupes_factures > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % doublon(s) (organisation_id, numero) détecté(s) sur factures — investiguer avant de continuer, aucune donnée modifiée.', v_dupes_factures;
  END IF;
  IF v_dupes_interventions > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % doublon(s) (organisation_id, numero) détecté(s) sur interventions — investiguer avant de continuer, aucune donnée modifiée.', v_dupes_interventions;
  END IF;

  RAISE NOTICE 'Audit préalable OK : aucun doublon (organisation_id, numero) sur devis/factures/interventions.';
END $$;


-- ================================================================
-- 3. TABLE : document_counters
-- ================================================================
CREATE TABLE IF NOT EXISTS public.document_counters (
  organisation_id uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  document_type   text        NOT NULL CHECK (document_type IN ('devis', 'factures', 'interventions')),
  period_key      text        NOT NULL CHECK (period_key ~ '^\d{4}$'),
  current_value   bigint      NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, document_type, period_key)
);
-- ON DELETE CASCADE : cohérent avec le schéma existant — devis/
-- factures/interventions ont déjà organisation_id ... ON DELETE
-- RESTRICT vers organisations, donc une organisation ayant le moindre
-- historique ne peut de toute façon jamais être supprimée ; CASCADE
-- ici ne fait que permettre de nettoyer des compteurs devenus
-- orphelins dans le seul cas (rare, aujourd'hui impossible en
-- pratique) où une organisation sans aucun document serait supprimée.

COMMENT ON TABLE public.document_counters IS
  'Compteur de numérotation atomique par organisation/type de document/année. Manipulé exclusivement par public.next_document_number() (SECURITY DEFINER) — aucun accès direct pour authenticated/anon.';


-- ================================================================
-- 4. RLS ET RÉVOCATION DES DROITS — document_counters
-- ================================================================
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
-- Aucune policy créée : deny-all par défaut pour authenticated/anon.
-- Révocation explicite des privilèges de table par hygiène, quels
-- que soient les GRANTs par défaut de la plateforme (Supabase
-- n'accorde pas de privilèges de table à anon/authenticated par
-- défaut sur une nouvelle table, mais on ne s'y fie pas).
REVOKE ALL ON public.document_counters FROM PUBLIC;
REVOKE ALL ON public.document_counters FROM anon;
REVOKE ALL ON public.document_counters FROM authenticated;


-- ================================================================
-- 5. INITIALISATION DES COMPTEURS DEPUIS LES DONNÉES HISTORIQUES
-- ================================================================
-- Lecture seule sur devis/factures/interventions — AUCUNE ligne de
-- ces tables n'est modifiée. Le suffixe numérique peut dépasser 3
-- chiffres (LPAD fixe une largeur MINIMALE, jamais maximale) : la
-- regex `\d+` (pas `\d{3}`) capture des suffixes de longueur
-- quelconque. Les numéros hors format PREFIX-YYYY-NNN (ex. ère
-- nextval() historique mentionnée dans 20260610000024) sont exclus
-- du calcul par la clause WHERE — traités comme non exploitables,
-- jamais réinterprétés ni modifiés.

INSERT INTO public.document_counters (organisation_id, document_type, period_key, current_value)
SELECT organisation_id, 'devis', substring(numero from 'DEV-(\d{4})-'), MAX(substring(numero from '(\d+)$')::bigint)
FROM public.devis
WHERE numero ~ '^DEV-\d{4}-\d+$'
GROUP BY organisation_id, substring(numero from 'DEV-(\d{4})-')
ON CONFLICT (organisation_id, document_type, period_key)
DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value), updated_at = now();

INSERT INTO public.document_counters (organisation_id, document_type, period_key, current_value)
SELECT organisation_id, 'factures', substring(numero from 'FAC-(\d{4})-'), MAX(substring(numero from '(\d+)$')::bigint)
FROM public.factures
WHERE numero ~ '^FAC-\d{4}-\d+$'
GROUP BY organisation_id, substring(numero from 'FAC-(\d{4})-')
ON CONFLICT (organisation_id, document_type, period_key)
DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value), updated_at = now();

INSERT INTO public.document_counters (organisation_id, document_type, period_key, current_value)
SELECT organisation_id, 'interventions', substring(numero from 'INT-(\d{4})-'), MAX(substring(numero from '(\d+)$')::bigint)
FROM public.interventions
WHERE numero ~ '^INT-\d{4}-\d+$'
GROUP BY organisation_id, substring(numero from 'INT-(\d{4})-')
ON CONFLICT (organisation_id, document_type, period_key)
DO UPDATE SET current_value = GREATEST(document_counters.current_value, EXCLUDED.current_value), updated_at = now();

-- ── Garde-fou supplémentaire ──────────────────────────────────────
-- Pour une organisation n'ayant AUCUN numéro conforme pour un type
-- donné (donc aucune ligne document_counters créée ci-dessus pour
-- elle), le premier appel post-migration démarrera à 1 pour l'ANNÉE
-- EN COURS au moment de cette migration. Vérifie qu'aucune ligne
-- existante (conforme ou non) de cette organisation ne porte déjà
-- exactement ce numéro cible — la contrainte UNIQUE (§9) le
-- rattraperait de toute façon à l'insertion réelle, mais on ne laisse
-- pas ce cas passer silencieusement ici.
DO $$
DECLARE
  v_year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_conflicts int;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM public.devis d
  WHERE d.numero = 'DEV-' || v_year || '-001'
    AND NOT EXISTS (
      SELECT 1 FROM public.document_counters dc
      WHERE dc.organisation_id = d.organisation_id AND dc.document_type = 'devis'
    );
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % devis porte(nt) déjà le numéro cible DEV-%-001 dans une organisation sans compteur initial conforme — audit manuel requis, aucune donnée modifiée.', v_conflicts, v_year;
  END IF;

  SELECT count(*) INTO v_conflicts
  FROM public.factures f
  WHERE f.numero = 'FAC-' || v_year || '-001'
    AND NOT EXISTS (
      SELECT 1 FROM public.document_counters dc
      WHERE dc.organisation_id = f.organisation_id AND dc.document_type = 'factures'
    );
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % facture(s) porte(nt) déjà le numéro cible FAC-%-001 dans une organisation sans compteur initial conforme — audit manuel requis, aucune donnée modifiée.', v_conflicts, v_year;
  END IF;

  SELECT count(*) INTO v_conflicts
  FROM public.interventions i
  WHERE i.numero = 'INT-' || v_year || '-001'
    AND NOT EXISTS (
      SELECT 1 FROM public.document_counters dc
      WHERE dc.organisation_id = i.organisation_id AND dc.document_type = 'interventions'
    );
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % intervention(s) porte(nt) déjà le numéro cible INT-%-001 dans une organisation sans compteur initial conforme — audit manuel requis, aucune donnée modifiée.', v_conflicts, v_year;
  END IF;

  RAISE NOTICE 'Garde-fou initialisation OK : aucune collision immédiate détectée pour l''année %.', v_year;
END $$;


-- ================================================================
-- 6. FONCTION CENTRALE : next_document_number(organisation_id, type)
-- ================================================================
-- Atomique via INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING —
-- jamais MAX()+1. Reçoit l'organisation de la ligne insérée
-- (NEW.organisation_id, transmise par les triggers ci-dessous), PAS
-- uniquement via current_org_id() : permet aux traitements internes
-- légitimes (futures migrations contrôlées, appels service_role sans
-- JWT utilisateur) de générer un numéro pour une organisation donnée.
-- Ceci ne compromet pas la sécurité : pour un appel utilisateur, la
-- policy WITH CHECK de la table cible (devis_insert/factures_insert/
-- interventions_insert, INCHANGÉES par cette migration) impose déjà
-- organisation_id = current_org_id() — si elle échoue, TOUTE la
-- transaction (y compris l'incrément fait ici) est annulée. Voir
-- rapport de correction pour la vérification détaillée de l'ordre
-- trigger BEFORE INSERT → RLS WITH CHECK → commit/rollback.
-- Fuseau horaire : Europe/Paris (métier français), pour que l'année
-- civile utilisée pour la clé de période ET pour le préfixe visible
-- du numéro corresponde à l'heure française, pas UTC.
CREATE OR REPLACE FUNCTION public.next_document_number(
  p_organisation_id uuid,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_period text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  v_next   bigint;
BEGIN
  IF p_organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id requis pour la numérotation';
  END IF;

  v_prefix := CASE p_document_type
    WHEN 'devis'         THEN 'DEV-'
    WHEN 'factures'      THEN 'FAC-'
    WHEN 'interventions' THEN 'INT-'
    ELSE NULL
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Type de document inconnu pour la numérotation : %', p_document_type;
  END IF;

  INSERT INTO public.document_counters (organisation_id, document_type, period_key, current_value)
  VALUES (p_organisation_id, p_document_type, v_period, 1)
  ON CONFLICT (organisation_id, document_type, period_key)
  DO UPDATE SET current_value = document_counters.current_value + 1, updated_at = now()
  RETURNING current_value INTO v_next;

  RETURN v_prefix || v_period || '-' || LPAD(v_next::text, 3, '0');
END;
$$;

ALTER FUNCTION public.next_document_number(uuid, text) OWNER TO postgres;


-- ================================================================
-- 7. RÉVOCATION DES DROITS PUBLICS — next_document_number
-- ================================================================
-- Jamais exposée comme RPC : appelée uniquement depuis les triggers
-- BEFORE INSERT ci-dessous (eux-mêmes SECURITY DEFINER, propriétaire
-- postgres) — un appel de fonction interne à une autre fonction
-- SECURITY DEFINER s'exécute avec les privilèges du propriétaire de
-- la fonction appelante (postgres, superutilisateur), qui a
-- implicitement EXECUTE sur tout : aucun GRANT n'est donc nécessaire
-- ni souhaitable ici. Un client authentifié ne peut jamais réserver
-- directement un numéro par cette voie.
--
-- Correction SEC2-02 (analyse : audit-kaytek-inter/corrections/
-- analyse-sec2-02-function-privileges.md) : l'image Postgres locale de
-- Supabase accorde un EXECUTE direct par défaut à anon/authenticated/
-- service_role sur toute nouvelle fonction créée par postgres — un
-- "REVOKE ALL FROM PUBLIC" seul ne retire jamais ce droit direct
-- (confirmé empiriquement, deux entrées ACL indépendantes). Cette
-- fonction est appelée EXCLUSIVEMENT via les triggers BEFORE INSERT
-- ci-dessous (chaîne SECURITY DEFINER postgres → SECURITY DEFINER
-- postgres) — confirmé empiriquement qu'un tel appel ne nécessite
-- AUCUN droit EXECUTE direct pour le rôle qui a initié l'INSERT
-- (contrairement à une fonction référencée dans une expression de
-- policy RLS). Les trois REVOKE explicites ci-dessous sont donc sans
-- aucun impact fonctionnel et ferment le seul écart réel : un appel
-- RPC direct (anon ou authenticated) qui fournirait librement un
-- organisation_id arbitraire.
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM service_role;
-- Explicitement aucun GRANT à anon, authenticated, ni service_role.


-- ================================================================
-- 8. REMPLACEMENT DU CORPS DES TROIS FONCTIONS TRIGGER EXISTANTES
-- ================================================================
-- Mêmes noms, mêmes signatures (RETURNS trigger, aucun argument),
-- mêmes triggers déjà attachés (set_devis_numero, set_facture_numero,
-- set_intervention_numero) — AUCUN DROP TRIGGER, AUCUN CREATE TRIGGER,
-- AUCUNE fenêtre où la numérotation serait absente. NEW.numero est
-- désormais TOUJOURS écrasé, quel que soit ce que l'appelant a fourni
-- (vide, rempli, valide, falsifié, déjà utilisé, format différent) —
-- c'est le changement de comportement central demandé par cette
-- correction (fin du contrat "numéro non vide = accepté tel quel").

CREATE OR REPLACE FUNCTION public.generate_devis_numero()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id requis pour la numérotation du devis';
  END IF;
  NEW.numero := public.next_document_number(NEW.organisation_id, 'devis');
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.generate_devis_numero() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.gen_numero_facture()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id requis pour la numérotation de la facture';
  END IF;
  NEW.numero := public.next_document_number(NEW.organisation_id, 'factures');
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.gen_numero_facture() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.gen_numero_intervention()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation_id requis pour la numérotation de l''intervention';
  END IF;
  NEW.numero := public.next_document_number(NEW.organisation_id, 'interventions');
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.gen_numero_intervention() OWNER TO postgres;

-- Aucun DROP TRIGGER / CREATE TRIGGER : set_devis_numero,
-- set_facture_numero, set_intervention_numero restent exactement
-- ceux déjà en place (20260610000023/24), référençant ces mêmes noms
-- de fonction par leur définition — le remplacement du corps ci-
-- dessus leur applique automatiquement le nouveau comportement.


-- ================================================================
-- 9. CONTRAINTES COMPOSITES — filet de sécurité final
-- ================================================================
ALTER TABLE public.devis
  ADD CONSTRAINT devis_organisation_numero_unique UNIQUE (organisation_id, numero);

ALTER TABLE public.factures
  ADD CONSTRAINT factures_organisation_numero_unique UNIQUE (organisation_id, numero);

ALTER TABLE public.interventions
  ADD CONSTRAINT interventions_organisation_numero_unique UNIQUE (organisation_id, numero);


-- ================================================================
-- 10. ASSERTIONS STATIQUES (schéma uniquement)
-- ================================================================
DO $$
DECLARE
  v_count int;
  v_prosrc text;
BEGIN
  -- 10.1 — document_counters existe avec la bonne clé primaire composite.
  SELECT count(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'document_counters' AND t.relnamespace = 'public'::regnamespace
    AND c.contype = 'p'
    AND pg_get_constraintdef(c.oid) LIKE '%organisation_id%document_type%period_key%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : clé primaire composite attendue sur document_counters, trouvé %', v_count;
  END IF;

  -- 10.2 — RLS active sur document_counters, aucune policy pour authenticated.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'document_counters' AND relnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Assertion échouée : RLS non activée sur document_counters';
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'document_counters';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Assertion échouée : % policy(ies) inattendue(s) sur document_counters (attendu 0)', v_count;
  END IF;

  -- 10.3 — Aucun privilège direct de modification pour authenticated/anon.
  IF has_table_privilege('authenticated', 'public.document_counters', 'INSERT')
     OR has_table_privilege('authenticated', 'public.document_counters', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.document_counters', 'SELECT') THEN
    RAISE EXCEPTION 'Assertion échouée : authenticated dispose d''un privilège direct sur document_counters';
  END IF;
  IF has_table_privilege('anon', 'public.document_counters', 'SELECT') THEN
    RAISE EXCEPTION 'Assertion échouée : anon dispose d''un privilège SELECT sur document_counters';
  END IF;

  -- 10.4 — next_document_number : SECURITY DEFINER, search_path=public, aucun EXECUTE public/authenticated/anon.
  SELECT count(*) INTO v_count
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'next_document_number'
    AND p.prosecdef = true
    AND p.proconfig IS NOT NULL
    AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Assertion échouée : next_document_number doit être unique, SECURITY DEFINER, avec search_path fixé (trouvé %)', v_count;
  END IF;
  IF has_function_privilege('anon', 'public.next_document_number(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.next_document_number(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : next_document_number ne doit être exécutable ni par anon ni par authenticated';
  END IF;
  -- Correction SEC2-02 : service_role vérifié explicitement aussi (jamais
  -- supposé) — aucun appel direct identifié nulle part dans le dépôt
  -- (frontend, Edge Functions, migrations), donc aucun droit nécessaire.
  IF has_function_privilege('service_role', 'public.next_document_number(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Assertion échouée : next_document_number ne doit être exécutable ni par service_role (aucun appel direct identifié)';
  END IF;

  -- 10.5 — Les 3 triggers existants sont toujours attachés aux bonnes tables.
  SELECT count(*) INTO v_count
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'
    AND (
      (event_object_table = 'devis' AND trigger_name = 'set_devis_numero') OR
      (event_object_table = 'factures' AND trigger_name = 'set_facture_numero') OR
      (event_object_table = 'interventions' AND trigger_name = 'set_intervention_numero')
    );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Assertion échouée : les 3 triggers de numérotation attendus ne sont pas tous présents (trouvé %)', v_count;
  END IF;

  -- 10.6 — Les 3 fonctions trigger restent SECURITY DEFINER et écrasent
  -- systématiquement NEW.numero (plus de garde conditionnelle "IF NEW.numero IS NULL").
  FOR v_prosrc IN
    SELECT prosrc FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('generate_devis_numero', 'gen_numero_facture', 'gen_numero_intervention')
  LOOP
    IF v_prosrc NOT LIKE '%NEW.numero := public.next_document_number%' THEN
      RAISE EXCEPTION 'Assertion échouée : une fonction trigger de numérotation n''appelle pas next_document_number pour écraser NEW.numero';
    END IF;
    IF v_prosrc LIKE '%NEW.numero IS NULL%' THEN
      RAISE EXCEPTION 'Assertion échouée : une fonction trigger conserve encore la garde conditionnelle "NEW.numero IS NULL" — le numéro client ne doit plus jamais être conservé';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('generate_devis_numero', 'gen_numero_facture', 'gen_numero_intervention')
    AND prosecdef = true;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Assertion échouée : les 3 fonctions trigger doivent être SECURITY DEFINER (trouvé %)', v_count;
  END IF;

  -- 10.7 — Les 3 contraintes composites sont présentes, nommées exactement.
  SELECT count(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relnamespace = 'public'::regnamespace
    AND c.contype = 'u'
    AND c.conname IN ('devis_organisation_numero_unique', 'factures_organisation_numero_unique', 'interventions_organisation_numero_unique');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Assertion échouée : les 3 contraintes UNIQUE(organisation_id, numero) attendues ne sont pas toutes présentes (trouvé %)', v_count;
  END IF;

  -- 10.8 — Les policies RLS métier existantes (devis/factures/interventions
  -- INSERT/UPDATE/SELECT/DELETE) n'ont pas été touchées par cette migration —
  -- vérification de comptage global (pas de suppression/ajout inattendu).
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('devis', 'factures', 'interventions');
  IF v_count < 12 THEN -- 4 policies (select/insert/update/delete) × 3 tables au minimum
    RAISE EXCEPTION 'Assertion échouée : nombre de policies RLS sur devis/factures/interventions inférieur à l''attendu (trouvé %) — une policy métier semble avoir disparu', v_count;
  END IF;

  -- 10.9 — Aucune contrainte/index UNIQUE global incompatible n'a été
  -- introduite par cette migration elle-même (re-vérification finale).
  SELECT count(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relnamespace = 'public'::regnamespace
    AND t.relname IN ('devis', 'factures', 'interventions')
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE '%(numero)%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Assertion échouée : une contrainte UNIQUE globale sur numero seul existe après la migration (trouvé %)', v_count;
  END IF;

  RAISE NOTICE 'Correction 4 (DB-02) : toutes les assertions statiques ont réussi.';
END $$;


-- ================================================================
-- VÉRIFICATION (informative)
-- ================================================================
SELECT
  conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'devis_organisation_numero_unique',
  'factures_organisation_numero_unique',
  'interventions_organisation_numero_unique'
);

SELECT organisation_id, document_type, period_key, current_value
FROM public.document_counters
ORDER BY document_type, period_key, organisation_id
LIMIT 50;
