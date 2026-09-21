// src/pages/googleAds/CampaignsSection.tsx — « Campagnes » : cartes lisibles sur
// mobile / petite largeur, tableau complet quand la place le permet (le choix se
// fait sur la largeur du bloc, voir styles.ts). Tri, recherche et filtre de statut
// sont de l'état d'affichage local ; le calcul reste dans googleAdsMetrics.ts.
import { useMemo, useState } from 'react'
import { Search, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'
import {
  filterSortCampaigns, sharePct, fmtInt, fmtConv, fmtPct, fmtEurMicros, ctrPct, costPerConvMicros,
  type CampaignRow, type SortKey, type SortDir, type StatusFilter,
} from '@/lib/googleAdsMetrics'
import { Section, StatusPill } from './ui'

const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'costMicros', label: 'Dépenses', defaultDir: 'desc' },
  { key: 'impressions', label: 'Impressions', defaultDir: 'desc' },
  { key: 'clicks', label: 'Clics', defaultDir: 'desc' },
  { key: 'ctr', label: 'CTR', defaultDir: 'desc' },
  { key: 'conversions', label: 'Conversions', defaultDir: 'desc' },
  { key: 'costPerConv', label: 'Coût/conv.', defaultDir: 'asc' },
  { key: 'name', label: 'Nom', defaultDir: 'asc' },
  { key: 'status', label: 'Statut', defaultDir: 'desc' },
]
const defaultDirFor = (key: SortKey): SortDir => SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 'desc'

