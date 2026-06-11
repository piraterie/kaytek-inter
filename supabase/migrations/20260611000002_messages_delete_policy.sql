-- Autoriser l'expéditeur (ou l'admin de la même org) à supprimer ses propres messages
-- Sécurité multi-tenant : is_same_org garantit l'isolation inter-organisations
DROP POLICY IF EXISTS "messages_delete" ON public.messages;

CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE
  USING (
    is_same_org(organisation_id)
    AND (
      expediteur_id = auth.uid()
      OR is_admin_in_org(organisation_id)
    )
  );
