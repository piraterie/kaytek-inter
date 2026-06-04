import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const respond = (data: object) =>
  new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? ''
    const { email, nom, prenom, commission_pct } = await req.json()
    if (!email || !nom || !prenom) return respond({ error: 'Champs email, nom et prenom obligatoires' })

    const origin = req.headers.get('origin') || 'https://kaytek-inter.vercel.app'
    const redirectTo = `${origin}/reset-password`
    const profileData = { nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true }

    // 1. Chercher si profil existe déjà
    const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()

    let actionLink: string
    let isNew = false

    if (existingProfile?.id) {
      // Utilisateur existant → mettre à jour profil + générer lien reset
      await admin.from('profiles').update({ nom, prenom, commission_pct: commission_pct ?? 30 }).eq('id', existingProfile.id)
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery', email, options: { redirectTo }
      })
      if (linkErr) return respond({ error: linkErr.message })
      actionLink = linkData.properties?.action_link ?? ''
    } else {
      // Nouvel utilisateur → chercher dans auth ou créer
      const { data: userList } = await admin.auth.admin.listUsers()
      const authUser = (userList?.users ?? []).find((u: any) => u.email === email)

      if (authUser) {
        // Existe dans auth mais pas de profil
        await admin.from('profiles').upsert({ id: authUser.id, email, ...profileData })
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'recovery', email, options: { redirectTo }
        })
        if (linkErr) return respond({ error: linkErr.message })
        actionLink = linkData.properties?.action_link ?? ''
      } else {
        // Vraiment nouveau → générer lien d'invitation
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'invite', email, options: { redirectTo }
        })
        if (linkErr) return respond({ error: linkErr.message })
        actionLink = linkData.properties?.action_link ?? ''

        // Créer le profil
        const userId = linkData.user?.id
        if (userId) {
          await admin.from('profiles').insert({ id: userId, email, ...profileData })
        }
        isNew = true
      }
    }

    if (!actionLink) return respond({ error: 'Impossible de générer le lien' })

    // 2. Envoyer l'email via Brevo API (pas SMTP)
    const subject = isNew ? 'Bienvenue sur Kaytek Inter — Activez votre compte' : 'Kaytek Inter — Définissez votre mot de passe'
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;">
        <div style="background:#1e3a5f;padding:28px 36px;text-align:center;">
          <div style="color:#fff;font-size:20px;font-weight:700;">KAYTEK INTER</div>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div>
        </div>
        <div style="background:#e85d04;height:4px;"></div>
        <div style="padding:32px 36px;">
          <p style="font-size:15px;color:#374151;">Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p style="font-size:15px;color:#374151;">
            ${isNew
              ? "Vous avez été invité(e) à rejoindre l'application <strong>Kaytek Inter</strong> en tant qu'intervenant(e)."
              : "Voici votre lien pour définir votre mot de passe sur <strong>Kaytek Inter</strong>."}
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${actionLink}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;display:inline-block;">
              ${isNew ? 'Activer mon compte' : 'Définir mon mot de passe'}
            </a>
          </div>
          <p style="font-size:12px;color:#9ca3af;text-align:center;">Ce lien expire dans 24h. Si vous n'êtes pas concerné(e), ignorez cet email.</p>
        </div>
        <div style="background:#1e3a5f;padding:16px 36px;text-align:center;">
          <div style="color:rgba(255,255,255,0.6);font-size:11px;">Kaytek Inter · Serrurerie · Vitrerie</div>
        </div>
      </div>`

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Kaytek Inter', email: 'castryludovic@gmail.com' },
        to: [{ email }],
        subject,
        htmlContent: html
      })
    })

    if (!emailRes.ok) {
      const emailErr = await emailRes.json()
      return respond({ error: emailErr.message || "Erreur envoi email" })
    }

    return respond({ error: null })

  } catch (e) {
    return respond({ error: e instanceof Error ? e.message : 'Erreur interne' })
  }
})
