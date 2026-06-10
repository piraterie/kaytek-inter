import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// Retourne l'organisationId du caller admin, ou une erreur
async function requireAdmin(req: Request): Promise<{ error: string | null; organisationId: string | null }> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return { error: 'Non authentifié', organisationId: null }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return { error: 'Token invalide', organisationId: null }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { error: 'Accès réservé aux administrateurs', organisationId: null }
  if (!profile?.organisation_id) return { error: "Administrateur sans organisation associée", organisationId: null }

  return { error: null, organisationId: profile.organisation_id as string }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { error: deny, organisationId } = await requireAdmin(req)
  if (deny) return new Response(JSON.stringify({ error: deny }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { userId } = await req.json()
    if (!userId) return new Response(JSON.stringify({ error: 'userId manquant' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    // Vérification organisation : l'utilisateur cible doit appartenir à la même org que le caller
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('organisation_id')
      .eq('id', userId)
      .single()

    if (!targetProfile) return new Response(JSON.stringify({ error: 'Utilisateur introuvable' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    if (targetProfile.organisation_id !== organisationId) {
      return new Response(JSON.stringify({ error: 'Suppression cross-organisation non autorisée' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    return new Response(JSON.stringify({ error: null }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur suppression' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
