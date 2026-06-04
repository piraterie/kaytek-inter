import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { email, nom, prenom, commission_pct } = await req.json()

    if (!email || !nom || !prenom) {
      return new Response(
        JSON.stringify({ error: 'Champs email, nom et prenom obligatoires' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const origin = req.headers.get('origin') || Deno.env.get('SITE_URL') || ''

    // Vérifie si l'utilisateur existe déjà
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    let userId: string

    if (existing?.id) {
      // Utilisateur existant : met à jour le profil et renvoie invitation
      userId = existing.id
      await supabaseAdmin.from('profiles').update({ nom, prenom, commission_pct: commission_pct ?? 30 }).eq('id', userId)
      await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/reset-password`
      })
    } else {
      // Nouvel utilisateur : invitation via Supabase (envoie l'email automatiquement)
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/reset-password`,
        data: { nom, prenom, role: 'intervenant' }
      })

      if (inviteError) {
        return new Response(
          JSON.stringify({ error: inviteError.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!inviteData.user) {
        return new Response(
          JSON.stringify({ error: "Impossible de créer l'utilisateur" }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      userId = inviteData.user.id

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({ id: userId, email, nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true })

      if (profileError) {
        return new Response(
          JSON.stringify({ error: "Erreur lors de l'enregistrement du profil" }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ error: null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erreur lors de l'invitation" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
