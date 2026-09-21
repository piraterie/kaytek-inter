// src/pages/googleAds/InsightsSection.tsx — « Tendances » : repères dérivés des
// données déjà synchronisées (meilleur jour, dépense moyenne…) et, quand il y a
// plusieurs campagnes et une période précédente, celles dont les clics varient le plus.
import { fmtInt, fmtEurMicros, formatDayLong, type InsightStats, type CampaignChange } from '@/lib/googleAdsMetrics'
import type { TodayInsights } from '@/lib/googleAdsToday'
import { Section, DeltaPill } from './ui'

export function InsightsSection({ stats, changes }: { stats: InsightStats; changes: CampaignChange[] }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: 'Dépenses moyennes / jour', value: fmtEurMicros(stats.avgCostMicros), hint: `sur ${stats.days} jour${stats.days > 1 ? 's' : ''} de données` },
    { label: 'Meilleur jour (clics)', value: stats.bestClicksDay ? fmtInt(stats.bestClicksDay.value) : '—', hint: stats.bestClicksDay ? formatDayLong(stats.bestClicksDay.iso) : undefined },
    { label: 'Jour le plus coûteux', value: stats.priciestDay ? fmtEurMicros(stats.priciestDay.costMicros) : '—', hint: stats.priciestDay ? formatDayLong(stats.priciestDay.iso) : undefined },
    { label: 'Jours avec diffusion', value: `${stats.activeDays} / ${stats.days}`, hint: 'jours avec impressions' },
  ]
  // Valeur des conversions : uniquement si elle est réellement renseignée dans les données.
  if (stats.conversionsValue > 0) items.push({ label: 'Valeur des conversions', value: fmtEurMicros(stats.conversionsValue * 1_000_000) })

  return (
    <Section id="trends" title="Tendances">
      <div className="card gads-trends">
        <div className="gads-stats">
          {items.map((it) => (
            <div key={it.label} className="gads-stat">
              <div className="l">{it.label}</div>
              <div className="v">{it.value}</div>
              {it.hint && <div className="h">{it.hint}</div>}
            </div>
          ))}
        </div>
        {changes.length > 0 && (
          <div className="gads-vars">
            <div className="gads-vars-title">Variation des clics par campagne</div>
            {changes.map((c) => (
              <div key={c.id} className="gads-var">
                <div className="gads-var-name">
                  {c.name}
                  <div className="gads-var-sub">{fmtInt(c.clicks)} clics · avant : {fmtInt(c.prevClicks)}</div>
                </div>
                <div className="gads-var-end"><DeltaPill delta={c.delta} fmtAbs={fmtInt} tone="goodUp" unit="clics" /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

const hh = (h: number) => `${String(h).padStart(2, '0')}h`

/** « Tendances » de la vue Aujourd'hui : repères horaires sur les heures déjà synchronisées. */
export function TodayInsightsSection({ stats }: { stats: TodayInsights }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: 'Dépenses moyennes / heure', value: fmtEurMicros(stats.avgCostMicrosPerHour === null ? null : Math.round(stats.avgCostMicrosPerHour)), hint: `sur ${stats.elapsedHours} heure${stats.elapsedHours > 1 ? 's' : ''} synchronisée${stats.elapsedHours > 1 ? 's' : ''}` },
    { label: 'Meilleure heure (clics)', value: stats.bestClicksHour ? fmtInt(stats.bestClicksHour.value) : '—', hint: stats.bestClicksHour ? `à ${hh(stats.bestClicksHour.hour)}` : undefined },
    { label: 'Heure la plus coûteuse', value: stats.priciestHour ? fmtEurMicros(stats.priciestHour.costMicros) : '—', hint: stats.priciestHour ? `à ${hh(stats.priciestHour.hour)}` : undefined },
    { label: 'Heures avec diffusion', value: `${stats.activeHours} / ${stats.elapsedHours}`, hint: 'heures avec impressions' },
  ]
  return (
    <Section id="trends" title="Tendances">
      <div className="card gads-trends">
        <div className="gads-stats">
          {items.map((it) => (
            <div key={it.label} className="gads-stat">
              <div className="l">{it.label}</div>
              <div className="v">{it.value}</div>
              {it.hint && <div className="h">{it.hint}</div>}
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
