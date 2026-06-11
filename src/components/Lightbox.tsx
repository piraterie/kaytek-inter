// src/components/Lightbox.tsx
import { useEffect } from 'react'

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>✕</button>
      <img src={src} onClick={e => e.stopPropagation()} alt="" style={{ maxWidth: '100%', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 4px 32px rgba(0,0,0,0.5)', touchAction: 'pinch-zoom' }} />
    </div>
  )
}
