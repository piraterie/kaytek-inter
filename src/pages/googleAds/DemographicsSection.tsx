// src/pages/googleAds/DemographicsSection.tsx — « Données démographiques »
// (google_ads_demographics_daily). Âge et sexe sont deux répartitions INDÉPENDANTES :
// l'API Google Ads ne permet pas de les croiser, donc « Âge et sexe » les affiche l'une
// sous l'autre, jamais combinées. « Inconnu » (non déterminé par Google) est conservé.
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { aggregateDemographics, toBars, type DemographicDbRow, type MetricKey } from '@/lib/googleAdsBreakdowns'
import { Section } from './ui'
import { MetricPills, SubTabs, BarList, BreakdownEmpty, zeroNote } from './BreakdownBars'

type View = 'age' | 'gender' | 'both'
const VIEWS: { key: View; label: string }[] = [
  { key: 'age', label: 'Âge' },
  { key: 'gender', label: 'Sexe' },
  { key: 'both', label: 'Âge et sexe' },
]

export function DemographicsSection({ rows, loading, error }: { rows: DemographicDbRow[] | undefined; loading: boolean; error: boolean }) {
  const [view, setView] = useState<View>('age')
  const [metric, setMetric] = useState<MetricKey>('impressions')
  const age = useMemo(() => toBars(aggregateDemographics(rows ?? [], 'age_range'), metric), [rows, metric])
  const gender = useMemo(() => toBars(aggregateDemographics(rows ?? [], 'gender'), metric), [rows, metric])
  const empty = !loading && !error && (rows?.length ?? 0) === 0
  const zero = view === 'age' ? age.total === 0 : view === 'gender' ? gender.total === 0 : age.total === 0 && gender.total === 0

  return (
    <Section id="demographics" title="Données démographiques">
      <div className="card gads-panel">
        {loading ? <BreakdownEmpty><Loader2 className="spin" size={20} /></BreakdownEmpty>
          : error ? <BreakdownEmpty>Impossible de charger les données démographiques.</BreakdownEmpty>
          : empty ? <BreakdownEmpty>Aucune donnée démographique pour cette période.</BreakdownEmpty>
          : (
            <>
              <SubTabs value={view} onChange={(k) => setView(k)} options={VIEWS} label="Vue démographique" />
              <MetricPills value={metric} onChange={setMetric} label="Indicateur démographique" />
              {view === 'both' && (
                <div className="gads-panel-note gads-note-top">Deux répartitions <strong>indépendantes</strong> : Google Ads ne permet pas de croiser l'âge et le sexe.</div>
              )}
              <div className={view === 'both' ? 'gads-split' : undefined}>
                {view !== 'gender' && (
                  <div className={view === 'both' ? 'gads-subcard' : undefined}>
                    {view === 'both' && <div className="gads-subcard-title">Par âge</div>}
                    <BarList bars={age} metric={metric} title="Répartition par âge" />
                  </div>
                )}
                {view !== 'age' && (
                  <div className={view === 'both' ? 'gads-subcard alt' : undefined}>
                    {view === 'both' && <div className="gads-subcard-title">Par sexe</div>}
                    <BarList bars={gender} metric={metric} title="Répartition par sexe" colorOf={view === 'both' ? () => 'var(--pu, #8b5cf6)' : undefined} />
                  </div>
                )}
              </div>
              {zero && <div className="gads-panel-note">{zeroNote(metric)}</div>}
            </>
          )}
      </div>
    </Section>
  )
}
