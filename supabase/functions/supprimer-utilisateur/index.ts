// supabase/functions/supprimer-utilisateur/index.ts
// Suppression définitive d'un membre (intervenant / assistant) par un
// administrateur de la MÊME organisation (page Utilisateurs).
//
// Toutes les vérifications ont lieu AVANT l'unique appel destructif
// (auth.admin.deleteUser, qui supprime en cascade profil et appareils) ; au
// moindre échec, rien n'est supprimé.
//  1. appelant authentifié (JWT vérifié par GoTrue) ;
//  2. appelant administrateur ACTIF d'une organisation — rôle et organisation
//     lus dans profiles via service role, jamais dans la requête (tout
//     organisation_id envoyé par le client est ignoré) ;
//  3. cible existante, dans la même organisation ;
//  4. cible intervenant ou assistant : jamais un administrateur, jamais
//     soi-même (mêmes règles que l'interface, imposées côté serveur).
//
// Historique : la version déployée jusqu'au 2026-11-03 (v32, 2026-06-05) ne
// vérifiait que le rôle admin — un admin pouvait supprimer un compte de
// n'importe quelle organisation.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const DELETABLE_ROLES = ['intervenant', 'assistant']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, data: object) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type Caller = { error: string; status: number } | { error: null; userId: string; organisationId: string }

// deno-lint-ignore no-explicit-any
async function requireActiveAdmin(req: Request, admin: any): Promise<Caller> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return { error: 'Non authentifié', status: 401 }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return { error: 'Session invalide ou expirée', status: 401 }

  const { data: profile } = await admin
    .from('profiles')
    .select('role, organisation_id, actif')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' || profile.actif === false) {
    return { error: 'Accès réservé aux administrateurs', status: 403 }
  }
  if (!profile.organisation_id) return { error: 'Administrateur sans organisation associée', status: 403 }

  return { error: null, userId: user.id, organisationId: profile.organisation_id as string }
}

export async function handleSupprimerUtilisateur(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const caller = await requireActiveAdmin(req, admin)
    if (caller.error !== null) return json(caller.status, { error: caller.error })

    let body: { userId?: unknown } = {}
    try { body = await req.json() } catch { /* corps invalide → userId manquant */ }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!UUID_RE.test(userId)) return json(400, { error: 'Identifiant utilisateur invalide' })

    if (userId === caller.userId) {
      return json(403, { error: 'Vous ne pouvez pas supprimer votre propre compte' })
    }

    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, organisation_id')
      .eq('id', userId)
      .maybeSingle()
    if (targetErr) {
      console.error('[supprimer-utilisateur] lecture du profil cible échouée:', targetErr.message)
      return json(500, { error: 'Suppression impossible pour le moment. Réessayez plus tard.' })
    }
    // Même réponse pour « inexistant » et « autre organisation » : ne révèle
    // pas l'existence de comptes hors de l'organisation de l'appelant.
    if (!target || target.organisation_id !== caller.organisationId) {
      if (target) console.warn('[supprimer-utilisateur] tentative cross-organisation refusée', JSON.stringify({ caller: caller.userId }))
      return json(404, { error: 'Utilisateur introuvable dans votre organisation' })
    }
    if (!DELETABLE_ROLES.includes(target.role)) {
      return json(403, { error: 'Un compte administrateur ne peut pas être supprimé' })
    }

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      console.error('[supprimer-utilisateur] deleteUser échoué:', error.message)
      return json(500, { error: 'Suppression impossible pour le moment. Réessayez plus tard.' })
    }

    console.log('[supprimer-utilisateur] membre supprimé', JSON.stringify({ caller: caller.userId, target: userId, role: target.role }))
    return json(200, { error: null })
  } catch (err) {
    console.error('[supprimer-utilisateur] erreur interne:', err instanceof Error ? err.message : err)
    return json(500, { error: 'Erreur interne — réessayez plus tard.' })
  }
}

if (import.meta.main) serve(handleSupprimerUtilisateur)
