// supabase/functions/send-relances-echeance/index.ts
// Envoie les relances client (email) pour les échéances de paiement.
// Déclenchement : bouton admin (JWT), soit en lot (aucun echeance_id —
// traite toutes les échéances de l'organisation dont le décalage du jour
// correspond aux réglages), soit ciblé (echeance_id fourni depuis la page
// Impayés — "Relancer par e-mail", envoie immédiatement le type de relance
// correspondant au retard actuel, hors calendrier).
//
// Pas de pg_cron actif sur ce projet (cf. send-reminders) — même modèle de
// déclenchement manuel admin, à brancher sur une planification plus tard.
//
// Idempotence : chaque relance potentielle réserve d'abord une ligne dans
// relances_paiement (clé UNIQUE cle_idempotence = echeance_id:type:jour).
// Un INSERT qui échoue en 23505 (collision) signifie qu'elle a déjà été
// traitée aujourd'hui — on ne renvoie jamais deux fois le même e-mail pour
// la même échéance/type/jour, y compris en cas de double-clic ou de
// rechargement de page.
//
// Envoi réel : délègue à la fonction envoyer-email existante (déjà
// durcie : vérifie l'appartenance du devis à l'organisation, exige un
// Reply-To valide, envoie via Brevo). On transmet le JWT admin de
// l'appelant tel quel — envoyer-email fait sa propre vérification
// (admin OU can_create_documents+can_bypass_validation), on ne duplique
// pas cette logique ici.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

type TypeRelance = 'rappel_avant' | 'jour_echeance' | 'relance_1' | 'relance_2' | 'mise_en_demeure'

const TEMPLATES: Record<TypeRelance, { subject: string; intro: string }> = {
  rappel_avant:    { subject: 'Rappel — échéance à venir', intro: "Nous vous rappelons qu'une échéance de paiement arrive prochainement." },
  jour_echeance:    { subject: "Échéance de paiement aujourd'hui", intro: "Votre échéance de paiement arrive à échéance aujourd'hui." },
  relance_1:        { subject: 'Relance — paiement en attente', intro: "Sauf erreur de notre part, nous n'avons pas encore reçu votre paiement pour l'échéance suivante." },
  relance_2:        { subject: 'Deuxième relance — paiement toujours en attente', intro: "Malgré notre précédent message, nous n'avons toujours pas reçu votre paiement." },
  mise_en_demeure:  { subject: 'Mise en demeure — paiement impayé', intro: "Cette échéance demeure impayée malgré nos relances précédentes. Nous vous demandons de bien vouloir régulariser la situation sous les plus brefs délais." },
}

function buildEmailHtml(type: TypeRelance, vars: {
  clientNom: string; devisNumero: string; libelle: string; montantRestant: string
  dateEcheance: string; joursRetard: number; entrepriseNom: string; iban?: string | null
}) {
  const t = TEMPLATES[type]
  const retardLine = vars.joursRetard > 0 ? `<p>Retard : <strong>${vars.joursRetard} jour(s)</strong></p>` : ''
  const ibanLine = vars.iban ? `<p>IBAN : <strong>${vars.iban}</strong></p>` : ''
  return `
    <div style="font-family:sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">
      <p>Bonjour ${vars.clientNom},</p>
      <p>${t.intro}</p>
      <table style="margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Devis</td><td><strong>${vars.devisNumero}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Échéance</td><td><strong>${vars.libelle}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Montant restant dû</td><td><strong>${vars.montantRestant}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Date prévue</td><td><strong>${vars.dateEcheance}</strong></td></tr>
      </table>
      ${retardLine}
      ${ibanLine}
      <p>Pour toute question, n'hésitez pas à nous contacter en répondant à cet e-mail.</p>
      <p>Cordialement,<br/>${vars.entrepriseNom}</p>
    </div>
  `
}

