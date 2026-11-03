// supabase/functions/_shared/auth-links.ts
// Helpers communs aux e-mails d'authentification envoyés via Brevo
// (inviter-intervenant, demander-reinitialisation).
//
// Pourquoi construire nous-mêmes le lien plutôt que d'envoyer l'action_link
// renvoyé par generateLink() (https://<ref>.supabase.co/auth/v1/verify?...) :
//  1. l'action_link consomme le jeton dès le premier GET — les scanners de
//     liens des messageries (Outlook Safe Links, antivirus…) le « grillent »
//     avant que la personne ne clique, qui atterrit alors sur une erreur
//     otp_expired puis sur /login ;
//  2. sa redirection dépend du Site URL / des Redirect URLs du dashboard
//     Supabase : tout redirect_to non autorisé est remplacé par la racine du
//     Site URL, en perdant le chemin /activation.
// Le lien applicatif (/activation?token_hash=…&type=…) n'est qu'une page :
// le jeton n'est vérifié (verifyOtp) qu'à la validation du formulaire.

export type AuthLinkType = 'invite' | 'recovery'

const DEFAULT_APP_URL = 'https://app.kaytekinter.fr'

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}

function isLocalSupabase(supabaseUrl: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|kong|host\.docker\.internal)(:\d+)?/i.test(supabaseUrl)
}

// L'origine de la requête ne doit JAMAIS être reprise telle quelle dans un
// lien contenant un jeton : un appel forgé (Origin: https://attaquant.tld)
// enverrait sinon à la victime un vrai jeton pointant vers un site tiers.
// Seules les origines listées sont acceptées ; sinon APP_URL.
export function resolveAppOrigin(
  requestOrigin: string | null,
  env: { APP_URL?: string; APP_ALLOWED_ORIGINS?: string; SUPABASE_URL?: string },
): string {
  const appOrigin = originOf(env.APP_URL || DEFAULT_APP_URL) ?? DEFAULT_APP_URL
  const allowed = new Set<string>([appOrigin])
  for (const o of (env.APP_ALLOWED_ORIGINS ?? '').split(',')) {
    const parsed = originOf(o.trim())
    if (parsed) allowed.add(parsed)
  }
  const req = requestOrigin ? originOf(requestOrigin) : null
  if (!req) return appOrigin
  if (allowed.has(req)) return req
  // Pile Supabase locale (tests/dev) : on accepte le serveur Vite local.
  if (isLocalSupabase(env.SUPABASE_URL ?? '') && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req)) return req
  return appOrigin
}

export function buildAppAuthLink(origin: string, type: AuthLinkType, hashedToken: string): string {
  const path = type === 'invite' ? '/activation' : '/reset-password'
  const params = new URLSearchParams({ token_hash: hashedToken, type })
  return `${origin}${path}?${params.toString()}`
}

// Lien pour une personne invitée dont le compte auth existe déjà (renvoi
// d'invitation après activation, compte sans profil) : le jeton est de type
// recovery, mais la page affichée reste « Activer mon compte ».
export function buildActivationLinkForRecovery(origin: string, hashedToken: string): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type: 'recovery' })
  return `${origin}/activation?${params.toString()}`
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Masque une adresse pour les logs (diagnostic sans exposer l'adresse entière).
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Gabarit Kaytek Inter commun (repris de l'e-mail d'invitation existant).
// `intro` est du HTML déjà construit par l'appelant à partir de valeurs
// échappées ; `greetingName` et `ctaUrl` sont échappés ici.
export function renderAuthEmail(opts: {
  greetingName: string
  intro: string
  ctaLabel: string
  ctaUrl: string
  footnote: string
}): string {
  const name = escapeHtml(opts.greetingName.trim())
  const url = escapeHtml(opts.ctaUrl)
  return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;">
        <div style="background:#1e3a5f;padding:28px 36px;text-align:center;">
          <div style="color:#fff;font-size:20px;font-weight:700;">KAYTEK INTER</div>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;">Serrurerie · Vitrerie</div>
        </div>
        <div style="background:#e85d04;height:4px;"></div>
        <div style="padding:32px 36px;">
          <p style="font-size:15px;color:#374151;">Bonjour${name ? ` <strong>${name}</strong>` : ''},</p>
          <p style="font-size:15px;color:#374151;">${opts.intro}</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${url}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;display:inline-block;">
              ${escapeHtml(opts.ctaLabel)}
            </a>
          </div>
          <p style="font-size:12px;color:#9ca3af;text-align:center;">${escapeHtml(opts.footnote)}</p>
          <p style="font-size:11px;color:#9ca3af;text-align:center;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${url}</p>
        </div>
        <div style="background:#1e3a5f;padding:16px 36px;text-align:center;">
          <div style="color:rgba(255,255,255,0.6);font-size:11px;">Kaytek Inter · Serrurerie · Vitrerie</div>
        </div>
      </div>`
}
