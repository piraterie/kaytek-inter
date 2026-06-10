import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

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
  const { data: profile } = await adminClient.from('profiles').select('role, organisation_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: 'Accès réservé aux administrateurs', organisationId: null }
  if (!profile.organisation_id) return { error: "L'administrateur n'a pas d'organisation associée", organisationId: null }

  return { error: null, organisationId: profile.organisation_id as string }
}

const respond = (data: object) =>
  new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { error: deny, organisationId } = await requireAdmin(req)
  if (deny) return new Response(JSON.stringify({ error: deny }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? ''
    const { email, nom, prenom, commission_pct } = await req.json()
    if (!email || !nom || !prenom) return respond({ error: 'Champs email, nom et prenom obligatoires' })

    const origin = req.headers.get('origin') || 'https://kaytek-inter.vercel.app'
    const redirectTo = `${origin}/reset-password`
    const profileData = { nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, actif: true, organisation_id: organisationId }

    // 1. Chercher si profil existe déjà
    const { data: existingProfile } = await admin.from('profiles')
      .select('id, organisation_id')
      .eq('email', email)
      .maybeSingle()

    let actionLink: string
    let isNew = false

    if (existingProfile?.id) {
      // Vérification isolation organisation : refuser si le profil appartient à une autre org
      if (existingProfile.organisation_id && existingProfile.organisation_id !== organisationId) {
        return respond({ error: 'Cet utilisateur appartient déjà à une autre organisation' })
      }

      // Utilisateur existant (même org ou sans org) → mise à jour profil + génération lien reset
      // role forcé à 'intervenant' pour éviter toute escalade de privilèges
      console.log('[DBG] profiles.update payload:', JSON.stringify({ nom, prenom, role: 'intervenant', commission_pct: commission_pct ?? 30, organisation_id: organisationId }))
      const { error: updateErr } = await admin.from('profiles').update({
        nom,
        prenom,
        role: 'intervenant',
        commission_pct: commission_pct ?? 30,
        organisation_id: organisationId,
      }).eq('id', existingProfile.id)
      if (updateErr) console.error('[DBG] profiles.update error:', JSON.stringify({ message: updateErr.message, code: (updateErr as any).code, details: (updateErr as any).details, hint: (updateErr as any).hint }))
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery', email, options: { redirectTo }
      })
      if (linkErr) return respond({ error: linkErr.message })
      actionLink = linkData.properties?.action_link ?? ''
    } else {
      // Nouvel utilisateur — recherche ciblée dans auth.users par email (évite listUsers global)
      const { data: authUser } = await admin
        .schema('auth')
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (authUser) {
        // Existe dans auth mais pas de profil
        console.log('[DBG] profiles.upsert payload:', JSON.stringify({ id: authUser.id, email, ...profileData }))
        const { error: upsertErr } = await admin.from('profiles').upsert({ id: authUser.id, email, ...profileData })
        if (upsertErr) console.error('[DBG] profiles.upsert error:', JSON.stringify({ message: upsertErr.message, code: (upsertErr as any).code, details: (upsertErr as any).details, hint: (upsertErr as any).hint }))
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'recovery', email, options: { redirectTo }
        })
        if (linkErr) return respond({ error: linkErr.message })
        actionLink = linkData.properties?.action_link ?? ''
      } else {
        // Vraiment nouveau → generateLink crée l'auth user (déclenche trigger handle_new_user si existant)
        console.log('[DBG] generateLink invite pour:', email)
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'invite', email, options: { redirectTo }
        })
        if (linkErr) {
          console.error('[DBG] generateLink invite error:', JSON.stringify({ message: linkErr.message, code: (linkErr as any).code, details: (linkErr as any).details, hint: (linkErr as any).hint, status: (linkErr as any).status }))
          return respond({ error: linkErr.message })
        }
        actionLink = linkData.properties?.action_link ?? ''

        // Créer le profil
        const userId = linkData.user?.id
        console.log('[DBG] profiles.insert payload:', JSON.stringify({ id: userId, email, ...profileData }))
        if (userId) {
          const { error: insertErr } = await admin.from('profiles').insert({ id: userId, email, ...profileData })
          if (insertErr) console.error('[DBG] profiles.insert error:', JSON.stringify({ message: insertErr.message, code: (insertErr as any).code, details: (insertErr as any).details, hint: (insertErr as any).hint }))
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

    const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''
    if (!EMAIL_FROM) {
      console.error('[inviter-intervenant] EMAIL_FROM non configuré — arrêt')
      return respond({ error: 'Configuration email manquante (EMAIL_FROM non défini)' })
    }
    const emailFromMatch = EMAIL_FROM.match(/^(.+?)\s*<(.+?)>$/)
    const senderName  = emailFromMatch ? emailFromMatch[1].trim() : 'Kaytek Inter'
    const senderEmail = emailFromMatch ? emailFromMatch[2].trim() : EMAIL_FROM.trim()

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
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
