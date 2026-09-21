// src/pages/googleAds/ui.tsx — petites briques d'affichage partagées par les
// blocs de la page Google Ads (aucune logique métier, aucun appel réseau).
import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { deltaLabel, deltaDirection, type Delta } from '@/lib/googleAdsMetrics'

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
export function DeltaPill({ delta, fmtAbs, tone }: { delta: Delta; fmtAbs: (n: number) => string; tone: 'goodUp' | 'goodDown' | 'neutral' }) {
  const label = deltaLabel(delta, fmtAbs)
  if (!label) return null
  const dir = deltaDirection(delta)
  const good = tone === 'neutral' || dir === 'flat' ? null : (tone === 'goodUp') === (dir === 'up')
  const cls = good === null ? '' : good ? 'up' : 'down'
  const title = delta.kind === 'abs'
    ? 'Période précédente trop faible pour un pourcentage fiable — écart en valeur absolue'
    : delta.kind === 'new' ? 'Aucune activité sur la période précédente' : 'Évolution par rapport à la période précédente'
  return (
    <span className={`gads-delta ${cls}`} title={title}>
      {dir === 'up' ? <TrendingUp size={11} /> : dir === 'down' ? <TrendingDown size={11} /> : null}
      {label}
    </span>
  )
}

/** Statut DÉDUIT de l'activité sur la période (la synchronisation ne récupère pas le statut Google). */
export function StatusPill({ active }: { active: boolean }) {
  return active
    ? <span className="pill pill-green">Active</span>
    : <span className="pill" style={{ background: 'var(--s2)', color: 'var(--t2)' }}>Sans activité</span>
}
