import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── [BOOT] Vérification des secrets au démarrage ──────────────────
console.log('[send-push] BOOT — VAPID_PUBLIC_KEY présente :', !!VAPID_PUBLIC_KEY, '— longueur :', VAPID_PUBLIC_KEY?.length ?? 0)
console.log('[send-push] BOOT — VAPID_PRIVATE_KEY présente :', !!VAPID_PRIVATE_KEY, '— longueur :', VAPID_PRIVATE_KEY?.length ?? 0)
console.log('[send-push] BOOT — SUPABASE_URL :', SUPABASE_URL ?? '(vide)')
console.log('[send-push] BOOT — SERVICE_KEY présente :', !!SUPABASE_SERVICE_KEY)

try {
  webpush.setVapidDetails('mailto:castryludovic@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  console.log('[send-push] BOOT — setVapidDetails OK')
} catch (e) {
  console.error('[send-push] BOOT — setVapidDetails ERREUR :', e)
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8)
  const ts = new Date().toISOString()
  console.log(`[send-push][${requestId}] ── REQUÊTE REÇUE ${ts} — method: ${req.method}`)

  if (req.method === 'OPTIONS') {
    console.log(`[send-push][${requestId}] OPTIONS preflight → 200`)
    return new Response('ok', { headers: cors })
  }

  try {
    // ── [1] Lecture du payload ────────────────────────────────────
    let body: any
    try {
      body = await req.json()
    } catch (e) {
      console.error(`[send-push][${requestId}] [1] Impossible de parser le JSON :`, e)
      return new Response(JSON.stringify({ error: 'JSON invalide' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const { user_id, titre, contenu, lien } = body
    console.log(`[send-push][${requestId}] [1] Payload reçu — user_id: ${user_id} | titre: "${titre}" | contenu: "${contenu}" | lien: "${lien}"`)

    if (!user_id) {
      console.warn(`[send-push][${requestId}] [1] user_id manquant → 400`)
      return new Response(JSON.stringify({ error: 'user_id requis' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── [2] Connexion Supabase + lecture des souscriptions ────────
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    console.log(`[send-push][${requestId}] [2] Recherche push_subscriptions pour user_id = ${user_id}`)

    const { data: subs, error: subsErr } = await sb
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', user_id)

    if (subsErr) {
      console.error(`[send-push][${requestId}] [2] Erreur DB push_subscriptions :`, subsErr.message)
      return new Response(JSON.stringify({ error: subsErr.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    console.log(`[send-push][${requestId}] [2] Souscriptions trouvées : ${subs?.length ?? 0}`)

    if (!subs?.length) {
      console.warn(`[send-push][${requestId}] [2] Aucune souscription → rien à envoyer`)
      return new Response(JSON.stringify({ sent: 0, reason: 'no_subscriptions' }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Log les endpoints (tronqués pour confidentialité)
    subs.forEach((s, i) => {
      const endpointShort = s.endpoint?.slice(0, 60) + '…'
      console.log(`[send-push][${requestId}] [2] Sub[${i}] id=${s.id} | endpoint=${endpointShort} | p256dh=${!!s.p256dh} | auth=${!!s.auth}`)
    })

    // ── [3] Construction du payload FCM ──────────────────────────
    const notificationId = crypto.randomUUID()
    const isIntervention = !!(
      (titre && titre.toLowerCase().includes('intervention')) ||
      (lien && lien.includes('/interventions'))
    )
    // TTL court pour les interventions : si FCM ne peut pas livrer dans les 60s,
    // le message est abandonné plutôt que livré en batch au déverrouillage.
    // TTL normal pour les autres notifications (factures, messages, etc.).
    const ttl = isIntervention ? 60 : 3600
    const pushPayload = JSON.stringify({
      title:          titre   || 'Kaytek Inter',
      body:           contenu || 'Nouvelle notification',
      url:            lien    || '/',
      icon:           '/icons/icon-192.png',
      notificationId,
      timestamp:      Date.now(),
      critical:       isIntervention,
    })
    console.log(`[send-push][${requestId}] [3] isIntervention: ${isIntervention}`)
    console.log(`[send-push][${requestId}] [3] notificationId: ${notificationId}`)
    console.log(`[send-push][${requestId}] [3] urgency: high`)
    console.log(`[send-push][${requestId}] [3] TTL: ${ttl}`)
    console.log(`[send-push][${requestId}] [3] Payload FCM construit : ${pushPayload}`)

    // ── [4] Envoi Web Push ────────────────────────────────────────
    // Aucun topic ni collapse_key : chaque notification est indépendante.
    // urgency:'high' → FCM priority high → Android doit réveiller Chrome même en Doze.
    // TTL court (60s) pour interventions → pas d'accumulation sur verrouillage long.
    let sent = 0
    const toDelete: string[] = []
    const results: any[] = []

    await Promise.all(subs.map(async (s) => {
      console.log(`[send-push][${requestId}] [4] Tentative envoi → sub.id=${s.id}`)
      try {
        const result = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          pushPayload,
          { TTL: ttl, urgency: 'high' },
        )
        sent++
        console.log(`[send-push][${requestId}] [4] webpush result: ${result?.statusCode ?? 'N/A'}`)
        console.log(`[send-push][${requestId}] [4] ✅ Push envoyé — sub.id=${s.id} | statusCode=${result?.statusCode ?? 'N/A'}`)
        results.push({ id: s.id, status: 'ok', statusCode: result?.statusCode })
      } catch (err: any) {
        console.error(`[send-push][${requestId}] [4] ❌ Push ÉCHOUÉ — sub.id=${s.id} | statusCode=${err?.statusCode} | body=${err?.body} | message=${err?.message}`)
        results.push({ id: s.id, status: 'error', statusCode: err?.statusCode, body: err?.body, message: err?.message })
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          console.warn(`[send-push][${requestId}] [4] Souscription expirée (${err.statusCode}) → sera supprimée`)
          toDelete.push(s.id)
        }
        if (err?.statusCode === 401 || err?.statusCode === 403) {
          console.error(`[send-push][${requestId}] [4] ⚠️ ERREUR VAPID (${err.statusCode}) — clés incorrectes ou expirées`)
        }
      }
    }))

    // ── [5] Nettoyage souscriptions mortes ────────────────────────
    if (toDelete.length) {
      console.log(`[send-push][${requestId}] [5] Suppression de ${toDelete.length} souscription(s) expirée(s) : ${toDelete.join(', ')}`)
      await sb.from('push_subscriptions').delete().in('id', toDelete)
    }

    // ── [6] Réponse finale ────────────────────────────────────────
    const response = { sent, total: subs.length, results }
    console.log(`[send-push][${requestId}] [6] ✅ TERMINÉ — sent=${sent}/${subs.length}`)
    return new Response(JSON.stringify(response), { headers: { ...cors, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error(`[send-push][${requestId}] ERREUR GLOBALE :`, err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
