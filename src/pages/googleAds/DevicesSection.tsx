// src/pages/googleAds/DevicesSection.tsx — « Appareils » (google_ads_devices_daily).
// Mobile, Ordinateur, Tablette toujours listés ; autres types seulement s'ils existent.
import { useMemo, useState } from 'react'
import { Loader2, Smartphone, Monitor, Tablet, Tv, CircleHelp } from 'lucide-react'
import { aggregateDevices, toBars, type DeviceDbRow, type MetricKey } from '@/lib/googleAdsBreakdowns'
import { Section } from './ui'
import { MetricPills, BarList, StackedShare, BreakdownEmpty, zeroNote } from './BreakdownBars'

// Couleurs par type d'appareil (tokens Kaytek) : bleu mobile, vert ordinateur, ambre tablette.
const DEVICE_COLOR: Record<string, string> = { MOBILE: 'var(--bl)', DESKTOP: 'var(--gn)', TABLET: 'var(--am)' }
const deviceColor = (key: string) => DEVICE_COLOR[key] ?? 'var(--t3)'
const deviceIcon = (key: string) => {
  const Icon = key === 'MOBILE' ? Smartphone : key === 'DESKTOP' ? Monitor : key === 'TABLET' ? Tablet : key === 'CONNECTED_TV' ? Tv : CircleHelp
  return <span className="gads-brow-ico" style={{ color: deviceColor(key) }} aria-hidden="true"><Icon size={15} /></span>
}

export function DevicesSection({ rows, loading, error }: { rows: DeviceDbRow[] | undefined; loading: boolean; error: boolean }) {
  const [metric, setMetric] = useState<MetricKey>('clicks')
  const bars = useMemo(() => toBars(aggregateDevices(rows ?? []), metric), [rows, metric])
  const empty = !loading && !error && (rows?.length ?? 0) === 0

  return (
    <Section id="devices" title="Appareils">
      <div className="card gads-panel">
        {loading ? <BreakdownEmpty><Loader2 className="spin" size={20} /></BreakdownEmpty>
          : error ? <BreakdownEmpty>Impossible de charger la répartition par appareil.</BreakdownEmpty>
          : empty ? <BreakdownEmpty>Aucune donnée par appareil pour cette période.</BreakdownEmpty>
          : (
            <>
              <MetricPills value={metric} onChange={setMetric} label="Indicateur des appareils" />
              {bars.total > 0 && <StackedShare items={bars.items} colorOf={deviceColor} label="Répartition par appareil" />}
              <BarList bars={bars} metric={metric} title="Répartition par appareil" colorOf={deviceColor} iconOf={deviceIcon} />
              {bars.total === 0 && <div className="gads-panel-note">{zeroNote(metric)}</div>}
            </>
          )}
      </div>
    </Section>
  )
}
