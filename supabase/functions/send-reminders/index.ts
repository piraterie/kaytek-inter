// supabase/functions/send-reminders/index.ts
// Envoie les rappels automatiques avant les interventions planifiées.
// Déclenchement : pg_cron (toutes les 10 min) OU bouton admin depuis la page Planning.
//
// Fenêtres de rappel :
//   · 24h avant  → rappel_24h_envoye_at
//   · 2h avant   → rappel_2h_envoye_at
//   · 30 min avant → rappel_30min_envoye_at
//
// Anti-doublons : colonne *_envoye_at stocke le timestamp d'envoi.
// Si IS NOT NULL → déjà envoyé → ignoré.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const INTERNAL_PUSH_SECRET = Deno.env.get('INTERNAL_PUSH_SECRET') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

const WINDOWS = [
  {
    key:          'rappel_24h_envoye_at'   as const,
    minutesBefore: 24 * 60,
    bufferMin:     20,
    label:         '24h',
    emoji:         '📅',
  },
  {
    key:          'rappel_2h_envoye_at'    as const,
    minutesBefore: 2 * 60,
    bufferMin:     10,
    label:         '2h',
    emoji:         '⏰',
  },
  {
    key:          'rappel_30min_envoye_at' as const,
    minutesBefore: 30,
    bufferMin:     5,
    label:         '30 min',
    emoji:         '🚨',
  },
] as const

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Authentification ──────────────────────────────────────────
  // Chemin 1 : secret interne (pg_cron)
  // Chemin 2 : JWT admin (bouton frontend)
  const internalSecret = req.headers.get('x-internal-secret')
  let authorized = INTERNAL_PUSH_SECRET && internalSecret === INTERNAL_PUSH_SECRET

  if (!authorized) {
    const auth = req.headers.get('Authorization')
    if (auth?.startsWith('Bearer ')) {
      try {
        const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: auth } },
          auth: { autoRefreshToken: false, persistSession: false },
        })
        const { data: { user } } = await sbAnon.auth.getUser()
        if (user) {
          const sbSvc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
          const { data: profile } = await sbSvc
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
          authorized = profile?.role === 'admin'
        }
      } catch { /* not authorized */ }
    }
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: 'Non autorisé — rôle admin requis' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const now = new Date()
  const totalResults: { window: string; id: string; client: string }[] = []
  let totalSent = 0

  // ── Boucle sur les 3 fenêtres de rappel ───────────────────────
  for (const win of WINDOWS) {
    const target    = new Date(now.getTime() + win.minutesBefore * 60_000)
    const rangeFrom = new Date(target.getTime() - win.bufferMin * 60_000)
    const rangeTo   = new Date(target.getTime() + win.bufferMin * 60_000)

    const { data: interventions, error } = await sb
      .from('interventions')
      .select(`
        id, numero, adresse, ville, date_prevue, statut, urgence, organisation_id,
        client:clients(nom, prenom),
        intervenant:profiles!intervenant_id(id, prenom, nom, telegram_chat_id, telegram_notifications_enabled, organisation_id)
      `)
      .gte('date_prevue', rangeFrom.toISOString())
      .lte('date_prevue', rangeTo.toISOString())
      .is(win.key, null)
      .not('statut', 'in', '(annule,refuse,termine,facture)')

    if (error) {
      console.error(`[send-reminders][${win.label}] Erreur DB:`, error.message)
      continue
    }

    if (!interventions?.length) continue

    for (const iv of interventions) {
      const client = iv.client as any
      const interv = iv.intervenant as any

      const clientName = client
        ? `${client.prenom || ''} ${client.nom || ''}`.trim()
        : `Intervention ${iv.numero}`

      const heure = new Date(iv.date_prevue).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
      })

      const titre   = `${win.emoji} Rappel — ${clientName}`
      const contenu = `Intervention prévue dans ${win.label} à ${heure}${iv.adresse ? ` — ${iv.adresse}` : ''}`
      const lien    = `/interventions/${iv.id}`
      const orgId   = iv.organisation_id

      // ── Notifier l'intervenant assigné ────────────────────────
      if (interv?.id) {
        let telegramSent = false
        if (interv.telegram_chat_id && interv.telegram_notifications_enabled !== false) {
          try {
            const { data } = await sb.functions.invoke('send-telegram', {
              body: {
                user_id: interv.id,
                message: `${titre}\n${contenu}\n👉 Ouvrir l'application`,
              },
            })
            telegramSent = data?.sent === true
          } catch { /* fallback push */ }
        }
        await sb.from('notifications').insert({
          user_id:        interv.id,
          titre,
          contenu,
          type:           'alerte',
          lue:            false,
          lien,
          skip_push:      telegramSent,
          organisation_id: orgId,
        })
      }

      // ── Notifier les admins de la même organisation ────────────
      const { data: admins } = await sb
        .from('profiles')
        .select('id, telegram_chat_id, telegram_notifications_enabled, organisation_id')
        .eq('role', 'admin')
        .eq('organisation_id', orgId)

      for (const admin of admins ?? []) {
        if (admin.id === interv?.id) continue  // déjà notifié ci-dessus

        let telegramSent = false
        if (admin.telegram_chat_id && admin.telegram_notifications_enabled !== false) {
          try {
            const { data } = await sb.functions.invoke('send-telegram', {
              body: { user_id: admin.id, message: `${titre}\n${contenu}` },
            })
            telegramSent = data?.sent === true
          } catch { /* fallback */ }
        }
        await sb.from('notifications').insert({
          user_id:        admin.id,
          titre,
          contenu,
          type:           'alerte',
          lue:            false,
          lien,
          skip_push:      telegramSent,
          organisation_id: admin.organisation_id,
        })
      }

      // ── Marquer ce rappel comme envoyé ─────────────────────────
      await sb
        .from('interventions')
        .update({ [win.key]: now.toISOString() })
        .eq('id', iv.id)

      totalSent++
      totalResults.push({ window: win.label, id: iv.id, client: clientName })
    }
  }

  return new Response(
    JSON.stringify({ sent: totalSent, results: totalResults }),
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
