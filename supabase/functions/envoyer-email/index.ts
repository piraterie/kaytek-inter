import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateEntrepriseReplyTo, REPLY_TO_INVALID_MESSAGE } from '../_shared/validateEntreprise.ts'
import {
  DOCUMENT_TABLES,
  buildBrevoPayload,
  callBrevo,
  estimatePdfBytes,
  logEnvoyerEmailEvent,
  parseEmailFrom,
  validateEnvoyerEmailBody,
} from '../_shared/emailContract.ts'

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

serve(async (req) => {
  const startedAt = Date.now()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { deny, organisationId } = await requireCanSendEmail(req)
  if (deny) {
    logEnvoyerEmailEvent('denied', { status: 403, organisationId, errorCode: 'access_denied' })
    return json({ error: deny }, 403)
  }
  if (!organisationId) {
    logEnvoyerEmailEvent('denied', { status: 403, errorCode: 'no_organisation' })
    return json({ error: "Aucune organisation associée à ce compte" }, 403)
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    logEnvoyerEmailEvent('rejected', { status: 400, organisationId, errorCode: 'invalid_json' })
    return json({ error: 'Corps de requête JSON invalide' }, 400)
  }

  // ── Contrat frontend/backend — voir _shared/emailContract.ts (source
  // unique de vérité, importée telle quelle par le frontend). Le frontend
  // valide déjà ces champs, mais le backend ne peut jamais lui faire
  // confiance (bug, ancien bundle en cache, appel direct de l'API) :
  // revalidation complète ici, via EXACTEMENT le même schéma zod.
  const validation = validateEnvoyerEmailBody(rawBody)
  if (validation.error) {
    const b = rawBody as Record<string, unknown>
    logEnvoyerEmailEvent('rejected', {
      status: validation.error.status,
      organisationId,
      documentType: typeof b?.documentType === 'string' ? b.documentType : undefined,
      documentId: typeof b?.documentId === 'string' ? b.documentId : undefined,
      errorCode: validation.error.field,
    })
    return json({ error: validation.error.message }, validation.error.status)
  }

  const { to, subject, html, pdfBase64, pdfFilename, documentType, documentId } = validation.data

  // ── Vérification d'appartenance du document (isolation multi-tenant) ──────
  // Cette fonction utilise la service role key, qui BYPASS la RLS — on ne
  // peut donc jamais se reposer sur la RLS ni sur la simple coïncidence que
  // l'appelant appartient à une organisation pour garantir l'isolation. Le
  // document envoyé (devis ou facture) doit être chargé explicitement et son
  // organisation_id comparé, sans exception, à celle de l'appelant.
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: document, error: docError } = await sb
    .from(DOCUMENT_TABLES[documentType])
    .select('id, organisation_id')
    .eq('id', documentId)
    .maybeSingle()

  if (docError || !document) {
    logEnvoyerEmailEvent('rejected', { status: 404, organisationId, documentType, documentId, errorCode: 'document_not_found' })
    return json({ error: 'Document introuvable' }, 404)
  }
  if (document.organisation_id !== organisationId) {
    logEnvoyerEmailEvent('rejected', { status: 403, organisationId, documentType, documentId, errorCode: 'cross_org_document' })
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
    logEnvoyerEmailEvent('rejected', { status: 200, organisationId, documentType, documentId, errorCode: 'incomplete_company_params' })
    return json({
      error: `Paramètres entreprise incomplets — complétez dans les Paramètres : ${missing.map(r => r.label).join(', ')}.`,
    })
  }

  // ── Blocage strict : jamais d'envoi d'email métier sans Reply-To valide ───
  const replyTo = validateEntrepriseReplyTo(entreprise)
  if (!replyTo) {
    logEnvoyerEmailEvent('rejected', { status: 422, organisationId, documentType, documentId, errorCode: 'invalid_reply_to' })
    return json({ error: REPLY_TO_INVALID_MESSAGE }, 422)
  }

  try {
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''

    if (!BREVO_API_KEY) {
      logEnvoyerEmailEvent('rejected', { status: 200, organisationId, documentType, documentId, errorCode: 'missing_brevo_key' })
      return json({ error: 'BREVO_API_KEY non configuré' })
    }
    if (!EMAIL_FROM) {
      console.error('[envoyer-email] EMAIL_FROM non configuré')
      logEnvoyerEmailEvent('rejected', { status: 200, organisationId, documentType, documentId, errorCode: 'missing_email_from' })
      return json({ error: 'Configuration email manquante (EMAIL_FROM non défini)' })
    }

    const sender = parseEmailFrom(EMAIL_FROM)
    const payload = buildBrevoPayload({ sender, to, subject, html, replyTo, pdfBase64, pdfFilename })

    // BREVO_API_URL est optionnelle, jamais définie en production (donc
    // toujours le vrai Brevo en prod) — utilisée uniquement par la CI
    // d'intégration pour rediriger vers un faux serveur Brevo local.
    const BREVO_API_URL = Deno.env.get('BREVO_API_URL')
    const outcome = await callBrevo(fetch, BREVO_API_KEY, payload, BREVO_API_URL)

    // Le statut HTTP retourné à l'appelant est toujours 200 ici (comme
    // avant cette refactorisation) : un échec Brevo/réseau est une erreur
    // métier communiquée dans le corps JSON, pas une erreur de la requête
    // elle-même envers cette fonction.
    logEnvoyerEmailEvent(outcome.ok ? 'sent' : (outcome.networkError ? 'network_error' : 'brevo_error'), {
      status: 200,
      organisationId,
      documentType,
      documentId,
      responseTimeMs: Date.now() - startedAt,
      pdfSizeBytes: estimatePdfBytes(pdfBase64),
      errorCode: outcome.ok ? undefined : (outcome.networkError ? 'network_error' : 'brevo_rejected'),
    })

    if (!outcome.ok) return json({ error: outcome.error })

    return json({ error: null, id: outcome.messageId })
  } catch (err) {
    // Filet de sécurité — callBrevo() n'est plus censé lancer d'exception
    // (les erreurs réseau y sont interceptées et renvoyées comme un échec
    // normal), mais une erreur inattendue ailleurs dans ce bloc (ex:
    // parseEmailFrom, buildBrevoPayload) doit rester journalisée et
    // renvoyée proprement plutôt que de faire planter la fonction.
    logEnvoyerEmailEvent('unexpected_error', {
      status: 200,
      organisationId,
      documentType,
      documentId,
      responseTimeMs: Date.now() - startedAt,
      errorCode: 'unexpected_error',
    })
    return json({ error: err instanceof Error ? err.message : 'Erreur envoi email' })
  }
})
