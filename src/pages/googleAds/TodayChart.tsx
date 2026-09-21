// src/pages/googleAds/TodayChart.tsx — vue « Aujourd'hui » : courbe horaire 00h → 23h.
// Chaque heure sans activité vaut 0 (calcul, pas une donnée inventée) ; les heures POSTÉRIEURES
// à la dernière synchronisation ne sont pas encore connues et restent vides. Hier est tracé en
// pointillés pour comparer heure par heure. Jamais « temps réel » : la fraîcheur affichée est
// l'heure de synchronisation.
import { useState } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Loader2 } from 'lucide-react'
import { fmtInt, fmtConv, fmtEurMicros, fmtCompact, type KpiData } from '@/lib/googleAdsMetrics'
import type { TodayView, HourPoint } from '@/lib/googleAdsToday'
import type { MetricKey } from '@/lib/googleAdsBreakdowns'
import { Section, DeltaPill } from './ui'
import { MetricPills } from './BreakdownBars'

const C = { today: '#3b82f6', yesterday: '#94a3b8', tick: '#94a3b8', grid: 'rgba(148,163,184,.25)' }

const valueOf = (p: HourPoint, m: MetricKey): number | null =>
  m === 'impressions' ? p.impressions : m === 'clicks' ? p.clicks : m === 'cost' ? p.cost : p.conversions

const fmtValue = (m: MetricKey, v: number | null): string =>
  v === null ? '—' : m === 'cost' ? fmtEurMicros(v * 1_000_000) : m === 'conversions' ? fmtConv(v) : fmtInt(v)

interface Row { label: string; today: number | null; yesterday: number | null; pending: boolean }

function Tip({ active, payload, metric }: { active?: boolean; payload?: { payload: Row }[]; metric: MetricKey }) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <div className="gads-tip">
      <div className="gads-tip-date">{p.label}</div>
      <div className="gads-tip-row"><span><i style={{ background: C.today }} />Aujourd'hui</span><strong>{p.pending ? 'Pas encore synchronisée' : fmtValue(metric, p.today)}</strong></div>
      <div className="gads-tip-row"><span><i style={{ background: C.yesterday }} />Hier</span><strong>{fmtValue(metric, p.yesterday)}</strong></div>
    </div>
  )
}

const HEAD: Record<MetricKey, { kpi: KpiData['key']; unit: string }> = {
  clicks: { kpi: 'clicks', unit: 'clics' }, impressions: { kpi: 'impressions', unit: 'impressions' },
  cost: { kpi: 'spend', unit: 'dépensés' }, conversions: { kpi: 'conversions', unit: 'conversions' },
}

export function TodayChart({ view, kpis, loading, syncedLabel, tzLabel }: {
  view: TodayView; kpis: KpiData[]; loading: boolean
  /** « HH:mm » de la dernière synchronisation (affichée dans « Vue d'ensemble »), null si inconnue */
  syncedLabel: string | null
  tzLabel: string
}) {
  const [metric, setMetric] = useState<MetricKey>('clicks')
  const head = HEAD[metric]
  const kpi = kpis.find((k) => k.key === head.kpi)!
  const data: Row[] = view.today.map((p, i) => ({
    label: p.label, today: valueOf(p, metric), yesterday: valueOf(view.yesterday[i], metric), pending: p.pending,
  }))
  const tickFmt = (v: number) => (metric === 'cost' ? `${fmtCompact(v)} €` : fmtCompact(v))
  const lastKnown = view.syncedHour

  return (
    <Section id="performance" title="Performances" aside={syncedLabel ? undefined : 'Heure de synchronisation inconnue'}>
      <div className="card gads-chart">
        <div className="gads-chart-top">
          <div>
            <div className="gads-headline">
              <span className="gads-headline-value">{loading ? <span className="gads-skel" style={{ width: 90 }} /> : kpi.value}</span>
              <span className="gads-headline-label">{head.unit} aujourd'hui</span>
              {!loading && <DeltaPill delta={kpi.delta} fmtAbs={kpi.fmtAbs} tone={kpi.tone} unit={kpi.absUnit} />}
            </div>
            <div className="gads-legend">
              <span><i style={{ background: C.today }} />Aujourd'hui</span>
              <span><i style={{ background: C.yesterday }} />Hier (mêmes heures)</span>
            </div>
          </div>
          <MetricPills value={metric} onChange={setMetric} label="Indicateur horaire" />
        </div>

        {loading ? (
          <div className="gads-empty"><Loader2 className="spin" size={20} /></div>
        ) : (
          <>
            <div className="gads-chart-body">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: C.tick }} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: C.tick }} allowDecimals={metric === 'cost'} tickFormatter={tickFmt} />
                  <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} content={(p) => <Tip active={p.active} payload={p.payload as unknown as { payload: Row }[]} metric={metric} />} />
                  <Line type="monotone" dataKey="yesterday" stroke={C.yesterday} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  <Bar dataKey="today" fill={C.today} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="gads-panel-note gads-chart-notes">
              <div>Fuseau horaire du compte : {tzLabel}. {lastKnown !== null
                ? `Les heures après ${String(lastKnown).padStart(2, '0')}h ne sont pas encore synchronisées.`
                : "Aucune synchronisation aujourd'hui pour l'instant."}</div>
              <div>{view.canCompare
                ? `Comparaison avec hier sur les mêmes heures (00h–${String(lastKnown).padStart(2, '0')}h, heures complètes).`
                : "Comparaison avec hier indisponible (pas encore d'heure complète, ou pas de données hier)."}</div>
              {metric === 'conversions' && <div>Google peut attribuer les conversions avec plusieurs heures de retard.</div>}
            </div>
          </>
        )}
      </div>
    </Section>
  )
}
