// src/components/guide/GuideSectionCard.tsx — Carte d'une section du guide
import { useCompletedSlugs, useMarkSectionComplete } from '@/lib/hooks/guide'
import { useGuideVideoMap } from '@/lib/hooks/guide'
import GuideVideoPlayer from './GuideVideoPlayer'
import type { GuideSection } from '@/lib/data/guide-admin'
import type { Role } from '@/types'

interface Props {
  section: GuideSection
  role: Role
  isQuickStart?: boolean
}

export default function GuideSectionCard({ section, role, isQuickStart }: Props) {
  const completed = useCompletedSlugs()
  const mark      = useMarkSectionComplete()
  const videoMap  = useGuideVideoMap(role)
  const video     = videoMap.get(section.video_slug)
  const isDone    = completed.has(section.slug)

  function handleMarkDone() {
    if (!isDone) mark.mutate(section.slug)
  }

  return (
    <div>
      {/* En-tête section */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: isQuickStart ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'var(--blBg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          {isQuickStart ? '🚀' : '📖'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--t0)', margin: 0 }}>{section.titre}</h2>
            {isDone && (
              <span style={{
                background: 'var(--gnBg)', color: 'var(--gnTx)',
                borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
              }}>✓ Vu</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--t2)', margin: '4px 0 0' }}>{section.objectif}</p>
        </div>
      </div>

      {/* Vidéo */}
      <div style={{ marginBottom: 24 }}>
        <GuideVideoPlayer
          video={video}
          sectionSlug={section.slug}
          onComplete={handleMarkDone}
        />
      </div>

      {/* Étapes */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
          Étapes
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {section.etapes.map((etape, i) => (
            <li key={i} style={{ fontSize: 14, color: 'var(--t1)', lineHeight: 1.5 }}>
              {etape}
            </li>
          ))}
        </ol>
      </div>

      {/* Métadonnées */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="pill pill-blue" style={{ fontSize: 12 }}>
          ⏱ {section.temps_moyen}
        </span>
        {video?.duree_secondes && (
          <span className="pill pill-gray" style={{ fontSize: 12 }}>
            🎬 Vidéo {Math.floor(video.duree_secondes / 60)}min{video.duree_secondes % 60 > 0 ? `${video.duree_secondes % 60}s` : ''}
          </span>
        )}
      </div>

      {/* Conseil */}
      {section.conseil && (
        <div style={{
          background: 'var(--amBg)', borderLeft: '3px solid var(--am)',
          borderRadius: '0 8px 8px 0', padding: '10px 14px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--amTx)' }}>💡 Conseil — </span>
          <span style={{ fontSize: 13, color: 'var(--t1)' }}>{section.conseil}</span>
        </div>
      )}

      {/* Bouton "Marquer comme vu" */}
      <button
        onClick={handleMarkDone}
        disabled={isDone || mark.isPending}
        className={isDone ? 'btn btn-secondary' : 'btn btn-primary'}
        style={{ gap: 8 }}
      >
        {isDone ? '✓ Section terminée' : mark.isPending ? 'Enregistrement…' : 'Marquer comme vu'}
      </button>
    </div>
  )
}
