// supabase/functions/google-oauth-disconnect/index.ts — Phase 2
//
// Déconnecte le compte Google (Ads ou Business Profile) de l'organisation
// de l'administrateur appelant. Organisation TOUJOURS dérivée de
// auth.uid() — un organisation_id envoyé par le client n'est jamais lu.
//
// La logique (dont la règle de révocation de l'autorisation Google, qui ne
// doit jamais casser un autre service ni une autre organisation utilisant le
// même compte Google) vit dans _shared/google-disconnect.ts.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  corsHeaders, respond, requireActiveAdmin, serviceClient, isValidProvider,
} from '../_shared/google-oauth.ts'
import { disconnectGoogleService } from '../_shared/google-disconnect.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Méthode non autorisée' }, 405)

  const auth = await requireActiveAdmin(req)
  if (!auth.ok) return respond({ error: auth.error }, auth.status)

  let body: { provider?: string }
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'JSON invalide' }, 400)
  }
  const { provider } = body
  if (!isValidProvider(provider)) {
    return respond({ error: "provider invalide — attendu 'google_ads' ou 'google_business'" }, 400)
  }

  const result = await disconnectGoogleService({ svc: serviceClient() }, provider, auth.organisationId)
  if (!result.ok) return respond({ error: result.error }, 500)

  // grant_revoked / reason : informatifs (le client actuel les ignore) — permettent de
  // vérifier en production que l'autorisation Google n'est pas révoquée à tort.
  return respond({ ok: true, status: result.status, grant_revoked: result.grantRevoked, reason: result.reason })
})
