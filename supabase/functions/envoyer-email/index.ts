import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateEntrepriseReplyTo, REPLY_TO_INVALID_MESSAGE } from '../_shared/validateEntreprise.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function requireCanSendEmail(req: Request): Promise<{ deny: string | null; organisationId: string | null }> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return { deny: 'Non authentifié', organisationId: null }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return { deny: 'Token invalide', organisationId: null }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role, can_create_documents, can_bypass_validation, organisation_id')
    .eq('id', user.id)
    .single()

  const canSend = profile?.role === 'admin' ||
    (profile?.can_create_documents === true && profile?.can_bypass_validation === true)
  if (!canSend) return { deny: 'Accès non autorisé', organisationId: null }

  return { deny: null, organisationId: (profile?.organisation_id as string) ?? null }
}

const REQUIRED_PARAMS = [
  { field: 'raison_sociale', label: 'Raison sociale' },
  { field: 'email',          label: 'Email entreprise' },
  { field: 'telephone',      label: 'Téléphone' },
  { field: 'adresse',        label: 'Adresse' },
] as const

const DOCUMENT_TABLES = { devis: 'devis', facture: 'factures' } as const

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { deny, organisationId } = await requireCanSendEmail(req)
  if (deny) return json({ error: deny }, 403)
  if (!organisationId) return json({ error: "Aucune organisation associée à ce compte" }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corps de requête JSON invalide' }, 400)
  }

  const { to, subject, html, pdfBase64, pdfFilename, documentType, documentId } = body as {
    to?: string; subject?: string; html?: string; pdfBase64?: string; pdfFilename?: string
    documentType?: 'devis' | 'facture'; documentId?: string
  }

  if (!to || !subject) return json({ error: 'Champs to et subject obligatoires' }, 400)

  // ── Vérification d'appartenance du document (isolation multi-tenant) ──────
  // Cette fonction utilise la service role key, qui BYPASS la RLS — on ne
  // peut donc jamais se reposer sur la RLS ni sur la simple coïncidence que
  // l'appelant appartient à une organisation pour garantir l'isolation. Le
  // document envoyé (devis ou facture) doit être chargé explicitement et son
  // organisation_id comparé, sans exception, à celle de l'appelant.
  if (!documentType || !DOCUMENT_TABLES[documentType] || !documentId) {
    return json({ error: 'documentType (devis|facture) et documentId sont obligatoires' }, 400)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: document, error: docError } = await sb
    .from(DOCUMENT_TABLES[documentType])
    .select('id, organisation_id')
    .eq('id', documentId)
    .maybeSingle()

  if (docError || !document) return json({ error: 'Document introuvable' }, 404)
  if (document.organisation_id !== organisationId) {
    return json({ error: "Ce document n'appartient pas à votre organisation" }, 403)
  }

  // ── Paramètres entreprise de l'organisation VÉRIFIÉE ci-dessus (jamais
  // celle du profil appelant prise à sa seule valeur nominale) ──────────────
  const { data: pe } = await sb
    .from('parametres_entreprise')
    .select('raison_sociale, email, telephone, adresse')
    .eq('organisation_id', document.organisation_id)
    .maybeSingle()
  const entreprise = pe as Record<string, string | null> | null

  const missing = REQUIRED_PARAMS.filter(r => !entreprise?.[r.field])
  if (missing.length > 0) {
    return json({
      error: `Paramètres entreprise incomplets — complétez dans les Paramètres : ${missing.map(r => r.label).join(', ')}.`,
    })
  }

  // ── Blocage strict : jamais d'envoi d'email métier sans Reply-To valide ───
  const replyTo = validateEntrepriseReplyTo(entreprise)
  if (!replyTo) {
    return json({ error: REPLY_TO_INVALID_MESSAGE }, 422)
  }

  try {
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''

    if (!BREVO_API_KEY) return json({ error: 'BREVO_API_KEY non configuré' })
    if (!EMAIL_FROM) {
      console.error('[envoyer-email] EMAIL_FROM non configuré')
      return json({ error: 'Configuration email manquante (EMAIL_FROM non défini)' })
    }

    const match = EMAIL_FROM.match(/^(.+?)\s*<(.+?)>$/)
    const senderName  = match ? match[1].trim() : 'Kaytek Inter'
    const senderEmail = match ? match[2].trim() : EMAIL_FROM.trim()

    // Reply-To systématique et inconditionnel — jamais optionnel après la
    // validation ci-dessus, jamais l'adresse personnelle du compte Brevo ni
    // une adresse globale à la plateforme.
    const payload: Record<string, unknown> = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      replyTo: { name: replyTo.name, email: replyTo.email },
    }
    if (pdfBase64 && pdfFilename) payload.attachment = [{ name: pdfFilename, content: pdfBase64 }]

    const res  = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    if (!res.ok) return json({ error: data.message || 'Erreur Brevo' })

    return json({ error: null, id: data.messageId })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur envoi email' })
  }
})
