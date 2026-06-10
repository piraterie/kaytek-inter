import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

async function requireCanSendEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return 'Non authentifié'

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return 'Token invalide'

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role, can_create_documents, can_bypass_validation')
    .eq('id', user.id)
    .single()

  const canSend = profile?.role === 'admin' ||
    (profile?.can_create_documents === true && profile?.can_bypass_validation === true)
  if (!canSend) return 'Accès non autorisé'

  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const deny = await requireCanSendEmail(req)
  if (deny) return new Response(JSON.stringify({ error: deny }), {
    status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''

    if (!BREVO_API_KEY) return new Response(JSON.stringify({ error: 'BREVO_API_KEY non configuré' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
    if (!EMAIL_FROM) {
      console.error('[envoyer-email] EMAIL_FROM non configuré')
      return new Response(JSON.stringify({ error: 'Configuration email manquante (EMAIL_FROM non défini)' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { to, subject, html, pdfBase64, pdfFilename } = await req.json()
    if (!to || !subject) return new Response(JSON.stringify({ error: 'Champs to et subject obligatoires' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    const match = EMAIL_FROM.match(/^(.+?)\s*<(.+?)>$/)
    const senderName  = match ? match[1].trim() : 'Kaytek Inter'
    const senderEmail = match ? match[2].trim() : EMAIL_FROM.trim()

    const payload: Record<string, unknown> = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }
    if (pdfBase64 && pdfFilename) payload.attachment = [{ name: pdfFilename, content: pdfBase64 }]

    const res  = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    if (!res.ok) return new Response(JSON.stringify({ error: data.message || 'Erreur Brevo' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

    return new Response(JSON.stringify({ error: null, id: data.messageId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur envoi email' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
