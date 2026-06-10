-- Politique UPDATE manquante pour l'upsert push_subscriptions
CREATE POLICY "push_sub_update" ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