function unauthorized(message: string) {
  return json({ error: message }, 401)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return unauthorized('Authentification requise')

  const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await sbAnon.auth.getUser()
  if (!user) return unauthorized('Authentification requise')

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: profile } = await sb.from('profiles').select('role, organisation_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return unauthorized('Accès refusé : rôle admin requis')

  const callerOrgId = profile.organisation_id
  if (!callerOrgId) return unauthorized('Organisation introuvable pour cet utilisateur')

  let body: { echeance_id?: string } = {}
  try { body = await req.json() } catch { /* corps vide accepté pour le mode lot */ }

  const { data: pe } = await sb
    .from('parametres_entreprise')
    .select('raison_sociale, iban, rappel_defaut_decalages, delai_impaye_jours')
    .eq('organisation_id', callerOrgId)
    .maybeSingle()
  const entrepriseNom = pe?.raison_sociale || 'Notre entreprise'
  const decalages: number[] = pe?.rappel_defaut_decalages || [-7, -3, -1, 0, 3, 7]
  const delaiImpaye = pe?.delai_impaye_jours ?? 30

  let query = sb
    .from('echeances')
    .select(`
      id, echeancier_id, devis_id, client_id, libelle, date_prevue, montant_restant, statut,
      rappel_actif, rappel_client_email, organisation_id,
      devis:devis(numero), client:clients(nom, prenom, email)
    `)
    .eq('organisation_id', callerOrgId)
    .eq('rappel_actif', true)
    .eq('rappel_client_email', true)
    .not('statut', 'in', '(paye,annule,brouillon,a_facturer)')

  if (body.echeance_id) query = query.eq('id', body.echeance_id)

  const { data: candidates, error } = await query
  if (error) return json({ error: error.message }, 500)
  if (!candidates?.length) return json({ sent: 0, results: [] })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const results: { echeance_id: string; type: TypeRelance; status: string }[] = []
  let totalSent = 0

  for (const ec of candidates as any[]) {
    if (ec.organisation_id !== callerOrgId) continue
    const client = ec.client
    if (!client?.email) { results.push({ echeance_id: ec.id, type: 'rappel_avant', status: 'ignoré (pas d\'email client)' }); continue }

    const echeanceDate = new Date(ec.date_prevue)
    echeanceDate.setHours(0, 0, 0, 0)
    const offsetJours = Math.round((today.getTime() - echeanceDate.getTime()) / 86400000)

    let type: TypeRelance | null = null
    if (body.echeance_id) {
      // Envoi manuel forcé depuis la page Impayés — type déduit du retard actuel.
      if (offsetJours >= delaiImpaye) type = 'mise_en_demeure'
      else if (offsetJours > 5) type = 'relance_2'
      else if (offsetJours > 0) type = 'relance_1'
      else if (offsetJours === 0) type = 'jour_echeance'
      else type = 'rappel_avant'
    } else if (decalages.includes(offsetJours)) {
      if (offsetJours < 0) type = 'rappel_avant'
      else if (offsetJours === 0) type = 'jour_echeance'
      else if (offsetJours <= 5) type = 'relance_1'
      else type = 'relance_2'
    } else if (offsetJours === delaiImpaye) {
      type = 'mise_en_demeure'
    }

    if (!type) continue

    const idempotencyKey = `${ec.id}:${type}:${today.toISOString().slice(0, 10)}`
    const { error: reserveError } = await sb.from('relances_paiement').insert({
      organisation_id: callerOrgId,
      client_id: ec.client_id,
      echeancier_id: ec.echeancier_id,
      echeance_id: ec.id,
      type_relance: type,
      canal: 'email',
      prevu_le: new Date().toISOString(),
      statut: 'planifie',
      destinataire: client.email,
      cle_idempotence: idempotencyKey,
      created_by: user.id,
    })
    if (reserveError) {
      // 23505 = déjà réservée aujourd'hui pour ce type -> skip silencieux (idempotence).
      if (reserveError.code === '23505') { results.push({ echeance_id: ec.id, type, status: 'déjà envoyée aujourd\'hui' }); continue }
      results.push({ echeance_id: ec.id, type, status: `erreur réservation: ${reserveError.message}` })
      continue
    }

    const clientNom = `${client.prenom || ''} ${client.nom || ''}`.trim() || 'Client'
    const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    const html = buildEmailHtml(type, {
      clientNom,
      devisNumero: (ec as any).devis?.numero || '',
      libelle: ec.libelle,
      montantRestant: eur(ec.montant_restant),
      dateEcheance: echeanceDate.toLocaleDateString('fr-FR'),
      joursRetard: Math.max(0, offsetJours),
      entrepriseNom,
      iban: pe?.iban,
    })

    const { data: sendData, error: sendError } = await sbAnon.functions.invoke('envoyer-email', {
      body: {
        to: client.email,
        subject: TEMPLATES[type].subject,
        html,
        documentType: 'devis',
        documentId: ec.devis_id,
      },
    })

    const ok = !sendError && !sendData?.error
    await sb.from('relances_paiement').update({
      statut: ok ? 'envoye' : 'echec',
      envoye_le: ok ? new Date().toISOString() : null,
      erreur_message: ok ? null : (sendData?.error || sendError?.message || 'Erreur inconnue'),
    }).eq('cle_idempotence', idempotencyKey)

    if (ok) {
      await sb.from('echeances').update({ dernier_rappel_le: new Date().toISOString() }).eq('id', ec.id)
      // Notification interne aux admins de l'organisation.
      const { data: admins } = await sb.from('profiles').select('id').eq('role', 'admin').eq('organisation_id', callerOrgId)
      for (const admin of admins ?? []) {
        await sb.from('notifications').insert({
          user_id: admin.id,
          titre: '📧 Relance envoyée',
          contenu: `${TEMPLATES[type].subject} envoyée à ${clientNom} (${(ec as any).devis?.numero})`,
          type: 'info',
          lue: false,
          lien: `/devis/${ec.devis_id}/apercu`,
          organisation_id: callerOrgId,
        })
      }
      totalSent++
    }

    results.push({ echeance_id: ec.id, type, status: ok ? 'envoyée' : 'échec' })
  }

  return json({ sent: totalSent, results })
})
