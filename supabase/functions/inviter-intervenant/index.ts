import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const respond = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { email, nom, prenom, commission_pct } = await req.json()
    if (!email || !nom || !prenom) return respond({ error: 'Champs email, nom et prenom obligatoires' })

    const origin = req.headers.get('origin') || 'https://kaytek-inter.vercel.app'
    const redirectTo = `${origin}/reset-password`
    const profileData = { nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true }

    // Chercher le profil existant
    const { data: profile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()

    if (profile?.id) {
      // Profil existe → mise à jour + reset password
      await admin.from('profiles').update({ nom, prenom, commission_pct: commission_pct ?? 30 }).eq('id', profile.id)
      await admin.auth.resetPasswordForEmail(email, { redirectTo })
      return respond({ error: null })
    }

    // Pas de profil → tenter invitation
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { nom, prenom, role: 'intervenant' }
    })

    if (inviteErr) {
      // Si user existe déjà dans auth mais pas de profil → chercher par email dans auth
      const { data: userList } = await admin.auth.admin.listUsers()
      const found = userList?.users?.find((u: any) => u.email === email)

      if (found) {
        // Créer le profil manquant + envoyer reset
        await admin.from('profiles').upsert({ id: found.id, email, ...profileData })
        await admin.auth.resetPasswordForEmail(email, { redirectTo })
        return respond({ error: null })
      }

      return respond({ error: inviteErr.message })
    }

    if (!invited?.user) return respond({ error: "Impossible de créer l'utilisateur" })

    // Créer le profil
    const { error: profileErr } = await admin.from('profiles').insert({ id: invited.user.id, email, ...profileData })
    if (profileErr) return respond({ error: 'Erreur profil: ' + profileErr.message })

    return respond({ error: null })

  } catch (e) {
    return respond({ error: e instanceof Error ? e.message : 'Erreur interne' })
  }
})
