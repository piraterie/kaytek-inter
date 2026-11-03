// supabase/functions/demander-reinitialisation/index.ts
// Demande de réinitialisation du mot de passe (« Mot de passe oublié ? »).
//
// Remplace supabase.auth.resetPasswordForEmail(), qui dépend du mailer de
// Supabase Auth (SMTP du projet) : en production celui-ci échouait avec
// « Error sending recovery email » (HTTP 500), alors que les invitations —
// envoyées via l'API Brevo — arrivent bien. On génère donc le jeton avec
// l'API admin et on envoie l'e-mail par le même canal Brevo que les
// invitations.
//
// Réponse volontairement identique que l'adresse corresponde ou non à un
// compte (pas d'énumération) ; le détail reste dans les logs (adresse masquée,
// jamais de jeton).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTransactionalEmail } from '../_shared/brevo-email.ts'
import {
  resolveAppOrigin, buildAppAuthLink, normalizeEmail, isPlausibleEmail, maskEmail, renderAuthEmail,
} from '../_shared/auth-links.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Délai minimal entre deux e-mails de réinitialisation pour une même adresse.
const COOLDOWN_MS = 60_000
// Durée minimale de réponse : lisse l'écart de temps entre « compte trouvé »
// (génération + envoi) et « aucun compte » pour ne pas trahir l'existence.
const MIN_RESPONSE_MS = 900

const json = (status: number, data: object) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

async function processRequest(email: string, origin: string): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: profile, error: lookupErr } = await admin.from('profiles')
    .select('id, prenom, nom, actif')
    .ilike('email', escapeLike(email))
    .maybeSingle()
  if (lookupErr) { console.error('[reset] recherche profil échouée:', lookupErr.message); return }
  if (!profile) { console.log('[reset] aucun profil pour', maskEmail(email)); return }
  if (profile.actif === false) { console.log('[reset] compte désactivé, pas d\'envoi:', maskEmail(email)); return }

  const { data: existing, error: userErr } = await admin.auth.admin.getUserById(profile.id)
  if (userErr || !existing?.user) { console.error('[reset] compte auth introuvable pour', maskEmail(email), userErr?.message); return }
  const lastSent = existing.user.recovery_sent_at ? Date.parse(existing.user.recovery_sent_at) : 0
  if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
    console.log('[reset] demande ignorée (anti-flood) pour', maskEmail(email))
    return
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  const hashedToken = linkData?.properties?.hashed_token
  if (linkErr || !hashedToken) {
    console.error('[reset] generateLink échoué:', JSON.stringify({ email: maskEmail(email), message: linkErr?.message, code: (linkErr as any)?.code }))
    return
  }

  const html = renderAuthEmail({
    greetingName: `${profile.prenom ?? ''} ${profile.nom ?? ''}`,
    intro: 'Vous avez demandé à réinitialiser votre mot de passe <strong>Kaytek Inter</strong>. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.',
    ctaLabel: 'Choisir un nouveau mot de passe',
    ctaUrl: buildAppAuthLink(origin, 'recovery', hashedToken),
    footnote: "Ce lien est personnel et valable pour une durée limitée. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste inchangé.",
  })
  const sent = await sendTransactionalEmail({ to: email, subject: 'Kaytek Inter — Réinitialisation de votre mot de passe', html })
  if (!sent.ok) { console.error('[reset] envoi Brevo échoué:', sent.error); throw new Error('send_failed') }
  console.log('[reset] e-mail envoyé à', maskEmail(email))
}

export async function handleDemanderReinitialisation(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' })

  const started = Date.now()
  let email = ''
  try {
    email = normalizeEmail((await req.json())?.email)
  } catch { /* corps invalide → traité comme adresse invalide */ }
  if (!isPlausibleEmail(email)) return json(400, { error: 'Adresse e-mail invalide' })

  const origin = resolveAppOrigin(req.headers.get('origin'), {
    APP_URL: Deno.env.get('APP_URL'),
    APP_ALLOWED_ORIGINS: Deno.env.get('APP_ALLOWED_ORIGINS'),
    SUPABASE_URL,
  })

  try {
    await processRequest(email, origin)
  } catch (e) {
    // Même une panne d'envoi (Brevo) renvoie la réponse générique : un statut
    // différent révélerait qu'un compte existe pour cette adresse.
    if (!(e instanceof Error && e.message === 'send_failed')) console.error('[reset] erreur interne:', e instanceof Error ? e.message : e)
  }

  const wait = MIN_RESPONSE_MS - (Date.now() - started)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))

  return json(200, { error: null })
}

if (import.meta.main) serve(handleDemanderReinitialisation)
