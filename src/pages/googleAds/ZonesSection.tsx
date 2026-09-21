// src/pages/googleAds/ZonesSection.tsx — « Zones ».
//  A. « Où sont les utilisateurs » : présence réelle (google_ads_geo_daily) — ville en principal,
//     code postal en détail. Deux niveaux SÉPARÉS, jamais fusionnés.
//  B. « Zones ciblées » : rayons réels (latitude / longitude / distance) sur une carte SVG, et
//     zones nommées listées (Google ne fournit aucune coordonnée pour celles-ci).
// Aucune coordonnée de ville / code postal n'est inventée (fournisseur par défaut : aucune).
import { useMemo, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import {
  aggregateGeo, toBars, postalCoveragePct, formatMetric, type GeoDbRow, type GeoTargetInfo, type GeoItem, type MetricKey,
} from '@/lib/googleAdsBreakdowns'
import { groupRadiusZones, formatKm, formatLatLon, noCoordinatesProvider, type GeoCoordinatesProvider, type PresencePoint, type RadiusZone } from '@/lib/googleAdsMap'
import { fmtInt, fmtConv, fmtEurMicros, friendlyCampaignName } from '@/lib/googleAdsMetrics'
import type { TargetedZoneRow } from '@/lib/hooks/googleAdsData'
import { Section, StatusPill } from './ui'
import { MetricPills, SubTabs, BarList, BreakdownEmpty, zeroNote } from './BreakdownBars'
import { ZonesMap } from './ZonesMap'

type View = 'presence' | 'targeted'
const VIEWS: { key: View; label: string }[] = [
  { key: 'presence', label: 'Où sont les utilisateurs' },
  { key: 'targeted', label: 'Zones ciblées' },
]
const TOP = 8
const PRESENCE = 'LOCATION_OF_PRESENCE'
const INTEREST = 'AREA_OF_INTEREST'

const detailLine = (r: GeoItem) => `${fmtInt(r.impressions)} impr. · ${fmtInt(r.clicks)} clics · ${fmtEurMicros(r.cost_micros)} · ${fmtConv(r.conversions)} conv.`

function GeoList({ items, metric, title, names }: { items: GeoItem[]; metric: MetricKey; title: string; names: string }) {
  const [all, setAll] = useState(false)
  const sorted = useMemo(() => [...items].sort((a, b) => {
    const va = metric === 'cost' ? a.cost_micros : metric === 'impressions' ? a.impressions : metric === 'clicks' ? a.clicks : a.conversions
    const vb = metric === 'cost' ? b.cost_micros : metric === 'impressions' ? b.impressions : metric === 'clicks' ? b.clicks : b.conversions
    return vb - va || b.impressions - a.impressions || a.label.localeCompare(b.label, 'fr')
  }), [items, metric])
  const shown = all ? sorted : sorted.slice(0, TOP)
  const byKey = new Map(shown.map((i) => [String(i.geoTargetId), i]))
  const bars = useMemo(() => toBars(shown.map((i) => ({ key: String(i.geoTargetId), label: i.label, hint: i.region ?? undefined, impressions: i.impressions, clicks: i.clicks, cost_micros: i.cost_micros, conversions: i.conversions })), metric), [shown, metric])
  // La part est calculée sur TOUTES les zones (pas seulement le top affiché).
  const total = sorted.reduce((s, i) => s + (metric === 'cost' ? i.cost_micros : metric === 'impressions' ? i.impressions : metric === 'clicks' ? i.clicks : i.conversions), 0)
  const withShare = { total, items: bars.items.map((b) => ({ ...b, share: total > 0 ? (b.value / total) * 100 : 0 })) }
  return (
    <div>
      <div className="gads-subtitle">{title} <span className="gads-subtitle-n">{names}</span></div>
      <BarList bars={withShare} metric={metric} title={title} extra={(b) => detailLine(byKey.get(b.key)!)} />
      {sorted.length > TOP && (
        <button type="button" className="btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Voir moins' : `Voir tout (${sorted.length})`}
        </button>
      )}
    </div>
  )
}

function PresenceView({ rows, names, provider, metric }: { rows: GeoDbRow[]; names: Map<number, GeoTargetInfo>; provider: GeoCoordinatesProvider; metric: MetricKey }) {
  // Présence réelle si disponible ; sinon repli sur la zone d'intérêt (libellé adapté).
  const type = rows.some((r) => r.presence_type === PRESENCE) ? PRESENCE : INTEREST
  const cities = useMemo(() => aggregateGeo(rows, 'city', type, names), [rows, type, names])
  const postal = useMemo(() => aggregateGeo(rows, 'postal_code', type, names), [rows, type, names])
  const coverage = postalCoveragePct(cities, postal)
  const points: PresencePoint[] = useMemo(() => cities.flatMap((c) => {
    const pos = provider.lookup({ geoTargetId: c.geoTargetId, name: c.label, region: c.region, level: 'city' })
    const value = metric === 'cost' ? c.cost_micros : metric === 'impressions' ? c.impressions : metric === 'clicks' ? c.clicks : c.conversions
    return pos && value > 0 ? [{ id: String(c.geoTargetId), label: c.label, value, position: pos }] : []
  }), [cities, provider, metric])
  const total = cities.reduce((s, c) => s + (metric === 'cost' ? c.cost_micros : metric === 'impressions' ? c.impressions : metric === 'clicks' ? c.clicks : c.conversions), 0)

  if (cities.length === 0 && postal.length === 0) return <BreakdownEmpty>Aucune donnée de localisation pour cette période.</BreakdownEmpty>
  return (
    <>
      {points.length > 0 && <ZonesMap groups={[]} presence={points} presenceLabel={`Taille des cercles proportionnelle à : ${formatMetric(metric, total)} au total (${provider.name})`} />}
      {type === INTEREST && <div className="gads-panel-note">Localisation de présence indisponible : ce sont les zones d'intérêt (lieux recherchés) qui sont affichées.</div>}
      <GeoList items={cities} metric={metric} title="Villes" names={`${cities.length} zone${cities.length > 1 ? 's' : ''}`} />
      {postal.length > 0 && (
        <details className="gads-fold">
          <summary>Codes postaux (détail) <span className="gads-subtitle-n">{postal.length}</span></summary>
          <GeoList items={postal} metric={metric} title="Par code postal" names="" />
        </details>
      )}
      {coverage !== null && postal.length > 0 && coverage < 99 && (
        <div className="gads-panel-note">Google n'attribue pas de code postal à toutes les impressions : {Math.round(coverage)} % des impressions par ville ont un code postal.</div>
      )}
      {total === 0 && <div className="gads-panel-note">{zeroNote(metric)}</div>}
      {points.length === 0 && (
        <div className="gads-panel-note"><MapPin size={12} style={{ verticalAlign: '-2px' }} /> Google Ads ne fournit pas de coordonnées pour les villes ni les codes postaux : ils sont listés, non placés sur une carte.</div>
      )}
    </>
  )
}

type StatusView = 'all' | 'enabled' | 'paused'
const STATUS_VIEWS: { key: StatusView; label: string }[] = [
  { key: 'all', label: 'Toutes' }, { key: 'enabled', label: 'Actives' }, { key: 'paused', label: 'En pause' },
]

function TargetedView({ zones, names }: { zones: TargetedZoneRow[]; names: Map<number, GeoTargetInfo> }) {
  const [status, setStatus] = useState<StatusView>('all')
  const passes = (s: string | null) => status === 'all' || (status === 'enabled' ? s === 'ENABLED' : s === 'PAUSED')
  const radius: RadiusZone[] = useMemo(() => zones.flatMap((z) =>
    z.zone_type === 'PROXIMITY' && z.latitude != null && z.longitude != null && z.radius != null && z.radius_unit && passes(z.campaign_status)
      ? [{ id: `${z.campaign_id}:${z.criterion_id}`, latitude: Number(z.latitude), longitude: Number(z.longitude), radius: Number(z.radius), unit: z.radius_unit, campaignName: friendlyCampaignName(z.campaign_name), status: z.campaign_status }]
      : []), [zones, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupRadiusZones(radius), [radius])
  const named = useMemo(() => {
    const seen = new Map<string, { label: string; campaigns: { name: string; status: string | null }[] }>()
    for (const z of zones) {
      if (z.zone_type !== 'LOCATION' || !passes(z.campaign_status)) continue
      const info = z.geo_target_id != null ? names.get(Number(z.geo_target_id)) : undefined
      // Le libellé Google est un nom canonique (« Labege,Occitanie,France ») : on garde le nom court.
      const label = z.label?.split(',')[0]?.trim() || info?.name || info?.canonical_name?.split(',')[0] || (z.geo_target_id != null ? `Zone ${z.geo_target_id}` : 'Zone nommée')
      const e = seen.get(label) ?? { label, campaigns: [] }
      e.campaigns.push({ name: friendlyCampaignName(z.campaign_name), status: z.campaign_status })
      seen.set(label, e)
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [zones, names, status]) // eslint-disable-line react-hooks/exhaustive-deps
  // Toutes les zones nommées visent les mêmes campagnes : une seule liste de campagnes suffit.
  const sig = (n: { campaigns: { name: string; status: string | null }[] }) => n.campaigns.map((c) => `${c.name}|${c.status}`).sort().join(';')
  const sameCampaigns = named.length > 1 && named.every((n) => sig(n) === sig(named[0]))
  const hasStatuses = new Set(zones.map((z) => z.campaign_status)).size > 1

  if (zones.length === 0) return <BreakdownEmpty>Aucune zone ciblée synchronisée pour ce compte.</BreakdownEmpty>
  return (
    <>
      {hasStatuses && <SubTabs value={status} onChange={(k) => setStatus(k)} options={STATUS_VIEWS} label="Statut des campagnes ciblant ces zones" />}
      {groups.length > 0 && <ZonesMap groups={groups} />}
      {groups.length > 0 && (
        <ol className="gads-zlist" aria-label="Zones ciblées par rayon">
          {groups.map((g, i) => (
            <li key={g.key} className="gads-zitem">
              <span className="gads-zbadge" aria-hidden="true">{i + 1}</span>
              <div className="gads-zbody">
                <div className="gads-zhead"><strong>Rayon de {formatKm(g.km)}</strong>{g.unit === 'MILES' && <span className="gads-zmuted"> ({g.radius} mi)</span>}</div>
                <div className="gads-zmuted">{formatLatLon(g.latitude, g.longitude)}</div>
                <div className="gads-zcamps">
                  {g.campaigns.map((c, k) => <span key={k} className="gads-zcamp"><span className="gads-zcamp-name">{c.name}</span> <StatusPill status={c.status} /></span>)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {named.length > 0 && (
        <div>
          <div className="gads-subtitle">Zones nommées <span className="gads-subtitle-n">{named.length}</span></div>
          {sameCampaigns ? (
            <>
              <ul className="gads-zchips" aria-label="Zones nommées">
                {named.map((n) => <li key={n.label}>{n.label}</li>)}
              </ul>
              <div className="gads-zcamps" style={{ marginTop: 8 }}>
                {named[0].campaigns.map((c, k) => <span key={k} className="gads-zcamp"><span className="gads-zcamp-name">{c.name}</span> <StatusPill status={c.status} /></span>)}
              </div>
            </>
          ) : (
            <ul className="gads-zlist plain" aria-label="Zones nommées">
              {named.map((n) => (
                <li key={n.label} className="gads-zitem">
                  <div className="gads-zbody">
                    <div className="gads-zhead"><strong>{n.label}</strong></div>
                    <div className="gads-zcamps">{n.campaigns.map((c, k) => <span key={k} className="gads-zcamp"><span className="gads-zcamp-name">{c.name}</span> <StatusPill status={c.status} /></span>)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="gads-panel-note">Google ne fournit pas de coordonnées pour les zones nommées : elles sont listées, non dessinées.</div>
        </div>
      )}
      {groups.length === 0 && named.length === 0 && <BreakdownEmpty>Aucune zone ne correspond à ce filtre.</BreakdownEmpty>}
    </>
  )
}

export function ZonesSection({ geo, geoLoading, geoError, names, zones, zonesLoading, zonesError, provider = noCoordinatesProvider }: {
  geo: GeoDbRow[] | undefined; geoLoading: boolean; geoError: boolean
  names: Map<number, GeoTargetInfo> | undefined
  zones: TargetedZoneRow[] | undefined; zonesLoading: boolean; zonesError: boolean
  provider?: GeoCoordinatesProvider
}) {
  const [view, setView] = useState<View>('presence')
  const [metric, setMetric] = useState<MetricKey>('impressions')
  const nameMap = names ?? new Map<number, GeoTargetInfo>()
  const loading = view === 'presence' ? geoLoading : zonesLoading
  const error = view === 'presence' ? geoError : zonesError

  return (
    <Section id="zones" title="Zones">
      <div className="card gads-panel">
        <SubTabs value={view} onChange={(k) => setView(k)} options={VIEWS} label="Vue des zones" />
        <div className="gads-panel-note gads-explain">
          {view === 'presence'
            ? <><strong>Où sont les utilisateurs</strong> : d'où venaient les personnes qui ont vu vos annonces (résultats réels de diffusion).</>
            : <><strong>Zones ciblées</strong> : les zones que vos campagnes cherchent à atteindre (paramétrage), sans résultat associé.</>}
        </div>
        {view === 'presence' && <MetricPills value={metric} onChange={setMetric} label="Indicateur des zones" />}
        {loading ? <BreakdownEmpty><Loader2 className="spin" size={20} /></BreakdownEmpty>
          : error ? <BreakdownEmpty>Impossible de charger les zones.</BreakdownEmpty>
          : view === 'presence' ? <PresenceView rows={geo ?? []} names={nameMap} provider={provider} metric={metric} />
          : <TargetedView zones={zones ?? []} names={nameMap} />}
      </div>
    </Section>
  )
}
