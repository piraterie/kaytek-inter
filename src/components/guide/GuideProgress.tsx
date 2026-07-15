// src/components/guide/GuideProgress.tsx — Barre de progression utilisateur
import { PartyPopper } from 'lucide-react'
import { useCompletedSlugs } from '@/lib/hooks/guide'
import type { GuideSection } from '@/lib/data/guide-admin'

interface Props {
  sections: GuideSection[]
}

export default function GuideProgress({ sections }: Props) {
  const completed = useCompletedSlugs()
  const total     = sections.length
  const done      = sections.filter(s => completed.has(s.slug)).length
  const pct       = total === 0 ? 0 : Math.round((done / total) * 100)

  const color = pct === 100 ? 'var(--gn)' : pct >= 50 ? 'var(--bl)' : 'var(--am)'

  return (
    <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {pct === 100 ? <><PartyPopper size={14} /> Guide terminé !</> : 'Progression du guide'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>
          {done}/{total} · {pct}%
        </span>
      </div>

      {/* Barre de progression */}
      <div style={{
        height: 8, background: 'var(--b0)', borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: 8, transition: 'width .5s ease',
        }} />
      </div>

      {/* Points de progression */}
      {total <= 12 && (
        <div style={{
          display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap',
        }}>
          {sections.map(s => (
            <div
              key={s.slug}
              title={s.titre}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: completed.has(s.slug) ? color : 'var(--b1)',
                transition: 'background .3s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
