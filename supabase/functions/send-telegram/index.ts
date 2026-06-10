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

async function requireAuth(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error } = await client.auth.getUser()
    return !error && !!user
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const authed = await requireAuth(req)
  if (!authed) {
    return new Response(JSON.stringify({ sent: false, reason: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const requestId = crypto.randomUUID().slice(0, 8)

  // Always return 200 — Telegram must never block the caller
  try {
    const body = await req.json().catch(() => ({}))
    // chat_id peut être passé directement (bouton test admin) ou résolu via user_id
    const { user_id, message, chat_id: directChatId } = body

    console.log(`[send-telegram][${requestId}] user_id: ${user_id ?? '(vide)'} | chat_id direct: ${directChatId ?? '(vide)'}`)

    if (!message) {
      console.warn(`[send-telegram][${requestId}] message manquant`)
      return new Response(JSON.stringify({ sent: false, reason: 'params_missing' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.error(`[send-telegram][${requestId}] TELEGRAM_BOT_TOKEN absent`)
      return new Response(JSON.stringify({ sent: false, reason: 'no_token' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    let chatId: string | null = directChatId ?? null

    // Si pas de chat_id direct → résoudre via user_id depuis la DB
    if (!chatId) {
      if (!user_id) {
        console.warn(`[send-telegram][${requestId}] Ni chat_id ni user_id fournis`)
        return new Response(JSON.stringify({ sent: false, reason: 'params_missing' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: profile, error: profileErr } = await sb
        .from('profiles')
        .select('telegram_chat_id, telegram_notifications_enabled')
        .eq('id', user_id)
        .single()

      if (profileErr || !profile) {
        console.warn(`[send-telegram][${requestId}] Profile introuvable pour user_id: ${user_id}`)
        return new Response(JSON.stringify({ sent: false, reason: 'profile_not_found' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
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
