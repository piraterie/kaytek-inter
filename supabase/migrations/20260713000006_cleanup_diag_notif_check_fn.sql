-- Retire la fonction de diagnostic temporaire créée en 20260713000004
-- (n'était destinée qu'à isoler une hypothèse de bug RLS pendant
-- l'investigation — confirmée non nécessaire, le flux réel fonctionne).
DROP FUNCTION IF EXISTS public.diag_notif_check(uuid, uuid);
