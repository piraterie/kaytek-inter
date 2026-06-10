// src/components/SignatureModal.tsx
import { useRef, useEffect, useState } from 'react'

interface Props {
  onConfirm: (base64: string) => void
  onCancel: () => void
  loading?: boolean
}

export default function SignatureModal({ onConfirm, onCancel, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * ratio
      canvas.height = canvas.offsetHeight * ratio
      ctx.scale(ratio, ratio)
      ctx.strokeStyle = '#111'
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
    resize()

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect()
      if ('touches' in e) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
      }
      return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top }
    }

    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      drawing.current = true
      const { x, y } = getPos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
    const move = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      if (!drawing.current) return
      const { x, y } = getPos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      setIsEmpty(false)
    }
    const stop = () => { drawing.current = false }

    canvas.addEventListener('mousedown', start)
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseup', stop)
    canvas.addEventListener('mouseleave', stop)
    canvas.addEventListener('touchstart', start, { passive: false })
    canvas.addEventListener('touchmove', move, { passive: false })
    canvas.addEventListener('touchend', stop)

    return () => {
      canvas.removeEventListener('mousedown', start)
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseup', stop)
      canvas.removeEventListener('mouseleave', stop)
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove', move)
      canvas.removeEventListener('touchend', stop)
    }
  }, [])

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  function confirm() {
    const canvas = canvasRef.current
    if (!canvas || isEmpty) return
    onConfirm(canvas.toDataURL('image/png'))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 16
    }}>
      <div style={{
        background: 'var(--s0)', borderRadius: 'var(--r3)',
        width: '100%', maxWidth: 560,
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 20, boxShadow: '0 8px 40px rgba(0,0,0,0.4)'
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--t0)' }}>Signature du client</div>
          <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 4 }}>Signez dans le cadre ci-dessous</div>
        </div>

        <div style={{ position: 'relative', border: '2px dashed var(--b1)', borderRadius: 'var(--r2)', background: '#fff', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', width: '100%', height: 200, cursor: 'crosshair', touchAction: 'none' }}
          />
          {isEmpty && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', color: '#aaa', fontSize: 14
            }}>
              ✍ Tracez votre signature ici
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={clear} disabled={loading || isEmpty}>
            Effacer
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Annuler
            </button>
            <button
              className="btn btn-primary"
              onClick={confirm}
              disabled={loading || isEmpty}
              style={{ minWidth: 140 }}
            >
              {loading ? 'Enregistrement…' : '✓ Valider la signature'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
