// supabase/functions/_shared/brevo-email.ts
// Envoi transactionnel générique via Brevo — même fournisseur/secret
// (BREVO_API_KEY, EMAIL_FROM) que supabase/functions/envoyer-email, mais
// SANS le couplage à un devis/facture existant (celui-ci reste intact,
// dédié à l'envoi de documents PDF — non modifié ici). Utilisé par les
// demandes d'avis Google (canal e-mail uniquement).
export interface SendEmailResult {
  ok: boolean
  error?: string
  messageId?: string
}

export async function sendTransactionalEmail(opts: {
  to: string
  subject: string
  html: string
  replyToEmail?: string | null
  replyToName?: string | null
}): Promise<SendEmailResult> {
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
  const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? ''

  if (!BREVO_API_KEY) return { ok: false, error: 'BREVO_API_KEY non configuré' }
  if (!EMAIL_FROM) return { ok: false, error: 'EMAIL_FROM non configuré' }

  const match = EMAIL_FROM.match(/^(.+?)\s*<(.+?)>$/)
  const senderName = match ? match[1].trim() : 'Kaytek Inter'
  const senderEmail = match ? match[2].trim() : EMAIL_FROM.trim()

  const payload: Record<string, unknown> = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: opts.to }],
    subject: opts.subject,
    htmlContent: opts.html,
    replyTo: { name: opts.replyToName || senderName, email: opts.replyToEmail || senderEmail },
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.message || 'Erreur Brevo' }
    return { ok: true, messageId: data?.messageId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur envoi email' }
  }
}
