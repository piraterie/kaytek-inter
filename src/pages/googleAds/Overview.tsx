// src/pages/googleAds/Overview.tsx — « Vue d'ensemble » : carte héro (dépenses +
// tendance) puis les 6 autres indicateurs. Affichage pur : reçoit des KPI déjà calculés.
import type { ReactNode } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { Eye, MousePointerClick, Euro, Target, Percent, Coins, Calculator } from 'lucide-react'
import type { KpiData, KpiKey, DailyPoint } from '@/lib/googleAdsMetrics'
import { Section, DeltaPill } from './ui'

const ICON: Record<KpiKey, { icon: ReactNode; tone: 'blue' | 'green' | 'amber' }> = {
  spend: { icon: <Euro size={15} />, tone: 'amber' },
  impressions: { icon: <Eye size={15} />, tone: 'blue' },
  clicks: { icon: <MousePointerClick size={15} />, tone: 'green' },
  ctr: { icon: <Percent size={15} />, tone: 'blue' },
  cpc: { icon: <Coins size={15} />, tone: 'amber' },
  conversions: { icon: <Target size={15} />, tone: 'green' },
  costPerConv: { icon: <Calculator size={15} />, tone: 'blue' },
}

function KpiLabel({ kpi }: { kpi: KpiData }) {
  const { icon, tone } = ICON[kpi.key]
  return <div className="gads-kpi-label"><span className={`tone-${tone}`} style={{ display: 'inline-flex' }}>{icon}</span>{kpi.label}</div>
}

const Value = ({ loading, children }: { loading: boolean; children: ReactNode }) => (
  <div className="gads-kpi-value">{loading ? <span className="gads-skel" aria-label="Chargement" /> : children}</div>
)

export function Overview({ kpis, loading, spark }: { kpis: KpiData[]; loading: boolean; spark: DailyPoint[] }) {
  const [hero, ...rest] = kpis
  return (
    <Section id="overview" title="Vue d'ensemble">
      <div className="gads-kpis-wrap">
        <div className="gads-kpis">
          <div className="card gads-hero">
            <div className="gads-kpi" style={{ padding: 0 }}>
              <KpiLabel kpi={hero} />
              <Value loading={loading}>{hero.value}</Value>
              <div className="gads-kpi-foot">
                <DeltaPill delta={hero.delta} fmtAbs={hero.fmtAbs} tone={hero.tone} />
                <span className="gads-hero-cap">sur la période</span>
              </div>
            </div>
            {!loading && spark.length > 1 && (
              <div className="gads-spark" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={spark} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="gadsSpark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} fill="url(#gadsSpark)" dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {rest.map((k) => (
            <div key={k.key} className="card gads-kpi">
              <KpiLabel kpi={k} />
              <Value loading={loading}>{k.value}</Value>
              <div className="gads-kpi-foot"><DeltaPill delta={k.delta} fmtAbs={k.fmtAbs} tone={k.tone} /></div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
