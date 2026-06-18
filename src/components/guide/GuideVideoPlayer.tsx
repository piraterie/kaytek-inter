// src/components/guide/GuideVideoPlayer.tsx
// Lecteur vidéo avec détection automatique de complétion à 80 %.
import { useRef, useState, useEffect } from 'react'
import { useGuideVideoUrl } from '@/lib/hooks/guide'
import type { GuideVideo } from '@/types'

interface Props {
  video: GuideVideo | undefined
  sectionSlug: string
  onComplete?: () => void
}

export default function GuideVideoPlayer({ video, sectionSlug, onComplete }: Props) {
  const { data: url, isLoading } = useGuideVideoUrl(video?.storage_path)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(false)

  // Réinitialiser quand la section change
  useEffect(() => { setCompleted(false); setError(false) }, [sectionSlug])

  function handleTimeUpdate() {
    const v = videoRef.current
    if (!v || completed || !v.duration || v.duration === Infinity) return
    if (v.currentTime / v.duration >= 0.8) {
      setCompleted(true)
      onComplete?.()
    }
  }

  // Placeholder si pas encore de vidéo
  if (!video || !video.actif) {
    return (
      <div style={{
        background: 'var(--s1)', border: '2px dashed var(--b1)',
        borderRadius: 12, padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🎬</div>
        <div style={{ color: 'var(--t1)', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
          Vidéo bientôt disponible
        </div>
        <div style={{ color: 'var(--t3)', fontSize: 12 }}>
          Cette vidéo sera bientôt disponible.
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={{
        background: 'var(--s1)', borderRadius: 12, padding: 32, textAlign: 'center',
      }}>
        <div style={{ color: 'var(--t3)', fontSize: 13 }}>Chargement de la vidéo…</div>
      </div>
    )
  }

  if (!url || error) {
    return (
      <div style={{
        background: 'var(--s1)', border: '2px dashed var(--b1)',
        borderRadius: 12, padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: 'var(--t1)', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
          Vidéo temporairement indisponible
        </div>
        <div style={{ color: 'var(--t3)', fontSize: 12 }}>Réessayez dans quelques instants.</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onError={() => setError(true)}
        style={{ width: '100%', display: 'block', maxHeight: 480, background: '#000' }}
      />
      {completed && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'var(--gn)', color: '#fff',
          borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          ✓ Vu
        </div>
      )}
      {video.duree_secondes && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,.7)', color: '#fff',
          borderRadius: 8, padding: '3px 8px', fontSize: 11,
        }}>
          {Math.floor(video.duree_secondes / 60)}:{String(video.duree_secondes % 60).padStart(2, '0')}
        </div>
      )}
    </div>
  )
}
