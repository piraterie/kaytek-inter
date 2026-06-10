-- ================================================================
-- PRIORITÉ 1 — Gestion des appareils + tentatives de connexion
-- ================================================================

-- Table devices : enregistrement des appareils par utilisateur
CREATE TABLE IF NOT EXISTS public.devices (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id                text NOT NULL,
  nom_appareil             text,
  navigateur               text,
  systeme_exploitation     text,
  adresse_ip               text,
  date_premiere_connexion  timestamptz DEFAULT now() NOT NULL,
  date_derniere_connexion  timestamptz DEFAULT now() NOT NULL,
  actif                    boolean DEFAULT true NOT NULL,
  UNIQUE(user_id, device_id)
);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- L'utilisateur voit et gère ses propres appareils ; l'admin voit tout
CREATE POLICY "devices_select" ON public.devices
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "devices_insert_own" ON public.devices
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "devices_update_own" ON public.devices
  FOR UPDATE USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "devices_delete_own" ON public.devices
  FOR DELETE USING (user_id = auth.uid() OR is_admin());

-- Index pour les requêtes de comptage par utilisateur actif
CREATE INDEX IF NOT EXISTS idx_devices_user_actif ON public.devices(user_id, actif);
