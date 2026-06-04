import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const ok = (data = {}) => new Response(JSON.stringify({ error: null, ...data }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const err = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { email, nom, prenom, commission_pct } = await req.json()
    if (!email || !nom || !prenom) return err('Champs email, nom et prenom obligatoires')

    const origin = req.headers.get('origin') || Deno.env.get('SITE_URL') || 'https://kaytek-inter.vercel.app'
    const redirectTo = `${origin}/reset-password`

    // 1. Chercher si l'utilisateur existe déjà dans auth.users
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const existingAuthUser = listData?.users?.find(u => u.email === email)

    if (existingAuthUser) {
      // Utilisateur déjà dans auth — met à jour ou crée le profil
      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('id').eq('id', existingAuthUser.id).maybeSingle()

      if (existingProfile) {
        await supabaseAdmin.from('profiles').update({ nom, prenom, commission_pct: commission_pct ?? 30 }).eq('id', existingAuthUser.id)
      } else {
        await supabaseAdmin.from('profiles').insert({ id: existingAuthUser.id, email, nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true })
      }

      // Envoie un email de réinitialisation de mot de passe
      await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo })
      return ok()
    }

    // 2. Nouvel utilisateur — invitation Supabase
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { nom, prenom, role: 'intervenant' }
    })

    if (inviteError) return err(inviteError.message)
    if (!inviteData?.user) return err("Impossible de créer l'utilisateur")

    // 3. Créer le profil
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: inviteData.user.id, email, nom, prenom,
      role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true
    })

    if (profileError) return err("Erreur profil: " + profileError.message)

    return ok()
  } catch (e) {
    return err(e instanceof Error ? e.message : "Erreur interne")
  }
})
