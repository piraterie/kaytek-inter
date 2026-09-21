// src/pages/googleAds/BreakdownBars.tsx — briques partagées par Appareils, Démographie et Zones :
// pastilles de métrique et barres horizontales. Affichage pur (aucun calcul métier ici).
import type { ReactNode } from 'react'
import { METRIC_OPTIONS, formatMetric, type BarSet, type MetricKey } from '@/lib/googleAdsBreakdowns'

export function MetricPills({ value, onChange, label = 'Indicateur' }: { value: MetricKey; onChange: (k: MetricKey) => void; label?: string }) {
  return (
    <div className="gads-chips metric" role="group" aria-label={label}>
      {METRIC_OPTIONS.map((o) => (
        <button key={o.key} type="button" className="gads-chip" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  )
}

export function SubTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (k: T) => void; options: { key: T; label: string }[]; label: string }) {
  return (
    <div className="gads-seg compact" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  )
}

const pctText = (share: number) => `${share >= 10 || share === 0 ? Math.round(share) : share.toFixed(1).replace('.', ',')} %`

/** Barres horizontales : libellé + valeur + part du total ; largeur relative à la plus grande valeur. */
export function BarList({ bars, metric, title, extra, colorOf, iconOf }: {
  bars: BarSet; metric: MetricKey; title?: string
  extra?: (item: BarSet['items'][number]) => string
  /** couleur de la barre (par défaut : bleu Kaytek) */
  colorOf?: (key: string) => string | undefined
  iconOf?: (key: string) => ReactNode
}) {
  return (
    <div className="gads-bars" role="list" aria-label={title}>
      {bars.items.map((it) => (
        <div key={it.key} className="gads-brow" role="listitem">
          <div className="gads-brow-top">
            <span className="gads-brow-label">{iconOf?.(it.key)}{it.label}{it.hint && <span className="gads-brow-hint"> · {it.hint}</span>}</span>
            <span className="gads-brow-val"><strong>{formatMetric(metric, it.value)}</strong><span className="gads-brow-share">{pctText(it.share)}</span></span>
          </div>
          <div className="gads-bar" role="img" aria-label={`${it.label} : ${formatMetric(metric, it.value)}, ${pctText(it.share)} du total`}>
            <i style={{ width: `${it.value > 0 ? Math.max(it.width, 1.5) : 0}%`, background: colorOf?.(it.key) }} />
          </div>
          {extra && <div className="gads-brow-extra">{extra(it)}</div>}
        </div>
      ))}
    </div>
  )
}

export function BreakdownEmpty({ children }: { children: React.ReactNode }) {
  return <div className="gads-empty" style={{ padding: '20px 12px' }}>{children}</div>
}

const ZERO_NOTE: Record<MetricKey, string> = {
  impressions: 'Aucune impression sur la période.',
  clicks: 'Aucun clic sur la période.',
  cost: 'Aucune dépense sur la période.',
  conversions: 'Aucune conversion enregistrée sur la période (Google peut les attribuer avec plusieurs heures de retard).',
}
export const zeroNote = (m: MetricKey) => ZERO_NOTE[m]

/** Répartition en une seule barre segmentée (part de chaque catégorie dans le total). */
export function StackedShare({ items, colorOf, label }: { items: { key: string; label: string; share: number; value: number }[]; colorOf: (key: string) => string; label: string }) {
  const visible = items.filter((i) => i.value > 0)
  if (visible.length === 0) return null
  return (
    <div className="gads-stack" role="img" aria-label={`${label} : ${visible.map((i) => `${i.label} ${Math.round(i.share)} %`).join(', ')}`}>
      {visible.map((i) => <i key={i.key} style={{ width: `${i.share}%`, background: colorOf(i.key) }} />)}
    </div>
  )
}
