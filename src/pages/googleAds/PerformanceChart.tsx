// src/pages/googleAds/PerformanceChart.tsx — « Performances » : un indicateur à
// la fois façon appli analytics. Par défaut « Clics & impressions » : les clics
// (courbe pleine, axe gauche) dominent, les impressions (fine, axe droit) donnent
// le contexte. Affichage pur des séries journalières déjà calculées.
import { useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { BarChart3, Loader2 } from 'lucide-react'
import { fmtInt, fmtConv, fmtEurMicros, fmtCompact, formatDayLong, type DailyPoint, type KpiData } from '@/lib/googleAdsMetrics'
import { Section, DeltaPill } from './ui'

type Mode = 'traffic' | 'cost' | 'conversions'
const MODES: { key: Mode; label: string }[] = [
  { key: 'traffic', label: 'Trafic' },
  { key: 'cost', label: 'Dépenses' },
  { key: 'conversions', label: 'Conversions' },
]

// Couleurs de série : identiques en thème clair et sombre (contrastes vérifiés sur les deux).
const C = { clicks: '#3b82f6', impressions: '#94a3b8', cost: '#f59e0b', conversions: '#22c55e', tick: '#94a3b8', grid: 'rgba(148,163,184,.25)' }

function ChartTip({ active, payload, mode }: { active?: boolean; payload?: { payload: DailyPoint }[]; mode: Mode }) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  const rows: { color: string; label: string; value: string }[] =
    mode === 'traffic' ? [
      { color: C.clicks, label: 'Clics', value: fmtInt(p.clicks) },
      { color: C.impressions, label: 'Impressions', value: fmtInt(p.impressions) },
    ] : mode === 'cost' ? [
      { color: C.cost, label: 'Dépenses', value: fmtEurMicros(p.cost * 1_000_000) },
    ] : [
      { color: C.conversions, label: 'Conversions', value: fmtConv(p.conversions) },
    ]
  return (
    <div className="gads-tip">
      <div className="gads-tip-date">{formatDayLong(p.iso)}</div>
      {rows.map((r) => (
        <div key={r.label} className="gads-tip-row"><span><i style={{ background: r.color }} />{r.label}</span><strong>{r.value}</strong></div>
      ))}
    </div>
  )
}

export function PerformanceChart({ series, kpis, loading }: { series: DailyPoint[]; kpis: KpiData[]; loading: boolean }) {
  const [mode, setMode] = useState<Mode>('traffic')
  const kpi = (k: KpiData['key']) => kpis.find((x) => x.key === k)!
  const head = mode === 'traffic' ? { k: kpi('clicks'), unit: 'clics' } : mode === 'cost' ? { k: kpi('spend'), unit: 'dépensés' } : { k: kpi('conversions'), unit: 'conversions' }
  const color = mode === 'traffic' ? C.clicks : mode === 'cost' ? C.cost : C.conversions
  const dataKey = mode === 'traffic' ? 'clicks' : mode === 'cost' ? 'cost' : 'conversions'
  const tickFmt = (v: number) => (mode === 'cost' ? `${fmtCompact(v)} €` : fmtCompact(v))

  return (
    <Section id="performance" title="Performances">
      <div className="card gads-chart">
        <div className="gads-chart-top">
          <div>
            <div className="gads-headline">
              <span className="gads-headline-value">{loading ? <span className="gads-skel" style={{ width: 90 }} /> : head.k.value}</span>
              <span className="gads-headline-label">{head.unit}</span>
              {!loading && <DeltaPill delta={head.k.delta} fmtAbs={head.k.fmtAbs} tone={head.k.tone} />}
            </div>
            {mode === 'traffic' && (
              <div className="gads-legend">
                <span><i style={{ background: C.clicks }} />Clics</span>
                <span><i style={{ background: C.impressions }} />Impressions (axe de droite)</span>
              </div>
            )}
          </div>
          <div className="gads-seg compact" role="group" aria-label="Indicateur du graphique">
            {MODES.map((m) => (
              <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="gads-empty"><Loader2 className="spin" size={20} /></div>
        ) : series.length === 0 ? (
          <div className="gads-empty">
            <BarChart3 size={22} style={{ color: 'var(--t3)' }} />
            Aucune donnée pour cette période — synchronisez pour récupérer les métriques.
          </div>
        ) : (
          <div className="gads-chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`gadsFill-${mode}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: C.tick }} minTickGap={28} />
                <YAxis yAxisId="l" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: C.tick }} allowDecimals={false} tickFormatter={tickFmt} />
                {mode === 'traffic' && (
                  <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: C.tick }} allowDecimals={false} tickFormatter={fmtCompact} />
                )}
                <Tooltip cursor={{ stroke: C.tick, strokeDasharray: '3 3' }} content={(p) => <ChartTip active={p.active} payload={p.payload as unknown as { payload: DailyPoint }[]} mode={mode} />} />
                {mode === 'traffic' && (
                  <Line yAxisId="r" type="monotone" dataKey="impressions" stroke={C.impressions} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                )}
                <Area yAxisId="l" type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill={`url(#gadsFill-${mode})`} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Section>
  )
}
