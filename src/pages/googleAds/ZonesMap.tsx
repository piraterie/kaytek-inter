// src/pages/googleAds/ZonesMap.tsx — carte SVG embarquée des zones ciblées.
// Aucune tuile, aucune bibliothèque cartographique, aucune requête externe.
//  - Les cercles utilisent la latitude, la longitude et le rayon RÉELS fournis par Google
//    (échelle uniforme : un rayon de 25 km est dessiné à 25 km).
//  - Aucune coordonnée n'est inventée : les villes / codes postaux ne sont positionnés que si
//    un fournisseur de coordonnées validé est branché (voir googleAdsMap.ts).
//  - Fond : graticule + contour de la France (Natural Earth, domaine public) + échelle + nord.
import { useEffect, useMemo, useRef, useState } from 'react'
import { FRANCE_OUTLINE } from '@/lib/franceOutline'
import {
  makeProjection, viewportOfCircles, niceScaleKm, graticuleStep, graticuleValues, bubbleRadius,
  type RadiusGroup, type PresencePoint,
} from '@/lib/googleAdsMap'

const FALLBACK_WIDTH = 640
const INSET = { w: 60, h: 60 }

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(FALLBACK_WIDTH)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => { const cw = el.clientWidth; if (cw > 0) setW(Math.round(cw)) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const fmtDeg = (v: number, pos: string, neg: string) => `${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}°${v >= 0 ? pos : neg}`

export function ZonesMap({ groups, presence = [], presenceLabel }: {
  groups: RadiusGroup[]
  /** Points de présence positionnés (vide tant qu'aucun fournisseur de coordonnées validé n'existe). */
  presence?: PresencePoint[]
  presenceLabel?: string
}) {
  const [ref, width] = useWidth()
  const height = Math.max(240, Math.min(420, Math.round(width * 0.66)))

  // Formes à cadrer : cercles de rayon + éventuels points de présence (rayon 0).
  const shapes = useMemo(() => [
    ...groups.map((g) => ({ latitude: g.latitude, longitude: g.longitude, km: g.km })),
    ...presence.map((p) => ({ latitude: p.position.lat, longitude: p.position.lon, km: 0 })),
  ], [groups, presence])

  const scene = useMemo(() => {
    if (shapes.length === 0) return null
    const vp = viewportOfCircles(shapes, width < 500 ? 0.34 : 0.2)
    const proj = makeProjection(vp, width, height)
    const scaleKm = niceScaleKm(proj.pxPerKm, Math.min(110, width * 0.25))
    const step = graticuleStep(Math.max(vp.maxLat - vp.minLat, (vp.maxLon - vp.minLon) * 0.7))
    const lats = graticuleValues(vp.minLat, vp.maxLat, step)
    const lons = graticuleValues(vp.minLon, vp.maxLon, step)
    const rings = FRANCE_OUTLINE.map((ring) => ring.map(([lon, lat]) => proj.project({ lat, lon })))
    return { vp, proj, scaleKm, lats, lons, rings }
  }, [shapes, width, height])

  // Encart « France » : situe la zone à l'échelle du pays.
  const inset = useMemo(() => {
    if (shapes.length === 0) return null
    const lonMin = -5.5, lonMax = 9.8, latMin = 41.2, latMax = 51.3
    const sx = INSET.w / (lonMax - lonMin), sy = INSET.h / (latMax - latMin)
    const s = Math.min(sx * 1, sy * 1.35) // 1° de longitude ≈ 0,74° de latitude à 45° N
    const px = (lon: number) => (lon - lonMin) * s * 0.74 + 4
    const py = (lat: number) => (latMax - lat) * s + 4
    const rings = FRANCE_OUTLINE.map((ring) => ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join(' '))
    const cLat = shapes.reduce((a, g) => a + g.latitude, 0) / shapes.length
    const cLon = shapes.reduce((a, g) => a + g.longitude, 0) / shapes.length
    return { rings, dot: { x: px(cLon), y: py(cLat) } }
  }, [shapes])

  if (!scene) return null
  const { proj, scaleKm, lats, lons, rings } = scene
  const scalePx = scaleKm * proj.pxPerKm
  const maxPresence = presence.reduce((m, p) => Math.max(m, p.value), 0)
  const ariaLabel = groups.length > 0
    ? `Carte des zones ciblées : ${groups.length} rayon${groups.length > 1 ? 's' : ''}, échelle ${scaleKm} km`
    : `Carte des zones de présence, échelle ${scaleKm} km`

  return (
    <div ref={ref} className="gads-map">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        <rect x={0} y={0} width={width} height={height} className="gm-bg" />
        <g className="gm-france">
          {rings.map((ring, i) => <polygon key={i} points={ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />)}
        </g>
        <g className="gm-grid">
          {lats.map((lat) => { const y = proj.project({ lat, lon: scene.vp.minLon }).y; return y > 14 && y < height - 26 && (
            <g key={`la${lat}`}><line x1={0} x2={width} y1={y} y2={y} /><text x={width - 6} y={y - 3} textAnchor="end">{fmtDeg(lat, ' N', ' S')}</text></g>) })}
          {lons.map((lon) => { const x = proj.project({ lat: (scene.vp.minLat + scene.vp.maxLat) / 2, lon }).x; return x > 8 && x < width - 78 && (
            <g key={`lo${lon}`}><line y1={0} y2={height} x1={x} x2={x} /><text x={x + 3} y={height - 6}>{fmtDeg(lon, ' E', ' O')}</text></g>) })}
        </g>

        {groups.map((g, i) => {
          const c = proj.project({ lat: g.latitude, lon: g.longitude })
          const r = g.km * proj.pxPerKm
          return (
            <g key={g.key} className={g.active ? 'gm-zone' : 'gm-zone paused'}>
              <circle cx={c.x} cy={c.y} r={r}><title>{`Rayon de ${g.km} km — ${g.campaigns.map((x) => x.name).join(', ')}`}</title></circle>
              <circle cx={c.x} cy={c.y} r={3} className="gm-center" />
              <g transform={`translate(${c.x},${Math.max(12, c.y - r)})`}>
                <circle r={9} className="gm-badge" /><text textAnchor="middle" dy="3.5">{i + 1}</text>
              </g>
            </g>
          )
        })}

        {presence.map((p) => {
          const c = proj.project(p.position)
          return <circle key={p.id} cx={c.x} cy={c.y} r={bubbleRadius(p.value, maxPresence)} className="gm-bubble"><title>{`${p.label} — ${p.value}`}</title></circle>
        })}

        {/* Échelle (kilomètres réels) et nord */}
        <g transform={`translate(12,${height - 28})`} className="gm-scale">
          <line x1={0} x2={scalePx} y1={0} y2={0} /><line x1={0} x2={0} y1={-4} y2={4} /><line x1={scalePx} x2={scalePx} y1={-4} y2={4} />
          <text x={scalePx + 6} y={4}>{scaleKm} km</text>
        </g>
        <g transform={`translate(${width - 52},${height - 30})`} className="gm-north"><path d="M0,-12 L5,4 L0,1 L-5,4 Z" /><text y={16} textAnchor="middle">N</text></g>

        {inset && (
          <g transform={`translate(10,10)`} className="gm-inset">
            <rect width={INSET.w + 8} height={INSET.h + 8} rx={8} />
            {inset.rings.map((pts, i) => <polygon key={i} points={pts} />)}
            <circle cx={inset.dot.x} cy={inset.dot.y} r={3.5} />
          </g>
        )}
      </svg>
      {presenceLabel && <div className="gads-map-cap">{presenceLabel}</div>}
    </div>
  )
}
