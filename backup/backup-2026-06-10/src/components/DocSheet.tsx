// src/components/DocSheet.tsx
// Bottom sheet contextuel partagé — Devis & Factures
import { useEffect } from 'react'

interface DocSheetProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}

export function DocSheet({ title, subtitle, onClose, children }: DocSheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.55)',
        zIndex: 200,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', alignItems: 'center',
        animation: 'fadeIn .2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--s0)',
          borderRadius: '24px 24px 0 0',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '100%',
          maxWidth: 600,
          animation: 'sheetUp .26s cubic-bezier(.32,.72,0,1)',
          paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 40px rgba(0,0,0,.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div style={{ width: 40, height: 4, background: 'var(--s3)', borderRadius: 2, margin: '14px auto 0', flexShrink: 0 }} />
        {/* Header */}
        <div style={{ padding: '16px 22px 14px', borderBottom: '1px solid var(--b0)' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--t0)', letterSpacing: '-.025em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 3 }}>{subtitle}</div>}
        </div>
        {/* Actions */}
        <div>{children}</div>
      </div>
    </div>
  )
}

interface SheetRowProps {
  icon: string
  label: string
  sublabel?: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  loading?: boolean
}

export function SheetRow({ icon, label, sublabel, onClick, danger, disabled, loading }: SheetRowProps) {
  const isDisabled = disabled || loading
  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '15px 22px',
        border: 'none',
        borderBottom: '1px solid var(--b0)',
        background: 'none',
        textAlign: 'left',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: isDisabled ? 0.45 : 1,
        WebkitTapHighlightColor: 'transparent',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--s1)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
      onTouchStart={e => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--s1)' }}
      onTouchEnd={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      <span style={{ fontSize: 22, width: 28, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
        {loading ? '⏳' : icon}
      </span>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{
          fontSize: 15, fontWeight: 500, lineHeight: 1.3,
          color: danger ? 'var(--rdTx)' : 'var(--t0)',
        }}>
          {loading ? 'En cours…' : label}
        </div>
        {sublabel && !loading && (
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{sublabel}</div>
        )}
      </div>
    </button>
  )
}

export function SheetSection({ label }: { label: string }) {
  return (
    <div style={{
      padding: '10px 22px 6px',
      background: 'var(--s1)',
      fontSize: 11,
      fontWeight: 700,
      color: 'var(--t3)',
      textTransform: 'uppercase',
      letterSpacing: '.07em',
    }}>
      {label}
    </div>
  )
}
