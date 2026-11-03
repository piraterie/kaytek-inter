import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTransactionalEmail } from '../_shared/brevo-email.ts'
import {
  resolveAppOrigin, buildAppAuthLink, buildActivationLinkForRecovery,
  normalizeEmail, isPlausibleEmail, maskEmail, escapeHtml, renderAuthEmail,
} from '../_shared/auth-links.ts'

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

// Échappe les jokers ILIKE (% _ \) — fréquents dans les adresses (ex. jean_dupont@…).
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function handleInviterIntervenant(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { error: deny, organisationId } = await requireAdmin(req)
  if (deny) return new Response(JSON.stringify({ error: deny }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const email = normalizeEmail(body.email)
    const nom = typeof body.nom === 'string' ? body.nom.trim() : ''
    const prenom = typeof body.prenom === 'string' ? body.prenom.trim() : ''
    const { commission_pct, role: requestedRole } = body
    if (!email || !nom || !prenom) return respond({ error: 'Champs email, nom et prénom obligatoires' })
    if (!isPlausibleEmail(email)) return respond({ error: 'Adresse e-mail invalide' })

    // Whitelist stricte des rôles invitables — 'admin' est explicitement exclu
    // pour empêcher toute escalade de privilèges via ce endpoint.
    const ALLOWED_ROLES = ['intervenant', 'assistant']
    if (requestedRole && !ALLOWED_ROLES.includes(requestedRole)) {
      return respond({ error: `Rôle invalide — autorisés : ${ALLOWED_ROLES.join(', ')}` })
    }
    const role: 'intervenant' | 'assistant' = requestedRole === 'assistant' ? 'assistant' : 'intervenant'

    const origin = resolveAppOrigin(req.headers.get('origin'), {
      APP_URL: Deno.env.get('APP_URL'),
      APP_ALLOWED_ORIGINS: Deno.env.get('APP_ALLOWED_ORIGINS'),
      SUPABASE_URL,
    })

    // 1. Profil existant ? (comparaison insensible à la casse)
    const { data: existingProfile, error: lookupErr } = await admin.from('profiles')
      .select('id, organisation_id, role')
      .ilike('email', escapeLike(email))
      .maybeSingle()
    if (lookupErr) {
      console.error('[inviter-intervenant] recherche profil échouée:', lookupErr.message)
      return respond({ error: "Impossible d'envoyer l'invitation pour le moment. Réessayez plus tard." })
    }

    if (existingProfile?.organisation_id && existingProfile.organisation_id !== organisationId) {
      return respond({ error: 'Cet utilisateur appartient déjà à une autre organisation' })
    }
    // Ne jamais rétrograder un administrateur via une (ré)invitation.
    if (existingProfile?.role === 'admin') {
      return respond({ error: 'Cette adresse correspond déjà à un administrateur' })
    }

    // 2. Jeton : invitation tant que le compte n'est pas confirmé (nouveau compte
    // ou invitation en attente = renvoi), sinon lien de type recovery.
    // user_metadata ne sert qu'à l'affichage : depuis la migration 20261103000000,
    // handle_new_user() ignore toute organisation fournie par ce biais (il serait
    // sinon exploitable par un signUp public) — le profil est créé à l'étape 3.
    let kind: 'invite' | 'recovery' = 'invite'
    let { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'invite', email,
      options: { data: { nom, prenom, role, organisation_id: organisationId } },
    })
    if (linkErr && ((linkErr as any).code === 'email_exists' || (linkErr as any).status === 422)) {
      kind = 'recovery'
      ;({ data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email }))
    }
    if (linkErr || !linkData?.user?.id || !linkData.properties?.hashed_token) {
      console.error('[inviter-intervenant] generateLink échoué:', JSON.stringify({
        kind, email: maskEmail(email), message: linkErr?.message, code: (linkErr as any)?.code, status: (linkErr as any)?.status,
      }))
      return respond({ error: "Impossible de générer le lien d'invitation. Réessayez plus tard." })
    }
    const userId = linkData.user.id

    if (existingProfile?.id && existingProfile.id !== userId) {
      console.error('[inviter-intervenant] incohérence profil/auth pour', maskEmail(email))
      return respond({ error: 'Compte incohérent pour cette adresse — contactez le support.' })
    }

    // 3. Profil — seul point de rattachement d'un membre à une organisation :
    // rôle et organisation fixés ici, côté serveur, après vérification de
    // l'admin (jamais depuis la page d'activation, l'URL du lien ou un signUp).
    const profileData: Record<string, unknown> = { nom, prenom, role, organisation_id: organisationId }
    if (role === 'intervenant') profileData.commission_pct = commission_pct ?? 30
    const { error: profileErr } = existingProfile?.id
      ? await admin.from('profiles').update(profileData).eq('id', userId)
      : await admin.from('profiles').upsert({ id: userId, email, actif: true, ...profileData }, { onConflict: 'id' })
    if (profileErr) {
      console.error('[inviter-intervenant] écriture profil échouée:', JSON.stringify({ message: profileErr.message, code: (profileErr as any).code }))
      return respond({ error: "Impossible d'enregistrer le profil invité. Réessayez plus tard." })
    }

    // 4. E-mail via l'API Brevo (pas le SMTP Supabase).
    const hashedToken = linkData.properties.hashed_token
    const link = kind === 'invite'
      ? buildAppAuthLink(origin, 'invite', hashedToken)
      : buildActivationLinkForRecovery(origin, hashedToken)
    const roleLabel = role === 'assistant' ? 'assistant(e)' : 'intervenant(e)'
    const html = renderAuthEmail({
      greetingName: `${prenom} ${nom}`,
      intro: kind === 'invite'
        ? `Vous avez été invité(e) à rejoindre l'application <strong>Kaytek Inter</strong> en tant qu'${escapeHtml(roleLabel)}. Cliquez sur le bouton ci-dessous pour choisir votre mot de passe et activer votre compte.`
        : 'Voici votre lien pour définir votre mot de passe sur <strong>Kaytek Inter</strong>.',
      ctaLabel: kind === 'invite' ? 'Activer mon compte' : 'Définir mon mot de passe',
      ctaUrl: link,
      footnote: "Ce lien est personnel et valable pour une durée limitée. Si vous n'êtes pas concerné(e), ignorez cet e-mail.",
    })
    const sent = await sendTransactionalEmail({
      to: email,
      subject: kind === 'invite' ? 'Bienvenue sur Kaytek Inter — Activez votre compte' : 'Kaytek Inter — Définissez votre mot de passe',
      html,
    })
    if (!sent.ok) {
      console.error('[inviter-intervenant] envoi Brevo échoué:', sent.error)
      return respond({ error: "L'e-mail d'invitation n'a pas pu être envoyé. Réessayez plus tard." })
    }

    console.log('[inviter-intervenant] invitation envoyée', JSON.stringify({ kind, role, email: maskEmail(email) }))
    return respond({ error: null, kind })

  } catch (e) {
    console.error('[inviter-intervenant] erreur interne:', e instanceof Error ? e.message : e)
    return respond({ error: 'Erreur interne — réessayez plus tard.' })
  }
}

if (import.meta.main) serve(handleInviterIntervenant)
