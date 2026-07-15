import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN  = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

type AuthResult =
  | { ok: true; mode: 'internal' }
  | { ok: true; mode: 'user'; callerId: string; callerOrgId: string; isAdmin: boolean }
  | { ok: false; status: 401 | 403; reason: string }

// Deux chemins d'authentification, à l'image de send-push :
//   Chemin 1 — appel serveur-à-serveur (send-reminders, autres Edge Functions)
//     via le client service_role : Authorization = Bearer <SUPABASE_SERVICE_ROLE_KEY>.
//     Ces appelants scopent déjà eux-mêmes strictement par organisation_id
//     avant d'invoquer send-telegram (cf. send-reminders/index.ts) — le
//     comparer littéralement à la clé service_role (jamais exposée à un
//     client) suffit à les distinguer d'un utilisateur authentifié normal.
//   Chemin 2 — appel frontend authentifié : Authorization = Bearer <JWT utilisateur>.
//     Le rôle et l'organisation de l'appelant sont toujours résolus côté
//     serveur depuis `profiles`, jamais déduits du body de la requête.
async function authenticate(req: Request): Promise<AuthResult> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return { ok: false, status: 401, reason: 'JWT absent' }
  const token = auth.slice('Bearer '.length)

  if (token === SUPABASE_SERVICE_KEY) return { ok: true, mode: 'internal' }

  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return { ok: false, status: 401, reason: 'JWT invalide' }

    const { data: callerProfile } = await svc.from('profiles').select('organisation_id, role').eq('id', user.id).maybeSingle()
    if (!callerProfile?.organisation_id) return { ok: false, status: 401, reason: 'Profil appelant introuvable' }

    return { ok: true, mode: 'user', callerId: user.id, callerOrgId: callerProfile.organisation_id, isAdmin: callerProfile.role === 'admin' }
  } catch {
    return { ok: false, status: 401, reason: 'Erreur de vérification du JWT' }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const requestId = crypto.randomUUID().slice(0, 8)

  const authResult = await authenticate(req)
  if (!authResult.ok) {
    console.warn(`[send-telegram][${requestId}] Requête refusée (${authResult.status}) — ${authResult.reason}`)
    return new Response(JSON.stringify({ sent: false, reason: 'unauthorized' }), {
      status: authResult.status, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Always return 200 (hors 401/403 d'auth) — Telegram must never block the caller
  try {
    const body = await req.json().catch(() => ({}))
    // chat_id peut être passé directement (bouton test admin) ou résolu via user_id
    const { user_id, message, chat_id: directChatId } = body

    console.log(`[send-telegram][${requestId}] mode: ${authResult.mode} | user_id: ${user_id ?? '(vide)'} | chat_id direct: ${directChatId ? '(fourni)' : '(vide)'}`)

    if (!message) {
      console.warn(`[send-telegram][${requestId}] message manquant`)
      return new Response(JSON.stringify({ sent: false, reason: 'params_missing' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.error(`[send-telegram][${requestId}] TELEGRAM_BOT_TOKEN absent`)
      return new Response(JSON.stringify({ sent: false, reason: 'no_token' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Chemin chat_id direct ("bouton test admin") : réservé aux admins.
    // Un utilisateur authentifié non-admin ne peut jamais cibler un chat_id
    // arbitraire — cela transformerait la fonction en relais ouvert.
    if (directChatId) {
      if (authResult.mode === 'user' && !authResult.isAdmin) {
        console.warn(`[send-telegram][${requestId}] chat_id direct refusé — appelant non-admin (${authResult.callerId})`)
        return new Response(JSON.stringify({ sent: false, reason: 'forbidden' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    let chatId: string | null = directChatId ?? null

    // Si pas de chat_id direct → résoudre via user_id depuis la DB
    if (!chatId) {
      if (!user_id) {
        console.warn(`[send-telegram][${requestId}] Ni chat_id ni user_id fournis`)
        return new Response(JSON.stringify({ sent: false, reason: 'params_missing' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      const { data: profile, error: profileErr } = await svc
        .from('profiles')
        .select('telegram_chat_id, telegram_notifications_enabled, organisation_id')
        .eq('id', user_id)
        .single()

      if (profileErr || !profile) {
        console.warn(`[send-telegram][${requestId}] Profile introuvable pour user_id: ${user_id}`)
        return new Response(JSON.stringify({ sent: false, reason: 'profile_not_found' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      // Garde cross-organisation : un appelant authentifié (mode 'user') ne
      // peut cibler qu'un destinataire de sa propre organisation. Les appels
      // internes service_role (mode 'internal') sont déjà scopés par
      // l'appelant (send-reminders, etc.) et restent inchangés.
      if (authResult.mode === 'user' && profile.organisation_id !== authResult.callerOrgId) {
        console.warn(`[send-telegram][${requestId}] Destinataire hors organisation — appelant org=${authResult.callerOrgId}, cible org=${profile.organisation_id}`)
        return new Response(JSON.stringify({ sent: false, reason: 'forbidden' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      if (!profile.telegram_chat_id) {
        console.log(`[send-telegram][${requestId}] Pas de telegram_chat_id → rien à envoyer`)
        return new Response(JSON.stringify({ sent: false, reason: 'no_chat_id' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      if (profile.telegram_notifications_enabled === false) {
        console.log(`[send-telegram][${requestId}] Notifications Telegram désactivées pour ${user_id}`)
        return new Response(JSON.stringify({ sent: false, reason: 'disabled' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      chatId = profile.telegram_chat_id
    }

    console.log(`[send-telegram][${requestId}] Envoi vers chat_id: ${chatId}`)
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const resp = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: false,
      }),
    })

    const result = await resp.json()
    console.log(`[send-telegram][${requestId}] Telegram API → ok: ${result.ok}, status: ${resp.status}`)

    if (!result.ok) {
      console.error(`[send-telegram][${requestId}] Telegram error: ${result.description ?? 'inconnue'}`)
    }

    return new Response(JSON.stringify({ sent: result.ok, telegram_status: resp.status }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(`[send-telegram][${requestId}] ERREUR GLOBALE:`, err)
    return new Response(JSON.stringify({ sent: false, error: String(err) }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
