// src/components/SignatureModal.tsx
import { useRef, useEffect, useState } from 'react'

interface Props {
  onConfirm: (base64: string) => void
  onCancel: () => void
  loading?: boolean
}

export default function SignatureModal({ onConfirm, onCancel, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const isDrawing = useRef(false)
  const pts = useRef<Array<{ x: number; y: number }>>([])
  const isInited = useRef(false)

  // Verrouiller le scroll iOS/Android pendant la signature
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  function applyCtxStyle(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  function getPos(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function setupCanvas() {
    const canvas = canvasRef.current
    if (!canvas || isInited.current) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 10) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    applyCtxStyle(ctx)
    isInited.current = true
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Double rAF pour attendre le layout complet
    requestAnimationFrame(() => requestAnimationFrame(setupCanvas))

    const onStart = (x: number, y: number) => {
      if (!isInited.current) setupCanvas()
      if (!isInited.current) return
      isDrawing.current = true
      pts.current = [getPos(canvas, x, y)]
      setHasDrawn(true)
    }

    const onMove = (x: number, y: number) => {
      if (!isDrawing.current) return
      const pos = getPos(canvas, x, y)
      pts.current.push(pos)
      const ctx = canvas.getContext('2d')!
      applyCtxStyle(ctx)
      const len = pts.current.length
      if (len >= 3) {
        const p1 = pts.current[len - 3]
        const p2 = pts.current[len - 2]
        const p3 = pts.current[len - 1]
        // Bézier quadratique — trait fluide même à grande vitesse
        ctx.beginPath()
        ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
        ctx.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2)
        ctx.stroke()
      } else if (len === 2) {
        ctx.beginPath()
        ctx.moveTo(pts.current[0].x, pts.current[0].y)
        ctx.lineTo(pts.current[1].x, pts.current[1].y)
        ctx.stroke()
      }
    }

    const onEnd = () => { isDrawing.current = false }

    const md = (e: MouseEvent) => { e.preventDefault(); onStart(e.clientX, e.clientY) }
    const mm = (e: MouseEvent) => { if (e.buttons === 1) onMove(e.clientX, e.clientY) }
    const mu = () => onEnd()
    const ts = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches[0]) onStart(e.touches[0].clientX, e.touches[0].clientY)
    }
    const tm = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY)
    }
    const te = () => onEnd()

    canvas.addEventListener('mousedown', md)
    canvas.addEventListener('mousemove', mm)
    canvas.addEventListener('mouseup', mu)
    canvas.addEventListener('mouseleave', mu)
    canvas.addEventListener('touchstart', ts, { passive: false })
    canvas.addEventListener('touchmove', tm, { passive: false })
    canvas.addEventListener('touchend', te)
    canvas.addEventListener('touchcancel', te)

    return () => {
      canvas.removeEventListener('mousedown', md)
      canvas.removeEventListener('mousemove', mm)
      canvas.removeEventListener('mouseup', mu)
      canvas.removeEventListener('mouseleave', mu)
      canvas.removeEventListener('touchstart', ts)
      canvas.removeEventListener('touchmove', tm)
      canvas.removeEventListener('touchend', te)
      canvas.removeEventListener('touchcancel', te)
    }
  }, [])

  function handleClear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    pts.current = []
    isInited.current = false
    setHasDrawn(false)
    setPreview(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      isInited.current = false
      setupCanvas()
    }))
  }

  function handleConfirm() {
    const canvas = canvasRef.current!
    const dataUrl = canvas.toDataURL('image/png')
    setPreview(dataUrl)
    onConfirm(dataUrl)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15,23,42,0.94)',
      display: 'flex', flexDirection: 'column',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
    }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 20px',
        paddingTop: 'calc(18px + env(safe-area-inset-top))',
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div>
          <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, letterSpacing: '-.03em' }}>
            ✍ Signature client
          </div>
          <div style={{ color: 'rgba(255,255,255,0.48)', fontSize: 13, marginTop: 4 }}>
            {preview
              ? loading ? 'Enregistrement en cours…' : 'Signature validée'
              : 'Signez dans la zone ci-dessous'}
          </div>
        </div>
        {!loading && (
          <button
            onClick={onCancel}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff', width: 40, height: 40, borderRadius: 20,
              cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0, fontFamily: 'inherit',
            }}
          >✕</button>
        )}
      </div>

      {/* ── Zone de signature ──────────────────────────────── */}
      <div style={{
        flex: 1, padding: '16px 16px 12px',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{
          flex: 1, position: 'relative',
          background: '#fff', borderRadius: 20, overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
        }}>

          {/* Placeholder "Signez ici" */}
          {!hasDrawn && !preview && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 10, pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 52, opacity: 0.10 }}>✍</div>
              <div style={{ color: 'rgba(0,0,0,0.20)', fontSize: 17, fontWeight: 500 }}>Signez ici</div>
            </div>
          )}

          {/* Canvas — caché pendant la prévisualisation */}
          <canvas
            ref={canvasRef}
            style={{
              display: preview ? 'none' : 'block',
              width: '100%', height: '100%',
              touchAction: 'none', cursor: 'crosshair',
            }}
          />

          {/* Ligne de base indicative */}
          {!preview && (
            <div style={{
              position: 'absolute', bottom: '28%', left: '8%', right: '8%',
              height: 1, background: 'rgba(0,0,0,0.06)', pointerEvents: 'none',
            }} />
          )}

          {/* Prévisualisation après validation */}
          {preview && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 20, padding: 28,
            }}>
              <img
                src={preview} alt="Signature validée"
                style={{ maxHeight: '68%', maxWidth: '92%', objectFit: 'contain' }}
              />
              {loading ? (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: '#eff6ff', color: '#1e40af',
                  padding: '10px 22px', borderRadius: 100,
                  fontWeight: 600, fontSize: 14, border: '1px solid #bfdbfe',
                }}>
                  <div style={{ width: 14, height: 14, border: '2px solid #2563eb', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Enregistrement…
                </div>
              ) : (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#f0fdf4', color: '#15803d',
                  padding: '10px 22px', borderRadius: 100,
                  fontWeight: 700, fontSize: 14, border: '1px solid #bbf7d0',
                }}>
                  ✓ Signature validée
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Boutons d'action ───────────────────────────────── */}
      <div style={{
        padding: '0 16px',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        display: 'flex', gap: 12, flexShrink: 0,
      }}>
        {preview ? (
          !loading && (
            <button
              onClick={handleClear}
              style={{
                flex: 1, padding: '16px 0', borderRadius: 18,
                background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff', fontSize: 16, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-.02em',
              }}
            >↺ Recommencer</button>
          )
        ) : (
          <>
            <button
              onClick={handleClear}
              disabled={!hasDrawn}
              style={{
                flex: 1, padding: '16px 0', borderRadius: 18,
                background: hasDrawn ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: hasDrawn ? '#fff' : 'rgba(255,255,255,0.28)',
                fontSize: 16, fontWeight: 600,
                cursor: hasDrawn ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all .2s',
              }}
            >↺ Recommencer</button>
            <button
              onClick={handleConfirm}
              disabled={!hasDrawn}
              style={{
                flex: 2, padding: '16px 0', borderRadius: 18,
                background: hasDrawn
                  ? 'linear-gradient(135deg,#2563eb,#1d4ed8)'
                  : 'rgba(37,99,235,0.22)',
                border: 'none', color: '#fff',
                fontSize: 16, fontWeight: 700,
                cursor: hasDrawn ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                boxShadow: hasDrawn ? '0 6px 24px rgba(37,99,235,0.50)' : 'none',
                transition: 'all .2s', letterSpacing: '-.02em',
              }}
            >✓ Valider la signature</button>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
