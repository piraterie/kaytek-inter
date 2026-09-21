// src/pages/googleAds/ui.tsx — petites briques d'affichage partagées par les
// blocs de la page Google Ads (aucune logique métier, aucun appel réseau).
import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { deltaLabel, deltaDirection, type Delta } from '@/lib/googleAdsMetrics'
import { campaignStatusInfo, type StatusTone } from '@/lib/googleAdsBreakdowns'

/** Bloc de page façon Google Ads : titre de section + contenu. */
export function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="gads-section" aria-labelledby={`gads-${id}`}>
      <div className="gads-section-head">
        <h2 id={`gads-${id}`} className="gads-h2">{title}</h2>
        {aside != null && <span className="gads-aside">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** Variation vs période précédente : vert = favorable, rouge = défavorable, gris = neutre/stable. */
export function DeltaPill({ delta, fmtAbs, tone, unit }: { delta: Delta; fmtAbs: (n: number) => string; tone: 'goodUp' | 'goodDown' | 'neutral'; unit?: string }) {
  const label = deltaLabel(delta, fmtAbs, unit)
  if (!label) return null
  const dir = deltaDirection(delta)
  const good = tone === 'neutral' || dir === 'flat' ? null : (tone === 'goodUp') === (dir === 'up')
  const cls = good === null ? '' : good ? 'up' : 'down'
  const title = delta.kind === 'abs'
    ? 'Variation trop forte (ou base trop faible) pour un pourcentage lisible — écart en valeur absolue'
    : delta.kind === 'new' ? 'Aucune activité sur la période précédente' : 'Évolution par rapport à la période précédente'
  return (
    <span className={`gads-delta ${cls}`} title={title}>
      {dir === 'up' ? <TrendingUp size={11} /> : dir === 'down' ? <TrendingDown size={11} /> : null}
      {label}
    </span>
  )
}

const TONE_CLASS: Record<StatusTone, string> = { green: 'pill-green', amber: 'pill-amber', grey: 'pill-gray' }

/** Statut RÉEL de la campagne dans Google Ads (jamais déduit de l'activité). */
export function StatusPill({ status }: { status: string | null }) {
  const { label, tone } = campaignStatusInfo(status)
  return <span className={`pill ${TONE_CLASS[tone]}`} style={{ whiteSpace: 'nowrap' }}>{label}</span>
}
