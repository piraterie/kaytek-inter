// supabase/functions/send-reminders/index.ts
// Envoie les rappels automatiques avant les interventions planifiées.
// Déclenchement : bouton admin depuis la page Planning (JWT utilisateur).
// Le déclenchement pg_cron / secret interne multi-organisation est traité
// séparément plus tard — non activé ici.
//
// Fenêtres de rappel :
//   · 24h avant  → rappel_24h_envoye_at
//   · 2h avant   → rappel_2h_envoye_at
//   · 30 min avant → rappel_30min_envoye_at
//
// Anti-doublons : colonne *_envoye_at stocke le timestamp d'envoi.
// Si IS NOT NULL → déjà envoyé → ignoré.
//
// Scope organisation (sécurité) : la fonction ne traite JAMAIS plusieurs
// organisations dans un même appel. L'appelant doit être un admin
// authentifié (JWT) et son organisation_id est utilisé pour filtrer
// strictement toutes les interventions traitées et toutes les données
// renvoyées. Aucune fuite cross-organisation possible.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function unauthorized(message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
  )
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Authentification : JWT admin uniquement ───────────────────
  // Le chemin secret interne / pg_cron multi-organisation est
  // volontairement désactivé ici — sera traité séparément.
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return unauthorized('Authentification requise')
  }

  const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user } } = await sbAnon.auth.getUser()
  if (!user) {
    return unauthorized('Authentification requise')
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: profile } = await sb
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return unauthorized('Accès refusé : rôle admin requis')
  }

  const callerOrgId = profile.organisation_id
  if (!callerOrgId) {
    return unauthorized('Organisation introuvable pour cet utilisateur')
  }

  const now = new Date()
  const totalResults: { window: string; id: string; client: string }[] = []
  let totalSent = 0

  // ── Boucle sur les 3 fenêtres de rappel, strictement scopée à callerOrgId ──
  for (const win of WINDOWS) {
    const target    = new Date(now.getTime() + win.minutesBefore * 60_000)
    const rangeFrom = new Date(target.getTime() - win.bufferMin * 60_000)
    const rangeTo   = new Date(target.getTime() + win.bufferMin * 60_000)

    const { data: candidates, error } = await sb
      .from('interventions')
      .select(`
        id, numero, adresse, ville, date_prevue, statut, urgence, organisation_id,
        client:clients(nom, prenom),
        intervenant:profiles!intervenant_id(id, prenom, nom, telegram_chat_id, telegram_notifications_enabled, organisation_id)
      `)
      .eq('organisation_id', callerOrgId)
      .gte('date_prevue', rangeFrom.toISOString())
      .lte('date_prevue', rangeTo.toISOString())
      .is(win.key, null)
      .not('statut', 'in', '(annule,refuse,termine,facture)')

    if (error) {
      console.error(`[send-reminders][${win.label}] Erreur DB:`, error.message)
      continue
    }

    if (!candidates?.length) continue

    // Réservation atomique anti-doublon : seules les lignes encore à NULL
    // au moment de cet UPDATE sont réellement "gagnées" par cet appel — un
    // appel concurrent (double-clic, overlap) qui aurait lu les mêmes
    // candidates ne pourra plus les revendiquer une fois marquées ici,
    // AVANT tout envoi Telegram/push/notification (pas après).
    const candidateIds = candidates.map(c => c.id)
    const { data: claimed, error: claimError } = await sb
      .from('interventions')
      .update({ [win.key]: now.toISOString() })
      .in('id', candidateIds)
      .eq('organisation_id', callerOrgId)
      .is(win.key, null)
      .select('id')

    if (claimError) {
      console.error(`[send-reminders][${win.label}] Erreur réservation:`, claimError.message)
      continue
    }
    if (!claimed?.length) continue

    const claimedIds = new Set(claimed.map(c => c.id))
    const interventions = candidates.filter(c => claimedIds.has(c.id))

    for (const iv of interventions) {
      // Garde-fou supplémentaire : ignore toute ligne qui ne serait pas
      // dans l'organisation de l'appelant (ne devrait jamais arriver
      // vu le filtre ci-dessus, mais on ne fait jamais confiance
      // aveuglément à une seule couche de filtrage).
      if (iv.organisation_id !== callerOrgId) continue

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
          organisation_id: callerOrgId,
        })
      }

      // ── Notifier les admins de la même organisation (uniquement) ──
      const { data: admins } = await sb
        .from('profiles')
        .select('id, telegram_chat_id, telegram_notifications_enabled, organisation_id')
        .eq('role', 'admin')
        .eq('organisation_id', callerOrgId)

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
          organisation_id: callerOrgId,
        })
      }

      // Déjà marqué envoyé lors de la réservation atomique ci-dessus —
      // plus besoin d'un second UPDATE ici (c'était l'origine de la
      // condition de course : marquer APRÈS l'envoi laissait une fenêtre
      // où un appel concurrent pouvait relire la même ligne à NULL).
      totalSent++
      totalResults.push({ window: win.label, id: iv.id, client: clientName })
    }
  }

  return new Response(
    JSON.stringify({ sent: totalSent, results: totalResults }),
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
