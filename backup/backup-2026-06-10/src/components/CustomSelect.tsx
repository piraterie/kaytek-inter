// src/components/CustomSelect.tsx
// Remplace <select> natif Android qui ignore le CSS des options
import { useState, useRef, useEffect } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}

export function CustomSelect({ value, options, onChange, placeholder = 'Sélectionner…', disabled, style }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  // Fermer si clic à l'extérieur
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  // Scroll vers l'option sélectionnée à l'ouverture
  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[data-selected="true"]') as HTMLElement
    if (active) active.scrollIntoView({ block: 'nearest' })
  }, [open])

  function toggle() {
    if (!disabled) setOpen(o => !o)
  }

  function pick(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', ...style }}>
      {/* Bouton déclencheur */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '0 36px 0 12px',
          background: disabled ? 'var(--s2)' : 'var(--s0)',
          border: `1px solid ${open ? 'var(--bl)' : 'var(--b1)'}`,
          borderRadius: 'var(--r)',
          color: selected ? 'var(--t0)' : 'var(--t3)',
          fontSize: 14,
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
          display: 'flex',
          alignItems: 'center',
          boxShadow: open ? '0 0 0 3px rgba(37,99,235,.14)' : 'none',
          transition: 'border-color .15s, box-shadow .15s',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '44px' }}>
          {selected?.label || placeholder}
        </span>
        {/* Chevron */}
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
          color: 'var(--t3)', fontSize: 11, pointerEvents: 'none', transition: 'transform .15s',
        }}>▼</span>
      </button>

      {/* Liste déroulante — rendu en CSS pur, pas de portal */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 999,
            background: 'var(--s0)',
            border: '1px solid var(--b1)',
            borderRadius: 'var(--r)',
            boxShadow: '0 8px 32px rgba(0,0,0,.2)',
            maxHeight: 280,
            overflowY: 'auto',
            marginTop: 4,
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '12px 14px', color: 'var(--t3)', fontSize: 13 }}>Aucune option</div>
          )}
          {options.map(opt => {
            const isSelected = opt.value === value
            return (
              <div
                key={opt.value}
                data-selected={isSelected}
                onMouseDown={e => { e.preventDefault(); pick(opt.value) }}
                onTouchEnd={e => { e.preventDefault(); pick(opt.value) }}
                style={{
                  padding: '12px 14px',
                  cursor: 'pointer',
                  color: 'var(--t0)',
                  background: isSelected ? 'var(--blBg)' : 'var(--s0)',
                  fontSize: 14,
                  fontWeight: isSelected ? 600 : 400,
                  borderBottom: '1px solid var(--b0)',
                  minHeight: 46,
                  display: 'flex',
                  alignItems: 'center',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
                onMouseEnter={e => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--s1)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--blBg)' : 'var(--s0)'
                }}
              >
                {opt.label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
