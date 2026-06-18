-- pgcrypto requis pour gen_random_bytes (encode hex du token)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Table pour les liens publics de partage de documents (devis / factures)
CREATE TABLE IF NOT EXISTS document_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  document_type text NOT NULL CHECK (document_type IN ('devis', 'facture')),
  document_id uuid NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index pour la recherche rapide par token
CREATE INDEX IF NOT EXISTS document_public_links_token_idx ON document_public_links (token);

-- RLS
ALTER TABLE document_public_links ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs authentifiés de l'organisation peuvent créer des liens
CREATE POLICY "org_insert" ON document_public_links
  FOR INSERT
  WITH CHECK (
    organisation_id = (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Les utilisateurs authentifiés de l'organisation peuvent voir leurs liens
CREATE POLICY "org_select" ON document_public_links
  FOR SELECT
  USING (
    organisation_id = (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Les utilisateurs authentifiés de l'organisation peuvent supprimer leurs liens
CREATE POLICY "org_delete" ON document_public_links
  FOR DELETE
  USING (
    organisation_id = (
      SELECT organisation_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Lecture publique par token (sans authentification) via fonction SECURITY DEFINER
-- La lecture publique est gérée par l'edge function get-public-document
-- qui utilise la service role key, donc pas de policy anon nécessaire ici.