export function CampaignsSection({ campaigns }: { campaigns: CampaignRow[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('costMicros')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const visible = useMemo(() => filterSortCampaigns(campaigns, { query, status, sortKey, sortDir }), [campaigns, query, status, sortKey, sortDir])
  const totalSpend = useMemo(() => campaigns.reduce((s, c) => s + c.costMicros, 0), [campaigns])
  const totals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 }
    for (const c of visible) { t.impressions += c.impressions; t.clicks += c.clicks; t.costMicros += c.costMicros; t.conversions += c.conversions }
    return { ...t, ctr: ctrPct(t.clicks, t.impressions), costPerConv: costPerConvMicros(t.costMicros, t.conversions) }
  }, [visible])
  const count = (st: string) => campaigns.filter((c) => c.status === st).length
  const filtersActive = query.trim() !== '' || status !== 'all'

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(defaultDirFor(key)) }
  }
  const reset = () => { setQuery(''); setStatus('all') }

  const aside = campaigns.length === 0 ? null
    : filtersActive ? `${visible.length} sur ${campaigns.length} campagne${campaigns.length > 1 ? 's' : ''}`
    : `${campaigns.length} campagne${campaigns.length > 1 ? 's' : ''}`

  if (campaigns.length === 0) {
    return (
      <Section id="campaigns" title="Campagnes">
        <div className="card"><div className="gads-empty">Aucune campagne sur cette période.</div></div>
      </Section>
    )
  }

  const chips: { key: StatusFilter; label: string; n: number }[] = [
    { key: 'all', label: 'Toutes', n: campaigns.length },
    { key: 'enabled', label: 'Actives', n: count('ENABLED') },
    { key: 'paused', label: 'En pause', n: count('PAUSED') },
    { key: 'removed', label: 'Supprimées', n: count('REMOVED') },
  ].filter((c) => c.key === 'all' || c.n > 0 || status === c.key) as { key: StatusFilter; label: string; n: number }[]
  const sortIcon = (key: SortKey) => key !== sortKey
    ? <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
    : sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => (key !== sortKey ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending')
  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th aria-sort={ariaSort(key)} style={{ textAlign: align }}>
      <button type="button" className="gads-th-btn" onClick={() => toggleSort(key)}>{label} {sortIcon(key)}</button>
    </th>
  )

  return (
    <Section id="campaigns" title="Campagnes" aside={aside}>
      <div className="card gads-camp">
        <div className="gads-toolbar">
          <div className="gads-toolbar-row">
            <div className="gads-search">
              <Search size={15} />
              <input type="search" aria-label="Rechercher une campagne" placeholder="Rechercher une campagne" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="gads-toolbar-row">
            <div className="gads-chips" role="group" aria-label="Filtrer par statut">
              {chips.map((c) => (
                <button key={c.key} type="button" className="gads-chip" aria-pressed={status === c.key} onClick={() => setStatus(c.key)}>
                  {c.label} <span className="n">{c.n}</span>
                </button>
              ))}
            </div>
            {filtersActive && <button className="btn-secondary btn-sm" onClick={reset}>Réinitialiser</button>}
            <select className="gads-sortsel" aria-label="Trier les campagnes" value={sortKey} onChange={(e) => { const k = e.target.value as SortKey; setSortKey(k); setSortDir(defaultDirFor(k)) }}>
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Trier : {o.label}</option>)}
            </select>
            <button type="button" className="btn-secondary gads-sortdir" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              aria-label={sortDir === 'asc' ? 'Ordre croissant — cliquer pour inverser' : 'Ordre décroissant — cliquer pour inverser'}>
              {sortDir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="gads-empty">Aucune campagne ne correspond à ces filtres.</div>
        ) : (
          <>
            <div className="gads-table">
              <table>
                <thead>
                  <tr>
                    {th('name', 'Campagne', 'left')}
                    {th('status', 'Statut', 'left')}
                    {th('impressions', 'Impressions')}
                    {th('clicks', 'Clics')}
                    {th('ctr', 'CTR')}
                    {th('costMicros', 'Dépenses')}
                    {th('conversions', 'Conversions')}
                    {th('costPerConv', 'Coût/conv.')}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id}>
                      {/* Nom complet, à la ligne si besoin — jamais tronqué. */}
                      <td style={{ minWidth: 160, maxWidth: 340, wordBreak: 'break-word', fontWeight: 600 }}>{c.name}</td>
                      <td><StatusPill status={c.status} /></td>
                      <td className="gads-num">{fmtInt(c.impressions)}</td>
                      <td className="gads-num">{fmtInt(c.clicks)}</td>
                      <td className="gads-num">{fmtPct(c.ctr)}</td>
                      <td className="gads-num gads-strong">{fmtEurMicros(c.costMicros)}</td>
                      <td className="gads-num">{fmtConv(c.conversions)}</td>
                      <td className="gads-num">{fmtEurMicros(c.costPerConv)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>{filtersActive ? 'Total affiché' : 'Total'}</td>
                    <td className="gads-num">{fmtInt(totals.impressions)}</td>
                    <td className="gads-num">{fmtInt(totals.clicks)}</td>
                    <td className="gads-num">{fmtPct(totals.ctr)}</td>
                    <td className="gads-num">{fmtEurMicros(totals.costMicros)}</td>
                    <td className="gads-num">{fmtConv(totals.conversions)}</td>
                    <td className="gads-num">{fmtEurMicros(totals.costPerConv)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="gads-cards">
              {visible.map((c) => {
                const share = sharePct(c.costMicros, totalSpend)
                // Campagne sans aucune activité sur la période : ligne compacte (aucune donnée retirée : tout vaut 0).
                if (c.impressions === 0 && c.clicks === 0 && c.costMicros === 0 && c.conversions === 0) {
                  return (
                    <div key={c.id} className="gads-card idle">
                      <div className="gads-card-head">
                        <div className="gads-card-name">{c.name}</div>
                        <StatusPill status={c.status} />
                      </div>
                      <div className="gads-idle-cap">Aucune activité sur la période</div>
                    </div>
                  )
                }
                return (
                  <div key={c.id} className="gads-card">
                    <div className="gads-card-head">
                      <div className="gads-card-name">{c.name}</div>
                      <StatusPill status={c.status} />
                    </div>
                    <div className="gads-card-main">
                      <div><div className="l">Dépenses</div><div className="v">{fmtEurMicros(c.costMicros)}</div></div>
                      <div><div className="l">Clics</div><div className="v">{fmtInt(c.clicks)}</div></div>
                      <div><div className="l">Conversions</div><div className="v">{fmtConv(c.conversions)}</div></div>
                    </div>
                    <div className="gads-bar" role="img" aria-label={`${Math.round(share)} % des dépenses`}><i style={{ width: `${share}%` }} /></div>
                    <div className="gads-bar-cap">{Math.round(share)} % des dépenses</div>
                    <div className="gads-card-sub">
                      <div><div className="l">Impressions</div><div className="v">{fmtInt(c.impressions)}</div></div>
                      <div><div className="l">CTR</div><div className="v">{fmtPct(c.ctr)}</div></div>
                      <div><div className="l">Coût/conv.</div><div className="v">{fmtEurMicros(c.costPerConv)}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="gads-foot-note">
          Le statut est celui de la campagne dans Google Ads. Les chiffres portent sur la période sélectionnée.
        </div>
      </div>
    </Section>
  )
}
